/**
 * Pure page logic for Settings → Skills: the editable review drafts
 * built from a preview, the selections sent back to the skill-manager, and
 * small formatters. No DOM, no Remote — the component renders these.
 */
import type {
  SkillImportCandidate,
  SkillImportPreview,
  SkillImportSelection,
  SkillIssue,
  SkillIssueCode,
} from '@deepseek-ai/dsh-skill-manager/types'
import type { SkillsKey } from './locales.ts'

/** One candidate as the person is editing it. */
export interface CandidateDraft {
  key: string
  selected: boolean
  /** Working name: the declared one, then the proposal, then empty. */
  name: string
  /** Working description: the declared one, then the proposal, then empty. */
  description: string
}

/**
 * Build the editable drafts of a preview. Installable candidates start
 * selected; every candidate starts with the declared metadata or the
 * review's proposal so the person sees what would be written.
 * @param preview - reviewed source.
 * @returns one draft per candidate, in preview order.
 */
export function draftsFrom(preview: SkillImportPreview): CandidateDraft[] {
  return preview.candidates.map(candidate => ({
    key: candidate.key,
    selected: candidate.installable,
    name: candidate.name ?? candidate.proposed.name ?? '',
    description: candidate.description ?? candidate.proposed.description ?? '',
  }))
}

/**
 * Whether a draft can be sent: selected, not blocked, and with both fields
 * filled in.
 * @param candidate - the reviewed candidate.
 * @param draft - its draft.
 * @returns true when the apply request may include it.
 */
export function draftReady(candidate: SkillImportCandidate, draft: CandidateDraft): boolean {
  const blocked = candidate.issues.some(issue => issue.fixable !== true)
  return draft.selected && !blocked && draft.name.trim() !== '' && draft.description.trim() !== ''
}

/**
 * Turn ready drafts into apply selections. A name or description is sent
 * only when it differs from what the entry declares, so an untouched valid
 * skill installs byte-for-byte; `replaces` is the preview's finding, which
 * the person saw beside the candidate.
 * @param preview - reviewed source.
 * @param drafts - the edited drafts.
 * @returns selections for the apply request.
 */
export function selectionsFrom(preview: SkillImportPreview, drafts: CandidateDraft[]): SkillImportSelection[] {
  const selections: SkillImportSelection[] = []
  for (const candidate of preview.candidates) {
    const draft = drafts.find(item => item.key === candidate.key)
    if (draft === undefined || !draftReady(candidate, draft)) continue
    const name = draft.name.trim()
    const description = draft.description.trim()
    selections.push({
      key: candidate.key,
      ...name === candidate.name ? {} : { name },
      ...description === candidate.description ? {} : { description },
      replaces: candidate.replaces === null ? null : candidate.replaces.installId,
    })
  }
  return selections
}

/**
 * The locale key of an issue code.
 * @param code - issue code from the skill-manager.
 * @returns the `issue.*` key.
 */
export function issueKey(code: SkillIssueCode): SkillsKey {
  return `issue.${code}`
}

/**
 * One-line, localized text for an issue: the code's label plus the path it
 * is about when there is one.
 * @param issue - the issue.
 * @param t - translate function of the skills namespace.
 * @returns display text.
 */
export function issueText(issue: SkillIssue, t: (key: SkillsKey) => string): string {
  const label = t(issueKey(issue.code))
  return issue.path === undefined ? label : `${label} — ${issue.path}`
}

/**
 * Human-readable byte size.
 * @param bytes - byte count.
 * @returns `123 B`, `4.5 KB`, `1.2 MB`.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Local date and time for the rows naming where an install came from; the raw text when it is not a date.
 * @param iso - ISO timestamp from a manifest.
 * @returns display text.
 */
export function formatTime(iso: string): string {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return iso
  return new Date(ms).toLocaleString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
}
