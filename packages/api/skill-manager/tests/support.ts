/**
 * Shared harness for the skill-manager specs: a Context with the real skill
 * registry and the real storage stack (json backend under the temp home),
 * a scripted `sessionQuery` whose sessions map to folders, and the manager
 * itself. No agent or preset is composed: catalog reads resolve the global
 * layer, which is where the managed provider registers.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import Storage from '@deepseek-ai/dsh-storage'
import {
  apply as storageDomainApply, Config as storageDomainConfig, inject as storageDomainInject, name as storageDomainName,
} from '@deepseek-ai/dsh-storage-domain'
import {
  apply as storageJsonApply, Config as storageJsonConfig, inject as storageJsonInject, name as storageJsonName,
} from '@deepseek-ai/dsh-storage-json'
import SkillManager, { SKILL_MANAGER_LIMITS, type SkillLibraryChange } from '../src/index.ts'

const roots: string[] = []
const contexts: Context[] = []

/** Dispose every context and remove every temp root created since the last call. */
export async function cleanup(): Promise<void> {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
}

/**
 * A fresh temp directory removed by {@link cleanup}.
 * @param prefix - directory name prefix.
 * @returns the absolute path.
 */
export function temp(prefix = 'dsh-skill-manager-'): string {
  const root = mkdtempSync(join(tmpdir(), prefix))
  roots.push(root)
  return root
}

/** One mounted manager and the knobs the specs turn. */
export interface Harness {
  home: string
  ctx: Context
  api: SkillManager
  /** Session id → cwd; mutate to move a session or leave it without a folder. */
  sessions: Map<string, string | undefined>
  changes: SkillLibraryChange[]
  signal: AbortSignal
  /** Runs inside every `observeSession`, with the caller's signal (a spec can abort it mid-read). */
  onObserve: (sessionId: string, signal: AbortSignal | undefined) => void
  /** Session id → recorded preset; absent = projected `default`, `null` = projected without a preset, `'none'` = no projections at all. */
  presets: Map<string, string | null>
}

/** Harness options. */
export interface HarnessOptions {
  /** Reuse a home (a "restart" of the same installation). */
  home?: string
  sessions?: Record<string, string | undefined>
  config?: Record<string, unknown>
  /** A fake live-agent registry (`get(sessionId)`), for scope resolution. */
  agents?: { get: (sessionId: string) => object | undefined }
  /** A fake preset service (`standingKeyFor(preset)`), for scope resolution. */
  agentPresets?: { acquireScope: (preset: string | undefined) => Promise<{ key: object } & AsyncDisposable> }
}

/**
 * Mount the manager over a real registry and storage stack.
 * @param options - home reuse, session folders, extra config.
 * @returns the harness.
 */
export async function mount(options: HarnessOptions = {}): Promise<Harness> {
  const home = options.home ?? temp()
  const ctx = new Context()
  contexts.push(ctx)
  const sessions = new Map<string, string | undefined>(Object.entries(options.sessions ?? {}))
  await ctx.plugin(Storage)
  await ctx.plugin(
    { name: storageJsonName, inject: storageJsonInject, apply: storageJsonApply, Config: storageJsonConfig },
    { root: join(home, 'storages') },
  )
  await ctx.plugin(
    { name: storageDomainName, inject: storageDomainInject, apply: storageDomainApply, Config: storageDomainConfig },
    { backend: 'json' },
  )
  await ctx.plugin(SkillRegistry)
  ctx.provide('typert', {} as never)
  const hooks = { onObserve: (_sessionId: string, _signal: AbortSignal | undefined): void => {} }
  const presets = new Map<string, string | null>()
  ctx.provide('sessionQuery', {
    observeSession: async (sessionId: SessionId, options?: { signal?: AbortSignal }) => {
      if (!sessions.has(sessionId)) throw new Error(`session "${sessionId}" not found`)
      hooks.onObserve(sessionId, options?.signal)
      const preset = presets.has(sessionId) ? presets.get(sessionId) : 'default'
      const projections = preset === 'none' ? undefined : { values: { agentPreset: preset } }
      return { header: { cwd: sessions.get(sessionId) }, projections, [Symbol.dispose]: () => {} }
    },
  } as never)
  if (options.agents !== undefined) ctx.provide('agents', options.agents as never)
  if (options.agentPresets !== undefined) ctx.provide('agentPresets', options.agentPresets as never)
  await ctx.plugin(SkillManager, {
    ...SKILL_MANAGER_LIMITS,
    dshHome: home,
    agentsHome: join(home, 'agents'),
    watchLibrary: false,
    ...options.config,
  })
  const api = ctx.get('skillManager')
  if (api === undefined) throw new Error('Skill manager did not mount')
  const changes: SkillLibraryChange[] = []
  ctx.on('skill-manager/change', (change) => { changes.push(change) })
  return {
    home,
    ctx,
    api,
    sessions,
    changes,
    presets,
    signal: new AbortController().signal,
    set onObserve(hook: (sessionId: string, signal: AbortSignal | undefined) => void) { hooks.onObserve = hook },
    get onObserve() { return hooks.onObserve },
  }
}

/**
 * Write a minimal valid skill package.
 * @param root - directory to create.
 * @param name - skill name.
 * @param description - description; defaults to `<name> description`.
 * @returns the directory.
 */
export function writeSkill(root: string, name: string, description = `${name} description`): string {
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n\nBody of ${name}\n`)
  return root
}

/**
 * Install one skill package from a source directory and return its install id.
 * @param harness - mounted manager.
 * @param source - skill directory.
 * @returns the install id.
 */
export async function install(harness: Harness, source: string): Promise<string> {
  const outcome = await harness.api.applyImport({ path: source, selections: [{ key: 'SKILL.md', replaces: null }] }, harness.signal)
  const installed = outcome.installed[0]
  if (installed === undefined) throw new Error(`install failed: ${JSON.stringify(outcome.failures)}`)
  return installed.installId
}
