/**
 * Continuation notes (B7-P8): the one shape a task hand-over takes. A note
 * is stored as ordinary entry content in a fixed text layout, so the pages
 * show and edit it as text, while the tools and the recall read it back into
 * its five parts — goal, decisions, unfinished items, leads, and what was
 * verified back then — and keep them apart. Bounded on purpose: a note is a
 * hand-over, not a transcript, and it never nests a recalled list or an
 * earlier note inside itself. Client-safe (no Node imports): the desktop
 * pages read and write the same layout through the `./continuation` export.
 */
import type { ContinuationNote } from './types.ts'

/** Bounds of one note; the entry content cap still applies on top. */
export const CONTINUATION_LIMITS = {
  /** Inclusive cap on the items of one part. */
  itemsPerPart: 24,
  /** Inclusive UTF-8 byte cap on one item or the goal. */
  itemBytes: 512,
} as const

/** Section labels in storage order; the labels are the parse anchors, so they never change casually. */
const LABELS = {
  goal: 'Goal:',
  decisions: 'Decided:',
  unfinished: 'Unfinished:',
  leads: 'Leads:',
  verified: 'Verified then:',
} as const

const PARTS = ['decisions', 'unfinished', 'leads', 'verified'] as const

/** Text of an injected list; refused anywhere in a part, so a note never nests a recalled list. */
const LIST_MARKERS = ['<system-reminder>', '</system-reminder>', 'DeepSeekGUI memory recalled']

/** An empty part as written. */
const NONE = '(none)'

/** Result of validating a note. */
export type ContinuationCheck =
  | { ok: true; note: ContinuationNote }
  | { ok: false; message: string }

/**
 * Trim and bound a note: blank items drop, every part is capped, no part
 * may carry the markers of an injected list or of another note.
 * @param input - the note as the tool or the page received it.
 * @returns the note as it will be stored, or why it is refused.
 */
export function checkContinuation(input: ContinuationNote): ContinuationCheck {
  const goal = oneLine(input.goal)
  if (goal === '') return { ok: false, message: 'a continuation note needs a goal' }
  const problem = checkItem(goal, 'goal')
  if (problem !== undefined) return { ok: false, message: problem }
  const note: ContinuationNote = { goal, decisions: [], unfinished: [], leads: [], verified: [] }
  for (const part of PARTS) {
    const items = input[part].map(oneLine).filter(item => item !== '')
    if (items.length > CONTINUATION_LIMITS.itemsPerPart) {
      return { ok: false, message: `${part} has ${String(items.length)} items; at most ${String(CONTINUATION_LIMITS.itemsPerPart)}` }
    }
    for (const item of items) {
      const itemProblem = checkItem(item, part)
      if (itemProblem !== undefined) return { ok: false, message: itemProblem }
    }
    note[part] = items
  }
  return { ok: true, note }
}

const utf8 = new TextEncoder()

function checkItem(item: string, part: string): string | undefined {
  if (utf8.encode(item).length > CONTINUATION_LIMITS.itemBytes) {
    return `an item of ${part} is over ${String(CONTINUATION_LIMITS.itemBytes)} bytes; keep items short and put detail in the files`
  }
  const marker = LIST_MARKERS.find(candidate => item.includes(candidate))
  if (marker !== undefined) return `${part} contains "${marker}": a note does not embed a recalled list`
  const label = Object.values(LABELS).find(candidate => item.startsWith(candidate))
  if (label !== undefined) return `${part} starts with "${label}": a note does not embed another note`
  return undefined
}

function oneLine(text: string): string {
  return text.replace(/\s+/gu, ' ').trim()
}

/**
 * The stored text of a note.
 * @param note - a checked note.
 * @returns the canonical layout.
 */
export function renderContinuation(note: ContinuationNote): string {
  const lines = [`${LABELS.goal} ${note.goal}`]
  for (const part of PARTS) {
    lines.push(LABELS[part])
    if (note[part].length === 0) lines.push(NONE)
    else for (const item of note[part]) lines.push(`- ${item}`)
  }
  return lines.join('\n')
}

/**
 * Read a stored note back; undefined when the content is not in the layout
 * (free text saved by hand or imported), which the readers then show as is.
 * @param content - entry content.
 * @returns the five parts.
 */
export function parseContinuation(content: string): ContinuationNote | undefined {
  if (!content.startsWith(LABELS.goal)) return undefined
  const note: ContinuationNote = { goal: '', decisions: [], unfinished: [], leads: [], verified: [] }
  let part: typeof PARTS[number] | undefined
  for (const [index, line] of content.split('\n').entries()) {
    if (index === 0) {
      note.goal = line.slice(LABELS.goal.length).trim()
      continue
    }
    const label = PARTS.find(candidate => line === LABELS[candidate])
    if (label !== undefined) {
      part = label
      continue
    }
    if (part === undefined) return undefined
    if (line === NONE) continue
    if (!line.startsWith('- ')) return undefined
    note[part].push(line.slice(2))
  }
  return note.goal === '' ? undefined : note
}
