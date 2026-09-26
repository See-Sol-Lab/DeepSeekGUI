/**
 * The skill library on disk: `<DSH_HOME>/deepseekgui/skills/<installId>/`,
 * one directory per install with the whole skill package plus a manifest.
 *
 * Every install is a complete directory operation: the package is staged
 * under `<DSH_HOME>/deepseekgui/skills-staging/`, validated there, and only
 * then renamed into the library — a failure leaves no half-installed entry
 * behind. Uninstall removes only directories the manager wrote (those with a
 * matching manifest); the original download and every other skill root stay
 * untouched. Skills under the official user roots and the bundled root are
 * listed read-only for orientation.
 */
import { randomBytes } from 'node:crypto'
import { copyFile, lstat, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { hasBlockingIssue, proposeMetadata, reviewSkillDocument, renderSkillDocument, SKILL_NAME, type SkillDocument } from './frontmatter.ts'
import { readZip } from './zip.ts'
import {
  SKILL_MANIFEST_FILE,
  SKILL_MANIFEST_SCHEMA_VERSION,
  type SkillImportCandidate,
  type SkillImportOutcome,
  type SkillImportPreview,
  type SkillImportRequest,
  type SkillImportSelection,
  type SkillInstalledView,
  type SkillInstallRecord,
  type SkillInventory,
  type SkillIssue,
  type SkillLibraryChange,
  type SkillOrigin,
  type SkillOriginKind,
  type SkillReadOnlySource,
  type SkillReadOnlyView,
  type SkillUninstallOutcome,
} from './types.ts'

/** Library location under the DSH home. */
const LIBRARY_SEGMENTS = ['deepseekgui', 'skills'] as const
/** Staging and trash location under the DSH home; outside the library so a provider root never sees it. */
const STAGING_SEGMENTS = ['deepseekgui', 'skills-staging'] as const
/** Deepest directory (in segments) at which a nested `SKILL.md` is still listed as a candidate. */
const NESTED_SKILL_MAX_DEPTH = 3
/** Deepest directory the source walk descends into. */
const WALK_MAX_DEPTH = 24
/** Directory names never copied from a source. */
const SKIPPED_DIRECTORIES = new Set(['.git'])
/** Install directory grammar: `<name>-<8 hex>`. */
const INSTALL_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*-[0-9a-f]{8}$/u

/** Size and count bounds for one import. */
export interface LibraryLimits {
  /** Inclusive cap on the archive file itself. */
  maxZipBytes: number
  /** Inclusive cap on one file inside a source. */
  maxFileBytes: number
  /** Inclusive cap on all files of one source. */
  maxTotalBytes: number
  /** Inclusive cap on the number of files of one source. */
  maxFiles: number
}

/** Where the library lives and how it is bounded. */
export interface LibraryOptions {
  /** Explicit DSH home; defaults to `$DSH_HOME` or `~/.dsh`, resolved on every call. */
  dshHome?: string
  /** Explicit agents home; defaults to `$DSH_AGENTS_HOME` or `~/.agents`. */
  agentsHome?: string
  /** Bundled skill root; defaults to `$DSH_BUNDLED_SKILL_DIR`. */
  bundledSkillDir?: string
  /** Explicit library directory; defaults to `<DSH home>/deepseekgui/skills`. */
  libraryDir?: string
  /** Explicit staging directory; defaults to `<DSH home>/deepseekgui/skills-staging`. */
  stagingDir?: string
  limits: LibraryLimits
  /** Clock for manifest timestamps. */
  now?: () => Date
  /** Eight lowercase hex characters for new install ids. */
  randomHex?: () => string
}

/** Resolved locations for one call. */
export interface LibraryPaths {
  dshHome: string
  agentsHome: string
  bundledSkillDir: string | undefined
  libraryDir: string
  stagingDir: string
}

/**
 * Resolve the library locations for the current environment.
 * @param options - library options.
 * @returns absolute paths.
 */
export function resolveLibraryPaths(options: LibraryOptions): LibraryPaths {
  const dshHome = resolveDshHome(options.dshHome)
  const agentsHome = resolve(options.agentsHome ?? process.env.DSH_AGENTS_HOME ?? join(homedir(), '.agents'))
  const bundled = options.bundledSkillDir ?? process.env.DSH_BUNDLED_SKILL_DIR
  return {
    dshHome,
    agentsHome,
    bundledSkillDir: bundled === undefined ? undefined : resolve(bundled),
    libraryDir: resolve(options.libraryDir ?? join(dshHome, ...LIBRARY_SEGMENTS)),
    stagingDir: resolve(options.stagingDir ?? join(dshHome, ...STAGING_SEGMENTS)),
  }
}

/** One regular file of a source, addressed by its posix-relative path. */
interface SourceFile {
  path: string
  bytes: number
  /** Write the file's bytes to an absolute destination path. */
  copyTo: (destination: string) => Promise<void>
  /** Read the file as UTF-8 text. */
  text: () => Promise<string>
}

/** A source after reading: its files and the problems that excluded parts of it. */
interface SourceTree {
  kind: SkillOriginKind
  path: string
  files: SourceFile[]
  problems: SkillIssue[]
}

/** A candidate with the files it would install. */
interface ResolvedCandidate {
  view: SkillImportCandidate
  document: SkillDocument
  /** Posix-relative directory of the candidate inside the source; '' for the root. */
  root: string
  /** Files under `root`, the entry included. */
  files: SourceFile[]
  entry: SourceFile
}

/**
 * List the library, the orphans beside it, and the read-only roots.
 * @param options - library options.
 * @returns the inventory.
 */
export async function scanInventory(options: LibraryOptions): Promise<SkillInventory> {
  const paths = resolveLibraryPaths(options)
  const installed: SkillInstalledView[] = []
  const orphans: string[] = []
  for (const entry of await readdirSafe(paths.libraryDir)) {
    if (!entry.isDirectory()) continue
    const location = join(paths.libraryDir, entry.name)
    const record = await readManifest(location, entry.name)
    if (record === undefined) {
      orphans.push(entry.name)
      continue
    }
    installed.push(await installedView(record, location))
  }
  installed.sort((left, right) => left.name.localeCompare(right.name) || left.installId.localeCompare(right.installId))
  orphans.sort((left, right) => left.localeCompare(right))
  const readOnly: SkillReadOnlyView[] = []
  const roots: Array<{ path: string; source: SkillReadOnlySource; skipSystem: boolean }> = [
    { path: join(paths.dshHome, 'skills'), source: 'user-dsh', skipSystem: true },
    { path: join(paths.agentsHome, 'skills'), source: 'user-agents', skipSystem: false },
  ]
  if (paths.bundledSkillDir !== undefined) roots.push({ path: paths.bundledSkillDir, source: 'bundled', skipSystem: false })
  for (const root of roots) readOnly.push(...await scanReadOnlyRoot(root.path, root.source, root.skipSystem))
  return { libraryDir: paths.libraryDir, installed, orphans, readOnly }
}

/**
 * Read a managed install that still agrees with its manifest.
 * @param libraryDir - library root.
 * @param installId - selected directory name.
 * @returns the valid declared name, or undefined for an invalid or missing install.
 */
export async function validInstallName(libraryDir: string, installId: string): Promise<string | undefined> {
  if (!INSTALL_ID.test(installId)) return undefined
  const location = join(libraryDir, installId)
  const record = await readManifest(location, installId)
  if (record === undefined) return undefined
  const item = await installedView(record, location)
  return item.status === 'ok' ? item.name : undefined
}

/**
 * Review a source without writing anything.
 * @param options - library options.
 * @param sourcePath - directory, `.zip`, or `.md` the user picked.
 * @returns the candidates found and the problems with the source.
 */
export async function previewImport(options: LibraryOptions, sourcePath: string): Promise<SkillImportPreview> {
  const tree = await loadSource(sourcePath, options.limits)
  const inventory = await scanInventory(options)
  const candidates = await findCandidates(tree, inventory.installed)
  const problems = [...tree.problems]
  // A source that produced no files already carries the problem that explains it.
  if (candidates.length === 0 && (tree.files.length > 0 || problems.length === 0)) {
    problems.push({ code: 'no-skill-found', message: 'no SKILL.md or Markdown skill file was found in the source' })
  }
  return { source: { kind: tree.kind, path: tree.path }, candidates: candidates.map(candidate => candidate.view), problems }
}

/**
 * Install the selected candidates of a source. Selections are independent:
 * one failure does not undo another selection's install.
 * @param options - library options.
 * @param request - source path and reviewed selections.
 * @param changed - called after each successful library change.
 * @returns what installed and what did not.
 */
export async function applyImport(
  options: LibraryOptions,
  request: SkillImportRequest,
  changed: (change: SkillLibraryChange) => void,
): Promise<SkillImportOutcome> {
  const outcome: SkillImportOutcome = { installed: [], failures: [] }
  const tree = await loadSource(request.path, options.limits)
  const incomplete = tree.problems.find(issue => issue.code === 'too-large' || issue.code === 'too-many-files')
  if (incomplete !== undefined) {
    outcome.failures = request.selections.map(selection => ({ key: selection.key, issue: incomplete }))
    return outcome
  }
  for (const selection of request.selections) {
    const inventory = await scanInventory(options)
    const candidates = await findCandidates(tree, inventory.installed)
    const candidate = candidates.find(item => item.view.key === selection.key)
    if (candidate === undefined) {
      outcome.failures.push({ key: selection.key, issue: { code: 'candidate-missing', message: `no candidate "${selection.key}" in the source` } })
      continue
    }
    const result = await installCandidate(options, tree, candidate, selection, inventory.installed)
    if ('issue' in result) {
      outcome.failures.push({ key: selection.key, issue: result.issue })
      continue
    }
    outcome.installed.push(result.view)
    changed({ kind: selection.replaces === null ? 'install' : 'replace', installId: result.view.installId })
  }
  return outcome
}

/**
 * Remove one managed install.
 * @param options - library options.
 * @param installId - directory name under the library.
 * @param changed - called when the directory was removed.
 * @returns the outcome; refusals carry an issue and remove nothing.
 */
export async function uninstallSkill(
  options: LibraryOptions,
  installId: string,
  changed: (change: SkillLibraryChange) => void,
): Promise<LibraryUninstallOutcome> {
  const paths = resolveLibraryPaths(options)
  const location = join(paths.libraryDir, installId)
  if (!INSTALL_ID.test(installId)) {
    return { installId, location, removed: false, issue: { code: 'not-managed', message: `"${installId}" is not a library install id` } }
  }
  const record = await readManifest(location, installId)
  if (record === undefined) {
    return {
      installId,
      location,
      removed: false,
      issue: { code: 'not-managed', message: 'the directory has no manifest written by this manager; nothing was removed' },
    }
  }
  try {
    await mkdir(paths.stagingDir, { recursive: true })
    const trash = join(paths.stagingDir, `${installId}.${scratchName()}.uninstall`)
    await rename(location, trash)
    await rm(trash, { recursive: true, force: true })
  } catch (error) {
    return { installId, location, removed: false, issue: { code: 'io-error', message: `uninstall failed: ${String(error)}` } }
  }
  changed({ kind: 'uninstall', installId })
  return { installId, location, removed: true }
}

/** The directory-level uninstall result; the service adds the affected projects. */
export type LibraryUninstallOutcome = Omit<SkillUninstallOutcome, 'affected'>

/** Successful install of one candidate. */
interface InstallSuccess {
  view: SkillInstalledView
}

/** Refused or failed install of one candidate. */
interface InstallFailure {
  issue: SkillIssue
}

async function installCandidate(
  options: LibraryOptions,
  tree: SourceTree,
  candidate: ResolvedCandidate,
  selection: SkillImportSelection,
  installed: SkillInstalledView[],
): Promise<InstallSuccess | InstallFailure> {
  const name = selection.name ?? candidate.view.name ?? candidate.view.proposed.name
  if (name === undefined || !SKILL_NAME.test(name)) {
    return { issue: { code: 'invalid-name', message: `"${name ?? ''}" is not a kebab-case skill name` } }
  }
  const description = (selection.description ?? candidate.view.description ?? candidate.view.proposed.description ?? '').trim()
  if (description === '') {
    return { issue: { code: 'missing-description', message: 'a description is required' } }
  }
  const blocking = candidate.document.issues.find(issue => issue.fixable !== true)
  if (blocking !== undefined) {
    return { issue: { code: 'skill-invalid', message: blocking.message, path: candidate.view.entry } }
  }
  // Same-name rules: the replacement target is the install id the user
  // confirmed from the preview, never a lookup by display name at apply time.
  const replaced = selection.replaces === null ? undefined : installed.find(item => item.installId === selection.replaces)
  if (selection.replaces !== null && replaced === undefined) {
    return { issue: { code: 'replace-target-missing', message: `install "${selection.replaces}" no longer exists` } }
  }
  const conflict = installed.find(item => item.name === name && item.installId !== selection.replaces)
  if (conflict !== undefined) {
    return {
      issue: {
        code: 'name-conflict',
        message: `"${name}" is already installed as ${conflict.installId} from ${conflict.origin.path}; choose it as the replacement target or rename`,
      },
    }
  }
  const paths = resolveLibraryPaths(options)
  try {
    await mkdir(paths.libraryDir, { recursive: true })
    await mkdir(paths.stagingDir, { recursive: true })
  } catch (error) {
    return { issue: { code: 'library-unwritable', message: `the library cannot be created: ${String(error)}` } }
  }
  const stage = join(paths.stagingDir, `${name}.${scratchName()}.stage`)
  try {
    const written = await stageCandidate(stage, candidate, name, description)
    const now = (options.now ?? (() => new Date))().toISOString()
    const installId = replaced?.installId ?? await freshInstallId(paths.libraryDir, name, options)
    const record: SkillInstallRecord = {
      schemaVersion: SKILL_MANIFEST_SCHEMA_VERSION,
      installId,
      name,
      description,
      ...candidate.document.whenToUse === undefined ? {} : { whenToUse: candidate.document.whenToUse },
      installedAt: replaced?.installedAt ?? now,
      updatedAt: now,
      origin: { kind: tree.kind, path: tree.path, entry: candidate.view.entry },
      files: written.files,
      bytes: written.bytes,
    }
    await writeFile(join(stage, SKILL_MANIFEST_FILE), `${JSON.stringify(record, null, 2)}\n`, 'utf8')
    await validateStaged(stage, name)
    const location = join(paths.libraryDir, installId)
    await publish(stage, location, replaced === undefined ? undefined : join(paths.stagingDir, `${installId}.${scratchName()}.replaced`))
    return { view: await installedView(record, location) }
  } catch (error) {
    await rm(stage, { recursive: true, force: true })
    const code = error instanceof StageError ? error.code : 'io-error'
    return { issue: { code, message: error instanceof StageError ? error.message : `install failed: ${String(error)}` } }
  }
}

/** Failure raised while staging, carrying its issue code. */
class StageError extends Error {
  constructor(readonly code: SkillIssue['code'], message: string) {
    super(message)
    this.name = 'StageError'
  }
}

/** Files and bytes written into a staging directory. */
interface StagedCount {
  files: number
  bytes: number
}

async function stageCandidate(stage: string, candidate: ResolvedCandidate, name: string, description: string): Promise<StagedCount> {
  await mkdir(stage, { recursive: true })
  let files = 0
  let bytes = 0
  const prefix = candidate.root === '' ? '' : `${candidate.root}/`
  for (const file of candidate.files) {
    const relative = file === candidate.entry ? 'SKILL.md' : file.path.slice(prefix.length)
    const destination = join(stage, ...relative.split('/'))
    await mkdir(dirname(destination), { recursive: true })
    if (file === candidate.entry && needsRewrite(candidate.document, name, description)) {
      const text = renderSkillDocument(candidate.document, name, description)
      await writeFile(destination, text, 'utf8')
      bytes += Buffer.byteLength(text)
    } else {
      await file.copyTo(destination)
      bytes += file.bytes
    }
    files += 1
  }
  return { files, bytes }
}

function needsRewrite(document: SkillDocument, name: string, description: string): boolean {
  return document.issues.length > 0 || document.name !== name || document.description !== description
}

/**
 * Re-read the staged `SKILL.md` with the provider's rules before it becomes
 * visible; the copy must parse clean and declare the chosen name.
 * @param stage - staging directory holding the complete package.
 * @param name - name the install was reviewed under.
 * @throws StageError when the staged copy would be ignored or misnamed.
 */
export async function validateStaged(stage: string, name: string): Promise<void> {
  const staged = reviewSkillDocument(await readFile(join(stage, 'SKILL.md'), 'utf8'))
  if (staged.issues.length > 0 || staged.name !== name) {
    const detail = staged.issues[0]?.message ?? 'the staged SKILL.md does not declare the chosen name'
    throw new StageError('skill-invalid', `the staged copy fails validation: ${detail}`)
  }
}

/**
 * Move a validated stage into the library. Replacing first parks the old
 * install under `trash`; if the stage cannot take its place the old install
 * is put back before the error propagates.
 * @param stage - staging directory.
 * @param location - final install directory.
 * @param trash - where the old install goes when replacing; undefined for a new install.
 */
export async function publish(stage: string, location: string, trash: string | undefined): Promise<void> {
  if (trash === undefined) {
    await rename(stage, location)
    return
  }
  await rename(location, trash)
  try {
    await rename(stage, location)
  } catch (error) {
    await rename(trash, location)
    throw error
  }
  await rm(trash, { recursive: true, force: true })
}

async function freshInstallId(libraryDir: string, name: string, options: LibraryOptions): Promise<string> {
  for (;;) {
    const installId = `${name}-${hex(options)}`
    if (await lstat(join(libraryDir, installId)).then(() => false, () => true)) return installId
  }
}

function hex(options: LibraryOptions): string {
  return (options.randomHex ?? (() => randomBytes(4).toString('hex')))()
}

/** Unique scratch directory suffix for stages and trash; never part of an install id. */
function scratchName(): string {
  return `${process.pid}-${randomBytes(6).toString('hex')}`
}

async function loadSource(sourcePath: string, limits: LibraryLimits): Promise<SourceTree> {
  const path = resolve(sourcePath)
  let info
  try {
    info = await stat(path)
  } catch (error) {
    return { kind: 'directory', path, files: [], problems: [{ code: 'source-missing', message: `the source cannot be read: ${String(error)}` }] }
  }
  if (info.isDirectory()) {
    const walk = await walkDirectory(path, limits)
    return { kind: 'directory', path, files: walk.files, problems: walk.problems }
  }
  const lower = path.toLowerCase()
  if (lower.endsWith('.zip')) {
    if (info.size > limits.maxZipBytes) {
      return { kind: 'zip', path, files: [], problems: [{ code: 'zip-too-large', message: `the archive exceeds ${limits.maxZipBytes} bytes` }] }
    }
    const contents = readZip(new Uint8Array(await readFile(path)), limits)
    const files = contents.entries.map(entry => ({
      path: entry.path,
      bytes: entry.data.byteLength,
      copyTo: (destination: string) => writeFile(destination, entry.data),
      text: () => Promise.resolve(new TextDecoder().decode(entry.data)),
    }))
    return { kind: 'zip', path, files, problems: contents.problems }
  }
  if (lower.endsWith('.md')) {
    if (info.size > limits.maxFileBytes) {
      return { kind: 'markdown', path, files: [], problems: [{ code: 'too-large', message: `the file exceeds ${limits.maxFileBytes} bytes` }] }
    }
    return { kind: 'markdown', path, files: [fileEntry(path, basename(path), info.size)], problems: [] }
  }
  return {
    kind: 'directory',
    path,
    files: [],
    problems: [{ code: 'source-unsupported', message: 'only a skill directory, a .zip archive, or a .md file can be imported' }],
  }
}

function fileEntry(absolute: string, relative: string, bytes: number): SourceFile {
  return {
    path: relative,
    bytes,
    copyTo: destination => copyFile(absolute, destination),
    text: () => readFile(absolute, 'utf8'),
  }
}

/** Result of walking a source directory. */
interface WalkResult {
  files: SourceFile[]
  problems: SkillIssue[]
}

async function walkDirectory(root: string, limits: LibraryLimits): Promise<WalkResult> {
  const files: SourceFile[] = []
  const problems: SkillIssue[] = []
  let total = 0
  const visit = async (directory: string, relative: string, depth: number): Promise<boolean> => {
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      const childRelative = relative === '' ? entry.name : `${relative}/${entry.name}`
      const childAbsolute = join(directory, entry.name)
      if (entry.isSymbolicLink()) {
        problems.push({ code: 'symlink-skipped', message: 'symbolic links are not copied', path: childRelative })
        continue
      }
      if (entry.isDirectory()) {
        if (SKIPPED_DIRECTORIES.has(entry.name)) continue
        if (depth >= WALK_MAX_DEPTH) {
          problems.push({ code: 'unsafe-path', message: `directories deeper than ${WALK_MAX_DEPTH} levels are not copied`, path: childRelative })
          continue
        }
        if (!await visit(childAbsolute, childRelative, depth + 1)) return false
        continue
      }
      if (!entry.isFile() || entry.name === SKILL_MANIFEST_FILE) continue
      const info = await lstat(childAbsolute)
      if (info.size > limits.maxFileBytes) {
        problems.push({ code: 'too-large', message: `file exceeds ${limits.maxFileBytes} bytes`, path: childRelative })
        continue
      }
      if (files.length >= limits.maxFiles) {
        problems.push({ code: 'too-many-files', message: `the source holds more than ${limits.maxFiles} files`, path: childRelative })
        return false
      }
      total += info.size
      if (total > limits.maxTotalBytes) {
        problems.push({ code: 'too-large', message: `the source exceeds ${limits.maxTotalBytes} bytes in total`, path: childRelative })
        return false
      }
      files.push(fileEntry(childAbsolute, childRelative, info.size))
    }
    return true
  }
  await visit(root, '', 0)
  return { files, problems }
}

async function findCandidates(tree: SourceTree, installed: SkillInstalledView[]): Promise<ResolvedCandidate[]> {
  const resolved: ResolvedCandidate[] = []
  if (tree.kind === 'markdown') {
    const entry = tree.files[0]
    if (entry !== undefined) resolved.push(await reviewCandidate(tree, installed, entry, '', [entry], 'markdown', basename(tree.path)))
    return resolved
  }
  const skillFiles = tree.files.filter(file => basename(file.path) === 'SKILL.md')
  const rootSkill = skillFiles.find(file => file.path === 'SKILL.md')
  if (rootSkill !== undefined) {
    resolved.push(await reviewCandidate(tree, installed, rootSkill, '', tree.files, 'skill', basename(tree.path)))
    return resolved
  }
  const nested = skillFiles.filter(file => file.path.split('/').length - 1 <= NESTED_SKILL_MAX_DEPTH)
  for (const entry of nested) {
    const root = dirname(entry.path).replace(/\\/gu, '/')
    const files = tree.files.filter(file => file.path.startsWith(`${root}/`))
    resolved.push(await reviewCandidate(tree, installed, entry, root, files, 'skill', basename(root)))
  }
  if (resolved.length > 0) return resolved
  for (const entry of tree.files.filter(file => !file.path.includes('/') && file.path.toLowerCase().endsWith('.md'))) {
    resolved.push(await reviewCandidate(tree, installed, entry, '', [entry], 'markdown', entry.path))
  }
  return resolved
}

async function reviewCandidate(
  tree: SourceTree,
  installed: SkillInstalledView[],
  entry: SourceFile,
  root: string,
  files: SourceFile[],
  kind: SkillImportCandidate['kind'],
  fallbackName: string,
): Promise<ResolvedCandidate> {
  const document = reviewSkillDocument(await entry.text())
  const proposed = proposeMetadata(document, fallbackName)
  const finalName = document.name ?? proposed.name
  const byOrigin = installed.find(item =>
    item.origin.kind === tree.kind && item.origin.path === tree.path && item.origin.entry === entry.path)
  const byName = finalName === undefined ? undefined : installed.find(item => item.name === finalName)
  const replaces = byOrigin ?? byName
  const incomplete = tree.problems.find(issue => issue.code === 'too-large' || issue.code === 'too-many-files')
  const metadataReady = finalName !== undefined && (document.description ?? proposed.description) !== undefined
  const installable = incomplete === undefined && !hasBlockingIssue(document) && metadataReady
  const view: SkillImportCandidate = {
    key: entry.path,
    entry: entry.path,
    kind,
    name: document.name,
    description: document.description,
    ...document.whenToUse === undefined ? {} : { whenToUse: document.whenToUse },
    proposed,
    issues: incomplete === undefined ? document.issues : [...document.issues, incomplete],
    files: files.length,
    bytes: files.reduce((sum, file) => sum + file.bytes, 0),
    replaces: replaces === undefined
      ? null
      : { installId: replaces.installId, name: replaces.name, origin: replaces.origin, location: replaces.location },
    installable,
  }
  return { view, document, root, files, entry }
}

async function installedView(record: SkillInstallRecord, location: string): Promise<SkillInstalledView> {
  let issue: SkillIssue | undefined
  try {
    const document = reviewSkillDocument(await readFile(join(location, 'SKILL.md'), 'utf8'))
    issue = document.issues[0]
    if (issue === undefined && document.name !== record.name) {
      issue = { code: 'skill-invalid', message: `SKILL.md declares "${String(document.name)}" but the manifest says "${record.name}"` }
    }
  } catch (error) {
    issue = { code: 'skill-invalid', message: `SKILL.md cannot be read: ${String(error)}`, path: 'SKILL.md' }
  }
  return { ...record, location, status: issue === undefined ? 'ok' : 'invalid', ...issue === undefined ? {} : { issue } }
}

async function readManifest(location: string, installId: string): Promise<SkillInstallRecord | undefined> {
  let parsed: unknown
  try {
    const directory = await lstat(location)
    if (!directory.isDirectory() || directory.isSymbolicLink()) return undefined
    parsed = JSON.parse(await readFile(join(location, SKILL_MANIFEST_FILE), 'utf8'))
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const record = parsed as Record<string, unknown>
  if (record.schemaVersion !== SKILL_MANIFEST_SCHEMA_VERSION || record.installId !== installId) return undefined
  if (!isNonEmptyString(record.name) || !isNonEmptyString(record.description)) return undefined
  if (!isNonEmptyString(record.installedAt) || !isNonEmptyString(record.updatedAt)) return undefined
  if (typeof record.files !== 'number' || typeof record.bytes !== 'number') return undefined
  const origin = readOrigin(record.origin)
  if (origin === undefined) return undefined
  return {
    schemaVersion: SKILL_MANIFEST_SCHEMA_VERSION,
    installId,
    name: record.name,
    description: record.description,
    ...isNonEmptyString(record.whenToUse) ? { whenToUse: record.whenToUse } : {},
    installedAt: record.installedAt,
    updatedAt: record.updatedAt,
    origin,
    files: record.files,
    bytes: record.bytes,
  }
}

function readOrigin(value: unknown): SkillOrigin | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const origin = value as Record<string, unknown>
  if (origin.kind !== 'directory' && origin.kind !== 'zip' && origin.kind !== 'markdown') return undefined
  if (!isNonEmptyString(origin.path) || typeof origin.entry !== 'string') return undefined
  return { kind: origin.kind, path: origin.path, entry: origin.entry }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

async function scanReadOnlyRoot(root: string, source: SkillReadOnlySource, skipSystem: boolean): Promise<SkillReadOnlyView[]> {
  const views: SkillReadOnlyView[] = []
  for (const entry of await readdirSafe(root)) {
    if (skipSystem && entry.name === '.system') continue
    const location = entry.isDirectory()
      ? join(root, entry.name, 'SKILL.md')
      : entry.isFile() && entry.name.endsWith('.md')
        ? join(root, entry.name)
        : undefined
    if (location === undefined) continue
    let text: string
    try {
      text = await readFile(location, 'utf8')
    } catch {
      continue
    }
    const document = reviewSkillDocument(text)
    if (document.issues.length > 0 || document.name === null || document.description === null) continue
    views.push({ source, name: document.name, description: document.description, location })
  }
  return views.sort((left, right) => left.name.localeCompare(right.name))
}

async function readdirSafe(directory: string): Promise<Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>> {
  try {
    return await readdir(directory, { withFileTypes: true })
  } catch {
    return []
  }
}
