/**
 * DeepSeekGUI guide and memory — host half (B5-P7 two flat files;
 * B7-P7 split).
 *
 * Two contexts now:
 * - `deepseekgui:guide` — the product guide (where the model runs, tools,
 *   paths, diagnostics, language), always injected.
 * - `deepseekgui:memory` — the memory: the two-file contract plus the files'
 *   text, `<DSH home>/memory.md` and `<project cwd>/<folder>.memory.md`,
 *   injected at the start of every window. The entry-based enhanced memory
 *   that could take its place was removed on 2026-09-29 (住户): the two
 *   Markdown files are the only memory again.
 *
 * The first assembly for a loaded Session captures both files. Subsequent
 * steps reuse that text until the Session is unloaded. Official context
 * snapshots record it in the Session log. Reopening the Session reads edits.
 *
 * Typing note: this module deliberately uses structural types only. The
 * plugin compiles its browser and host halves in one program, and importing
 * host packages that augment the plugin-runtime Context type (agent/session/
 * system-prompt) would collide with the client-side Context merges; the
 * runtime service names and provider shapes below are pinned by the official
 * seams they describe (system-prompt `context`,
 * `AssembleContext.agent.session`).
 *
 * @module @see-sol-lab/deepseekgui-workbench/host/memory
 */

import { closeSync, mkdirSync, openSync, readFileSync, readSync, renameSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
// A pure function from a type-only module: no Context augmentation crosses over.
import { AREA_BEGIN, AREA_END, projectMemoryFileName } from '@deepseek-ai/dsh-workbench-inspector/types'
import { createHash } from 'node:crypto'

/** Memory context section name owned by this plugin. */
const MEMORY_SECTION_NAME = 'deepseekgui:memory'

/** Product guide context section name owned by this plugin. */
const GUIDE_SECTION_NAME = 'deepseekgui:guide'

/** Sort position: after every contributed guidance section. */
const MEMORY_SECTION_ORDER = 1_000_000

/** The guide sits right before the memory section. */
const GUIDE_SECTION_ORDER = MEMORY_SECTION_ORDER - 1

/**
 * Per-file cap (bytes) protecting the assembly from runaway files. 64 KB
 * holds the 20,000 characters the guide asks the model to stay under even
 * when every one of them is CJK (three UTF-8 bytes each).
 */
const MEMORY_FILE_CAP = 64 * 1024

/** Both memory file paths for one home/cwd pair. */
export interface MemoryFiles {
  readonly globalPath: string
  readonly projectPath: string
}

/** Resolve the two flat memory files (project: `<folder>.memory.md`, D20 2026-09-06). */
export function memoryFilesOf(home: string, cwd: string): MemoryFiles {
  return {
    globalPath: join(home, 'memory.md'),
    projectPath: join(cwd, projectMemoryFileName(cwd)),
  }
}

/** One file's injected view: its full text, or an explicit absent/empty status. */
export interface MemoryFileView {
  readonly path: string
  readonly status: 'present' | 'absent' | 'empty' | 'truncated' | 'unreadable'
  readonly text: string
  /** Project memory only: whether the archive-notes area rides along in full. */
  readonly autoArea?: 'included' | 'absent'
}

/**
 * How far the project file is read before the injection budget is applied:
 * enough to find the archive-notes area at the end of a long file.
 */
const PROJECT_READ_LIMIT = 1024 * 1024

/** The first `bytes` UTF-8 bytes of `text`, never splitting a character. */
function headBytes(text: string, bytes: number): string {
  const buffer = Buffer.from(text, 'utf8')
  if (buffer.length <= bytes) return text
  return new TextDecoder().decode(buffer.subarray(0, Math.max(0, bytes)), { stream: true })
}

/**
 * Read the project memory within the same cap, but keep the archive-notes
 * area whole (Phase 2, Sol P2-05): the area is appended at the end of the
 * file, so a plain head-cut of a long file would drop exactly the notes the
 * archive step just saved. When the file exceeds the cap, the person's own
 * text is cut from its end instead and the area follows in full; the person's
 * text is never deleted from disk, only shortened in this injection.
 * @param path - project memory file.
 * @param cap - injection cap in bytes.
 * @returns the injected view.
 */
export function readProjectMemoryFile(path: string, cap = MEMORY_FILE_CAP): MemoryFileView {
  const whole = readMemoryFile(path, PROJECT_READ_LIMIT)
  if (whole.status === 'absent' || whole.status === 'empty' || whole.status === 'unreadable') return whole
  const begin = whole.text.indexOf(AREA_BEGIN)
  const end = whole.text.indexOf(AREA_END)
  const area = begin >= 0 && end > begin ? whole.text.slice(begin, end + AREA_END.length) : ''
  if (Buffer.byteLength(whole.text, 'utf8') <= cap && whole.status === 'present') {
    return { ...whole, autoArea: area === '' ? 'absent' : 'included' }
  }
  if (area === '') return { path, status: 'truncated', text: headBytes(whole.text, cap), autoArea: 'absent' }
  const human = whole.text.slice(0, begin) + whole.text.slice(end + AREA_END.length)
  const marker = '\n…（以上为节选 / excerpt above）…\n'
  const room = cap - Buffer.byteLength(area, 'utf8') - Buffer.byteLength(marker, 'utf8')
  return { path, status: 'truncated', text: `${headBytes(human, room)}${marker}${area}`, autoArea: 'included' }
}

/** Read one memory file within the cap; never throws. */
export function readMemoryFile(path: string, cap = MEMORY_FILE_CAP): MemoryFileView {
  let text = ''
  let truncated = false
  try {
    const fd = openSync(path, 'r')
    try {
      const buffer = Buffer.alloc(cap + 1)
      let size = 0
      while (size < buffer.length) {
        const read = readSync(fd, buffer, size, buffer.length - size, null)
        if (read === 0) break
        size += read
      }
      truncated = size > cap
      text = new TextDecoder().decode(buffer.subarray(0, Math.min(size, cap)), { stream: truncated })
    } finally { closeSync(fd) }
  } catch (error) {
    return { path, status: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'absent' : 'unreadable', text: '' }
  }
  if (text.trim() === '') return { path, status: 'empty', text: '' }
  if (truncated) {
    return { path, status: 'truncated', text }
  }
  return { path, status: 'present', text }
}

/**
 * The DeepSeekGUI product guide (D20, 2026-09-06): where the model is
 * running, how the DeepSeekGUI tools are meant to be used, how to write
 * paths, diagnostics, language. It is the product's fixed "house rules" — no
 * user-facing entry, shipped and upgraded with the package — and the user's
 * own AGENTS.md files (loaded by the official agent-instructions plugin)
 * arrive after it, so the user's rules win.
 *
 * The text ships as `assets/deepseekgui-guide.md` beside the plugin: it is
 * content, not code, so wording changes need no recompile. A missing asset is
 * a broken package, so the read throws rather than injecting a silent blank.
 * @returns The guide, trimmed of the trailing newline.
 */
export function productGuide(): string {
  return readAsset('deepseekgui-guide.md')
}

/**
 * The two-file memory contract (B5-P7), injected with the file texts. Ships as
 * `assets/deepseekgui-memory-files.md`.
 * @returns The contract, trimmed of the trailing newline.
 */
export function memoryContract(): string {
  return readAsset('deepseekgui-memory-files.md')
}

function readAsset(name: string): string {
  const asset = fileURLToPath(new URL(`../assets/${name}`, import.meta.url))
  return readFileSync(asset, 'utf8').trimEnd()
}

/** The complete injected section text for one window assembly. */
export function buildMemorySectionText(files: MemoryFiles): string {
  return captureMemorySection(files).text
}

/** One file's injection fact (Phase 2, 2026-10-05): what reached the request, not today's file. */
export interface MemoryInjectionFact {
  readonly path: string
  readonly status: MemoryFileView['status']
  readonly bytes: number
  readonly chars: number
  /** SHA-256 of the injected text: same length, different content still tell apart. */
  readonly sha256: string
  readonly autoArea?: 'included' | 'absent'
}

function factOf(view: MemoryFileView): MemoryInjectionFact {
  let chars = 0
  for (const _ of view.text) chars++
  return {
    path: view.path, status: view.status, bytes: Buffer.byteLength(view.text, 'utf8'), chars,
    sha256: createHash('sha256').update(view.text, 'utf8').digest('hex'),
    ...view.autoArea === undefined ? {} : { autoArea: view.autoArea },
  }
}

/** Injection history kept per Session: the newest entry is the current load. */
const INJECTION_HISTORY = 20

/**
 * Read both files once and build the section text together with the facts of
 * what it carries, so the recorded facts and the injected text can never
 * describe two different reads.
 * @param files - the two memory files.
 * @returns the section text and per-file facts.
 */
export function captureMemorySection(files: MemoryFiles): { text: string; global: MemoryInjectionFact; project: MemoryInjectionFact } {
  const globalView = readMemoryFile(files.globalPath)
  const projectView = readProjectMemoryFile(files.projectPath)
  return { text: sectionTextOf(files, globalView, projectView), global: factOf(globalView), project: factOf(projectView) }
}

/**
 * Record the injection facts for one Session beside the DSH home
 * (`deepseekgui/memory-injections/<sessionId>.json`) so the Memory view can
 * show what this Session started with. Written once per loaded Session, at the
 * same moment the text is captured; a failure never blocks the assembly.
 * @param home - DSH home.
 * @param sessionId - the Session's id.
 * @param captured - facts from {@link captureMemorySection}.
 */
export function recordMemoryInjection(
  home: string,
  sessionId: string,
  captured: { global: MemoryInjectionFact; project: MemoryInjectionFact },
): void {
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(sessionId)) return
  try {
    const dir = join(home, 'deepseekgui', 'memory-injections')
    mkdirSync(dir, { recursive: true })
    const path = join(dir, `${sessionId}.json`)
    // Append, never overwrite: a reopened Session gets its own entry beside the earlier loads.
    let entries: unknown[] = []
    try {
      const previous: unknown = JSON.parse(readFileSync(path, 'utf8'))
      if (typeof previous === 'object' && previous !== null && 'entries' in previous && Array.isArray(previous.entries)) entries = previous.entries
    } catch {
      entries = []
    }
    entries.push({ at: new Date().toISOString(), capBytes: MEMORY_FILE_CAP, global: captured.global, project: captured.project })
    const temp = `${path}.${String(Date.now())}-${Math.random().toString(36).slice(2)}.tmp`
    writeFileSync(temp, `${JSON.stringify({ sessionId, entries: entries.slice(-INJECTION_HISTORY) }, null, 2)}\n`, 'utf8')
    renameSync(temp, path)
  } catch {
    // The record is a convenience for the Memory view; the injection itself already happened.
  }
}

function sectionTextOf(files: MemoryFiles, globalView: MemoryFileView, projectView: MemoryFileView): string {
  const statusText = (view: MemoryFileView): string => {
    if (view.status === 'absent') return '(file does not exist yet)'
    if (view.status === 'empty') return '(file is empty)'
    if (view.status === 'unreadable') return '(file could not be read; do not overwrite it)'
    if (view.status === 'truncated') {
      return view.autoArea === 'included'
        ? '(file exceeded the injection cap; the handwritten part was shortened, the archive-notes area is complete)'
        : '(file exceeded the injection cap; truncated)'
    }
    return ''
  }
  const globalBody = globalView.text === ''
    ? statusText(globalView)
    : `\`\`\`memory\n${globalView.text}\n\`\`\``
  const projectBody = projectView.text === ''
    ? statusText(projectView)
    : `\`\`\`memory\n${projectView.text}\n\`\`\``
  return [
    memoryContract(),
    '## DeepSeekGUI memory (injected once per session window)',
    `Global memory (user-edited, model read-only): ${files.globalPath}`,
    globalView.status === 'truncated' ? `${statusText(globalView)}\n${globalBody}` : globalBody,
    `Project memory (model-maintained via fs tools): ${files.projectPath}`,
    projectView.status === 'truncated' ? `${statusText(projectView)}\n${projectBody}` : projectBody,
  ].join('\n\n')
}

/** The official system-prompt seam, narrowed to what memory registers. */
interface SystemPromptSeam {
  variable(name: string, provider: (context: MemoryAssembleContext) => string): () => void
  context(section: {
    readonly name: string
    readonly order: number
    readonly text: string
  }): () => void
}

/** The prompt-assembly context the seam passes to text providers. */
export type MemoryAssembleContext = {
  readonly agent?: { readonly session?: { readonly header?: { readonly cwd?: string; readonly id?: string } } }
}

/** Read DSH_HOME through the untyped env record (client env ambient types narrow process.env). */
function dshHomeOf(env: Record<string, string | undefined> = process.env as Record<string, string | undefined>): string | undefined {
  const home = env.DSH_HOME
  return home === undefined || home === '' ? undefined : home
}

/**
 * Register the product guide and the memory context in the plugin scope.
 * The guide is static; the memory section is a variable resolved at every
 * assembly and captured once per loaded Session.
 * @param ctx - plugin host context.
 */
export function registerMemoryContext(ctx: Context): void {
  const systemPrompt = (ctx as unknown as { systemPrompt: SystemPromptSeam }).systemPrompt
  const captured = new WeakMap<object, string>()
  const guide: Parameters<SystemPromptSeam['context']>[0] = {
    name: GUIDE_SECTION_NAME,
    order: GUIDE_SECTION_ORDER,
    text: productGuide(),
  }
  const provider: Parameters<SystemPromptSeam['context']>[0] = {
    name: MEMORY_SECTION_NAME,
    order: MEMORY_SECTION_ORDER,
    text: '{{deepseekgui_memory}}',
  }
  ctx.effect(() => {
    const disposeVariable = systemPrompt.variable('deepseekgui_memory', (context) => {
      // A bare assemble (tests/diagnostics) has no agent; and without a home
      // or a session cwd there is nothing to anchor memory to.
      const home = dshHomeOf()
      const session = context.agent?.session
      const cwd = session?.header?.cwd
      if (home === undefined || cwd === undefined || session === undefined) return ''
      let text = captured.get(session)
      if (text === undefined) {
        const capture = captureMemorySection(memoryFilesOf(home, cwd))
        text = capture.text
        captured.set(session, text)
        const id = session.header?.id
        if (id !== undefined) recordMemoryInjection(home, id, capture)
      }
      return text
    })
    const disposeGuide = systemPrompt.context(guide)
    const dispose = systemPrompt.context(provider)
    return () => { dispose(); disposeGuide(); disposeVariable() }
  }, 'deepseekgui: guide and memory contexts')
}
