/**
 * 整体搬家执行面（Phase 1，Sol 审查后返工）的顺序与失败边界：先拿到放进受控副本、核过版本的
 * 安装包，再搬数据，再核一次副本、写记录、启动交接助手，最后有序退出；退出失败要停掉助手。
 * 网络、对话框、迁移、助手启动、版本资源读取都是替身，文件与记录用真实临时目录。
 * @module @see-sol-lab/deepseekgui/tests/relocation-control
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRelocationControl, type RelocationControlDeps } from '../src/relocation-control.ts'
import { measureMigrationTree } from '../src/migration.ts'
import {
  readRelocationRecord,
  relocationLayout,
  writeRelocationRecord,
  RELOCATION_DIR_NAME,
  RELOCATION_HELPER_CONFIG_NAME,
  RELOCATION_HELPER_STATE_NAME,
  type RelocationFacts,
  type RelocationHelperConfig,
  type RelocationRecord,
} from '../src/relocation.ts'
import type { MigrationControl } from '../src/migration-control.ts'
import type { DataHomeView } from '../src/control-model.ts'
import type { UpdateAsset } from '../src/update-service.ts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

const INSTALLER = Buffer.from('fake installer bytes')
const SHA = createHash('sha256').update(INSTALLER).digest('hex')

function manifest(version: string): string {
  return JSON.stringify({
    latestVersion: version,
    releaseNotes: '',
    assets: [{ url: `https://example.test/DeepSeekGUI-Setup-${version}.exe`, sha256: SHA, size: INSTALLER.length, filename: `DeepSeekGUI-Setup-${version}.exe` }],
  })
}

const okFacts: RelocationFacts = {
  exists: path => existsSync(path),
  names: () => [],
  isLink: () => false,
  isWritable: () => true,
  freeBytes: () => Number.MAX_SAFE_INTEGER,
}

type DownloadAsset = RelocationControlDeps['downloadAsset']
const writeInstaller: DownloadAsset = async (_asset: UpdateAsset, dest: string) => {
  writeFileSync(dest, INSTALLER)
  return { bytes: INSTALLER.length, sha256: SHA }
}

/** 一套临时环境：当前程序目录、当前 Home、userData、目标父目录。 */
function stage(over: Partial<RelocationControlDeps> & { homeKind?: 'managed' | 'existing'; data?: Partial<DataHomeView>; migrateFails?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'dsg-relc-'))
  dirs.push(root)
  const appDir = join(root, 'old-app')
  mkdirSync(appDir, { recursive: true })
  writeFileSync(join(appDir, 'DeepSeekGUI.exe'), 'exe')
  const userData = join(root, 'userData')
  mkdirSync(userData, { recursive: true })
  const parent = join(root, 'target')
  mkdirSync(parent, { recursive: true })
  const layout = relocationLayout(parent)
  let homePath = join(root, 'home')
  mkdirSync(homePath, { recursive: true })
  const homeKind = over.homeKind ?? 'managed'
  const migrate = vi.fn(async (target?: string) => {
    if (over.migrateFails === true) throw new Error('copy failed')
    homePath = join(target ?? '', 'dsh')
  })
  const migration: MigrationControl = {
    isRunning: () => false,
    view: () => ({ homePath, homeKind, awaitingRestart: null, verifyFailed: null, pendingCleanup: null, ...over.data }),
    migrate,
    verifyOnStartup: () => {},
    cleanup: () => {},
  }
  const kill = vi.fn()
  const spawnHelper = vi.fn(async (_script: string, _config: string) => ({ kill }))
  const quit = vi.fn(async () => {})
  const offerLocalInstaller = vi.fn(async (_reason: string): Promise<string | undefined> => undefined)
  const downloadAsset = vi.fn(writeInstaller)
  const deps: RelocationControlDeps = {
    win: true,
    packaged: true,
    execPath: join(appDir, 'DeepSeekGUI.exe'),
    pid: 4242,
    appVersion: '1.2.1',
    userDataDir: userData,
    keptInstaller: null,
    home: () => ({ kind: homeKind, path: homePath }),
    migration,
    busyReason: () => null,
    protectedRoots: () => [],
    facts: okFacts,
    measure: dir => measureMigrationTree(dir),
    pickParent: async () => parent,
    runningSessions: async () => 0,
    confirmPlan: async () => true,
    feeds: () => [null],
    fetchText: async () => manifest('1.2.1'),
    downloadAsset,
    installerIdentity: async () => ({ productName: 'DeepSeekGUI', productVersion: '1.2.1' }),
    offerLocalInstaller,
    confirmLocalInstaller: async () => true,
    failureMessages: () => ({ failedTitle: 't', failedBody: 'b' }),
    spawnHelper,
    quit,
    note: () => {},
    text: key => key,
    zh: () => true,
    broadcast: () => {},
    ...over,
  }
  const copy = join(userData, RELOCATION_DIR_NAME, 'DeepSeekGUI-Setup-1.2.1.exe')
  return {
    root, appDir, userData, parent, layout, migrate, spawnHelper, kill, quit, offerLocalInstaller, downloadAsset, deps, copy,
    api: createRelocationControl(deps), home: () => homePath,
  }
}

function record(s: ReturnType<typeof stage>, over: Partial<RelocationRecord> = {}): RelocationRecord {
  return {
    schemaVersion: 1, startedAt: 'x', fromAppDir: s.appDir, toAppDir: s.layout.appDir, root: s.layout.root,
    version: '1.2.1', dataMoved: true, fromHome: 'h', installerPath: s.copy, installerSha256: SHA, ...over,
  }
}

describe('createRelocationControl.relocate', () => {
  it('只支持 Windows 打包版', async () => {
    await expect(stage({ win: false }).api.relocate()).rejects.toThrow('error.relocation-not-windows')
    await expect(stage({ packaged: false }).api.relocate()).rejects.toThrow('error.relocation-not-packaged')
  })

  it('正常路径：安装包进受控副本 → 搬数据 → 写记录与助手配置 → 启动助手 → 有序退出', async () => {
    const s = stage()
    await s.api.relocate()
    expect(s.downloadAsset.mock.invocationCallOrder[0]).toBeLessThan(s.migrate.mock.invocationCallOrder[0]!)
    expect(s.migrate).toHaveBeenCalledWith(s.layout.root)
    expect(s.spawnHelper.mock.invocationCallOrder[0]).toBeLessThan(s.quit.mock.invocationCallOrder[0]!)
    expect(readRelocationRecord(s.userData).record).toMatchObject({
      fromAppDir: s.appDir, toAppDir: s.layout.appDir, dataMoved: true, installerPath: s.copy, installerSha256: SHA,
    })
    const config = JSON.parse(readFileSync(join(s.userData, RELOCATION_DIR_NAME, RELOCATION_HELPER_CONFIG_NAME), 'utf8')) as RelocationHelperConfig
    expect(config).toMatchObject({ parentPid: 4242, installer: s.copy, sha256: SHA, fromAppDir: s.appDir, toAppDir: s.layout.appDir, exeName: 'DeepSeekGUI.exe' })
  })

  it('有序退出失败：停掉助手、删记录，应用照常可用', async () => {
    const s = stage({ quit: async () => { throw new Error('terminal cleanup failed') } })
    await expect(s.api.relocate()).rejects.toThrow('terminal cleanup failed')
    expect(s.kill).toHaveBeenCalledOnce()
    expect(readRelocationRecord(s.userData).record).toBeNull()
    expect(s.api.view().last).toMatchObject({ kind: 'quit-failed', dataMoved: true })
  })

  it('助手起不来：删记录、不退出，如实给结果', async () => {
    const s = stage({ spawnHelper: async () => { throw new Error('ENOENT') } })
    await expect(s.api.relocate()).rejects.toThrow('error.relocation-spawn-failed')
    expect(readRelocationRecord(s.userData).record).toBeNull()
    expect(s.quit).not.toHaveBeenCalled()
    expect(s.api.view().last).toMatchObject({ kind: 'spawn-failed' })
  })

  it('确认之后、交接之前副本被改了：不交接', async () => {
    // 写记录前最后一个可插手的时机（给助手留事实的那一步）把副本换掉
    let copyPath = ''
    const s = stage({ homeKind: 'existing', note: () => { writeFileSync(copyPath, 'tampered') } })
    copyPath = s.copy
    await expect(s.api.relocate()).rejects.toThrow('error.relocation-installer-changed')
    expect(s.spawnHelper).not.toHaveBeenCalled()
  })

  it('清单版本不是当前版本：不顺手升级，转去问本地安装包；用户放弃就什么都没动', async () => {
    const s = stage({ fetchText: async () => manifest('1.3.0') })
    await s.api.relocate()
    expect(s.offerLocalInstaller).toHaveBeenCalledOnce()
    expect(s.migrate).not.toHaveBeenCalled()
  })

  it('下载的安装包摘要不符：报错，不搬数据', async () => {
    const s = stage({ downloadAsset: async (_asset, dest) => { writeFileSync(dest, INSTALLER); return { bytes: INSTALLER.length, sha256: '0'.repeat(64) } } })
    await expect(s.api.relocate()).rejects.toThrow('error.relocation-installer-digest')
    expect(s.migrate).not.toHaveBeenCalled()
  })

  it('本地安装包：复制进受控副本；产品名或版本不对（改了名字的旧包）就拒绝', async () => {
    const s = stage({ fetchText: async () => { throw new Error('offline') }, installerIdentity: async () => ({ productName: 'DeepSeekGUI', productVersion: '1.0.0' }) })
    const renamed = join(s.root, 'DeepSeekGUI-Setup-1.2.1.exe')
    writeFileSync(renamed, INSTALLER)
    s.offerLocalInstaller.mockResolvedValueOnce(renamed)
    await expect(s.api.relocate()).rejects.toThrow('error.relocation-installer-identity')
    expect(s.migrate).not.toHaveBeenCalled()
  })

  it('本地同版本候选：照常搬，交给助手的是受控副本而不是原文件', async () => {
    const s = stage({ fetchText: async () => { throw new Error('offline') } })
    const local = join(s.root, 'my-local-build.exe')
    writeFileSync(local, INSTALLER)
    s.offerLocalInstaller.mockResolvedValueOnce(local)
    await s.api.relocate()
    expect(readRelocationRecord(s.userData).record).toMatchObject({ installerPath: s.copy, installerSha256: SHA })
  })

  it('安装器留在本机的同版本包：直接用，不下载、不问用户', async () => {
    const kept = join(mkdtempSync(join(tmpdir(), 'dsg-kept-')), 'DeepSeekGUI-Setup-1.2.1.exe')
    dirs.push(dirname(kept))
    writeFileSync(kept, INSTALLER)
    const fetchText = vi.fn(async () => manifest('1.2.1'))
    const s = stage({ keptInstaller: kept, fetchText })
    await s.api.relocate()
    expect(fetchText).not.toHaveBeenCalled()
    expect(s.downloadAsset).not.toHaveBeenCalled()
    expect(s.offerLocalInstaller).not.toHaveBeenCalled()
    expect(readRelocationRecord(s.userData).record).toMatchObject({ installerPath: s.copy, installerSha256: SHA })
  })

  it('留在本机的包版本对不上：退回按清单下载', async () => {
    const kept = join(mkdtempSync(join(tmpdir(), 'dsg-kept-')), 'DeepSeekGUI-Setup-1.2.1.exe')
    dirs.push(dirname(kept))
    writeFileSync(kept, 'other build')
    const installerIdentity = vi.fn(async () => ({ productName: 'DeepSeekGUI', productVersion: '1.2.1' }))
    installerIdentity.mockResolvedValueOnce({ productName: 'DeepSeekGUI', productVersion: '1.2.0' })
    const s = stage({ keptInstaller: kept, installerIdentity })
    await s.api.relocate()
    expect(s.downloadAsset).toHaveBeenCalledOnce()
    expect(readRelocationRecord(s.userData).record).toMatchObject({ installerSha256: SHA })
  })

  it('数据迁移失败：不写记录、不启动助手，空的根目录删掉', async () => {
    const s = stage({ migrateFails: true })
    await expect(s.api.relocate()).rejects.toThrow('copy failed')
    expect(s.spawnHelper).not.toHaveBeenCalled()
    expect(readRelocationRecord(s.userData).record).toBeNull()
    expect(existsSync(s.layout.root)).toBe(false)
  })

  it('Existing Home：只搬程序，不碰数据', async () => {
    const s = stage({ homeKind: 'existing' })
    await s.api.relocate()
    expect(s.migrate).not.toHaveBeenCalled()
    expect(readRelocationRecord(s.userData).record).toMatchObject({ dataMoved: false })
  })

  it('空间估算读不出来：说明原因，不开始', async () => {
    const s = stage({ measure: async () => { throw new Error('EACCES') } })
    await expect(s.api.relocate()).rejects.toThrow('error.relocation-measure-failed')
    expect(s.downloadAsset).not.toHaveBeenCalled()
  })

  it('只移动数据那一趟还没收尾、更新正忙、上一次没结束：都拒绝', async () => {
    await expect(stage({ data: { awaitingRestart: { targetHome: 'x' } } }).api.relocate()).rejects.toThrow('error.relocation-data-unsettled')
    await expect(stage({ busyReason: () => 'update busy' }).api.relocate()).rejects.toThrow('update busy')
    const s = stage()
    writeRelocationRecord(s.userData, record(s))
    await expect(s.api.relocate()).rejects.toThrow('error.relocation-pending')
  })
})

describe('createRelocationControl 启动时与重试', () => {
  it('从新位置启动：清记录与副本，结果是 moved', () => {
    const s = stage()
    mkdirSync(join(s.userData, RELOCATION_DIR_NAME), { recursive: true })
    writeFileSync(s.copy, INSTALLER)
    writeRelocationRecord(s.userData, record(s, { fromAppDir: join(s.root, 'older'), toAppDir: s.appDir }))
    s.api.resolveOnStartup()
    expect(readRelocationRecord(s.userData).record).toBeNull()
    expect(existsSync(join(s.userData, RELOCATION_DIR_NAME))).toBe(false)
    expect(s.api.view().last).toMatchObject({ kind: 'moved', appDir: s.appDir })
  })

  it('还在旧位置启动：记录与副本留着，带上助手写下的原因；重试按当前事实核目标后再交接', async () => {
    const s = stage()
    mkdirSync(join(s.userData, RELOCATION_DIR_NAME), { recursive: true })
    writeFileSync(join(s.userData, RELOCATION_DIR_NAME, RELOCATION_HELPER_STATE_NAME), '{"phase":"restored","detail":"install exit 2"}')
    writeRelocationRecord(s.userData, record(s))
    s.api.resolveOnStartup()
    expect(s.api.view().last).toMatchObject({ kind: 'not-moved', helperPhase: 'restored' })
    await s.api.retry()
    expect(s.migrate).not.toHaveBeenCalled()
    expect(s.spawnHelper).toHaveBeenCalledOnce()
    expect(s.quit).toHaveBeenCalledOnce()
  })

  it('重试前目标变成了链接或混进陌生内容：拒绝，不盲信旧记录', async () => {
    const s = stage({ facts: { ...okFacts, names: () => ['app', 'unrelated.txt'] } })
    mkdirSync(s.layout.root, { recursive: true })
    writeRelocationRecord(s.userData, record(s))
    await expect(s.api.retry()).rejects.toThrow('error.relocation-root-not-empty')
    expect(s.spawnHelper).not.toHaveBeenCalled()
  })

  it('放弃：清记录、副本与结果', () => {
    const s = stage()
    mkdirSync(join(s.userData, RELOCATION_DIR_NAME), { recursive: true })
    writeFileSync(s.copy, INSTALLER)
    writeRelocationRecord(s.userData, record(s, { dataMoved: false }))
    s.api.resolveOnStartup()
    s.api.dismiss()
    expect(readRelocationRecord(s.userData).record).toBeNull()
    expect(existsSync(s.copy)).toBe(false)
    expect(s.api.view().last).toBeNull()
  })

  it('记录坏了：报告 record-unreadable，不猜结果', () => {
    const s = stage()
    writeFileSync(join(s.userData, 'relocation.json'), 'broken')
    s.api.resolveOnStartup()
    expect(s.api.view().last).toMatchObject({ kind: 'record-unreadable' })
  })
})

describe('measureMigrationTree（空间估算与迁移同一规则）', () => {
  it('只算真文件，链接不跟进、不计入', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsg-measure-'))
    dirs.push(root)
    const home = join(root, 'home')
    mkdirSync(join(home, 'sub'), { recursive: true })
    writeFileSync(join(home, 'a.txt'), '12345')
    writeFileSync(join(home, 'sub', 'b.txt'), '123')
    const outside = join(root, 'outside')
    mkdirSync(outside)
    writeFileSync(join(outside, 'big.bin'), Buffer.alloc(4096))
    symlinkSync(outside, join(home, 'link'), 'junction')
    symlinkSync(home, join(home, 'sub', 'loop'), 'junction')
    expect(await measureMigrationTree(home)).toBe(8)
  })

  it('读不到就抛错（不少算）', async () => {
    await expect(measureMigrationTree(join(tmpdir(), 'dsg-no-such-dir-xyz'))).rejects.toThrow()
  })
})
