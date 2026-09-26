/**
 * Reviewed import of the legacy Markdown memory files (`<DSH_HOME>/memory.md`
 * and `<project>/<folder>.memory.md`). The file is cut into reviewable
 * segments — a paragraph, a list item with its continuation lines, a fenced
 * block — under their heading path; nothing claims a segment is one exact
 * fact, the person reviews and edits before anything is written. Preview
 * writes nothing; apply writes the chosen segments one by one and stops at
 * the first failure, reporting what landed. The Markdown file is never
 * modified.
 */
import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { EntriesTable } from './spec.ts'
import { findDuplicate, remember, type StoreClock, type StoreLimits } from './store.ts'
import type {
  MemoryImportCandidate,
  MemoryImportOutcome,
  MemoryImportPreview,
  MemoryImportSource,
  MemoryKind,
  MemoryScope,
  MemoryWriteResult,
} from './types.ts'

/** One reviewable piece of a Markdown file. */
export interface MarkdownSegment {
  /** Heading path above the segment, outermost first. */
  headings: string[]
  /** 1-based line of the first line. */
  line: number
  /** Trimmed text. */
  text: string
}

const HEADING = /^(#{1,6})(?:\s+(.*?))?\s*#*\s*$/u
const LIST_ITEM = /^(?:[-*+]|\d+[.)])\s+/u
const RULE = /^(?:-{3,}|\*{3,}|_{3,})\s*$/u
const FENCE = /^(`{3,}|~{3,})/u

/**
 * Cut Markdown into segments by headings, blank lines, list items and fences.
 * @param text - file content.
 * @returns the segments in file order; headings themselves are not segments.
 */
export function segmentMarkdown(text: string): MarkdownSegment[] {
  const segments: MarkdownSegment[] = []
  const headings: string[] = []
  const lines = text.split(/\r?\n/u)
  let current: { line: number; lines: string[] } | undefined
  let fence: string | undefined
  const flush = (): void => {
    if (current === undefined) return
    // A segment always starts on a non-blank line, so its trimmed body is never empty.
    segments.push({ headings: [...headings], line: current.line, text: current.lines.join('\n').trim() })
    current = undefined
  }
  lines.forEach((raw, index) => {
    const line = index + 1
    if (fence !== undefined) {
      current?.lines.push(raw)
      if (raw.trim().startsWith(fence)) {
        fence = undefined
        flush()
      }
      return
    }
    const opening = FENCE.exec(raw.trim())
    if (opening !== null) {
      flush()
      fence = opening[1]
      current = { line, lines: [raw] }
      return
    }
    const heading = HEADING.exec(raw)
    if (heading !== null) {
      flush()
      let level = 0
      while (raw[level] === '#') level += 1
      headings.length = Math.min(headings.length, level - 1)
      // A deeper heading after a shallower one leaves no holes: the missing levels read as empty.
      while (headings.length < level - 1) headings.push('')
      headings.push(heading[2] ?? '')
      return
    }
    if (raw.trim() === '' || RULE.test(raw.trim()) || raw.trim().startsWith('<!--')) {
      flush()
      return
    }
    if (LIST_ITEM.test(raw)) {
      flush()
      current = { line, lines: [raw] }
      return
    }
    if (current === undefined) current = { line, lines: [raw] }
    else current.lines.push(raw)
  })
  flush()
  return segments
}

/** Where a legacy file lives and which scope its entries take. */
export interface ImportTarget {
  path: string
  scope: MemoryScope
  kind: MemoryKind
}

/** How the preview reads files and resolves projects. */
export interface ImportEnvironment {
  /** Absolute path of the global memory file. */
  globalFile: string
  /** Resolve a project cwd to its scope and memory file; null when the folder is unusable. */
  projectTarget: (cwd: string) => Promise<{ scope: MemoryScope; path: string } | null>
  /** Inclusive byte cap on the file. */
  maxBytes: number
}

/**
 * Resolve an import source to its file and scope.
 * @param source - global or project.
 * @param env - environment.
 * @returns the target, or the problem.
 */
export async function resolveTarget(
  source: MemoryImportSource,
  env: ImportEnvironment,
): Promise<ImportTarget | { problem: 'no-project'; path: string }> {
  if (source.kind === 'global') return { path: env.globalFile, scope: { kind: 'global' }, kind: 'preference' }
  const project = await env.projectTarget(source.cwd)
  if (project === null) return { problem: 'no-project', path: join(source.cwd) }
  return { path: project.path, scope: project.scope, kind: 'fact' }
}

/**
 * Review a legacy file without writing.
 * @param entries - the entries table (for duplicate detection).
 * @param source - global or project.
 * @param env - environment.
 * @returns the candidates, or the problem with the file.
 */
export async function previewImport(
  entries: EntriesTable,
  source: MemoryImportSource,
  env: ImportEnvironment,
): Promise<MemoryImportPreview> {
  const target = await resolveTarget(source, env)
  if ('problem' in target) return { source, path: target.path, scope: null, problem: 'no-project', candidates: [] }
  const base = { source, path: target.path, scope: target.scope }
  let text: string
  try {
    const info = await stat(target.path)
    if (info.size > env.maxBytes) return { ...base, problem: 'too-large', candidates: [] }
    text = await readFile(target.path, 'utf8')
  } catch (error) {
    const missing = typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT'
    return { ...base, problem: missing ? 'missing' : 'unreadable', candidates: [] }
  }
  const candidates = segmentMarkdown(text).map((segment): MemoryImportCandidate => ({
    key: `L${segment.line}:${createHash('sha256').update(JSON.stringify(segment)).digest('hex')}`,
    headings: segment.headings,
    line: segment.line,
    text: segment.text,
    kind: target.kind,
    duplicateOf: findDuplicate(entries, target.scope, segment.text) ?? null,
  }))
  return candidates.length === 0 ? { ...base, problem: 'empty', candidates } : { ...base, candidates }
}

/** Inputs of one apply. */
export interface ApplyImportInput {
  source: MemoryImportSource
  selections: Array<{ key: string; kind?: MemoryKind; content?: string; keywords?: string[] }>
  sessionId?: string
}

/**
 * Write the chosen candidates, in order, stopping at the first failure.
 * @param entries - the entries table.
 * @param input - source and selections.
 * @param env - environment.
 * @param clock - time and ids.
 * @param limits - write limits.
 * @returns what landed, what was skipped as duplicate, and where it stopped.
 */
export async function applyImport(
  entries: EntriesTable,
  input: ApplyImportInput,
  env: ImportEnvironment,
  clock: StoreClock,
  limits: StoreLimits,
): Promise<MemoryImportOutcome> {
  const outcome: MemoryImportOutcome = { written: [], skipped: [] }
  const preview = await previewImport(entries, input.source, env)
  const stop = preview.scope === null
    ? preview.problem
    : preview.problem === 'missing' || preview.problem === 'too-large' || preview.problem === 'unreadable' ? preview.problem : undefined
  if (preview.scope === null || stop !== undefined) {
    const first = input.selections[0]
    if (first !== undefined) {
      outcome.failedAt = { key: first.key, error: { code: 'MEMORY_INVALID', message: `the file cannot be imported: ${String(stop)}` } }
    }
    return outcome
  }
  const scope = preview.scope
  for (const selection of input.selections) {
    const candidate = preview.candidates.find(item => item.key === selection.key)
    if (candidate === undefined) {
      outcome.failedAt = {
        key: selection.key,
        error: { code: 'MEMORY_INVALID', message: 'the reviewed segment changed or is missing; preview the file again' },
      }
      return outcome
    }
    const content = (selection.content ?? candidate.text).trim()
    const duplicate = findDuplicate(entries, scope, content)
    if (duplicate !== undefined) {
      outcome.skipped.push({ key: selection.key, duplicateOf: duplicate })
      continue
    }
    const result: MemoryWriteResult = await remember(entries, {
      scope,
      kind: selection.kind ?? candidate.kind,
      content,
      ...selection.keywords === undefined ? {} : { keywords: selection.keywords },
      source: {
        kind: 'import',
        ...input.sessionId === undefined ? {} : { sessionId: input.sessionId },
        detail: `${preview.path}#${candidate.headings.join(' > ')}`,
        evidence: `line ${candidate.line}`,
      },
    }, clock, limits)
    if (!result.ok) {
      outcome.failedAt = { key: selection.key, error: result.error }
      return outcome
    }
    outcome.written.push(result.entry.id)
  }
  return outcome
}
