/**
 * Reproducible runtime install for the DeepSeekGUI distribution.
 *
 * The staging consumer installs local tarballs plus their external registry
 * dependencies. Local tarballs are rebuilt from the repository every run, so
 * their resolution is trivially reproducible; the floating part is the
 * external semver ranges. The build therefore keeps npm's lockfile enabled,
 * seeds the staging install with the committed
 * `apps/deepseekgui/runtime.package-lock.json`, and writes the result back — npm
 * holds every external dependency at its locked version while ranges still
 * allow it, so two builds from the same commit install the same external set.
 * For the lockfile to be committable it must be machine-portable: local
 * tarballs are referenced with relative `file:` specs, and this module's check
 * rejects any absolute path that would tie the lockfile to one build machine.
 * @module scripts/runtime-lock
 */

import { relative } from 'node:path'

/**
 * The relative `file:` dependency spec for a local tarball.
 * @param stagingDir - the staging consumer directory holding package.json.
 * @param tarballPath - absolute path of the packed tarball.
 * @returns A machine-portable `file:` spec (forward slashes).
 */
export function relativeTarballSpec(stagingDir: string, tarballPath: string): string {
  return `file:${relative(stagingDir, tarballPath).replaceAll('\\', '/')}`
}

/** npm `overrides` restricted to one nesting level: parent package → child package → version. */
export type NpmOverrides = Record<string, Record<string, string>>

/**
 * Translate the `parent>child` entries of the pnpm workspace `overrides` into
 * npm overrides for the staging install, so the source workspace and the
 * packaged runtime pin the same versions from one place. Entries without `>`
 * redirect workspace packages (`link:` vendor copies) and have no runtime
 * counterpart: the vendor family ships as tarballs.
 * @param pnpmOverrides - the `overrides` map of pnpm-workspace.yaml.
 * @returns the npm overrides; empty when no entry is scoped to a parent.
 */
export function runtimeNpmOverrides(pnpmOverrides: Readonly<Record<string, string>>): NpmOverrides {
  const result: NpmOverrides = {}
  for (const [selector, version] of Object.entries(pnpmOverrides)) {
    if (!selector.includes('>')) continue
    const [parent, child, ...rest] = selector.split('>')
    if (parent === undefined || child === undefined || parent === '' || child === '' || rest.length > 0 || version.startsWith('link:')) {
      throw new Error(`runtime-lock: unsupported pnpm override ${selector}: ${version} (expected parent>child: version)`)
    }
    result[parent] = { ...result[parent], [child]: version }
  }
  return result
}

/**
 * Installed copies in a staging lockfile that escaped an override: every copy
 * of an overridden child nested under its parent must carry the pinned version.
 * @param lockText - the package-lock.json content npm wrote.
 * @param overrides - the overrides the install was given.
 * @returns One line per escaped copy; empty when every copy is pinned.
 */
export function overrideViolations(lockText: string, overrides: NpmOverrides): string[] {
  const lock = JSON.parse(lockText) as LockWithVersions
  return escapedCopies(lock, overrides).map(copy => `${copy.path} is ${String(copy.installed)}, override pins ${copy.pinned}`)
}

/** The lockfile fields the override checks read. */
interface LockWithVersions {
  packages?: Record<string, { version?: unknown; dependencies?: Record<string, string>; optional?: boolean; dev?: boolean } | undefined>
}

/**
 * Required dependencies an installed lockfile leaves unresolvable. npm can
 * write a tree with a hole (2026-10-18: ajv without fast-uri after its seeded
 * entry was dropped), and a hole only shows when the code first loads it.
 * @param lockText - the package-lock.json content npm wrote.
 * @returns One line per missing dependency; empty when every one resolves.
 */
export function missingDependencies(lockText: string): string[] {
  const packages = (JSON.parse(lockText) as LockWithVersions).packages ?? {}
  const missing: string[] = []
  for (const [path, entry] of Object.entries(packages)) {
    if (entry === undefined || entry.optional === true || entry.dev === true) continue
    for (const name of Object.keys(entry.dependencies ?? {})) {
      if (resolvedCopy(packages, path, name) === undefined) missing.push(`${path === '' ? '<root>' : path} requires ${name}`)
    }
  }
  return missing
}

/**
 * One copy an overridden parent loads that carries another version than the
 * override's, or that is missing (`installed` undefined). `parent` is the
 * lockfile path of the parent that resolves it.
 */
interface EscapedCopy { path: string; installed: unknown; pinned: string; parent: string }

function escapedCopies(lock: LockWithVersions, overrides: NpmOverrides): EscapedCopy[] {
  const packages = lock.packages ?? {}
  const copies = new Map<string, EscapedCopy>()
  for (const [parent, children] of Object.entries(overrides)) {
    for (const parentPath of Object.keys(packages)) {
      if (parentPath !== `node_modules/${parent}` && !parentPath.endsWith(`/node_modules/${parent}`)) continue
      for (const [child, pinned] of Object.entries(children)) {
        // The copy the parent actually loads: its own nested one, else the
        // nearest ancestor's, the way Node resolves it. A hoisted copy counts.
        const path = resolvedCopy(packages, parentPath, child) ?? `${parentPath}/node_modules/${child}`
        const installed = packages[path]?.version
        if (installed !== pinned) copies.set(path, { path, installed, pinned, parent: parentPath })
      }
    }
  }
  return [...copies.values()]
}

/**
 * Lockfile path of the copy of `name` that the package at `from` resolves.
 * @param packages - lockfile `packages` entries.
 * @param from - lockfile path of the requiring package.
 * @param name - required package name.
 * @returns the resolved path, or undefined when no copy is installed.
 */
function resolvedCopy(packages: NonNullable<LockWithVersions['packages']>, from: string, name: string): string | undefined {
  let dir = from
  for (;;) {
    const candidate = dir === '' ? `node_modules/${name}` : `${dir}/node_modules/${name}`
    if (candidate in packages) return candidate
    if (dir === '') return undefined
    const cut = dir.lastIndexOf('/node_modules/')
    dir = cut === -1 ? '' : dir.slice(0, cut)
  }
}

/**
 * Remove, from a lockfile that seeds the staging install, the nested copies an
 * override now disagrees with (with their own subtrees). npm keeps a locked
 * version that no longer matches an added override instead of resolving it
 * again, so an override never reaches a seeded copy unless the entry is gone.
 * @param lockText - the seed lockfile content.
 * @param overrides - the overrides the install is given.
 * @returns the lockfile text without those copies, and the removed paths.
 */
export function dropOverriddenCopies(lockText: string, overrides: NpmOverrides): { text: string; dropped: string[] } {
  const lock = JSON.parse(lockText) as LockWithVersions
  // A copy hoisted above its parent, or missing, is dropped together with the
  // parent: npm left a parent whose locked child entry was gone without that
  // child (2026-10-18, ajv without fast-uri), so the parent resolves again too.
  const roots = [...new Set(escapedCopies(lock, overrides).flatMap(copy => copy.installed === undefined
    ? [copy.parent]
    : [copy.path, ...copy.path.startsWith(`${copy.parent}/node_modules/`) ? [] : [copy.parent]]))]
  if (roots.length === 0) return { text: lockText, dropped: [] }
  const kept = Object.fromEntries(Object.entries(lock.packages ?? {}).filter(([path]) =>
    !roots.some(root => path === root || path.startsWith(`${root}/node_modules/`))))
  return { text: `${JSON.stringify({ ...lock, packages: kept }, null, 2)}\n`, dropped: roots }
}

/**
 * Portability issues that tie a staging lockfile to one build machine.
 * @param lockText - the package-lock.json content.
 * @returns One line per issue; empty when the lockfile is portable.
 */
export function portableLockfileIssues(lockText: string): string[] {
  const issues: string[] = []
  if (/file:\/\//.test(lockText)) issues.push('absolute file:// URL (local tarballs must use relative file: specs)')
  // Windows drive-letter path, in native or JSON-escaped form. A drive letter
  // is a single letter — the lookbehind keeps URL schemes (https:, file:)
  // from matching.
  if (/(?<![A-Za-z])[A-Za-z]:[\\/]/.test(lockText)) issues.push('absolute drive-letter path')
  return issues
}
