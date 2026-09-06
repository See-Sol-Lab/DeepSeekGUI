/**
 * DeepSeekGUI memory — host half (B5-P7, two flat files ruling).
 *
 * Two flat files, nothing else:
 * - `<DSH home>/memory.md` — cross-project user preferences and corrections.
 *   Model read-only; the desktop writes it on user edits from the GUI panel.
 * - `<project cwd>/memory.md` — facts about this project, written by the
 *   model with ordinary fs tools under the official workspace-write
 *   semantics (no new permission face, no backdoor, never full-access by
 *   default).
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

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
// A pure function from a type-only module: no Context augmentation crosses over.
import { projectMemoryFileName } from '@deepseek-ai/dsh-workbench-inspector/types'

/** Context section name owned by this plugin. */
export const MEMORY_SECTION_NAME = 'deepseekgui:memory'

/** Sort position: after every contributed guidance section. */
export const MEMORY_SECTION_ORDER = 1_000_000

/**
 * Per-file cap (bytes) protecting the assembly from runaway files. 64 KB
 * holds the 20,000 characters the guide asks the model to stay under even
 * when every one of them is CJK (three UTF-8 bytes each).
 */
export const MEMORY_FILE_CAP = 64 * 1024

/** Both memory file paths for one home/cwd pair. */
export interface MemoryFiles {
  readonly home: string
  readonly cwd: string
  readonly globalPath: string
  readonly projectPath: string
}

/** Resolve the two flat memory files (project: `<folder>.memory.md`, D20 2026-09-06). */
export function memoryFilesOf(home: string, cwd: string): MemoryFiles {
  return {
    home,
    cwd,
    globalPath: join(home, 'memory.md'),
    projectPath: join(cwd, projectMemoryFileName(cwd)),
  }
}

/** One file's injected view: its full text, or an explicit absent/empty status. */
export interface MemoryFileView {
  readonly path: string
  readonly status: 'present' | 'absent' | 'empty' | 'truncated'
  readonly text: string
}

/** Read one memory file within the cap; never throws. */
export function readMemoryFile(path: string, cap = MEMORY_FILE_CAP): MemoryFileView {
  let text = ''
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return { path, status: 'absent', text: '' }
  }
  if (text.trim() === '') return { path, status: 'empty', text: '' }
  if (text.length > cap) {
    return { path, status: 'truncated', text: text.slice(0, cap) }
  }
  return { path, status: 'present', text }
}

/**
 * The DeepSeekGUI guide injected with the memory texts (D20, 2026-09-06):
 * where the model is running, how the DeepSeekGUI tools are meant to be
 * used, how to write paths, and the memory contract. It is the product's
 * fixed "house rules" — no user-facing entry, shipped and upgraded with the
 * package — and the user's own AGENTS.md files (loaded by the official
 * agent-instructions plugin) arrive after it, so the user's rules win.
 *
 * The text ships as `assets/deepseekgui-guide.md` beside the plugin: it is
 * content, not code, so wording changes need no recompile. A missing asset is
 * a broken package, so the read throws rather than injecting a silent blank.
 * @returns The guide, trimmed of the trailing newline.
 */
export function memoryContract(): string {
  const asset = fileURLToPath(new URL('../assets/deepseekgui-guide.md', import.meta.url))
  return readFileSync(asset, 'utf8').trimEnd()
}

/** The complete injected section text for one window assembly. */
export function buildMemorySectionText(files: MemoryFiles): string {
  const globalView = readMemoryFile(files.globalPath)
  const projectView = readMemoryFile(files.projectPath)
  const statusText = (view: MemoryFileView): string => {
    if (view.status === 'absent') return '(file does not exist yet)'
    if (view.status === 'empty') return '(file is empty)'
    if (view.status === 'truncated') return '(file exceeded the injection cap; truncated)'
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
    globalBody,
    `Project memory (model-maintained via fs tools): ${files.projectPath}`,
    projectBody,
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
  readonly agent?: { readonly session?: { readonly header?: { readonly cwd?: string } } }
}

/** Read DSH_HOME through the untyped env record (client env ambient types narrow process.env). */
export function dshHomeOf(env: Record<string, string | undefined> = process.env as Record<string, string | undefined>): string | undefined {
  const home = env.DSH_HOME
  return home === undefined || home === '' ? undefined : home
}

/**
 * Register the memory context contribution in the plugin scope.
 * @param ctx - plugin host context.
 */
export function registerMemoryContext(ctx: Context): void {
  const systemPrompt = (ctx as unknown as { systemPrompt: SystemPromptSeam }).systemPrompt
  const captured = new WeakMap<object, string>()
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
        text = buildMemorySectionText(memoryFilesOf(home, cwd))
        captured.set(session, text)
      }
      return text
    })
    const dispose = systemPrompt.context(provider)
    return () => { dispose(); disposeVariable() }
  }, 'deepseekgui: memory context')
}
