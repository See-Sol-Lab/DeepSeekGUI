/**
 * DeepSeekGUI safety zones (2026-09-24): the places an agent must not change
 * without a person's say-so, and the workspaces where it may only talk.
 *
 * Three protected kinds — Windows itself (`system`), installed application
 * code (`apps`), and DeepSeekGUI's own code (`gui`: its install directory and
 * any DeepSeekGUI source checkout) — plus `elevated` (the desktop runs with an
 * administrator token, so Windows no longer stops those writes by itself) and
 * `git` (repository metadata, read-only by default under `workspace-write`).
 * Callers turn a concern into a human decision; nothing here decides alone.
 *
 * Command text is scanned heuristically: an obvious reference is caught, a
 * script that writes elsewhere on its own is not. Kernel confinement stays
 * the sandbox runners' job; this layer is the red flag in front of a person.
 * @module @deepseek-ai/dsh-sandbox/protected-zones
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import type { Dirent } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join, parse, relative, sep } from 'node:path'
import { canonicalPath } from './roots.ts'

/** What a guarded action would touch, in the order a warning lists it. */
export type SafetyConcern = 'system' | 'apps' | 'gui' | 'elevated' | 'git'

/** A protected root and the concern it raises. */
export interface ProtectedZone {
  readonly kind: 'system' | 'apps' | 'gui'
  readonly root: string
}

/** Why a workspace is chat-only: nothing in it may be written or run with write access. */
export type ChatOnlyReason = 'home' | 'drive-root' | 'system' | 'apps'

/** Environment keys the desktop sets for the harness it launches. */
export const ELEVATED_ENV = 'DEEPSEEKGUI_ELEVATED'
/** Extra `gui` roots (the install directory), `path.delimiter`-separated. */
export const GUI_ROOTS_ENV = 'DEEPSEEKGUI_PROTECTED_ROOTS'

/** The package name that marks a DeepSeekGUI source checkout. */
const GUI_PACKAGE = '@see-sol-lab/deepseekgui'

const isWindows = process.platform === 'win32'

/** Case-folded comparison key: Windows paths are case-insensitive. */
function key(path: string): string {
  return isWindows ? path.toLowerCase() : path
}

/** Whether `candidate` is `root` or lies under it (both canonical). */
function within(root: string, candidate: string): boolean {
  const relation = relative(key(root), key(candidate))
  return relation === '' || (!relation.startsWith('..') && !parse(relation).root)
}

/**
 * The protected roots for this host.
 * @param env - the process environment (the desktop's markers included).
 * @returns canonical, deduplicated zones.
 */
export function protectedZones(env: NodeJS.ProcessEnv = process.env): ProtectedZone[] {
  const zones: ProtectedZone[] = []
  const add = (kind: ProtectedZone['kind'], root: string | undefined): void => {
    if (root === undefined || root.trim() === '') return
    const canonical = canonicalPath(root)
    if (!zones.some(zone => key(zone.root) === key(canonical))) zones.push({ kind, root: canonical })
  }
  // DeepSeekGUI's own roots first: its install directory sits inside Program
  // Files, and the more specific kind is the one a warning should name.
  for (const root of (env[GUI_ROOTS_ENV] ?? '').split(delimiter)) add('gui', root)
  if (isWindows) {
    add('system', env['SystemRoot'] ?? env['windir'])
    add('apps', env['ProgramFiles'])
    add('apps', env['ProgramW6432'])
    add('apps', env['ProgramFiles(x86)'])
    add('apps', env['ProgramData'])
    if (env['LOCALAPPDATA'] !== undefined) add('apps', join(env['LOCALAPPDATA'], 'Programs'))
  }
  return zones
}

const sourceCache = new Map<string, string | null>()

/**
 * The DeepSeekGUI source checkout containing `path`, if any: the nearest
 * ancestor carrying `apps/deepseekgui/package.json` with our package name.
 * @param path - an absolute path (need not exist).
 * @returns the checkout root, or undefined.
 */
export function guiSourceRoot(path: string): string | undefined {
  for (let current = path; ; current = dirname(current)) {
    const cached = sourceCache.get(key(current))
    if (cached !== undefined) return cached ?? undefined
    let found: string | null = null
    const manifest = join(current, 'apps', 'deepseekgui', 'package.json')
    if (existsSync(manifest)) {
      try {
        if ((JSON.parse(readFileSync(manifest, 'utf8')) as { name?: unknown }).name === GUI_PACKAGE) found = current
      } catch {
        // An unreadable manifest is not a checkout we can recognise.
      }
    }
    if (found !== null) {
      sourceCache.set(key(current), found)
      return found
    }
    if (dirname(current) === current) {
      sourceCache.set(key(current), null)
      return undefined
    }
  }
}

/**
 * Whether this harness was launched by the DeepSeekGUI desktop, which always
 * names its install directory. Only then is a source checkout "our own code":
 * a harness run from a checkout for tests or development is not the product.
 * @param env - the process environment.
 * @returns whether the desktop marker is present.
 */
export function launchedByDesktop(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env[GUI_ROOTS_ENV] ?? '').trim() !== ''
}

/**
 * The protected kind covering `path`, if any.
 * @param path - absolute path an action would write.
 * @param zones - {@link protectedZones}.
 * @param env - the process environment; source checkouts count only under the desktop.
 * @returns the zone kind, or undefined for an ordinary location.
 */
export function zoneOfPath(
  path: string,
  zones: readonly ProtectedZone[] = protectedZones(),
  env: NodeJS.ProcessEnv = process.env,
): ProtectedZone['kind'] | undefined {
  const canonical = canonicalPath(path)
  const zone = zones.find(candidate => within(candidate.root, canonical))
  if (zone !== undefined) return zone.kind
  if (!launchedByDesktop(env)) return undefined
  return guiSourceRoot(canonical) === undefined ? undefined : 'gui'
}

/**
 * Why a workspace may only be talked about, not changed: the user's home
 * directory, a drive root, or a system / application root. Granting write
 * access to such a root would open (and, under the Windows sandbox, relabel)
 * everything below it.
 * @param workspaceRoot - the session's workspace root.
 * @param env - the process environment.
 * @returns the reason, or undefined for an ordinary project folder.
 */
export function chatOnlyReason(workspaceRoot: string, env: NodeJS.ProcessEnv = process.env): ChatOnlyReason | undefined {
  const root = canonicalPath(workspaceRoot)
  if (dirname(root) === root) return 'drive-root'
  const homes = [homedir(), env['USERPROFILE'], env['HOME']].filter((home): home is string => home !== undefined && home !== '')
  if (homes.some(home => key(canonicalPath(home)) === key(root))) return 'home'
  const zone = protectedZones(env).find(candidate => within(candidate.root, root) || within(root, candidate.root))
  if (zone?.kind === 'system' || zone?.kind === 'apps') return zone.kind
  return undefined
}

/**
 * Whether the desktop told this harness that it runs with an administrator token.
 * @param env - the process environment.
 * @returns true when the desktop marker says so.
 */
export function isElevatedHost(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[ELEVATED_ENV] === '1'
}

/**
 * Whether `target` lies inside a `.git` directory of the workspace.
 * @param workspaceRoot - the session's workspace root.
 * @param target - the path an action would write.
 * @returns true for repository metadata inside the workspace.
 */
export function isGitMetadataPath(workspaceRoot: string, target: string): boolean {
  const relation = relative(key(canonicalPath(workspaceRoot)), key(canonicalPath(target)))
  if (relation === '' || relation.startsWith('..') || parse(relation).root !== '') return false
  return relation.split(sep).includes('.git')
}

/** Directory names the {@link readOnlySubtrees} walk never enters: dependency trees are large and guard nothing. */
const WALK_SKIPPED = new Set(['node_modules'])
/** How deep and how wide {@link readOnlySubtrees} looks before it stops. */
const WALK_MAX_DEPTH = 6
const WALK_MAX_DIRECTORIES = 20_000
const WALK_MAX_RESULTS = 200

/**
 * Directories strictly inside `workspaceRoot` that a confined write grant must
 * keep read-only (DeepSeekGUI, 2026-09-25): the `.git` directories of nested
 * repositories, and protected code below a workspace that is not itself that
 * code (DeepSeekGUI's own checkout under a parent folder chosen as the
 * workspace). The root's own `.git` is the grant's business already.
 *
 * A bounded walk, done when a grant is made: it skips `node_modules` and links,
 * does not descend into what it reports, and stops past a fixed depth and
 * directory count. Deeper ones, and ones created after the grant, are not
 * covered; the file tools still refuse any `.git` path on their own.
 * @param workspaceRoot - the workspace a write grant covers.
 * @param env - the process environment.
 * @returns absolute directories, outermost first.
 */
export function readOnlySubtrees(workspaceRoot: string, env: NodeJS.ProcessEnv = process.env): string[] {
  const root = canonicalPath(workspaceRoot)
  const zones = protectedZones(env)
  // A workspace that IS protected code reaches it only through an approved escalation.
  const guardCode = zoneOfPath(root, zones, env) === undefined
  const found: string[] = []
  let level = [root]
  let visited = 0
  for (let depth = 0; depth < WALK_MAX_DEPTH && level.length > 0; depth++) {
    const next: string[] = []
    for (const directory of level) {
      let entries: Dirent[]
      try {
        entries = readdirSync(directory, { withFileTypes: true })
      } catch {
        continue // unreadable: nothing below it can be granted to us either
      }
      for (const entry of entries) {
        // Dirent reports junctions and symlinks as links, never as directories.
        if (!entry.isDirectory()) continue
        const child = join(directory, entry.name)
        if (entry.name === '.git') {
          if (directory !== root) found.push(child)
        } else if (guardCode && zoneOfPath(child, zones, env) !== undefined) {
          found.push(child)
        } else if (!WALK_SKIPPED.has(entry.name)) {
          if (++visited > WALK_MAX_DIRECTORIES) return found
          next.push(child)
        }
        if (found.length >= WALK_MAX_RESULTS) return found
      }
    }
    level = next
  }
  return found
}

/** Environment-variable and registry spellings of protected places, lower-cased. */
const KEYWORDS: ReadonlyArray<readonly [RegExp, 'system' | 'apps']> = [
  [/\$env:(windir|systemroot)\b|%(windir|systemroot)%|\\system32\\|\\syswow64\\|\bhklm(:|\\)|hkey_local_machine/u, 'system'],
  [/program files|\$\{?env:(programfiles|programw6432|programdata)|%(programfiles|programw6432|programdata)|\\appdata\\local\\programs|(\$env:localappdata|%localappdata%)\\programs/u, 'apps'],
]

/** An absolute Windows path standing alone inside quotes: read whole, spaces included. */
const QUOTED_PATH = /(["'])([a-z]:\\[^"'\r\n]*)\1/giu

/** Bare absolute Windows paths: they end at whitespace or shell punctuation. */
const ABSOLUTE_PATH = /[a-z]:\\[^\s'"`|;<>]*/giu

/**
 * The protected concerns a command's text reveals. Heuristic by design: it
 * catches what the text says, not what a script it runs might do.
 * @param command - the shell command or code text.
 * @param zones - {@link protectedZones}.
 * @param env - the process environment.
 * @returns the concerns found, deduplicated.
 */
export function commandConcerns(
  command: string,
  zones: readonly ProtectedZone[] = protectedZones(),
  env: NodeJS.ProcessEnv = process.env,
): SafetyConcern[] {
  const text = command.replaceAll('/', '\\')
  const found = new Set<SafetyConcern>()
  const lower = text.toLowerCase()
  for (const [pattern, kind] of KEYWORDS) if (pattern.test(lower)) found.add(kind)
  const quoted = [...text.matchAll(QUOTED_PATH)].map(match => match[2] ?? '')
  // Quoted paths were read whole; blank them so a truncated prefix ("E:\Dev" of
  // "E:\Dev Projects\…") is not judged again as a shorter, different path.
  const bare = [...text.replaceAll(QUOTED_PATH, ' ').matchAll(ABSOLUTE_PATH)].map(match => match[0])
  for (const path of [...quoted, ...bare]) {
    const kind = zoneOfPath(path.replace(/[\\.,)]+$/u, '') || path, zones, env)
    if (kind !== undefined) found.add(kind)
  }
  return ORDER.filter(concern => found.has(concern))
}

/** Presentation order of concerns. */
const ORDER: readonly SafetyConcern[] = ['system', 'apps', 'gui', 'elevated', 'git']

/**
 * The concerns of one guarded action, in presentation order.
 * @param action - what the action writes: the workspace, the command text, the target paths.
 * @param action.workspaceRoot - the session's workspace root.
 * @param action.command - the command or code text, when there is one.
 * @param action.paths - absolute target paths, when known.
 * @param action.cwd - the directory a command actually runs in (its relative paths land there).
 * @param action.fullAccess - whether the action would run without confinement.
 * @param env - the process environment.
 * @returns the concerns (empty for an ordinary action).
 */
export function actionConcerns(
  action: { workspaceRoot: string; command?: string; paths?: readonly string[]; cwd?: string; fullAccess: boolean },
  env: NodeJS.ProcessEnv = process.env,
): SafetyConcern[] {
  const zones = protectedZones(env)
  const found = new Set<SafetyConcern>()
  if (action.command !== undefined) for (const concern of commandConcerns(action.command, zones, env)) found.add(concern)
  if (action.cwd !== undefined) {
    const kind = zoneOfPath(action.cwd, zones, env)
    if (kind !== undefined) found.add(kind)
  }
  for (const path of action.paths ?? []) {
    const kind = zoneOfPath(path, zones, env)
    if (kind !== undefined) found.add(kind)
    if (isGitMetadataPath(action.workspaceRoot, path)) found.add('git')
  }
  if (zoneOfPath(action.workspaceRoot, zones, env) === 'gui') found.add('gui')
  if (action.fullAccess && isElevatedHost(env)) found.add('elevated')
  return ORDER.filter(concern => found.has(concern))
}
