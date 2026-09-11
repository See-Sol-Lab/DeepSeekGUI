/**
 * Build the portable Windows distribution directory for DeepSeekGUI.
 *
 * Pipeline: pack both release families (dsh + vendor) exactly like
 * `release/pack.ts`, compute the shipped Web profile's runtime closure, npm
 * install exactly the closure tarballs (relative `file:` specs, external
 * registry dependencies pinned by the committed
 * `apps/deepseekgui/runtime.package-lock.json`), copy the resulting node_modules
 * into the staging area, run electron-builder `--dir`, sanitize and scan the
 * distribution before the NSIS installer wraps it, then scan the whole
 * prepared release set. The produced folder runs without Node.js, pnpm, or
 * the source checkout: the Electron executable acts as the Node runtime via
 * `ELECTRON_RUN_AS_NODE`.
 *
 * Entry points: `pnpm run build:desktop-dist` is the only official entry —
 * it rebuilds every input from the current source (`build:lib:host`,
 * `build:web`, `build:deepseekgui`) before running this script, so the produced
 * distribution always reflects the checkout as it is now. This script itself
 * is wired as the internal `build:desktop-dist:assemble` step; invoking it
 * directly skips the rebuild and can package stale artifacts. The committed
 * app icon is regenerated only when missing; `requirePrerequisites` stays as
 * defense in depth, it no longer carries the freshness guarantee.
 * @module scripts/build-desktop-dist
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync, closeSync, cpSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync,
  statSync, writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, delimiter, dirname, join } from 'node:path'
import { releaseFamily, tarballName } from './release/families.ts'
import { capture } from './release/process.ts'
import { packedIdentity, tarballFiles } from './release/tarball.ts'
// 皮肤 overlay 的文件名与运行时读取端共用同一个常量：两侧一旦不一致，
// --patch 会指向一个不存在的文件，而官方对此是启动即失败。
import { BROWSER_PATCH_FILENAME, PICKER_PATCH_FILENAME, SETTINGS_PATCH_FILENAME, THEME_PATCH_FILENAME, WORKBENCH_PATCH_FILENAME } from '../apps/deepseekgui/src/dsh-service.ts'
import { computeRuntimeClosure, parsePluginNames } from './runtime-closure.ts'
import { directoryBytes, prunePlatforms } from './platform-prune.ts'
import { sanitizeAndVerify } from './leak-scan.ts'
import { requireCleanTree } from './require-clean-tree.ts'
import { portableLockfileIssues, relativeTarballSpec } from './runtime-lock.ts'
import { readDevSourceCommit, SOURCE_COMMIT_FILENAME } from '../apps/deepseekgui/src/version-info.ts'

/** Repository root: this script always runs from the checkout root. */
const ROOT = process.cwd()
/** Staging root for the distribution build outputs. */
const DIST_ROOT = join(ROOT, 'dist', 'desktop')
/** Pack output directory for the dsh family. */
const PACK_DHS = join(ROOT, 'dist', 'npm-dsh')
/** Pack output directory for the vendor family. */
const PACK_VENDOR = join(ROOT, 'dist', 'npm-vendor')
/** The DSH runtime payload copied into `resources/dsh`. */
const RUNTIME_DIR = join(DIST_ROOT, 'dsh')
/**
 * Build platform. The distribution is always assembled on the platform it
 * targets (Windows locally and in the Windows CI lane, Linux in the Linux CI
 * lane): the staging npm install resolves native dependencies for the running
 * platform, so cross-packaging would ship binaries that cannot load.
 */
const IS_WINDOWS = process.platform === 'win32'
/** electron-builder `--dir` output for the current platform. */
const UNPACKED = join(DIST_ROOT, IS_WINDOWS ? 'win-unpacked' : 'linux-unpacked')
/**
 * The packaged executable inside the unpacked directory. The Linux name is
 * pinned by `executableName` in electron-builder.yml.
 */
const UNPACKED_EXE = join(UNPACKED, IS_WINDOWS ? 'DeepSeekGUI.exe' : 'deepseekgui')
/** Staging consumer for the npm install; inside dist so tarball specs stay relative and portable. */
const STAGING = join(DIST_ROOT, 'npm-staging')
/** The committed runtime lockfile pinning every external registry dependency. */
const COMMITTED_LOCK = join(ROOT, 'apps', 'deepseekgui', 'runtime.package-lock.json')
/** Electron executable consumed by electron-builder's configured electronDist. */
const ELECTRON_EXE = join(ROOT, 'node_modules', 'electron', 'dist', IS_WINDOWS ? 'electron.exe' : 'electron')

/**
 * The pnpm executable this run uses: `npm_execpath` (pnpm injects its own
 * module path when a pnpm script invokes this script) or `pnpm` from PATH.
 * @returns The pnpm module path or command name.
 */
function pnpmModule(): string {
  const execpath = process.env.npm_execpath
  if (execpath !== undefined && /^pnpm\.(?:cjs|mjs|js)$/u.test(basename(execpath))) return execpath
  throw new Error('build-desktop-dist: run this script through pnpm so its CLI entry is available')
}

/** Run a command with inherited streams, failing loud on a non-zero exit. */
function runNode(args: readonly string[], cwd = ROOT, options: { env?: NodeJS.ProcessEnv } = {}): void {
  const result = spawnSync(process.execPath, [...args], { cwd, stdio: 'inherit', env: options.env })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`node ${args.join(' ')} exited with ${String(result.status)}`)
}

/** Run pnpm through its module path (works without pnpm on PATH). */
function runPnpm(args: readonly string[], cwd = ROOT): void {
  runNode([pnpmModule(), ...args], cwd)
}

/**
 * A temporary `pnpm.cmd` shim so subprocesses that invoke `pnpm` (electron-builder's
 * node-modules collector) find it even when pnpm is absent from PATH.
 * @returns The shim directory.
 */
function pnpmShimDirectory(): string {
  const dir = join(tmpdir(), 'deepseekgui-pnpm-shim')
  mkdirSync(dir, { recursive: true })
  // Always rewritten: a shim left by an earlier build may point at a pnpm
  // module path that no longer exists on this machine.
  if (IS_WINDOWS) {
    writeFileSync(join(dir, 'pnpm.cmd'), `@echo off\r\nnode "${pnpmModule()}" %*\r\n`)
  } else {
    const shim = join(dir, 'pnpm')
    writeFileSync(shim, `#!/bin/sh\nexec node "${pnpmModule()}" "$@"\n`)
    chmodSync(shim, 0o755)
  }
  return dir
}

/**
 * The npm CLI this run uses: `npm-cli.js` beside the running Node when present
 * (the standard Windows Node layout, reachable even when pnpm trims PATH),
 * otherwise `npm` from PATH.
 * @returns The npm-cli.js path or the `npm` command name.
 */
function npmCli(): string {
  const sibling = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  return existsSync(sibling) ? sibling : 'npm'
}

/** Run npm (through Node when its CLI path is known), failing loud on a non-zero exit. */
function runNpm(args: readonly string[], cwd: string): void {
  const cli = npmCli()
  const result = spawnSync(cli === 'npm' ? 'npm' : process.execPath, cli === 'npm' ? [...args] : [cli, ...args], {
    cwd,
    stdio: 'inherit',
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`npm ${args.join(' ')} exited with ${String(result.status)}`)
}

/** Download Electron when a clean dependency install has not populated its distribution. */
function ensureElectronDistribution(): void {
  if (existsSync(ELECTRON_EXE)) return
  const installer = join(ROOT, 'node_modules', 'electron', 'install.js')
  if (!existsSync(installer)) {
    throw new Error('build-desktop-dist: Electron installer is missing; run `pnpm install` first')
  }
  console.log('build-desktop-dist: Electron distribution missing; running the packaged installer')
  runNode([installer])
  if (!existsSync(ELECTRON_EXE)) {
    throw new Error(`build-desktop-dist: Electron installer did not produce ${ELECTRON_EXE}`)
  }
}

/**
 * Fail loud when a distribution prerequisite is missing (defense in depth
 * behind the public `build:desktop-dist` chain, which rebuilds them from
 * current source).
 */
function requirePrerequisites(): void {
  // The icons are committed assets outside the rebuild chain: generate them
  // only when a checkout lacks one (generation output is stable for a given
  // source favicon and toolchain, but regenerating on every build would churn
  // the committed binaries).
  const appIcon = join(ROOT, 'apps', 'deepseekgui', 'build', 'icon.ico')
  const trayIcon = join(ROOT, 'apps', 'deepseekgui', 'src', 'chrome', 'tray.ico')
  const trayPng = join(ROOT, 'apps', 'deepseekgui', 'src', 'chrome', 'tray.png')
  if (!existsSync(appIcon) || !existsSync(trayIcon) || !existsSync(trayPng)) {
    runPnpm(['run', 'generate:desktop-icon'])
  }
  const required: [string, string][] = [
    ['Web UI dist', join(ROOT, 'apps', 'web', 'dist', 'index.html')],
    ['dsh CLI built bin', join(ROOT, 'apps', 'cli', 'lib', 'bin.js')],
    ['desktop shell build', join(ROOT, 'apps', 'deepseekgui', 'lib', 'main.js')],
    ['app icon', appIcon],
    // P7-I：托盘图标是多尺寸 .ico 运行时资产（16/20/24/32），缺失时
    // 打包必须失败——托盘是常驻应用"回来的门"，与 app icon 同一层门禁。
    ['tray icon', trayIcon],
    // Linux 托盘的单图 PNG（同源生成），与 ICO 同一层门禁。
    ['tray icon (png)', trayPng],
  ]
  const missing = required.filter(([, path]) => !existsSync(path)).map(([name]) => name)
  if (missing.length === 0) return
  throw new Error(
    'build-desktop-dist: missing ' + missing.join(', ')
    + '; run `pnpm run build:lib:host`, `pnpm run build:web`, `pnpm run build:deepseekgui`,'
    + ' and `pnpm run generate:desktop-icon` first',
  )
}

/**
 * Refuse to start while the previous build output is still locked.
 *
 * electron-builder clears `win-unpacked` before repopulating it. A running
 * DeepSeekGUI — or a diagnostic script that crashed without closing the app —
 * holds its executable open, the delete fails with EPERM, and the build stops
 * having produced nothing new. The old artefacts stay on disk with their old
 * timestamps, so the next investigation happily inspects a stale package and
 * concludes the source change never took effect. That misdiagnosis costs far
 * more than the build failure itself, which is why this check exists.
 *
 * Windows refuses a write handle on a running executable, so asking for one is
 * a direct test of the condition rather than a guess from process names.
 */
function requireUnlockedOutput(): void {
  // POSIX opens a running executable without complaint, so this check only
  // ever fires on Windows — which is also the only place the failure mode
  // it guards against exists.
  const exe = UNPACKED_EXE
  if (!existsSync(exe)) return
  try {
    closeSync(openSync(exe, 'r+'))
  } catch {
    throw new Error(
      `build-desktop-dist: ${exe} is locked by a running process, so this build`
      + ' would fail while clearing the directory and leave the previous package'
      + ' in place. Close DeepSeekGUI (including instances left behind by a crashed'
      + ' diagnostic run) and rebuild:\n'
      + '  Get-Process -Name DeepSeekGUI -ErrorAction SilentlyContinue | Stop-Process -Force',
    )
  }
}

/**
 * Drop every locally packed tarball's entry from a seeded lockfile.
 *
 * The lockfile exists to pin external registry dependencies, and for those the
 * recorded version and integrity are exactly the point. Our own families are
 * different: they are repacked from source on every run, so their content hash
 * moves without the version, and after a merge to a new upstream release the
 * version moves too. An entry left behind pins the previous build: with only
 * the integrity stripped (the earlier shape of this function) npm still
 * resolved the entry's old version against the peer ranges the new tarballs
 * declare and refused the install outright (ERESOLVE, first packaging after
 * 0.1.2 → 0.1.5); with the integrity kept it quietly installed the previous
 * build from cache. Removing the entries makes npm read every `file:` spec
 * from disk as it is now, while every registry entry stays pinned.
 * @param lockPath - the seeded lockfile inside the staging directory.
 */
/**
 * The lockfile text with the integrity of every locally packed tarball removed,
 * in npm's own serialization (two-space indent, trailing newline) so that a
 * stable dependency set round-trips byte-identical.
 * @param lockText - the lockfile npm wrote after the staging install.
 * @returns The text to commit.
 */
function withoutLocalTarballIntegrity(lockText: string): string {
  const lock = JSON.parse(lockText) as {
    packages?: Record<string, { resolved?: string; integrity?: string }>
  }
  lock.packages = Object.fromEntries(
    Object.entries(lock.packages ?? {}).map(([key, entry]) => {
      if (entry.resolved?.startsWith('file:') !== true) return [key, entry]
      const { integrity: _dropped, ...rest } = entry
      return [key, rest]
    }),
  )
  return `${JSON.stringify(lock, null, 2)}
`
}

function dropLocalTarballEntries(lockPath: string): void {
  const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as {
    packages?: Record<string, { resolved?: string }>
  }
  const packages = lock.packages ?? {}
  const kept = Object.fromEntries(
    Object.entries(packages).filter(([, entry]) => entry.resolved?.startsWith('file:') !== true),
  )
  const dropped = Object.keys(packages).length - Object.keys(kept).length
  if (dropped > 0) {
    lock.packages = kept
    writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}
`)
    console.log(`build-desktop-dist: dropped ${String(dropped)} locally packed tarball entr${dropped === 1 ? 'y' : 'ies'} from the seeded lockfile`)
  }
}

/** Pack one release family into `out` with the same per-member checks as release/pack.ts. */
function packFamily(familyId: string, out: string): void {
  const family = releaseFamily(familyId)
  const members = family.publishOrder(family.members(ROOT)).order
  // Official npm releases require the official Client build profile. DeepSeekGUI
  // embeds its own attributed Client, so only member versions and payloads apply.
  family.verifyVersions(members)
  rmSync(out, { recursive: true, force: true })
  mkdirSync(out, { recursive: true })
  for (const member of members) {
    runPnpm(['--dir', member.directory, 'pack', '--pack-destination', out])
    const tarball = join(out, tarballName(member))
    if (!existsSync(tarball)) throw new Error(`${member.name} produced no tarball at ${tarball}`)
    family.validatePayload(member, tarballFiles(tarball))
  }
  console.log(`build-desktop-dist: packed ${familyId} family (${String(members.length)} tarballs) into ${out}`)
}

/**
 * Product packages the shipped Web profile names as dependencies but no
 * release family publishes. The bundle manifest holds them as `workspace:*`
 * so the CLI Web profile and its tests resolve them from the workspace;
 * `@see-sol-lab` is not a release scope, so packing them beside the family
 * tarballs is what lets the runtime closure resolve them from relative
 * `file:` specs instead of npm asking the public registry for a private
 * package (a 404 at install time).
 *
 * The workbench inspector is ours too, only it carries the `@deepseek-ai`
 * scope. Up to 0.1.2 it rode along as a dsh-family member; the 0.1.5 release
 * families skip `private: true` manifests, so it must be packed here or the
 * runtime closure reports it absent (first packaging after the merge did).
 */
const PRODUCT_PACKAGES = [
  join('apps', 'deepseekgui', 'coding-tools-plugin'),
  join('packages', 'api', 'workbench-inspector'),
] as const

/** Pack the product packages into `out` beside the family tarballs. */
function packProductPackages(out: string): void {
  for (const directory of PRODUCT_PACKAGES) {
    runPnpm(['--dir', directory, 'pack', '--pack-destination', out])
  }
  console.log(`build-desktop-dist: packed ${String(PRODUCT_PACKAGES.length)} product package(s) into ${out}`)
}

/** Every packed tarball's absolute path by package name. */
function packedDependencies(directories: readonly string[]): Map<string, string> {
  const dependencies = new Map<string, string>()
  for (const directory of directories) {
    for (const filename of readdirSync(directory).filter(name => name.endsWith('.tgz')).sort()) {
      const tarball = join(directory, filename)
      const { name } = packedIdentity(tarball)
      dependencies.set(name, tarball)
    }
  }
  return dependencies
}

/** Read every tarball manifest's version and production dependency sections. */
function tarballManifests(directories: readonly string[]): Map<string, {
  name: string
  version?: string
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}> {
  const manifests = new Map<string, {
    name: string
    version?: string
    dependencies?: Record<string, string>
    optionalDependencies?: Record<string, string>
    peerDependencies?: Record<string, string>
  }>()
  for (const directory of directories) {
    for (const filename of readdirSync(directory).filter(name => name.endsWith('.tgz')).sort()) {
      const tarball = join(directory, filename)
      const manifest = JSON.parse(capture('tar', ['-xOzf', basename(tarball), 'package/package.json'], { cwd: dirname(tarball) })) as {
        name?: unknown
        version?: unknown
        dependencies?: Record<string, string>
        optionalDependencies?: Record<string, string>
        peerDependencies?: Record<string, string>
      }
      if (typeof manifest.name !== 'string') throw new Error(`build-desktop-dist: tarball ${tarball} has no name`)
      manifests.set(manifest.name, {
        name: manifest.name,
        ...typeof manifest.version === 'string' && { version: manifest.version },
        ...manifest.dependencies !== undefined && { dependencies: manifest.dependencies },
        ...manifest.optionalDependencies !== undefined && { optionalDependencies: manifest.optionalDependencies },
        ...manifest.peerDependencies !== undefined && { peerDependencies: manifest.peerDependencies },
      })
    }
  }
  return manifests
}

/** Every vendored tarball's package name (the Cordis framework layer). */
function vendoredPackageNames(directory: string): string[] {
  return readdirSync(directory)
    .filter(name => name.endsWith('.tgz'))
    .map(filename => packedIdentity(join(directory, filename)).name)
    .sort()
}

/**
 * The closure roots: every package the shipped Web profile mounts — the base
 * and web-app bundle patches, and every agent preset shipped inside the
 * `@deepseek-ai/dsh-agent-presets` package (the preset picker lets a session
 * mount any of them) — plus
 * the launcher entry itself and the frontend package the web-app bundle
 * resolves dynamically (`require.resolve` of the built dist, invisible to
 * static edges).
 * @returns The root package names, deduplicated.
 */
function profileRoots(): string[] {
  const roots = new Set<string>(['@deepseek-ai/dsh', '@deepseek-ai/dsh-web-frontend'])
  // DSH 0.1.2 moved the shipped presets out of the CLI's config directory into
  // the dsh-agent-presets package; each preset still owns an agent.cordis.yml.
  const presetsDir = join(ROOT, 'packages', 'preset', 'agent-presets', 'presets')
  const presets = readdirSync(presetsDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map((entry) => {
      const composition = join(presetsDir, entry.name, 'agent.cordis.yml')
      // Every shipped preset directory must carry its composition; a missing
      // file is a broken preset, not an empty seed.
      if (!existsSync(composition)) {
        throw new Error(`build-desktop-dist: shipped preset ${entry.name} lacks agent.cordis.yml at ${composition}`)
      }
      return composition
    })
  if (presets.length === 0) throw new Error(`build-desktop-dist: no agent presets found under ${presetsDir}`)
  for (const patch of [
    join(ROOT, 'packages', 'bundle', 'base', 'cordis.patch.yml'),
    join(ROOT, 'packages', 'bundle', 'web-app', 'cordis.patch.yml'),
    ...presets,
  ]) {
    if (!existsSync(patch)) throw new Error(`build-desktop-dist: shipped profile file missing: ${patch}`)
    for (const name of parsePluginNames(readFileSync(patch, 'utf8'))) roots.add(name)
  }
  return [...roots].sort()
}

/** One DeepSeekGUI plugin shipped into the runtime's node_modules as real files. */
interface PluginShipment {
  /** Directory under apps/deepseekgui. */
  dir: string
  /** Package name under @see-sol-lab (also its module-fallback link name). */
  pkg: string
  /** Built entry the desktop build must have produced. */
  entry: 'lib/index.js' | 'lib/client.js'
  /** [file inside the plugin dir, file name at the runtime root]; absent for plugins without a `--patch` overlay. */
  overlay?: [string, string]
  /** Content directories shipped beside `lib` (must exist). */
  assets?: string[]
  /** Extra shipping work after the copy: dependencies and base-class asserts. */
  extra?: (target: string) => void
}

/**
 * The DeepSeekGUI plugins that travel as files copied into the DSH runtime
 * tree. The harness's own Node process loads them and cannot read the
 * Electron asar, so both the package and its overlay must exist as real files
 * under the runtime directory; dropping the package into the runtime's
 * `node_modules` makes it resolvable from every profile without touching a
 * single profile manifest, and the overlay only exists for the composition
 * DeepSeekGUI starts (`resolve*PatchFile()` points `--patch` at
 * `<resources>/dsh/<name>`, so both sides must agree on the file name).
 * None of them is ever published to a registry.
 */
const PLUGIN_SHIPMENTS: readonly PluginShipment[] = [
  // The skin (P8-D2). A packaged app whose skin silently vanished looks like
  // the theme code is broken, and that lie costs far more to chase than a
  // failed build does — so a missing build fails loud.
  { dir: 'theme-plugin', pkg: 'deepseekgui-theme', entry: 'lib/client.js', overlay: [THEME_PATCH_FILENAME, THEME_PATCH_FILENAME] },
  // The directory-picker backend (P8-D11). Its overlay disables the official
  // picker row: an app that shipped the overlay but not the package would
  // have no directory picker at all.
  {
    dir: 'picker-plugin',
    pkg: 'deepseekgui-directory-picker',
    entry: 'lib/index.js',
    overlay: [PICKER_PATCH_FILENAME, PICKER_PATCH_FILENAME],
    extra: (target) => {
      // The backend extends the official service class, so that package has
      // to be in the runtime closure next to it. It is (the official
      // auto-picker pulls it in), but assert rather than assume: without it
      // the harness refuses to boot with our overlay applied.
      const base = join(dirname(dirname(target)), '@deepseek-ai', 'dsh-host-directory-picker')
      if (!existsSync(base)) {
        throw new Error(`build-desktop-dist: ${base} is missing — the DeepSeekGUI picker cannot resolve its base class`)
      }
    },
  },
  // The settings sections (P8-D39): missing it only removes the DeepSeekGUI
  // sections from the official settings page, but a hollow ship would still
  // fail client boot.
  { dir: 'settings-plugin', pkg: 'deepseekgui-settings', entry: 'lib/client.js', overlay: [SETTINGS_PATCH_FILENAME, SETTINGS_PATCH_FILENAME] },
  // The browser capability (B3-11). Unlike the others it has a real npm
  // dependency (`playwright-core`), so the dependency ships beside it — a
  // user behind a firewall gets browser tools without ever running
  // `dsh plugin add`. The browser kernel itself is NOT bundled: playwright
  // drives the system Edge (`channel: 'msedge'`), so this costs ~12 MB.
  {
    dir: 'browser-plugin',
    pkg: 'deepseekgui-browser',
    entry: 'lib/index.js',
    overlay: ['cordis.patch.yml', BROWSER_PATCH_FILENAME],
    extra: (target) => {
      // The plugin is loaded by the harness's own Node process, which resolves
      // from this very node_modules tree; shipping it without its dependency
      // would fail at the first tool call, not at boot — the worst possible
      // time to find out. `dereference` matters: pnpm's tree is symlinks into
      // .pnpm, and a copied symlink would point at a path that does not exist
      // on the user's machine.
      const pwSource = join(ROOT, 'node_modules', 'playwright-core')
      if (!existsSync(join(pwSource, 'package.json'))) {
        throw new Error(`build-desktop-dist: ${pwSource} is missing — install dependencies before packaging`)
      }
      cpSync(pwSource, join(dirname(dirname(target)), 'playwright-core'), { recursive: true, dereference: true })
      // The same overlay also stays INSIDE the package, under its original
      // name. The plugin's package.json declares `dsh.bundle.patch:
      // ./cordis.patch.yml`, so a profile that lists this package in its
      // bundle layer (anyone who ran the plugin manager's install once) makes
      // app-boot read it from here. Ship the package without it and that
      // profile dies at boot with ENOENT before any UI exists (2026-08-24,
      // caught on the developer's machine after a B3-10 install).
      cpSync(join(ROOT, 'apps', 'deepseekgui', 'browser-plugin', 'cordis.patch.yml'), join(target, 'cordis.patch.yml'))
    },
  },
  // The Workbench product plugin (B3-P1); `assets/` carries the memory
  // behavior contract as content beside the code (B5-P9).
  { dir: 'workbench-plugin', pkg: 'deepseekgui-workbench', entry: 'lib/client.js', overlay: [WORKBENCH_PATCH_FILENAME, WORKBENCH_PATCH_FILENAME], assets: ['assets'] },
  // The coding tools (B5-P4) are not listed here: the web-app bundle depends
  // on them by name, so they travel as a product tarball through the runtime
  // closure install (PRODUCT_PACKAGES) and land in node_modules with it.
]

/**
 * Copy one DeepSeekGUI plugin (and its overlay) into the assembled runtime.
 * @param runtimeDir - assembled DSH runtime directory.
 * @param ship - the plugin to ship.
 */
function shipPlugin(runtimeDir: string, ship: PluginShipment): void {
  const source = join(ROOT, 'apps', 'deepseekgui', ship.dir)
  const entry = join(source, ship.entry)
  if (!existsSync(entry)) {
    throw new Error(`build-desktop-dist: ${ship.pkg} entry ${entry} is missing — run the desktop build first`)
  }
  // A client bundle must register itself with the official module loader. A
  // plain ESM file loads, throws "Cannot use import statement outside a
  // module" in the browser, and leaves the whole page stuck on boot — a
  // failure that looks nothing like "the plugin is broken", so catch its
  // shape here rather than in a user's window.
  if (ship.entry === 'lib/client.js' && !readFileSync(entry, 'utf8').includes('__ModuleLoader__.load')) {
    throw new Error(`build-desktop-dist: ${entry} does not register through __ModuleLoader__ — the client runtime cannot load it`)
  }
  const target = join(runtimeDir, 'node_modules', '@see-sol-lab', ship.pkg)
  mkdirSync(target, { recursive: true })
  cpSync(join(source, 'lib'), join(target, 'lib'), { recursive: true })
  cpSync(join(source, 'package.json'), join(target, 'package.json'))
  for (const asset of ship.assets ?? []) {
    if (!existsSync(join(source, asset))) throw new Error(`build-desktop-dist: ${ship.pkg} lacks ${asset}`)
    cpSync(join(source, asset), join(target, asset), { recursive: true })
  }
  if (ship.overlay !== undefined) {
    const overlay = join(source, ship.overlay[0])
    if (!existsSync(overlay)) throw new Error(`build-desktop-dist: ${ship.pkg} overlay ${overlay} is missing`)
    cpSync(overlay, join(runtimeDir, ship.overlay[1]))
  }
  ship.extra?.(target)
  console.log(`build-desktop-dist: DeepSeekGUI ${ship.pkg} shipped into ${runtimeDir}${ship.overlay === undefined ? '' : ' with its overlay'}`)
}

/** Install the closure into the staging consumer and copy its node_modules into the runtime payload. */
function assembleRuntime(): void {
  rmSync(STAGING, { recursive: true, force: true })
  mkdirSync(STAGING, { recursive: true })
  try {
    const manifests = tarballManifests([PACK_DHS, PACK_VENDOR])
    const roots = [...profileRoots(), ...vendoredPackageNames(PACK_VENDOR)]
    // The system addon (Landlock launcher + flock; `node-addon-landlock-run`
    // up to 0.1.2) is a workspace member but ships through its own native
    // release family (native/README.md), published to the npm registry with
    // platform prebuilds as optionalDependencies; the staging install resolves
    // it from the registry, not from these tarballs.
    const registryExternal = new Set(['@deepseek-ai/node-addon-system'])
    const { included, excluded } = computeRuntimeClosure(manifests, roots, registryExternal)
    console.log(`build-desktop-dist: runtime closure ${included.length} included, ${excluded.length} excluded of ${manifests.size} tarballs`)
    console.log(`build-desktop-dist: closure roots (${roots.length}): ${roots.join(', ')}`)
    const all = packedDependencies([PACK_DHS, PACK_VENDOR])
    const dependencies = new Map<string, string>()
    for (const name of included) {
      const tarball = all.get(name)
      if (tarball === undefined) throw new Error(`build-desktop-dist: closure member ${name} has no tarball`)
      // Relative specs keep the generated package.json and its lockfile free
      // of build-machine paths.
      dependencies.set(name, relativeTarballSpec(STAGING, tarball))
    }
    // pnpm 私有 Runtime：与仓库 packageManager pin 同版本，经锁文件
    // 可重复打包；Terminal 与维护命令经 ELECTRON_RUN_AS_NODE 运行它，
    // 绝不读系统 pnpm、绝不依赖 global PATH。
    const rootManifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { packageManager?: unknown }
    const pnpmPin = typeof rootManifest.packageManager === 'string' && rootManifest.packageManager.startsWith('pnpm@')
      ? rootManifest.packageManager.slice('pnpm@'.length)
      : null
    if (pnpmPin === null) throw new Error('build-desktop-dist: root package.json lacks a pnpm@<version> packageManager pin')
    dependencies.set('pnpm', pnpmPin)
    writeFileSync(join(STAGING, 'package.json'), `${JSON.stringify({
      name: 'deepseekgui-dist',
      version: '0.0.0',
      private: true,
      dependencies: Object.fromEntries(dependencies),
    }, null, 2)}\n`)
    // Reproducibility: seed the committed lockfile so npm resolves every
    // external registry dependency at its locked version; the result is
    // written back below, so external drift is visible as a git diff.
    if (existsSync(COMMITTED_LOCK)) {
      cpSync(COMMITTED_LOCK, join(STAGING, 'package-lock.json'))
      dropLocalTarballEntries(join(STAGING, 'package-lock.json'))
    }
    // No --omit=optional: koffi (Windows ACL sandbox) and the Landlock
    // platform packages ship prebuilt binaries as optionalDependencies, and
    // skipping them makes koffi's install script attempt a source build.
    runNpm(['install', '--no-audit', '--no-fund'], STAGING)
    const lockText = readFileSync(join(STAGING, 'package-lock.json'), 'utf8')
    const lockIssues = portableLockfileIssues(lockText)
    if (lockIssues.length > 0) {
      throw new Error(`build-desktop-dist: staging lockfile is not machine-portable: ${lockIssues.join('; ')}`)
    }
    // What gets committed carries no integrity for our own tarballs: every
    // repack changes their content hash, so keeping it made the committed lock
    // differ on every build — the tree went dirty mid-build and every package
    // was stamped `+dirty` for a diff nobody would review. The seeding step
    // discards those entries anyway; only the registry pins are the lock's job.
    const committedText = withoutLocalTarballIntegrity(lockText)
    if (!existsSync(COMMITTED_LOCK) || readFileSync(COMMITTED_LOCK, 'utf8') !== committedText) {
      writeFileSync(COMMITTED_LOCK, committedText)
      console.log(`build-desktop-dist: runtime lockfile updated at ${COMMITTED_LOCK} — review and commit it`)
    } else {
      console.log('build-desktop-dist: runtime lockfile unchanged (external dependency set is pinned)')
    }
    const entry = join(STAGING, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
    if (!existsSync(entry)) throw new Error('build-desktop-dist: installed tree lacks @deepseek-ai/dsh/lib/bin.js')
    const pnpmEntry = join(STAGING, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs')
    if (!existsSync(pnpmEntry)) throw new Error('build-desktop-dist: installed tree lacks pnpm/bin/pnpm.cjs')
    // 版本一致性门禁：声明版本（本次打包的 dsh tarball manifest）必须等于
    // 实际安装进 Runtime 的版本。npm 缓存复用旧 tarball 的坑在此现形——
    // 不一致立即失败，绝不把旧货装进发行目录（B1 第 6 扇窗教训二）。
    const declaredDshVersion = manifests.get('@deepseek-ai/dsh')?.version
    if (typeof declaredDshVersion !== 'string') throw new Error('build-desktop-dist: dsh tarball manifest has no version')
    const installedManifest = join(STAGING, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
    let installedDshVersion: unknown
    try {
      installedDshVersion = (JSON.parse(readFileSync(installedManifest, 'utf8')) as { version?: unknown }).version
    } catch (error) {
      throw new Error(`build-desktop-dist: cannot read installed DSH manifest ${installedManifest}: ${String(error instanceof Error ? error.message : error)}`)
    }
    if (installedDshVersion !== declaredDshVersion) {
      throw new Error(
        `build-desktop-dist: declared DSH version ${declaredDshVersion} does not match installed runtime version ${String(installedDshVersion)} — the npm cache served a stale tarball; clear the cache and rebuild`,
      )
    }
    rmSync(RUNTIME_DIR, { recursive: true, force: true })
    mkdirSync(RUNTIME_DIR, { recursive: true })
    // sourcemap 不随产物出厂：打包态从不读它——我们没装 source-map-support，
    // 启动 DSH 的 argv 也没有 --enable-source-maps（见 dsh-service.ts 的
    // resolveDshCommand）。而它们是 3,863 个文件、21.4 MB：安装时要逐个写盘，
    // 之后每次 require 都被杀软实时扫描碰一遍。符号本身没丢，留在 npm 包与
    // CI 产物里，需要回溯堆栈时随时取得到。
    cpSync(join(STAGING, 'node_modules'), join(RUNTIME_DIR, 'node_modules'), {
      recursive: true,
      filter: source => !source.endsWith('.map'),
    })
    // npm's hidden lockfile records every tarball's `resolved` as a file: URL
    // relative to the staging directory — a path through the build user's home
    // and repository location. The packaged app never runs npm, so the file
    // has no runtime consumer; the leak scan treats any surviving copy as a
    // finding.
    rmSync(join(RUNTIME_DIR, 'node_modules', '.package-lock.json'), { force: true })
    for (const ship of PLUGIN_SHIPMENTS) shipPlugin(RUNTIME_DIR, ship)
    const pruned = prunePlatforms(RUNTIME_DIR, IS_WINDOWS ? 'win32-x64' : `linux-${process.arch}`)
    console.log(`build-desktop-dist: platform prune removed ${pruned.length} artifacts (${formatBytes(directoryBytes(RUNTIME_DIR))} runtime after prune)`)
    console.log(`build-desktop-dist: DSH runtime assembled at ${RUNTIME_DIR}`)
  } finally {
    rmSync(STAGING, { recursive: true, force: true })
  }
}

/** Print the distribution summary. */
function summarize(): void {
  const exe = UNPACKED_EXE
  if (!existsSync(exe)) throw new Error(`build-desktop-dist: ${exe} was not produced`)
  const totalBytes = directoryBytes(UNPACKED)
  const installers = readdirSync(DIST_ROOT).filter(name => IS_WINDOWS
    ? name.endsWith('.exe') && name.includes('Setup')
    : name.endsWith('.AppImage'))
  // 交付身份：installer 文件名必须携带 DeepSeekGUI app version（唯一手写源头
  // 是 apps/deepseekgui/package.json）。文件名与产品版本不一致立即失败。
  let appVersion: unknown
  try {
    appVersion = (JSON.parse(readFileSync(join(ROOT, 'apps', 'deepseekgui', 'package.json'), 'utf8')) as { version?: unknown }).version
  } catch (error) {
    throw new Error(`build-desktop-dist: cannot read DeepSeekGUI app manifest: ${String(error instanceof Error ? error.message : error)}`)
  }
  for (const installer of installers) {
    if (!installer.includes(String(appVersion))) {
      throw new Error(`build-desktop-dist: installer ${installer} does not carry the DeepSeekGUI app version ${String(appVersion)}`)
    }
  }
  console.log(`build-desktop-dist: distribution at ${UNPACKED}`)
  console.log(`build-desktop-dist: executable ${exe} (${formatBytes(statSync(exe).size)})`)
  console.log(`build-desktop-dist: total ${formatBytes(totalBytes)}`)
  for (const installer of installers) {
    const path = join(DIST_ROOT, installer)
    console.log(`build-desktop-dist: installer ${path} (${formatBytes(statSync(path).size)})`)
  }
  if (installers.length === 0) throw new Error(`build-desktop-dist: no ${IS_WINDOWS ? 'NSIS installer' : 'AppImage'} produced`)
}

/** Windows' classic path limit; the ceiling every shipped file has to fit under. */
const MAX_PATH = 260

/**
 * Install directory length that must still work after this build.
 *
 * The per-user default is `%LOCALAPPDATA%\Programs\DeepSeekGUI`, which lands
 * around 54 characters for an ordinary account name. 60 is that with a little
 * air: below it, a normal install is already at risk and the build has no
 * business producing an installer.
 */
const MIN_INSTALL_BUDGET = 60

/** The installer's own ceiling on `$INSTDIR`, declared in `installer.nsh`. */
function installerGateLength(): number {
  const nsh = join(ROOT, 'apps', 'deepseekgui', 'build', 'installer.nsh')
  const declaration = /!define\s+DEEPSEEKGUI_MAX_INSTDIR_LEN\s+(\d+)/.exec(readFileSync(nsh, 'utf8'))
  if (declaration === null) {
    throw new Error(`build-desktop-dist: ${nsh} no longer declares DEEPSEEKGUI_MAX_INSTDIR_LEN; the installer would stop refusing over-long install directories`)
  }
  return Number(declaration[1])
}

/**
 * Fail the build when the payload leaves no room for an install directory.
 *
 * Windows refuses paths past 260 characters, and the failure does not surface
 * as "path too long" — upstream has six reports of the NSIS uninstaller
 * aborting on a deep install and telling the user "DSH Desktop cannot be
 * closed, please close it and retry". Users then close the app, kill the
 * process, reboot, and none of it helps, because closing was never the
 * problem. The install succeeds and the *uninstall* is what breaks, so the
 * damage shows up months later during an upgrade.
 *
 * Nothing here is ours: the longest paths come from third-party packages that
 * nest their own node_modules and ship several build variants of one file. We
 * cannot shorten them, so the least we can do is know our own margin, print it
 * every build, and refuse to ship once it is gone.
 * @param unpackedDir - the win-unpacked directory to measure.
 * @throws when the remaining budget cannot hold an ordinary install path.
 */
function requirePathLengthHeadroom(unpackedDir: string): void {
  let longest = ''
  const walk = (directory: string, prefix: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const relative = prefix === '' ? entry.name : prefix + String.fromCharCode(92) + entry.name
      if (entry.isDirectory()) {
        walk(join(directory, entry.name), relative)
        continue
      }
      if (relative.length > longest.length) longest = relative
    }
  }
  walk(unpackedDir, '')
  // +1 for the separator between the install directory and the relative path.
  const budget = MAX_PATH - longest.length - 1
  console.log(
    `build-desktop-dist: longest shipped path is ${String(longest.length)} chars,`
    + ` leaving ${String(budget)} for the install directory (need >= ${String(MIN_INSTALL_BUDGET)})`,
  )
  const gate = installerGateLength()
  if (gate > budget) {
    throw new Error(
      `build-desktop-dist: installer.nsh admits install directories up to ${String(gate)} characters, but this`
      + ` payload only leaves ${String(budget)}. Lower DEEPSEEKGUI_MAX_INSTDIR_LEN in`
      + ' apps/deepseekgui/build/installer.nsh to match, or the installer will accept a directory it cannot install into.',
    )
  }
  if (budget < MIN_INSTALL_BUDGET) {
    throw new Error(
      `build-desktop-dist: the payload leaves only ${String(budget)} characters for an install directory,`
      + ` under the ${String(MIN_INSTALL_BUDGET)} an ordinary per-user install needs. Windows will refuse the`
      + ' resulting paths, and the uninstaller reports it as "cannot be closed" rather than as a path problem.'
      + `${String.fromCharCode(10)}  longest: ${longest}`,
    )
  }
}
/**
 * Files that exist in the runtime tree but never run.
 *
 * Installing DeepSeekGUI is slow, and the cost is dominated by file *count*, not
 * bytes: NSIS unpacks single-threaded and Defender scans every write. The DSH
 * runtime ships 23771 files, and nearly half of them cannot execute — 8897
 * `.d.ts` declarations exist for a compiler that is not present, plus package
 * READMEs, changelogs and test suites.
 *
 * Verified before deleting (2026-08-27): all 532 package.json manifests in the
 * tree were scanned, and no runtime entry — main, module, bin, or any exports
 * condition other than `types`/`typings` — resolves to a declaration file.
 * Hand-written `.ts` sources are deliberately kept: 34 of them are referenced
 * by `browser` fields and `.source` export conditions, and 2122 files are not
 * worth the risk.
 *
 * LICENSE files always stay: shipping them is a licensing obligation, not a
 * convenience.
 */
const RUNTIME_DEAD_WEIGHT_DIRS = new Set([
  'test', 'tests', '__tests__', 'example', 'examples',
  'benchmark', 'benchmarks', 'coverage', '.github',
])

/** Doc files with no runtime role. `LICENSE*` is never matched here. */
const RUNTIME_DEAD_WEIGHT_DOCS = /^(readme|changelog|history|contributing|authors|code_of_conduct|security|governance)/i

/**
 * Drop what cannot run from the shipped DSH runtime.
 * @param runtimeDir - resources/dsh inside win-unpacked.
 * @returns how many files were removed and how many bytes they held.
 */
function trimRuntimeDeadWeight(runtimeDir: string): { files: number; bytes: number } {
  let files = 0
  let bytes = 0
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name)
      if (entry.isDirectory()) {
        if (RUNTIME_DEAD_WEIGHT_DIRS.has(entry.name.toLowerCase())) {
          for (const inner of countTree(full)) {
            files += 1
            bytes += inner
          }
          rmSync(full, { recursive: true, force: true })
          continue
        }
        walk(full)
        continue
      }
      const lower = entry.name.toLowerCase()
      const declaration = lower.endsWith('.d.ts') || lower.endsWith('.d.mts') || lower.endsWith('.d.cts')
      if (!declaration && !RUNTIME_DEAD_WEIGHT_DOCS.test(lower)) continue
      files += 1
      bytes += statSync(full).size
      rmSync(full, { force: true })
    }
  }
  walk(runtimeDir)
  return { files, bytes }
}

/** Sizes of every file under a directory (used to account for what a delete removed). */
function* countTree(directory: string): Generator<number> {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name)
    if (entry.isDirectory()) {
      yield* countTree(full)
      continue
    }
    yield statSync(full).size
  }
}

/** Chromium locale packs kept in the distribution: the two languages DeepSeekGUI ships. */
const SHIPPED_LOCALES = new Set(['en-US.pak', 'zh-CN.pak'])

/**
 * Drop the Chromium locale packs DeepSeekGUI never displays.
 *
 * Electron ships all 55 locales (47 MB); DeepSeekGUI's own chrome is zh/en only
 * and the official web surface carries its own i18n, so the rest is dead
 * weight in every installer and on every user's disk. Chromium falls back to
 * en-US for any system language whose pack is absent, which is exactly the
 * behaviour an unshipped language should get.
 *
 * Done here rather than through electron-builder's `electronLanguages`
 * because this build drives electron-builder with `--dir` and assembles the
 * rest of the payload itself: keeping the trim in one place makes what ships
 * a property of this script, not of a config key whose Windows semantics
 * differ across electron-builder versions.
 * @param unpackedDir - the unpacked directory electron-builder produced.
 */
function trimElectronLocales(unpackedDir: string): void {
  const localesDir = join(unpackedDir, 'locales')
  if (!existsSync(localesDir)) {
    throw new Error(`build-desktop-dist: ${localesDir} is missing — electron-builder did not produce a locales directory`)
  }
  let removed = 0
  let freed = 0
  for (const name of readdirSync(localesDir)) {
    if (SHIPPED_LOCALES.has(name)) continue
    const target = join(localesDir, name)
    freed += statSync(target).size
    rmSync(target, { force: true })
    removed += 1
  }
  // A locales directory that lost en-US would leave Chromium with no strings
  // at all; fail loud rather than ship a mute build.
  for (const kept of SHIPPED_LOCALES) {
    if (!existsSync(join(localesDir, kept))) {
      throw new Error(`build-desktop-dist: locale pack ${kept} is missing after the trim`)
    }
  }
  console.log(`build-desktop-dist: trimmed ${String(removed)} Chromium locale packs (${formatBytes(freed)} freed)`)
}

/** Format a byte count for the summary. */
function formatBytes(bytes: number): string {
  const mb = bytes / 1024 / 1024
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`
}

if (import.meta.main) {
  requirePrerequisites()
  requireUnlockedOutput()
  // Dirty-tree gate (B5 release): the public chain checks first; this
  // repeat keeps the internal assemble entry from bypassing it.
  requireCleanTree(ROOT)
  ensureElectronDistribution()
  packFamily('dsh', PACK_DHS)
  packProductPackages(PACK_DHS)
  packFamily('vendor', PACK_VENDOR)
  assembleRuntime()
  // electron-builder toolchain binaries (NSIS, winCodeSign) download from
  // GitHub; a mirror keeps network-restricted builds working.
  const builderEnv = {
    ...process.env,
    PATH: `${pnpmShimDirectory()}${delimiter}${process.env.PATH ?? ''}`,
    ...process.env.ELECTRON_BUILDER_BINARIES_MIRROR === undefined
      ? { ELECTRON_BUILDER_BINARIES_MIRROR: 'https://npmmirror.com/mirrors/electron-builder-binaries/' }
      : {},
  }
  runNode([join(ROOT, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js'),
    '--dir', '--config', join(ROOT, 'apps', 'deepseekgui', 'electron-builder.yml')], ROOT, {
    env: builderEnv,
  })
  // The DSH runtime lands in resources/dsh, where the main process launches it
  // via ELECTRON_RUN_AS_NODE. Copied here (not via extraResources) so the
  // distribution build owns the copy and its timing.
  trimElectronLocales(UNPACKED)
  const resourcesDsh = join(UNPACKED, 'resources', 'dsh')
  cpSync(RUNTIME_DIR, resourcesDsh, { recursive: true })
  // The staging copy has served its purpose; dropping it halves disk use and
  // keeps the final release-set scan scoped to what actually ships.
  rmSync(RUNTIME_DIR, { recursive: true, force: true })
  console.log(`build-desktop-dist: DSH runtime copied to ${resourcesDsh}`)
  const trimmed = trimRuntimeDeadWeight(resourcesDsh)
  console.log(`build-desktop-dist: dropped ${String(trimmed.files)} files that never run (${String(Math.round(trimmed.bytes / 1024 / 1024))} MB) from the runtime`)
  // 交付身份：embedded DSH source/commit 标识与 Runtime 一起出厂。
  // About 面板据此展示产物可溯源事实；git 不可用时打包直接失败
  // （打包必须发生在 git checkout 里，产物必须可溯源）。
  const sourceCommit = readDevSourceCommit(ROOT)
  if (sourceCommit === null) {
    throw new Error('build-desktop-dist: git HEAD is unavailable; a packaged DeepSeekGUI must carry its source/commit identifier')
  }
  writeFileSync(join(UNPACKED, 'resources', SOURCE_COMMIT_FILENAME), `${sourceCommit}\n`, 'utf8')
  console.log(`build-desktop-dist: source/commit identifier ${sourceCommit} written to resources/${SOURCE_COMMIT_FILENAME}`)
  // （终端 shims 在运行时由 main 生成到 userData/deepseekgui-bin——转发当前
  // exact executable，见 apps/deepseekgui/src/terminal-service.ts。）
  // Sanitize and verify BEFORE building the installer: any finding fails the
  // build here, so the NSIS package can only ever wrap a sanitized payload.
  // The path-length gate encodes MAX_PATH and the NSIS $INSTDIR ceiling —
  // Windows facts with no Linux counterpart (AppImage mounts read-only at a
  // short fixed path).
  if (IS_WINDOWS) requirePathLengthHeadroom(UNPACKED)
  const findings = sanitizeAndVerify(UNPACKED, ROOT, homedir())
  if (findings.length > 0) {
    throw new Error(`build-desktop-dist: distribution leaked sensitive content:\n${findings.join('\n')}`)
  }
  console.log('build-desktop-dist: sanitize and leak scan passed')
  // DeepSeekGUI 自带插件必须以**文件级**存在于即将打包的 payload 里。
  // 2026-08-23 实机灾难：win-unpacked 里这两个目录被清空（清空者未查明——
  // 目录还在、内容没了，overlay yml 无恙，目录级检查全部通过），打出的
  // 安装包带着空插件，用户装完首启必崩 page-load，现场没有任何线索指向
  // 这里。装配段的 shipThemePlugin/shipPickerPlugin 检查的是装配时刻；
  // 这里是打包时刻，中间的空窗期发生过什么没人担保。断言放在离打包最近处。
  for (const [plugin, entry] of [
    ['deepseekgui-theme', join('lib', 'client.js')],
    ['deepseekgui-directory-picker', join('lib', 'index.js')],
    ['deepseekgui-settings', join('lib', 'client.js')],
    ['deepseekgui-browser', join('lib', 'index.js')],
    ['deepseekgui-workbench', join('lib', 'client.js')],
    ['deepseekgui-coding-tools', join('lib', 'index.js')],
  ] as const) {
    const file = join(UNPACKED, 'resources', 'dsh', 'node_modules', '@see-sol-lab', plugin, entry)
    if (!existsSync(file) || statSync(file).size === 0) {
      throw new Error(`build-desktop-dist: ${file} is missing or empty — the payload would ship a hollow plugin and every install would fail page-load on first boot`)
    }
  }
  // The browser plugin is the only bundled one with an npm dependency: without
  // playwright-core beside it the tools register fine and then fail at the
  // first call. Assert the dependency at packaging time, where the evidence is
  // still on this machine (B3-11 built-in browser).
  const shippedPlaywright = join(UNPACKED, 'resources', 'dsh', 'node_modules', 'playwright-core', 'package.json')
  if (!existsSync(shippedPlaywright)) {
    throw new Error(`build-desktop-dist: ${shippedPlaywright} is missing — the bundled browser plugin would ship without its runtime dependency`)
  }
  // It is also the only bundled plugin that declares `dsh.bundle.patch`, so
  // its own overlay must stay inside the package: a profile that lists this
  // package in its bundle layer (any machine where the plugin manager
  // installed it once) reads the overlay from there, and its absence kills
  // boot with ENOENT before any window exists. Assert the file the manifest
  // promises (2026-08-24 field failure).
  const shippedBundlePatch = join(UNPACKED, 'resources', 'dsh', 'node_modules', '@see-sol-lab', 'deepseekgui-browser', 'cordis.patch.yml')
  if (!existsSync(shippedBundlePatch) || statSync(shippedBundlePatch).size === 0) {
    throw new Error(`build-desktop-dist: ${shippedBundlePatch} is missing — a profile carrying this package in its bundle layer would fail to boot`)
  }
  console.log('build-desktop-dist: bundled plugin payload verified (file-level, browser dependency included)')
  // The installer is built from the sanitized unpacked directory
  // (--prepackaged), so resources/dsh and the checked payload are exactly
  // what ships. Linux passes --publish never explicitly: electron-builder's
  // CI detection otherwise triggers implicit publishing in the Linux lane.
  runNode([join(ROOT, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js'),
    '--prepackaged', UNPACKED,
    ...IS_WINDOWS ? ['--win', 'nsis'] : ['--linux', 'appimage', '--publish', 'never'],
    '--config', join(ROOT, 'apps', 'deepseekgui', 'electron-builder.yml')],
  ROOT, { env: builderEnv })
  console.log(`build-desktop-dist: ${IS_WINDOWS ? 'NSIS installer' : 'AppImage'} built from sanitized ${UNPACKED}`)
  // electron-builder's debug dump records the full NSIS command line —
  // build-machine repository, user, temp, and cache paths. It is not a
  // release artifact; the release-set scan reports any survivor.
  rmSync(join(DIST_ROOT, 'builder-debug.yml'), { force: true })
  // Final scan over the whole prepared release set (win-unpacked, installer
  // metadata such as latest.yml, and anything else left in dist/desktop):
  // scan-only, so files the installer already wrapped are never modified.
  const releaseFindings = sanitizeAndVerify(DIST_ROOT, ROOT, homedir(), { rewrite: false })
  if (releaseFindings.length > 0) {
    throw new Error(`build-desktop-dist: release set leaked sensitive content:\n${releaseFindings.join('\n')}`)
  }
  console.log('build-desktop-dist: release-set leak scan passed')
  // Release artifact SHA-256 manifest (P4 发行物完整性 gate)：installer 与
  // 打包 exe 的 digest 随发布集出厂，verify-desktop-dist.ps1 逐项比对。
  writeSha256Manifest()
  summarize()
}

/** 生成发布集的 SHA-256 manifest（installer + win-unpacked exe）。
 * 清单记**相对 dist/desktop 的路径**（统一正斜杠），verify-desktop-dist.ps1
 * 按同一约定解析——两端共用一套路径约定，绝不各写各的。 */
function writeSha256Manifest(): void {
  const lines: string[] = []
  const installer = readdirSync(DIST_ROOT).find(name => IS_WINDOWS
    ? /^DeepSeekGUI-Setup-.*\.exe$/.test(name)
    : /^DeepSeekGUI-.*\.AppImage$/.test(name))
  const targets: { rel: string; abs: string }[] = [
    ...installer === undefined ? [] : [{ rel: installer, abs: join(DIST_ROOT, installer) }],
    { rel: `${basename(UNPACKED)}/${basename(UNPACKED_EXE)}`, abs: UNPACKED_EXE },
  ]
  for (const target of targets) {
    if (!existsSync(target.abs)) {
      throw new Error(`build-desktop-dist: cannot hash missing artifact ${target.abs}`)
    }
    const digest = createHash('sha256').update(readFileSync(target.abs)).digest('hex')
    lines.push(`${digest}  ${target.rel}`)
  }
  const manifest = join(DIST_ROOT, 'SHA256SUMS.txt')
  writeFileSync(manifest, `${lines.join('\n')}\n`, 'utf8')
  console.log(`build-desktop-dist: SHA-256 manifest written to ${manifest}`)
}
