/**
 * Skill document review: the same frontmatter rules the official filesystem
 * provider enforces (kebab-case `name`, non-empty `description`, canonical
 * invocation keys), reported as issues instead of silently ignoring the file,
 * plus proposals for what a plain document lacks. Rewrites only ever target
 * the installed copy; the source file is never edited.
 */
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import type { SkillIssue, SkillMetadataProposal } from './types.ts'

/** Public skill-name grammar (mirrors `@deepseek-ai/dsh-skill`). */
export const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u

/** Longest description the review proposes from a document body. */
const PROPOSED_DESCRIPTION_MAX = 200

/** Legacy invocation keys the official provider rejects, with their canonical spelling. */
const LEGACY_KEYS: ReadonlyArray<readonly [legacy: string, canonical: string]> = [
  ['disableModelInvocation', 'disable-model-invocation'],
  ['modelInvocable', 'disable-model-invocation'],
  ['userInvocable', 'user-invocable'],
]

/** Canonical boolean invocation keys. */
const BOOLEAN_KEYS = ['disable-model-invocation', 'user-invocable'] as const

/** A skill document split into reviewed frontmatter and body. */
export interface SkillDocument {
  /** Parsed frontmatter mapping; null when absent or unparsable. */
  data: Record<string, unknown> | null
  /** Markdown body after the closing delimiter, or the whole text when there is no frontmatter. */
  body: string
  /** Declared kebab-case name; null when missing or invalid. */
  name: string | null
  /** Declared non-empty description; null when missing. */
  description: string | null
  whenToUse?: string
  issues: SkillIssue[]
}

/**
 * Review one skill document.
 * @param raw - full text of `SKILL.md` or a plain Markdown file.
 * @returns the reviewed document; `issues` lists every rule the text breaks.
 */
export function reviewSkillDocument(raw: string): SkillDocument {
  const split = splitFrontmatter(raw)
  if (split === undefined) {
    return {
      data: null,
      body: raw,
      name: null,
      description: null,
      issues: [{ code: 'missing-frontmatter', message: 'the document has no YAML frontmatter', fixable: true }],
    }
  }
  let data: unknown
  try {
    data = parseYaml(split.yaml)
  } catch (error) {
    return {
      data: null,
      body: split.body,
      name: null,
      description: null,
      issues: [{ code: 'invalid-frontmatter', message: `the YAML frontmatter does not parse: ${String(error)}` }],
    }
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return {
      data: null,
      body: split.body,
      name: null,
      description: null,
      issues: [{ code: 'invalid-frontmatter', message: 'the YAML frontmatter is not a mapping' }],
    }
  }
  const mapping = data as Record<string, unknown>
  const issues: SkillIssue[] = []
  const rawName = stringField(mapping, 'name')
  let name: string | null = null
  if (rawName === undefined) {
    issues.push({ code: 'missing-name', message: 'frontmatter requires a non-empty "name"', fixable: true })
  } else if (!SKILL_NAME.test(rawName)) {
    issues.push({ code: 'invalid-name', message: `"${rawName}" is not a kebab-case skill name`, fixable: true })
  } else {
    name = rawName
  }
  const description = stringField(mapping, 'description') ?? null
  if (description === null) {
    issues.push({ code: 'missing-description', message: 'frontmatter requires a non-empty "description"', fixable: true })
  }
  for (const [legacy, canonical] of LEGACY_KEYS) {
    if (Object.hasOwn(mapping, legacy)) {
      issues.push({ code: 'legacy-key', message: `frontmatter field "${legacy}" is unsupported; use "${canonical}"` })
    }
  }
  for (const key of BOOLEAN_KEYS) {
    if (Object.hasOwn(mapping, key) && !isFrontmatterBoolean(mapping[key])) {
      issues.push({ code: 'invalid-boolean', message: `frontmatter field "${key}" must be a boolean` })
    }
  }
  const whenToUse = stringField(mapping, 'whenToUse')
  return {
    data: mapping,
    body: split.body,
    name,
    description,
    ...whenToUse === undefined ? {} : { whenToUse },
    issues,
  }
}

/**
 * Propose the metadata a document lacks: a kebab-case name from the file or
 * directory name, and a description from the first plain line of the body.
 * @param document - reviewed document.
 * @param fallbackName - file or directory name to derive a name from.
 * @returns proposals for the missing fields only.
 */
export function proposeMetadata(document: SkillDocument, fallbackName: string): SkillMetadataProposal {
  const proposal: SkillMetadataProposal = {}
  if (document.name === null) {
    const name = toSkillName(fallbackName)
    if (name !== undefined) proposal.name = name
  }
  if (document.description === null) {
    const description = firstPlainLine(document.body)
    if (description !== undefined) proposal.description = description
  }
  return proposal
}

/**
 * Whether a reviewed document blocks installation regardless of proposals.
 * @param document - reviewed document.
 * @returns true when an issue exists that a name or description cannot repair.
 */
export function hasBlockingIssue(document: SkillDocument): boolean {
  return document.issues.some(issue => issue.fixable !== true)
}

/**
 * Render the installed copy of a document with final metadata. Unchanged
 * frontmatter keys are kept; the body is written back verbatim.
 * @param document - reviewed document.
 * @param name - final skill name.
 * @param description - final description.
 * @returns the text to write as the installed `SKILL.md`.
 */
export function renderSkillDocument(document: SkillDocument, name: string, description: string): string {
  const data: Record<string, unknown> = { ...document.data ?? {}, name, description }
  const yaml = stringifyYaml(data, { lineWidth: 0 })
  return `---\n${yaml}---\n${document.body}`
}

/**
 * Derive a kebab-case skill name from a file or directory name.
 * @param input - raw name; an extension is dropped first.
 * @returns the name, or undefined when nothing usable remains.
 */
export function toSkillName(input: string): string | undefined {
  const stem = input.replace(/\.[^.]+$/u, '')
  const name = stem
    .replace(/([a-z0-9])([A-Z])/gu, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
  return SKILL_NAME.test(name) ? name : undefined
}

/** The frontmatter block and the rest of the text. */
interface FrontmatterSplit {
  yaml: string
  body: string
}

function splitFrontmatter(raw: string): FrontmatterSplit | undefined {
  const firstLineEnd = raw.indexOf('\n')
  if (firstLineEnd < 0) return undefined
  if (raw.slice(0, firstLineEnd).replace(/\r$/u, '') !== '---') return undefined
  const start = firstLineEnd + 1
  let lineStart = start
  for (;;) {
    const nextNewline = raw.indexOf('\n', lineStart)
    const lineEnd = nextNewline < 0 ? raw.length : nextNewline
    if (raw.slice(lineStart, lineEnd).replace(/\r$/u, '') === '---') {
      return { yaml: raw.slice(start, lineStart), body: nextNewline < 0 ? '' : raw.slice(nextNewline + 1) }
    }
    if (nextNewline < 0) return undefined
    lineStart = nextNewline + 1
  }
}

function stringField(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function isFrontmatterBoolean(value: unknown): boolean {
  if (typeof value === 'boolean' || value === 1 || value === '1' || value === 0 || value === '0') return true
  return typeof value === 'string' && ['true', 'yes', 'on', 'false', 'no', 'off'].includes(value.toLowerCase())
}

function firstPlainLine(body: string): string | undefined {
  let inFence = false
  for (const rawLine of body.split('\n')) {
    const line = rawLine.replace(/\r$/u, '').trim()
    if (line.startsWith('```')) {
      inFence = !inFence
      continue
    }
    if (inFence || line === '' || line.startsWith('#') || line.startsWith('<')) continue
    const text = line.replace(/^[-*>]\s+/u, '').replace(/[*_`]/gu, '').trim()
    if (text === '') continue
    return text.length > PROPOSED_DESCRIPTION_MAX ? `${text.slice(0, PROPOSED_DESCRIPTION_MAX - 1)}…` : text
  }
  return undefined
}
