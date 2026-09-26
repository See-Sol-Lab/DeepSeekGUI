/** Wire values of the DeepSeekGUI skill library: inventory, import review and outcomes. */

/** Manifest file name written into every install directory the manager owns. */
export const SKILL_MANIFEST_FILE = 'deepseekgui-skill.json'

/** Manifest schema version written by this release. */
export const SKILL_MANIFEST_SCHEMA_VERSION = 1

/** What an import came from. */
export type SkillOriginKind = 'directory' | 'zip' | 'markdown'

/**
 * Stable identity of an install: the source the user picked and the entry
 * inside it. Replacement matches on this record, never on the display name.
 */
export interface SkillOrigin {
  kind: SkillOriginKind
  /** Absolute path of the directory, archive, or Markdown file that was imported. */
  path: string
  /** Posix-relative path of the skill entry inside the source (`SKILL.md`, `pack/a/SKILL.md`, or the file name). */
  entry: string
}

/** Manifest stored as `deepseekgui-skill.json` beside the installed `SKILL.md`. */
export interface SkillInstallRecord {
  schemaVersion: typeof SKILL_MANIFEST_SCHEMA_VERSION
  /** Directory name under the library; `<name>-<8 hex>`, kept across replacements. */
  installId: string
  name: string
  description: string
  whenToUse?: string
  /** ISO time of the first install. */
  installedAt: string
  /** ISO time of the latest install or replacement. */
  updatedAt: string
  origin: SkillOrigin
  /** Regular files copied into the install directory, excluding the manifest. */
  files: number
  /** Bytes of those files. */
  bytes: number
}

/** Machine-readable problem codes surfaced during review, install and inventory. */
export type SkillIssueCode =
  | 'missing-frontmatter'
  | 'invalid-frontmatter'
  | 'missing-name'
  | 'invalid-name'
  | 'missing-description'
  | 'legacy-key'
  | 'invalid-boolean'
  | 'symlink-skipped'
  | 'unsafe-path'
  | 'too-many-files'
  | 'too-large'
  | 'zip-unreadable'
  | 'zip-too-large'
  | 'source-missing'
  | 'source-unsupported'
  | 'no-skill-found'
  | 'candidate-missing'
  | 'name-conflict'
  | 'replace-target-missing'
  | 'library-unwritable'
  | 'manifest-invalid'
  | 'skill-invalid'
  | 'not-managed'
  | 'io-error'
  | 'no-project'
  | 'unknown-install'
  | 'revision-conflict'

/** One problem with a source, a candidate, or an installed skill. */
export interface SkillIssue {
  code: SkillIssueCode
  /** Human-readable detail in English; the client maps `code` to localized copy. */
  message: string
  /** Posix-relative path inside the source or install the problem is about, when it is about one file. */
  path?: string
  /** Whether the review can repair it in the installed copy (name and description proposals). */
  fixable?: boolean
}

/** Health of one installed entry as read back from disk. */
export type SkillInstallStatus = 'ok' | 'invalid'

/** One entry of the library as shown in Settings → Skills (local). */
export interface SkillInstalledView extends SkillInstallRecord {
  /** Absolute install directory. */
  location: string
  status: SkillInstallStatus
  /** Present when `status` is `invalid`: what is wrong with the installed `SKILL.md`. */
  issue?: SkillIssue
}

/** Where a read-only skill comes from. Values mirror the official provider's source buckets. */
export type SkillReadOnlySource = 'user-dsh' | 'user-agents' | 'bundled'

/** A skill the manager can show but does not own: official user roots and the bundled root. */
export interface SkillReadOnlyView {
  source: SkillReadOnlySource
  name: string
  description: string
  /** Absolute path of the skill file. */
  location: string
}

/** Everything Settings → Skills (local) lists. */
export interface SkillInventory {
  /** Absolute library directory under the active DSH home. */
  libraryDir: string
  installed: SkillInstalledView[]
  /** Directory names under the library without a readable manifest; never touched by uninstall. */
  orphans: string[]
  readOnly: SkillReadOnlyView[]
}

/** What kind of entry a candidate was found as. */
export type SkillCandidateKind = 'skill' | 'markdown'

/** Metadata the review proposes for a candidate whose own frontmatter is incomplete. */
export interface SkillMetadataProposal {
  name?: string
  description?: string
}

/** The existing install a same-name candidate would replace. */
export interface SkillReplaceTarget {
  installId: string
  name: string
  origin: SkillOrigin
  location: string
}

/** One installable skill found inside a source. */
export interface SkillImportCandidate {
  /** Identifies the candidate within the preview; passed back in the apply request. */
  key: string
  /** Posix-relative path of the entry inside the source. */
  entry: string
  kind: SkillCandidateKind
  /** Name declared by the entry's frontmatter; null when missing or invalid. */
  name: string | null
  /** Description declared by the entry's frontmatter; null when missing. */
  description: string | null
  whenToUse?: string
  /** Proposed values for missing metadata; applied only to the installed copy. */
  proposed: SkillMetadataProposal
  /** Problems found; blocking ones have `fixable` unset or false. */
  issues: SkillIssue[]
  /** Regular files under the candidate's directory, including the entry. */
  files: number
  bytes: number
  /** Install the candidate would replace (matched by origin first, then by name), named so the actual target is visible; null when none. */
  replaces: SkillReplaceTarget | null
  /** Whether the candidate can be installed as reviewed (no blocking issue, and a name plus description resolve). */
  installable: boolean
}

/** The reviewed content of one source before anything is written. */
export interface SkillImportPreview {
  source: {
    kind: SkillOriginKind
    path: string
  }
  candidates: SkillImportCandidate[]
  /** Problems with the source itself (unreadable, unsupported, nothing found). */
  problems: SkillIssue[]
}

/** One reviewed candidate the user chose to install. */
export interface SkillImportSelection {
  key: string
  /** Final name; defaults to the declared name, then the proposal. */
  name?: string
  /** Final description; defaults to the declared description, then the proposal. */
  description?: string
  /** Install to replace, confirmed by the user from the preview's `replaces`; null installs beside existing entries. */
  replaces: string | null
}

/** Install the selected candidates of one source. */
export interface SkillImportRequest {
  path: string
  selections: SkillImportSelection[]
}

/** One selection that did not install. */
export interface SkillImportFailure {
  key: string
  issue: SkillIssue
}

/** Result of one apply call; installs and failures are independent per selection. */
export interface SkillImportOutcome {
  installed: SkillInstalledView[]
  failures: SkillImportFailure[]
}

/** One project that references an install through its selection. */
export interface SkillProjectRef {
  /** Project key: sha256 of the canonical folder path (see `SkillProjectView.project`). */
  key: string
  /** Canonical project folder as recorded when the selection was saved. */
  path: string
}

/** Result of removing one managed install. */
export interface SkillUninstallOutcome {
  installId: string
  /** Absolute directory that was (or would have been) removed. */
  location: string
  removed: boolean
  /** Present when `removed` is false. */
  issue?: SkillIssue
  /**
   * Projects whose selection still names this install. The references stay
   * in place as missing entries — nothing switches to another skill of the
   * same name — until each project clears them.
   */
  affected: SkillProjectRef[]
}

/** Projects whose selection references one install (Settings asks before uninstalling). */
export interface SkillInstallReferences {
  installId: string
  projects: SkillProjectRef[]
}

/**
 * Library or selection change carried by the `skill-manager/change` event.
 * The client `/` picker cache and the project page refresh on it.
 */
export type SkillLibraryChange =
  | {
    kind: 'install' | 'replace' | 'uninstall'
    installId: string
  }
  | {
    /** A project's selection was saved. */
    kind: 'selection'
    projectKey: string
  }

/** Why a session has no usable project. */
export type SkillProjectProblem = 'no-cwd' | 'missing-folder'

/** What the selection does for one install in the session's real catalog. */
export type SkillProjectEffect =
  /** Selected and the session's winning skill of that name is this install. */
  | 'active'
  /** Selected, but an official skill of the same name wins for this session. */
  | 'shadowed'
  /** Not selected: absent from the session's catalog. */
  | 'inactive'
  /** Selected, but the installed copy fails validation and cannot load. */
  | 'invalid'
  /** Selected, but the install no longer exists in the library. */
  | 'missing'

/** One row of the project page: an installed skill, or a selection entry whose install is gone. */
export interface SkillProjectEntry {
  installId: string
  name: string
  description: string
  status: SkillInstallStatus
  /** Present when `status` is `invalid`. */
  issue?: SkillIssue
  /** Whether the project's saved selection includes this install. */
  enabled: boolean
  effect: SkillProjectEffect
  /** The winning same-name skill's source and provider when `effect` is `shadowed`. */
  shadowedBy?: {
    source: string
    provider: string
  }
}

/** The project page for one session. */
export interface SkillProjectView {
  sessionId: string
  /** The session's project folder (canonical path and its key); null when the session has none. */
  project: SkillProjectRef | null
  /** Why `project` is null or unusable. */
  problem?: SkillProjectProblem
  /** Revision of the saved selection; 0 before the first save. Sent back with a save. */
  revision: number
  entries: SkillProjectEntry[]
  /** Whether the session's real catalog could be read; false means `effect` is a best guess from the selection alone. */
  catalogComplete: boolean
}

/** Save one project's selection through the session that shows it. */
export interface SkillProjectSelectionRequest {
  sessionId: string
  /** The complete list of install ids the project may use. */
  enabled: string[]
  /** The revision the page was rendered from; a different stored revision refuses the save. */
  revision: number
}

/** Result of a selection save. */
export interface SkillProjectSelectionOutcome {
  saved: boolean
  /** Present when `saved` is false. */
  issue?: SkillIssue
  /** The page as it reads after the attempt (fresh on conflict, so the person sees what won). */
  view: SkillProjectView
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * The library or a project selection changed: an install, a replacement,
     * an uninstall, or a saved selection. Declared here, in the client-safe
     * types module, so the Remote assembly can forward it to the browser.
     * @mode emit
     * @param change - What happened, to which installId or projectKey.
     */
    'skill-manager/change'(change: SkillLibraryChange): void
  }
}
