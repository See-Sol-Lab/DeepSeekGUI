/**
 * Per-project skill selection (B7-P5): which library installs a project
 * folder may use. One record per project under the `deepseekgui_skills`
 * storage domain, keyed by the canonical folder path, so every session of
 * the same folder reads one selection and other folders stay independent.
 * The record holds install ids, never display names: a replacement keeps
 * its id, and an uninstall leaves a missing reference the project clears
 * itself rather than silently resolving to another skill of the same name.
 */
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { defineDomain, domainTable, type KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { SkillSummary } from '@deepseek-ai/dsh-skill'
import { realpathNormalize } from '@deepseek-ai/dsh-workspace'
import type {
  SkillInstalledView,
  SkillIssue,
  SkillProjectEntry,
  SkillProjectProblem,
  SkillProjectRef,
  SkillProjectView,
} from './types.ts'

/** Provider name the managed library registers under; the project page recognizes its own winners by it. */
export const MANAGED_PROVIDER_NAME = 'deepseekgui-skills'

/** One project's saved selection. */
export const projectSelectionRecord = z.object({
  /** Canonical folder path as displayed. */
  path: z.string().min(1),
  /** Install ids the project may use; order is not significant. */
  enabled: z.array(z.string()),
  /** Monotonic save counter; a save must quote the revision it was rendered from. */
  revision: z.number().int().positive(),
  updatedAt: z.string(),
})

/** One project's saved selection. */
export type ProjectSelectionRecord = z.infer<typeof projectSelectionRecord>

/**
 * The selection domain: one `projects` table keyed by project key. The
 * `per-record` layout writes `<DSH_HOME>/storages/deepseekgui_skills/projects/<key>.json`
 * per project, so a save rewrites one small document.
 */
export const skillSelectionDomainSpec = defineDomain({
  name: 'deepseekgui_skills',
  version: 1,
  layout: 'per-record',
  tables: { projects: domainTable<string, ProjectSelectionRecord>(projectSelectionRecord) },
})

/** The projects table handle. */
export type ProjectTable = KvTable<string, ProjectSelectionRecord>

/** A resolved project folder, or why a session has none. */
export type ProjectResolution =
  | { project: SkillProjectRef; problem?: undefined }
  | { project: null; problem: SkillProjectProblem }

/**
 * Resolve a session working directory to its project identity: the same
 * `realpath` canon the official workspace registry uses, hashed into the
 * per-record key. Windows folds case first so two spellings of one folder
 * are one project.
 * @param cwd - session `header.cwd`; undefined for a session without a folder.
 * @returns the project, or the problem that leaves the session without one.
 */
export async function resolveProject(cwd: string | undefined): Promise<ProjectResolution> {
  if (cwd === undefined || cwd === '') return { project: null, problem: 'no-cwd' }
  let canonical: string
  try {
    canonical = await realpathNormalize(cwd)
  } catch {
    return { project: null, problem: 'missing-folder' }
  }
  return { project: { key: projectKeyOf(canonical), path: canonical } }
}

/**
 * Derive the per-record key of a canonical folder path.
 * @param canonical - path returned by the workspace canon.
 * @param platform - host platform; Windows folds case, everything else keeps it.
 * @returns 32 hex characters, path-safe for the storage backend.
 */
export function projectKeyOf(canonical: string, platform: NodeJS.Platform = process.platform): string {
  const folded = platform === 'win32' ? canonical.toLowerCase() : canonical
  return createHash('sha256').update(folded).digest('hex').slice(0, 32)
}

/**
 * The saved selection of a project.
 * @param table - projects table.
 * @param key - project key.
 * @returns the install ids, empty before the first save.
 */
export function enabledFor(table: ProjectTable, key: string): string[] {
  return table.get(key)?.enabled ?? []
}

/**
 * Projects whose selection names an install.
 * @param table - projects table.
 * @param installId - the install.
 * @returns project references, sorted by path.
 */
export function referencesTo(table: ProjectTable, installId: string): SkillProjectRef[] {
  const refs: SkillProjectRef[] = []
  for (const [key, record] of table.entries()) {
    if (record.enabled.includes(installId)) refs.push({ key, path: record.path })
  }
  return refs.sort((left, right) => left.path.localeCompare(right.path))
}

/** Inputs of one save. */
export interface SaveSelectionInput {
  project: SkillProjectRef
  /** Install ids the page submitted. */
  enabled: string[]
  /** Revision the page was rendered from. */
  expectedRevision: number
  /** Install ids that exist in the library right now. */
  installed: ReadonlySet<string>
  now: () => Date
}

/** Result of one save attempt. */
export type SaveSelectionResult =
  | { saved: true; record: ProjectSelectionRecord }
  | { saved: false; issue: SkillIssue }

/**
 * Save a project's selection. The revision check makes a stale page lose:
 * whoever saved last is what the folder uses, and the loser re-reads. An id
 * that neither exists nor was already referenced is refused; keeping an
 * already-missing reference is allowed so a page can save around it.
 * @param table - projects table.
 * @param input - the save.
 * @returns the stored record, or the issue that refused the save.
 */
export async function saveSelection(table: ProjectTable, input: SaveSelectionInput): Promise<SaveSelectionResult> {
  const current = table.get(input.project.key)
  const storedRevision = current?.revision ?? 0
  if (storedRevision !== input.expectedRevision) {
    return {
      saved: false,
      issue: {
        code: 'revision-conflict',
        message: `the selection was saved elsewhere (revision ${storedRevision}, page had ${input.expectedRevision})`,
      },
    }
  }
  const previous = new Set(current?.enabled ?? [])
  const enabled = [...new Set(input.enabled)].sort((left, right) => left.localeCompare(right))
  const unknown = enabled.find(installId => !input.installed.has(installId) && !previous.has(installId))
  if (unknown !== undefined) {
    return { saved: false, issue: { code: 'unknown-install', message: `"${unknown}" is not installed in the library` } }
  }
  const record: ProjectSelectionRecord = {
    path: input.project.path,
    enabled,
    revision: storedRevision + 1,
    updatedAt: input.now().toISOString(),
  }
  await table.put(input.project.key, record)
  return { saved: true, record }
}

/** What the page needs beyond the selection to say whether each tick takes effect. */
export interface ProjectViewInput {
  sessionId: string
  resolution: ProjectResolution
  record: ProjectSelectionRecord | undefined
  installed: SkillInstalledView[]
  /** The session's winning catalog as the registry resolves it; undefined when it could not be read. */
  catalog: { skills: readonly SkillSummary[]; complete: boolean } | undefined
}

/**
 * Assemble the project page: one row per library install plus one per
 * selection entry whose install is gone, each with what the selection does
 * for this session — active, shadowed by an official same-name skill,
 * invalid, missing, or simply not selected.
 * @param input - selection, inventory and catalog facts.
 * @returns the page.
 */
export function buildProjectView(input: ProjectViewInput): SkillProjectView {
  const enabled = new Set(input.record?.enabled ?? [])
  const winners = new Map((input.catalog?.skills ?? []).map(skill => [skill.name, skill]))
  const complete = input.catalog?.complete === true
  const entries: SkillProjectEntry[] = input.installed.map((item) => {
    const isEnabled = enabled.has(item.installId)
    const base = {
      installId: item.installId,
      name: item.name,
      description: item.description,
      status: item.status,
      ...item.issue === undefined ? {} : { issue: item.issue },
      enabled: isEnabled,
    }
    if (!isEnabled) return { ...base, effect: 'inactive' }
    if (item.status === 'invalid') return { ...base, effect: 'invalid' }
    const winner = winners.get(item.name)
    if (winner === undefined) return { ...base, effect: complete ? 'invalid' : 'active' }
    if (winner.provider === MANAGED_PROVIDER_NAME) return { ...base, effect: 'active' }
    return { ...base, effect: 'shadowed', shadowedBy: { source: winner.source, provider: winner.provider } }
  })
  const present = new Set(input.installed.map(item => item.installId))
  for (const installId of enabled) {
    if (present.has(installId)) continue
    entries.push({
      installId,
      name: nameOfInstallId(installId),
      description: '',
      status: 'invalid',
      issue: { code: 'unknown-install', message: 'the install no longer exists in the library' },
      enabled: true,
      effect: 'missing',
    })
  }
  entries.sort((left, right) => left.name.localeCompare(right.name) || left.installId.localeCompare(right.installId))
  return {
    sessionId: input.sessionId,
    project: input.resolution.project,
    ...input.resolution.problem === undefined ? {} : { problem: input.resolution.problem },
    revision: input.record?.revision ?? 0,
    entries,
    catalogComplete: complete,
  }
}

/**
 * The display name of an install whose manifest is gone: the id minus its
 * random suffix.
 * @param installId - `<name>-<8 hex>`.
 * @returns the name part, or the id itself when it has no such suffix.
 */
export function nameOfInstallId(installId: string): string {
  const match = /^(.+)-[0-9a-f]{8}$/u.exec(installId)
  return match?.[1] ?? installId
}
