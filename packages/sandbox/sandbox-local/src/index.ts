/**
 * Local sandbox backend. It selects the platform runner chain (Linux bwrap then
 * Landlock; macOS Seatbelt; Windows the ACL restricted-token runner), functionally probes
 * competing candidates once, and reports each wrap's enforcement and stderr
 * classification facts. Missing or unusable confinement fails closed rather
 * than returning the original argv.
 *
 * The windows-acl rung additionally owns the write grants: the write SID is
 * the per-WORKSPACE identity derived from the canonical workspace path
 * (`workspaceWriteSid`), while every live session receives a RANDOM private
 * temp directory and its own derived capability (`tempWriteSid`). Upstream
 * lets the workspace-root grant STAND for good as a reuse cache; DeepSeekGUI
 * (2026-09-29) makes it through an out-of-process helper and takes it back
 * once the root has been idle for half a minute with no runner holding a
 * lease, because a standing Low label turns every program started from the
 * folder into a Low-integrity process. The private-temp ACEs are revoked on
 * dispose. The runner
 * receives both SIDs (their presence marks the seam-managed contract) and
 * stops managing DACLs itself. The rung reports partial enforcement because
 * NTFS hard links alias one file object across paths, reads stay unconfined,
 * and a tree another AppContainer tool has ACL'd with a package SID is not
 * readable by the Low-integrity child.
 * @module @deepseek-ai/dsh-sandbox-local
 */

import { execFile, spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  LAUNCHER_BIN,
  LAUNCHER_FAILURE_EXIT,
  launcherPath as landlockLauncherPath,
  probe as defaultProbeLandlock,
} from '@deepseek-ai/node-addon-system/landlock-run'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { SandboxProvider, SandboxUnavailableError, canonicalPath, readOnlySubtrees } from '@deepseek-ai/dsh-sandbox'
import type { ConfinedArgv, ConfinedSandboxMode, RunnerFailureRule, SandboxEnforcement, SandboxPolicy } from '@deepseek-ai/dsh-sandbox'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { AclWriteGrant, assertTempRootOutsideWorkspace, registerAclDiagnosisSkill, tempWriteSid, workspaceWriteSid } from '@deepseek-ai/dsh-sandbox-windows-acl'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import { bwrapProfileArgs, landlockProfileArgs, seatbeltProfileArgs } from './profiles.ts'

/** Plugin config. All optional — `static Config` supplies the defaults. */
export interface Config {
  /**
   * Override the runner argv; bwrap-compatible profile arguments are appended. A
   * non-empty override asserts full enforcement and skips built-in selection and
   * probing. A runner that starts but refuses its profile must be identifiable by
   * {@link runnerFailureSignatures}. Consumers classify a spawn rejection only after
   * confirming the workdir is usable. `ENOENT` or `EACCES` identifies the runner when
   * `error.path` equals argv[0] and `error.syscall` is `spawn` or `spawn <runner>`, or
   * when `error.path` is absent and `error.syscall` is exactly `spawn <runner>`.
   */
  runnerCommand?: string[]
  /**
   * Case-insensitive stderr substrings emitted when a configured
   * {@link runnerCommand} refuses its profile before executing the wrapped
   * command. Required and non-empty with `runnerCommand`; rejected without
   * it. Each entry is a non-empty, single-line, case-insensitive substring
   * covering the executable runner's own failure dialect.
   */
  runnerFailureSignatures?: string[]
  /** Positive timeout for each functional probe; zero would mean unbounded to Node. */
  probeTimeoutMs?: number
}

/** Probe whether `bwrap` can create the profile; the provider caches the bounded result. */
function defaultProbeBwrap(timeoutMs: number): boolean {
  const probe = spawnSync('bwrap', [...bwrapProfileArgs({ mode: 'read-only', workspaceRoot: '/' }), '--', 'true'], {
    timeout: timeoutMs,
    stdio: 'ignore',
  })
  return probe.status === 0
}

/**
 * Functional Seatbelt probe: apply the real `read-only` profile through
 * `sandbox-exec -p` and run `true` under it — exit 0 means the kernel
 * accepted and enforced the profile (`sandbox-exec` exits non-zero when
 * `sandbox_init` refuses it). A missing `sandbox-exec` (every non-macOS
 * host) fails the spawn and probes `unusable`, exactly like the other
 * rungs' absent binaries. Apple marks the CLI deprecated but ships it on
 * every macOS; if it ever disappears, this probe is what fails closed.
 */
function defaultProbeSeatbelt(seatbeltExec: string, timeoutMs: number): boolean {
  const probe = spawnSync(seatbeltExec, [...seatbeltProfileArgs({ mode: 'read-only', workspaceRoot: '/' }), '--', 'true'], {
    timeout: timeoutMs,
    stdio: 'ignore',
  })
  return probe.status === 0
}

/**
 * Functional windows-acl probe: run the runner in read-only mode (zero grants,
 * no ACL mutation) around `cmd /c exit 0` — exit 0 means the runner created
 * the restricted token and spawned the child under it. The win32 chain is a
 * sole candidate, so the product never probes; the probe exists for override
 * chains and mirrors the other rungs' shape.
 */
function defaultProbeWindowsAcl(runnerInvocation: string[], timeoutMs: number): boolean {
  const program = runnerInvocation[0]
  if (program === undefined) return false
  const probe = spawnSync(program, [
    ...runnerInvocation.slice(1),
    '--workspace', tmpdir(), '--temp', tmpdir(), '--mode', 'read-only',
    '--', 'cmd', '/c', 'exit', '0',
  ], {
    timeout: timeoutMs,
    stdio: 'ignore',
  })
  return probe.status === 0
}

/** Test hook: inject probe verdicts / a fake launcher / a platform without real runners. */
export interface SandboxInternals {
  /** Replaces `process.platform` for chain selection (exercise any platform's chain from any host). */
  platform?: string
  /** Replaces the platform's chain wholesale (walk mechanics — e.g. probing a rung the product chains only reach unprobed). */
  chain?: readonly SelectedRunner['runner'][]
  /** Replaces the functional `bwrap` probe (the Linux chain's first rung). */
  probeBwrap?: () => boolean
  /** Replaces the functional Landlock launcher probe (the Linux chain's second rung). */
  probeLandlock?: (launcher: string) => SandboxEnforcement | 'unusable'
  /** Replaces the functional Seatbelt probe (the darwin chain's sole rung — only consulted if that chain ever grows). */
  probeSeatbelt?: (seatbeltExec: string) => boolean
  /** Replaces the resolved `landlock-run` launcher path (a fake launcher script). */
  landlockLauncher?: string
  /** Replaces the `sandbox-exec` executable the probe and wraps invoke (a fake script). */
  seatbeltExec?: string
  /** Replaces the resolved windows-acl runner argv prefix (a fake runner). */
  windowsAclRunnerArgs?: string[]
  /** Replaces the resolved windows-acl runner built entry path (a fake lib/runner.js location). */
  windowsAclRunnerEntry?: string
  /** Replaces the functional windows-acl probe (the win32 chain's sole rung — only consulted if that chain ever grows). */
  probeWindowsAcl?: () => boolean
  /** Replaces the private-temp-directory removal at provider dispose (a throwing fake exercises the cleanup-failure path). */
  rmTempDir?: (path: string) => void
  /** DeepSeekGUI: replaces the out-of-process `acl-helper` run (grant / revoke / purge of a workspace's marks). */
  aclHelper?: (command: AclHelperCommand, workspace: string, readOnly: readonly string[]) => Promise<void>
  /** DeepSeekGUI: replaces the read-only probe of a workspace root (grant standing? any mark?). */
  inspectWorkspace?: (workspace: string) => { grant: boolean; marks: boolean }
  /** DeepSeekGUI: replaces the liveness check of a lease's runner pid. */
  leaseAlive?: (pid: number) => boolean
  /** DeepSeekGUI: replaces the clock the idle sweep reads. */
  now?: () => number
  /** DeepSeekGUI: replaces the detached revoke spawned at provider dispose. */
  revokeDetached?: (workspace: string) => void
  /** DeepSeekGUI: replaces the resolved `acl-helper` built entry path (a fake lib/acl-helper.js location). */
  aclHelperEntry?: string
}

/** DeepSeekGUI: the `acl-helper` commands (see `@deepseek-ai/dsh-sandbox-windows-acl/acl-helper`). */
export type AclHelperCommand = 'grant' | 'revoke' | 'purge'

/**
 * DeepSeekGUI: what {@link LocalSandboxProvider.cleanWorkspaceMarks} did.
 * `cleaned` — the marks on `root` are gone; `clean` — no folder from the
 * chosen one up carries any; `busy` — `root` carries them and a confined
 * command is running there right now; `unsupported` — this host does not
 * confine with Windows ACLs.
 */
export interface SandboxMarksClean {
  status: 'cleaned' | 'clean' | 'busy' | 'unsupported'
  /** The folder the marks were on (the chosen folder, or the ancestor they are inherited from). */
  root: string
}

/**
 * DeepSeekGUI (2026-09-29): how long a workspace grant stays after its last
 * confined command, with no runner holding a lease, before the seam takes it
 * back. A turn's commands follow each other within seconds; a finished turn
 * leaves the folder an ordinary Medium folder half a minute later.
 */
const IDLE_REVOKE_MS = 30_000

/** How often the idle sweep looks. */
const IDLE_SWEEP_MS = 10_000

/** How long after start the cleanup of registered workspaces begins — out of the way of the first requests. */
const STARTUP_PURGE_DELAY_MS = 5_000

/** Upper bound for one helper run: a very large tree propagates for minutes, not hours. */
const ACL_HELPER_TIMEOUT_MS = 30 * 60_000

/**
 * DeepSeekGUI: the lease directory of one workspace — runners hold `<pid>`
 * files here while they run (`--lease`). Keyed by the workspace SID, so every
 * provider and runner on this machine agrees on it.
 * @param root - the canonical workspace root.
 * @returns the directory.
 */
function aclLeaseDir(root: string): string {
  return join(tmpdir(), 'dsh-acl-leases', workspaceWriteSid(root))
}

/**
 * Whether a process with this pid is running (signal 0: EPERM still means it exists).
 * @param pid - the runner's pid.
 * @returns whether it is alive.
 */
function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'EPERM'
  }
}

/**
 * The registered workspace paths from the `workspaceRegistry` service, read
 * structurally (this package does not depend on the workspace package).
 * @param registry - the service, or anything else.
 * @returns the paths; empty when the service does not look like a registry.
 */
function workspacePaths(registry: unknown): string[] {
  if (typeof registry !== 'object' || registry === null || !('list' in registry) || typeof registry.list !== 'function') return []
  const listed: unknown = Reflect.apply(registry.list, registry, [])
  if (!Array.isArray(listed)) return []
  return listed.flatMap((workspace: unknown) =>
    typeof workspace === 'object' && workspace !== null && 'path' in workspace && typeof workspace.path === 'string' ? [workspace.path] : [])
}

/** DeepSeekGUI: one workspace's grant as this provider knows it. */
interface WorkspaceGrantState {
  /** The standing grant is on the root (made by this provider, or by an agentless runner it launched). */
  granted: boolean
  /** Last confined command for this root (ms, {@link LocalSandboxProvider.now}). */
  lastUsed: number
  /** Serializes grant, revoke, and purge for this root. */
  queue: Promise<void>
}

/** The chain's verdict: which runner confines, and how completely it enforces. */
type SelectedRunner = { runner: 'bwrap' | 'landlock' | 'seatbelt' | 'windows-acl'; enforcement: SandboxEnforcement }

/** One live session/workspace pair's private temp directory and capability. */
interface AclTempCapability {
  dir: string
  writeSid: string
  grant: AclWriteGrant
}

/**
 * The runner chain per platform — selection is BY PLATFORM first, probes
 * second: a platform's chain is probed in preference order only when it has
 * MORE than one candidate (probing arbitrates; it does not re-validate a
 * choice that has no alternative). A platform with no chain fails closed at
 * `confine()`. Linux prefers `bwrap` (its mount profile is closest to the
 * mode vocabulary) over the Landlock launcher; darwin has exactly one
 * candidate, selected without any probe.
 */
const PLATFORM_CHAINS: Record<string, readonly SelectedRunner['runner'][]> = {
  linux: ['bwrap', 'landlock'],
  darwin: ['seatbelt'],
  // The Windows restricted-token runner (@deepseek-ai/dsh-sandbox-windows-acl):
  // a sole candidate, selected without a probe — its execution-time refusal
  // fails closed through its stderr signature (windows-acl-run:) and exit 127.
  win32: ['windows-acl'],
}

/**
 * Enforcement completeness a rung claims when selected WITHOUT a probe (a
 * chain of one). `bwrap` and Seatbelt govern every promised file effect by
 * construction, so the claim is a profile fact; `landlock` is listed for the
 * table's totality but is unreachable without a probe (the Linux chain has
 * two rungs, so it is only ever selected through its probe, whose report is
 * what distinguishes full from per-ABI-partial — and the launcher additionally
 * self-reports partial enforcement on stderr at every confined run).
 */
const STATIC_ENFORCEMENT: Record<SelectedRunner['runner'], SandboxEnforcement> = {
  bwrap: 'full',
  landlock: 'full',
  seatbelt: 'full',
  // Everyone stays in both restricting lists for process initialization, but
  // the Low label denies the write authority it used to confer. NTFS hard
  // links still alias a granted workspace file to a path outside it, reads
  // stay unconfined, and an AppContainer-ACL'd tree is unreadable to the
  // child: the backend enforces the remaining ACL-addressable surface but
  // must not advertise the absolute promise.
  'windows-acl': 'partial',
}

/**
 * A probe bound must be a positive finite number: Node treats
 * `spawnSync({ timeout: 0 })` as NO timeout, so an unvalidated 0 would
 * silently mean "unbounded" — the opposite of what the field promises.
 */
function assertPositiveFinite(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`sandbox-local: ${name} must be a positive finite number`)
  }
}

/**
 * The denial dialect each runner's kernel speaks — the case-insensitive stderr substrings a
 * denied file effect produces under it, carried on every wrap (the seam's
 * `ConfinedArgv.denialSignatures`).
 */
const DENIAL_SIGNATURES = {
  bwrap: ['read-only file system'],
  landlock: ['permission denied'],
  seatbelt: ['operation not permitted'],
  // pwsh/.NET: "Access to the path '...' is denied."; cmd: "Access is denied.";
  // Node EACCES: "permission denied"; EPERM: "operation not permitted".
  'windows-acl': ['access is denied', 'access to the path', 'permission denied', 'operation not permitted'],
  runnerCommand: ['read-only file system', 'permission denied'],
} as const satisfies Record<SelectedRunner['runner'] | 'runnerCommand', readonly string[]>

/** The windows-acl runner's documented failure exit (its own RUNNER_FAILURE_EXIT contract, distinct from Landlock's 125). */
const WINDOWS_ACL_RUNNER_FAILURE_EXIT = 127

/**
 * Runner-owned fatal diagnostics. Landlock has a versioned exit-125 plus
 * fatal-line launcher-failure contract. Bubblewrap's current fatal paths exit
 * 1 but its public contract does not reserve that status, while sandbox-exec
 * publishes no launcher-failure status; those backends remain signature-only.
 * The windows-acl runner prints `windows-acl-run: <detail>` on every
 * runner-side failure and exits 127 — the rule is exit-gated on that status
 * so a confined command that merely PRINTS the signature (or a runner
 * cleanup failure reported on a non-zero child exit) is never misclassified
 * as "the command did not run". Keep the Landlock tuple aligned with the
 * assembled snapshot fixture at
 * `packages/test-support/session-snapshot/tests/fixtures/partial-landlock-sandbox.ts`.
 */
const RUNNER_FAILURE_RULES = {
  bwrap: [{ fatalSignatures: ['bwrap: '] }],
  landlock: [{
    allowedExitCodes: [LAUNCHER_FAILURE_EXIT],
    fatalSignatures: [`${LAUNCHER_BIN}: `],
    informationalLines: [`${LAUNCHER_BIN}: partial enforcement (older Landlock ABI)`],
  }],
  seatbelt: [{ fatalSignatures: ['sandbox-exec: '] }],
  'windows-acl': [{ allowedExitCodes: [WINDOWS_ACL_RUNNER_FAILURE_EXIT], fatalSignatures: ['windows-acl-run: '] }],
} as const satisfies Record<SelectedRunner['runner'], readonly RunnerFailureRule[]>

/**
 * Local process-sandbox provider. Registers as `ctx.sandbox`. Caches the
 * chain verdict and, on the windows-acl rung, the write grants
 * ({@link AclWriteGrant}: the standing workspace-root grant per workspace
 * and the revocable private-temp grant per live session/workspace pair, the
 * latter revoked on provider dispose); the one-time probes spawn nothing
 * else.
 */
export class LocalSandboxProvider extends SandboxProvider {
  // Inline schema call: the config catalog walks `static Config` statically.
  static Config: z<Config> = z.object({
    runnerCommand: z.array(z.string()).default([]),
    runnerFailureSignatures: z.array(z.string()).default([]),
    probeTimeoutMs: z.natural().default(5_000),
  })

  /** Test hook (mirrors the bash executors' `internals`). */
  internals: SandboxInternals = {}

  private readonly runnerCommand: string[] | undefined
  private readonly configuredRunnerFailureSignatures: string[]
  private readonly probeTimeoutMs: number
  /** Cached chain verdict; undefined until the first confined wrap needs it. */
  private selectedRunner: SelectedRunner | 'unavailable' | undefined
  /**
   * DeepSeekGUI (2026-09-29): workspace grants this provider made or saw made
   * (windows-acl rung), keyed by canonical root. Upstream kept each grant
   * standing for good as a reuse cache, which left every workspace a Low
   * integrity folder long after the session; here a grant is taken back once
   * the root is idle and no runner holds a lease on it.
   */
  private readonly workspaces = new Map<string, WorkspaceGrantState>()
  /** The REVOCABLE private-temp grant per live session/workspace pair (revoked on provider dispose). */
  private readonly tempCapabilities = new Map<string, AclTempCapability>()

  constructor(ctx: Context, config: Config) {
    super(ctx)
    // The schema (static Config) defaults every field — the casts record
    // those runtime facts. An empty runnerCommand means "not configured":
    // use the platform chain.
    const runner = config.runnerCommand as string[]
    const runnerFailureSignatures = config.runnerFailureSignatures as string[]
    if (runner.length === 0 && runnerFailureSignatures.length > 0) {
      throw new Error('sandbox-local: runnerFailureSignatures requires runnerCommand')
    }
    if (runner.length > 0 && runnerFailureSignatures.length === 0) {
      throw new Error('sandbox-local: runnerCommand requires at least one runnerFailureSignatures entry')
    }
    if (runnerFailureSignatures.some(signature => signature.trim().length === 0 || /[\r\n]/u.test(signature))) {
      throw new Error('sandbox-local: runnerFailureSignatures entries must be non-empty single-line strings')
    }
    this.runnerCommand = runner.length > 0 ? runner : undefined
    this.configuredRunnerFailureSignatures = runnerFailureSignatures
    this.probeTimeoutMs = config.probeTimeoutMs as number
    assertPositiveFinite('probeTimeoutMs', this.probeTimeoutMs)
    // An operator-supplied runner does not use the ACL backend. The registry
    // remains optional and may be mounted after this provider.
    /* v8 ignore start -- Windows-only registration; the Linux coverage lane cannot take this branch */
    if (process.platform === 'win32' && this.runnerCommand === undefined) {
      ctx.inject(['skills'], (skillsCtx) => { registerAclDiagnosisSkill(skillsCtx) })
      // DeepSeekGUI: take idle workspace grants back, and once per start clean
      // the registered workspaces an older build or a crash left marked.
      ctx.effect(() => {
        const sweep = setInterval(() => { void this.revokeIdleGrants() }, IDLE_SWEEP_MS)
        sweep.unref()
        return () => { clearInterval(sweep) }
      })
      ctx.inject(['workspaceRegistry'], (registryCtx) => {
        registryCtx.effect(() => {
          const timer = setTimeout(() => { void this.purgeRegisteredWorkspaces(registryCtx.get('workspaceRegistry')) }, STARTUP_PURGE_DELAY_MS)
          timer.unref()
          return () => { clearTimeout(timer) }
        })
      })
    }
    /* v8 ignore stop */
    // The temp grants are revoked with the provider, and DeepSeekGUI hands
    // every workspace grant still standing to a detached helper: a clean
    // server shutdown leaves no marks behind. An unclean shutdown leaves them
    // for the next start's cleanup of the registered workspaces.
    ctx.effect(() => () => {
      this.revokeAclGrants()
    })
  }

  /**
   * Wrap `argv` in the selected runner's invocation for `policy` — the configured
   * `runnerCommand` when present (the operator's assertion, no probe), else the platform
   * chain's runner speaking its own profile dialect.
   *
   * @param argv - the exact argv the caller is about to spawn.
   * @param policy - the file-effect policy this execution runs under.
   * @param signal - cancellation before policy resolution or grant creation.
   * @returns the wrapped argv plus the selected backend's enforcement completeness, denial
   *   signatures, and structured runner-failure rules; throws the fail-closed
   *   `SANDBOX_UNAVAILABLE` error when the platform has no usable runner.
   */
  async confine(argv: readonly string[], policy: SandboxPolicy, signal?: AbortSignal): Promise<ConfinedArgv> {
    signal?.throwIfAborted()
    policy = { ...policy, workspaceRoot: canonicalPath(policy.workspaceRoot) }
    if (this.runnerCommand !== undefined) {
      return Promise.resolve<ConfinedArgv>({
        argv: [...this.runnerCommand, ...bwrapProfileArgs(policy), '--', ...argv],
        enforcement: 'full',
        denialSignatures: DENIAL_SIGNATURES.runnerCommand,
        runnerFailureRules: [{ fatalSignatures: this.configuredRunnerFailureSignatures }],
      })
    }
    const selected = this.selectRunner(policy.mode)
    const runnerArgv = await this.runnerArgv(selected.runner, policy, signal)
    return {
      argv: [...runnerArgv, '--', ...argv],
      enforcement: selected.enforcement,
      denialSignatures: DENIAL_SIGNATURES[selected.runner],
      runnerFailureRules: RUNNER_FAILURE_RULES[selected.runner],
    }
  }

  /** The selected rung's runner invocation (program + profile arguments) for one policy. */
  private async runnerArgv(runner: SelectedRunner['runner'], policy: SandboxPolicy, signal?: AbortSignal): Promise<string[]> {
    switch (runner) {
      case 'bwrap': return ['bwrap', ...bwrapProfileArgs(policy)]
      case 'landlock': return [this.landlockLauncher(), ...landlockProfileArgs(policy)]
      case 'seatbelt': return [this.seatbeltExec(), ...seatbeltProfileArgs(policy)]
      case 'windows-acl': return this.windowsAclRunnerArgv(policy, signal)
      default: return assertNever(runner)
    }
  }

  /**
   * The windows-acl runner argv for one policy. With a calling session (the
   * policy's `sessionId`) under workspace-write, the workspace-root grant is
   * made through the out-of-process `acl-helper` (DeepSeekGUI: queued per
   * root, and taken back again once the root is idle — see
   * {@link revokeIdleGrants}) and a revocable, RANDOM private-temp capability
   * is materialized per live session/workspace pair. The runner receives
   * `--write-sid` plus `--temp-write-sid` and grants nothing itself.
   * Agentless workspace-write calls pass the ambient temp ROOT and no SID
   * flags: the runner creates and removes a random private child directory
   * for that one invocation and grants the workspace itself. Every
   * workspace-write runner holds a `--lease` for as long as it runs.
   * @param policy - the resolved per-call policy.
   * @param signal - cancellation while the grant is queued.
   * @returns the runner invocation.
   */
  private async windowsAclRunnerArgv(policy: SandboxPolicy, signal?: AbortSignal): Promise<string[]> {
    const sessionId = policy.sessionId
    const root = policy.workspaceRoot
    if (policy.mode === 'read-only') {
      return [...this.windowsAclRunnerInvocation(), '--workspace', root, '--temp', tmpdir(), '--mode', policy.mode]
    }
    const lease = ['--lease', aclLeaseDir(root)]
    if (sessionId === undefined) {
      // DeepSeekGUI: an agentless workspace-write runner grants the workspace
      // itself, so it also gets the directories that stay read-only inside it.
      // It waits out a revoke or purge in flight; the idle sweep then takes
      // its grant back like any other.
      await this.useWorkspace(root, false, signal)
      return [
        ...this.windowsAclRunnerInvocation(),
        '--workspace', root,
        '--temp', tmpdir(),
        '--mode', policy.mode,
        ...readOnlySubtrees(root).flatMap(directory => ['--read-only', directory]),
        ...lease,
      ]
    }
    assertTempRootOutsideWorkspace(root, tmpdir())
    await this.useWorkspace(root, true, signal)
    const temp = this.materializeTempCapability(sessionId, root)
    return [
      ...this.windowsAclRunnerInvocation(),
      '--workspace', root,
      '--temp', temp.dir,
      '--mode', policy.mode,
      '--write-sid', workspaceWriteSid(root),
      '--temp-write-sid', temp.writeSid,
      ...lease,
    ]
  }

  /**
   * DeepSeekGUI (2026-09-29): mark `root` in use and, for a session call,
   * make sure its workspace grant stands — probed in process (one read), made
   * through `acl-helper` when missing, which also repairs a grant something
   * outside this provider took away. Queued behind any revoke or purge in
   * flight for the same root. Fail-closed: a helper failure rejects the
   * confinement.
   * @param root - the canonical workspace root.
   * @param grant - whether this provider makes the grant (session calls) or the runner does (agentless).
   * @param signal - cancellation while queued.
   */
  private async useWorkspace(root: string, grant: boolean, signal?: AbortSignal): Promise<void> {
    const state = this.workspaceState(root)
    state.lastUsed = this.now()
    const step = state.queue.then(async () => {
      signal?.throwIfAborted()
      // DeepSeekGUI: nested repositories' .git and protected code below the
      // workspace stay read-only for the workspace SID (scanned per grant).
      if (grant && !this.inspectWorkspace(root).grant) await this.runAclHelper('grant', root, readOnlySubtrees(root))
      state.granted = true
      state.lastUsed = this.now()
    })
    state.queue = step.catch(() => undefined)
    await step
  }

  /** This root's grant state, created on first use. */
  private workspaceState(root: string): WorkspaceGrantState {
    let state = this.workspaces.get(root)
    if (state === undefined) {
      state = { granted: false, lastUsed: 0, queue: Promise.resolve() }
      this.workspaces.set(root, state)
    }
    return state
  }

  /**
   * DeepSeekGUI (2026-09-29): take back the grant of every workspace idle for
   * {@link IDLE_REVOKE_MS} with no live lease. Runs on a timer; each revoke
   * waits in its root's queue and checks again there, so a command that came
   * in meanwhile keeps the grant. A failed revoke is logged and the grant is
   * tried again by a later sweep.
   * @returns once every revoke this sweep started has settled.
   */
  async revokeIdleGrants(): Promise<void> {
    if (this.sweeping) return
    this.sweeping = true
    try {
      for (const [root, state] of this.workspaces) {
        if (!this.idle(root, state)) continue
        const step = state.queue.then(async () => {
          if (!this.idle(root, state)) return
          await this.runAclHelper('revoke', root, [])
          state.granted = false
        })
        state.queue = step.catch((error: unknown) => {
          this.ctx.logger.warn(`sandbox-local: taking back the windows-acl grant on ${root} failed; the next sweep tries again`)
          this.ctx.logger.warn(error)
        })
        await state.queue
      }
    } finally {
      this.sweeping = false
    }
  }

  /** Whether a sweep is running (one at a time). */
  private sweeping = false

  /** A granted root, unused for {@link IDLE_REVOKE_MS}, that no live runner holds a lease on. */
  private idle(root: string, state: WorkspaceGrantState): boolean {
    return state.granted && this.now() - state.lastUsed >= IDLE_REVOKE_MS && this.liveLeases(root) === 0
  }

  /**
   * Count the live leases on `root`, discarding the ones a crashed runner
   * left (a pid no longer running).
   * @param root - the canonical workspace root.
   * @returns the number of runners still holding a lease.
   */
  private liveLeases(root: string): number {
    const dir = aclLeaseDir(root)
    let names: string[]
    try {
      names = readdirSync(dir)
    } catch {
      return 0
    }
    const alive = this.internals.leaseAlive ?? processAlive
    let live = 0
    for (const name of names) {
      const pid = Number(name)
      if (Number.isSafeInteger(pid) && pid > 0 && alive(pid)) {
        live++
        continue
      }
      try {
        rmSync(join(dir, name), { force: true })
      } catch {
        // Still there next sweep; it only counts as dead again.
      }
    }
    return live
  }

  /**
   * DeepSeekGUI (2026-09-29): once per start, clean every registered
   * workspace that still carries marks — standing grants an older build left
   * for good, or grants a crashed Harness could not take back. One read per
   * workspace; the helper runs only where a mark is found, queued like any
   * other change of that root, and never on a root this provider has granted
   * since start or that a live runner holds a lease on.
   * @param registry - the `workspaceRegistry` service, read structurally.
   * @returns once every workspace has been looked at.
   */
  async purgeRegisteredWorkspaces(registry: unknown): Promise<void> {
    for (const path of workspacePaths(registry)) {
      let root: string
      try {
        root = canonicalPath(path)
      } catch {
        continue
      }
      if (!existsSync(root)) continue
      const state = this.workspaceState(root)
      const step = state.queue.then(async () => {
        if (state.granted || this.liveLeases(root) > 0) return
        if (!this.inspectWorkspace(root).marks) return
        await this.runAclHelper('purge', root, readOnlySubtrees(root))
      })
      state.queue = step.catch((error: unknown) => {
        this.ctx.logger.warn(`sandbox-local: cleaning the sandbox marks on ${root} failed`)
        this.ctx.logger.warn(error)
      })
      await state.queue
    }
  }

  /**
   * DeepSeekGUI (2026-09-29): the desktop's "clean this folder's sandbox
   * marks". The marks a folder shows may be inherited from an ancestor
   * workspace, so the nearest folder from `path` up that carries them itself
   * is the one cleaned. Queued like every other change of that root; refused
   * (`busy`) while a confined command runs there, since pulling its grant
   * would fail the command mid-write. A grant this provider still counts as
   * standing is dropped with the marks, and the next confined command there
   * makes it again.
   * @param path - the folder the person chose.
   * @returns what was done, and on which folder.
   */
  async cleanWorkspaceMarks(path: string): Promise<SandboxMarksClean> {
    const chosen = canonicalPath(path)
    if ((this.internals.platform ?? process.platform) !== 'win32' || this.runnerCommand !== undefined) return { status: 'unsupported', root: chosen }
    let root: string | undefined
    for (let directory = chosen; root === undefined; directory = dirname(directory)) {
      if (this.inspectWorkspace(directory).marks) root = directory
      else if (dirname(directory) === directory) return { status: 'clean', root: chosen }
    }
    const target = root
    const state = this.workspaceState(target)
    let status: 'cleaned' | 'busy' = 'cleaned'
    const step = state.queue.then(async () => {
      if (this.liveLeases(target) > 0) {
        status = 'busy'
        return
      }
      await this.runAclHelper('purge', target, readOnlySubtrees(target))
      state.granted = false
    })
    state.queue = step.catch(() => undefined)
    await step
    return { status, root: target }
  }

  /** Read-only probe of a workspace root (injectable for tests). */
  private inspectWorkspace(root: string): { grant: boolean; marks: boolean } {
    if (this.internals.inspectWorkspace !== undefined) return this.internals.inspectWorkspace(root)
    const probe = AclWriteGrant.create(workspaceWriteSid(root))
    try {
      return probe.inspect(root)
    } finally {
      probe.dispose()
    }
  }

  /** The clock the idle sweep reads (injectable for tests). */
  private now(): number {
    return this.internals.now?.() ?? Date.now()
  }

  /**
   * Run `acl-helper` out of process and wait for it (injectable for tests).
   * @param command - grant, revoke, or purge.
   * @param root - the workspace root.
   * @param readOnly - directories kept read-only inside it (grant, purge).
   * @returns once the helper exited 0; rejects with its stderr otherwise.
   */
  private runAclHelper(command: AclHelperCommand, root: string, readOnly: readonly string[]): Promise<void> {
    if (this.internals.aclHelper !== undefined) return this.internals.aclHelper(command, root, readOnly)
    const [program, ...prefix] = this.aclHelperInvocation()
    const args = [...prefix, command, '--workspace', root, ...readOnly.flatMap(directory => ['--read-only', directory])]
    return new Promise((resolve, reject) => {
      execFile(program ?? process.execPath, args, { windowsHide: true, timeout: ACL_HELPER_TIMEOUT_MS }, (error, _stdout, stderr) => {
        if (error === null) resolve()
        else reject(new Error(`sandbox-local: acl-helper ${command} failed for ${root}: ${stderr.trim() || error.message}`))
      })
    })
  }

  /**
   * Hand one workspace's revoke to a detached helper that outlives this
   * process (provider dispose; injectable for tests).
   * @param root - the workspace root.
   */
  private revokeDetached(root: string): void {
    if (this.internals.revokeDetached !== undefined) {
      this.internals.revokeDetached(root)
      return
    }
    const [program, ...prefix] = this.aclHelperInvocation()
    const child = spawn(program ?? process.execPath, [...prefix, 'revoke', '--workspace', root], { detached: true, stdio: 'ignore', windowsHide: true })
    child.on('error', (error) => { this.ctx.logger.warn(error) })
    child.unref()
  }

  /**
   * Materialize one session/workspace pair's private temp capability, once
   * per provider lifetime. The temp directory is random and carries a
   * distinct SID, so another session on the same workspace cannot use the
   * shared workspace SID to enter it. A fresh provider always chooses a new
   * path; crash residue therefore cannot collide with or authorize a resumed
   * session. Fail-closed: a half-materialized temp grant is revoked and its
   * directory removed before the error propagates.
   * @param sessionId - the policy's calling-session identity.
   * @param workspaceRoot - the resolved policy root.
   * @returns the pair's private temp directory and write capability.
   */
  private materializeTempCapability(sessionId: SessionId, workspaceRoot: string): AclTempCapability {
    const key = JSON.stringify([String(sessionId), workspaceRoot])
    const existing = this.tempCapabilities.get(key)
    if (existing !== undefined) return existing
    const tempDir = mkdtempSync(join(tmpdir(), 'dsh-'))
    const tempSid = tempWriteSid(tempDir)
    let grant: AclWriteGrant | undefined
    try {
      grant = AclWriteGrant.create(tempSid)
      grant.add(tempDir)
    } catch (error) {
      const cleanupFailures: unknown[] = []
      if (grant !== undefined) {
        try {
          grant.dispose()
        } catch (cleanupError) {
          cleanupFailures.push(cleanupError)
        }
      }
      try {
        this.removeTempDir(tempDir)
      } catch (cleanupError) {
        cleanupFailures.push(cleanupError)
      }
      if (cleanupFailures.length > 0) {
        throw new AggregateError([error, ...cleanupFailures], 'sandbox-local windows-acl temp grant materialization failed and its cleanup also failed')
      }
      throw error
    }
    const capability = { dir: tempDir, writeSid: tempSid, grant }
    this.tempCapabilities.set(key, capability)
    return capability
  }

  /**
   * Dispose every write grant (provider dispose): the revocable temp ACEs
   * are revoked, the private temp directories this provider created are
   * removed, and every SID allocation is freed. DeepSeekGUI: every workspace
   * grant still standing goes to a detached `acl-helper revoke` — a large
   * tree takes seconds to propagate and teardown must not wait for it.
   * Cleanup failures are reported, not thrown: cordis teardown must not be
   * aborted by grant cleanup. A crash skips all of it; the next start's
   * cleanup of the registered workspaces takes the marks back, and a new
   * provider never reuses the temp residue's random path or SID.
   */
  private revokeAclGrants(): void {
    const failures: unknown[] = []
    for (const [root, state] of this.workspaces) {
      if (!state.granted) continue
      try {
        this.revokeDetached(root)
      } catch (error) {
        failures.push(error)
      }
    }
    this.workspaces.clear()
    if (this.tempCapabilities.size === 0 && failures.length === 0) return
    for (const grant of [...this.tempCapabilities.values()].map(capability => capability.grant)) {
      try {
        grant.dispose()
      } catch (error) {
        failures.push(error)
      }
    }
    for (const { dir } of this.tempCapabilities.values()) {
      try {
        this.removeTempDir(dir)
      } catch (error) {
        failures.push(error)
      }
    }
    this.tempCapabilities.clear()
    if (failures.length > 0) {
      this.ctx.logger.warn(`sandbox-local: windows-acl grant cleanup completed with ${failures.length} failure(s)`)
      for (const error of failures) this.ctx.logger.warn(error)
    }
  }

  /** Remove one provider-owned private temp directory (injectable for cleanup tests). */
  private removeTempDir(dir: string): void {
    const remove = this.internals.rmTempDir ?? ((path: string) => { rmSync(path, { recursive: true, force: true }) })
    remove(dir)
  }

  /**
   * Resolve which runner confines commands, once, for the provider's
   * lifetime: this platform's chain ({@link PLATFORM_CHAINS}), its sole
   * candidate selected directly, multiple candidates arbitrated by
   * functional probes in chain order. Fail closed when the platform has no
   * chain or no candidate passes — the command never runs.
   */
  private selectRunner(mode: ConfinedSandboxMode): SelectedRunner {
    this.selectedRunner ??= this.chainVerdict()
    if (this.selectedRunner === 'unavailable') throw new SandboxUnavailableError(mode)
    return this.selectedRunner
  }

  /** Walk this platform's chain: sole candidate unprobed, several probed in order, none usable → unavailable. */
  private chainVerdict(): SelectedRunner | 'unavailable' {
    const chain = this.internals.chain ?? PLATFORM_CHAINS[this.internals.platform ?? process.platform] ?? []
    const [first, ...rest] = chain
    if (first === undefined) return 'unavailable'
    // A sole candidate needs no arbitration; its execution-time refusal still fails closed.
    if (rest.length === 0) return { runner: first, enforcement: STATIC_ENFORCEMENT[first] }
    for (const runner of chain) {
      const enforcement = this.probeRunner(runner)
      if (enforcement !== 'unusable') return { runner, enforcement }
    }
    return 'unavailable'
  }

  /** One rung's functional probe (each at most once, via the chain walk). */
  private probeRunner(runner: SelectedRunner['runner']): SandboxEnforcement | 'unusable' {
    // bwrap's mount profile and Seatbelt's deny-file-write* profile govern
    // every promised file effect by construction, so their passing probes
    // are always full enforcement; the Landlock launcher's probe report
    // distinguishes full from per-ABI-partial, while windows-acl is always
    // partial for its documented hard-link, unconfined-read, and
    // AppContainer-ACL boundaries.
    switch (runner) {
      case 'bwrap': {
        const probe = this.internals.probeBwrap ?? (() => defaultProbeBwrap(this.probeTimeoutMs))
        return probe() ? 'full' : 'unusable'
      }
      case 'landlock': {
        const probe = this.internals.probeLandlock ?? (launcher => defaultProbeLandlock(launcher, { timeoutMs: this.probeTimeoutMs }))
        return probe(this.landlockLauncher())
      }
      case 'seatbelt': {
        const probe = this.internals.probeSeatbelt ?? (exec => defaultProbeSeatbelt(exec, this.probeTimeoutMs))
        return probe(this.seatbeltExec()) ? 'full' : 'unusable'
      }
      case 'windows-acl': {
        const probe = this.internals.probeWindowsAcl
          ?? (() => defaultProbeWindowsAcl(this.windowsAclRunnerInvocation(), this.probeTimeoutMs))
        return probe() ? 'partial' : 'unusable'
      }
      default: return assertNever(runner)
    }
  }

  /** The Landlock launcher to probe and exec (test hook over the resolved one). */
  private landlockLauncher(): string {
    return this.internals.landlockLauncher ?? landlockLauncherPath()
  }

  /** The `sandbox-exec` executable to probe and exec (test hook over the system one). */
  private seatbeltExec(): string {
    return this.internals.seatbeltExec ?? 'sandbox-exec'
  }

  /**
   * The windows-acl runner argv prefix: the built lib/runner.js entry when
   * present (production), else the package source through tsx (development).
   * Pin the source loader and TypeScript paths to this installation, independently
   * of target cwd or environment overrides.
   * The prefix stays `[node, runner, ...]` — a future native-exe runner keeps
   * the same argv contract and only swaps these entries.
   */
  private windowsAclRunnerInvocation(): string[] {
    const override = this.internals.windowsAclRunnerArgs
    if (override !== undefined) return override
    const builtEntry = this.internals.windowsAclRunnerEntry ?? fileURLToPath(import.meta.resolve('@deepseek-ai/dsh-sandbox-windows-acl/runner'))
    if (existsSync(builtEntry)) return [process.execPath, builtEntry]
    const sourceEntry = fileURLToPath(import.meta.resolve('@deepseek-ai/dsh-sandbox-windows-acl/src/runner.ts'))
    const sourceConfig = fileURLToPath(new URL('../../../../tsconfig.base.json', import.meta.url))
    const registration = `import { register } from ${JSON.stringify(import.meta.resolve('tsx/esm/api'))}; register({ tsconfig: ${JSON.stringify(sourceConfig)} });`
    return [process.execPath, '--import', `data:text/javascript,${encodeURIComponent(registration)}`, sourceEntry]
  }

  /**
   * DeepSeekGUI: the `acl-helper` argv prefix, resolved like the runner's —
   * the built lib/acl-helper.js entry when present (production), else the
   * package source through tsx (development).
   */
  private aclHelperInvocation(): string[] {
    const builtEntry = this.internals.aclHelperEntry ?? fileURLToPath(import.meta.resolve('@deepseek-ai/dsh-sandbox-windows-acl/acl-helper'))
    if (existsSync(builtEntry)) return [process.execPath, builtEntry]
    const sourceEntry = fileURLToPath(import.meta.resolve('@deepseek-ai/dsh-sandbox-windows-acl/src/acl-helper.ts'))
    const sourceConfig = fileURLToPath(new URL('../../../../tsconfig.base.json', import.meta.url))
    const registration = `import { register } from ${JSON.stringify(import.meta.resolve('tsx/esm/api'))}; register({ tsconfig: ${JSON.stringify(sourceConfig)} });`
    return [process.execPath, '--import', `data:text/javascript,${encodeURIComponent(registration)}`, sourceEntry]
  }
}

export default LocalSandboxProvider
