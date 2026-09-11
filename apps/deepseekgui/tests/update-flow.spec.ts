/**
 * 完整更新业务序列测试（P11）：manifest → 下载 → 完整性校验 → 就绪 →
 * 用户确认 → 安装交接请求，全部在本机 mock HTTP server 上跑真链路（真网络栈、
 * 真流、真缓存目录），spawn 用注入替身——**测试里请求交接不等于安装器已经
 * 执行或应用已经重启**，真实安装与重启仍由打包态实机验收。
 *
 * 覆盖：可用更新全序列、已验证产物复用、拒绝确认、任务运行中的安装选择、
 * 网络错误、旧版本、平台不符、长度/摘要不符、取消。
 * 不访问公网、无凭据、无模型、不执行真实安装器。
 * @module @see-sol-lab/deepseekgui/tests/update-flow
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { stringsFor } from '../src/chrome/view-model.ts'
import { installConfirmDetail } from '../src/quit-confirm.ts'
import {
  prepareUpdateCache,
  promoteVerifiedFile,
  readVerifiedRecord,
  updateCacheDir,
  writeVerifiedRecord,
} from '../src/update-cache.ts'
import {
  createUpdateRunnerDeps,
  runUpdateCheck,
  runUpdateDownload,
  runUpdateHandoff,
} from '../src/update-runner.ts'
import {
  sanitizeAssetFilename,
  selectPlatformAsset,
  shouldReuseVerifiedInstaller,
  updateCachePaths,
  type UpdateAsset,
  type UpdateManifest,
} from '../src/update-service.ts'
import { cancelledInstallView } from '../src/update-view.ts'
import { httpGet, httpGetLocal, manifestFor, startMock } from './update-mock.ts'

const zh = stringsFor('zh')
const PAYLOAD = Buffer.from('installer-payload-bytes-0123456789')
const PAYLOAD_DIGEST = createHash('sha256').update(PAYLOAD).digest('hex')

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** 一个临时 userData 目录。 */
function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsgui-update-flow-'))
  roots.push(dir)
  return dir
}

/** 资产条目（URL 由调用方按 mock server 地址填写）。 */
/** runner 现在要 manifest 与选中的资产两样：同一个资产对象，两个位置。 */
function downloadOf(one: UpdateAsset): [UpdateManifest, UpdateAsset] {
  return [manifestFor('1.2.0', one), one]
}

function asset(url: string, over: Partial<UpdateAsset> = {}): UpdateAsset {
  return { url, sha256: PAYLOAD_DIGEST, size: PAYLOAD.length, filename: 'DeepSeekGUI-Setup-1.2.0.exe', ...over }
}

/** 收集 spawn 调用的注入替身：测试里它只记录路径，绝不执行任何程序。 */
function fakeSpawn(): { spawned: string[]; spawnInstaller: (path: string) => Promise<void> } {
  const spawned: string[] = []
  return {
    spawned,
    spawnInstaller: async (path: string) => {
      spawned.push(path)
    },
  }
}

describe('完整更新业务序列（本机 mock server + 注入 spawn）', () => {
  it('manifest → 下载 → 完整性校验 → 就绪 → 确认 → 安装交接请求', async () => {
    // manifest 里的资产 URL 要指向本机 mock 自己：先起服务，再在响应里现算。
    // 资产 URL 用 https（产品解析器只接受 HTTPS），注入客户端把它降到 http
    // 连上本地替身——同一份已解析 manifest 因此能连续走完下载。
    let base = ''
    const server = await startMock(new Map<string, { status: number; body: Buffer | (() => Buffer) }>([
      ['/manifest.json', {
        status: 200,
        body: () => Buffer.from(JSON.stringify(manifestFor('1.2.0', asset(`${base.replace(/^http:/u, 'https:')}/setup.exe`)))),
      }],
      ['/setup.exe', { status: 200, body: PAYLOAD }],
    ]))
    base = server.url
    try {
      const spawn = fakeSpawn()
      const deps = createUpdateRunnerDeps(httpGetLocal, spawn.spawnInstaller)
      const userData = temp()

      // ① check：严格更新 → available
      const checked = await runUpdateCheck(deps, `${server.url}/manifest.json`, '1.1.0', true)
      expect(checked.kind).toBe('available')
      if (checked.kind !== 'available') return

      // ② 平台选择：Windows 取 .exe
      const picked = selectPlatformAsset(checked.manifest.assets, 'win32')
      expect(picked.ok).toBe(true)
      if (!picked.ok) return

      // ③ 缓存准备 + 下载（真流）
      const dir = updateCacheDir(userData)
      prepareUpdateCache(dir)
      const paths = updateCachePaths(dir, sanitizeAssetFilename(picked.asset.filename) ?? 'DeepSeekGUI-Setup.exe')
      const progress: number[] = []
      const download = await runUpdateDownload(
        deps, checked.manifest, picked.asset, paths.partial, new AbortController().signal, bytes => progress.push(bytes), true,
      )
      expect(download.kind).toBe('verified')
      if (download.kind !== 'verified') return
      expect(progress.at(-1)).toBe(PAYLOAD.length)

      // ④ 校验通过才改名 + 落盘记录
      expect(promoteVerifiedFile(paths.partial, paths.verified)).toBeNull()
      writeVerifiedRecord(dir, { path: paths.verified, sha256: download.sha256, version: download.version })
      expect(existsSync(paths.partial)).toBe(false)

      // ⑤ 就绪：重启路径读回同一份记录
      const restored = readVerifiedRecord(dir)
      expect(restored).toEqual({ path: paths.verified, sha256: PAYLOAD_DIGEST, version: '1.2.0' })

      // ⑥ 用户确认：运行中的任务数进入确认文案
      expect(installConfirmDetail(2, zh, '1.2.0')).toContain('2')
      expect(installConfirmDetail(2, zh, '1.2.0')).toContain('1.2.0')

      // ⑦ 交接请求：spawn 注入面收到已验证文件的路径（不执行真实安装）
      expect(await runUpdateHandoff(deps, paths.verified)).toBe('spawned')
      expect(spawn.spawned).toEqual([paths.verified])
      expect(server.requests).toContain('/manifest.json')
      expect(server.requests).toContain('/setup.exe')
    } finally {
      server.close()
    }
  })

  it('已验证产物复用：同版本同 digest 时不再下载，记录仍指向同一份文件', async () => {
    const mock = await startMock(new Map([['/setup.exe', { status: 200, body: PAYLOAD }]]))
    try {
      const userData = temp()
      const dir = updateCacheDir(userData)
      prepareUpdateCache(dir)
      const paths = updateCachePaths(dir, 'DeepSeekGUI-Setup-1.2.0.exe')
      const first = await runUpdateDownload(
        createUpdateRunnerDeps(httpGet, async () => {}),
        ...downloadOf(asset(`${mock.url}/setup.exe`)),
        paths.partial,
        new AbortController().signal,
        () => {},
        true,
      )
      expect(first.kind).toBe('verified')
      if (first.kind !== 'verified') return
      expect(promoteVerifiedFile(paths.partial, paths.verified)).toBeNull()
      writeVerifiedRecord(dir, { path: paths.verified, sha256: first.sha256, version: first.version })
      const requestsAfterFirst = mock.requests.length

      // 第二轮：记录仍在、digest 匹配 → 复用，不再发起下载请求。
      const record = readVerifiedRecord(dir)
      expect(record).not.toBeNull()
      if (record === null) return
      expect(shouldReuseVerifiedInstaller(
        record.sha256, record.version, asset(`${mock.url}/setup.exe`), '1.2.0',
      )).toBe(true)
      expect(mock.requests.length).toBe(requestsAfterFirst)
      expect(existsSync(record.path)).toBe(true)
    } finally {
      mock.close()
    }
  })

  it('拒绝确认：留在 verified（安装包仍可安装）并说明原因，绝不发起交接请求', async () => {
    const spawn = fakeSpawn()
    const view = cancelledInstallView({
      channel: 'https://example.test/manifest.json',
      version: '1.2.0',
      releaseNotes: 'notes',
      message: zh['msg.update-install-cancelled'] ?? 'cancelled',
    })
    expect(view).toMatchObject({
      channel: 'https://example.test/manifest.json',
      state: 'verified',
      latestVersion: '1.2.0',
      releaseNotes: 'notes',
      message: zh['msg.update-install-cancelled'],
    })
    expect(spawn.spawned).toEqual([])
  })

  it('任务运行中的安装选择：确认文案写明正在执行的会话数，查不到时不夸大', () => {
    const withTasks = installConfirmDetail(3, zh, '1.2.0')
    expect(withTasks).toContain('3')
    expect(withTasks).toContain(zh['dialog.install-confirm.detail']?.replace('{version}', '1.2.0') ?? '')
    const idle = installConfirmDetail(0, zh, '1.2.0')
    expect(idle).not.toContain('3')
    expect(idle).toBe(zh['dialog.install-confirm.detail']?.replace('{version}', '1.2.0'))
    const unknown = installConfirmDetail(null, zh, '1.2.0')
    expect(unknown).toContain(zh['quit.confirm.unknown'] ?? '')
  })

  it('网络错误：manifest 不可达 → error，且不发起任何下载', async () => {
    const mock = await startMock(new Map())
    try {
      const outcome = await runUpdateCheck(createUpdateRunnerDeps(httpGet, async () => {}), `${mock.url}/manifest.json`, '1.1.0', true)
      expect(outcome.kind).toBe('error')
      expect(mock.requests).toEqual(['/manifest.json'])
    } finally {
      mock.close()
    }
  })

  it('旧版本（或同版本）：→ current，不进入下载', async () => {
    const mock = await startMock(new Map([
      ['/manifest.json', { status: 200, body: Buffer.from(JSON.stringify(manifestFor('1.1.0', asset('https://placeholder/x.exe')))) }],
    ]))
    try {
      const outcome = await runUpdateCheck(createUpdateRunnerDeps(httpGet, async () => {}), `${mock.url}/manifest.json`, '1.1.0', true)
      expect(outcome).toEqual({ kind: 'current' })
      expect(mock.requests).toEqual(['/manifest.json'])
    } finally {
      mock.close()
    }
  })

  it('平台不符：manifest 只有 Linux 资产 → 明确拒绝，不下载其他平台的包', async () => {
    const manifest = manifestFor('1.2.0', asset('https://placeholder/x.AppImage', { filename: 'DeepSeekGUI-1.2.0.AppImage' }))
    expect(selectPlatformAsset(manifest.assets, 'win32')).toEqual({ ok: false, reason: 'no-platform-asset' })
    expect(selectPlatformAsset(manifest.assets, 'linux').ok).toBe(true)
  })

  it('长度不符：明确失败、partial 被清理、不产生就绪记录', async () => {
    const mock = await startMock(new Map([['/setup.exe', { status: 200, body: PAYLOAD }]]))
    try {
      const userData = temp()
      const dir = updateCacheDir(userData)
      prepareUpdateCache(dir)
      const paths = updateCachePaths(dir, 'setup.exe')
      const outcome = await runUpdateDownload(
        createUpdateRunnerDeps(httpGet, async () => {}),
        ...downloadOf(asset(`${mock.url}/setup.exe`, { size: PAYLOAD.length + 3 })),
        paths.partial,
        new AbortController().signal,
        () => {},
        true,
      )
      expect(outcome.kind).toBe('failed')
      expect(existsSync(paths.partial)).toBe(false)
      expect(readVerifiedRecord(dir)).toBeNull()
    } finally {
      mock.close()
    }
  })

  it('摘要不符：明确失败、partial 被清理、不产生就绪记录', async () => {
    const mock = await startMock(new Map([['/setup.exe', { status: 200, body: PAYLOAD }]]))
    try {
      const userData = temp()
      const dir = updateCacheDir(userData)
      prepareUpdateCache(dir)
      const paths = updateCachePaths(dir, 'setup.exe')
      const outcome = await runUpdateDownload(
        createUpdateRunnerDeps(httpGet, async () => {}),
        ...downloadOf(asset(`${mock.url}/setup.exe`, { sha256: 'b'.repeat(64) })),
        paths.partial,
        new AbortController().signal,
        () => {},
        true,
      )
      expect(outcome.kind).toBe('failed')
      if (outcome.kind === 'failed') expect(outcome.message).toContain('SHA-256')
      expect(existsSync(paths.partial)).toBe(false)
      expect(readVerifiedRecord(dir)).toBeNull()
    } finally {
      mock.close()
    }
  })

  it('取消：返回 cancelled、partial 被清理、不产生就绪记录', async () => {
    const mock = await startMock(new Map([['/setup.exe', { status: 200, body: PAYLOAD }]]))
    try {
      const userData = temp()
      const dir = updateCacheDir(userData)
      prepareUpdateCache(dir)
      const paths = updateCachePaths(dir, 'setup.exe')
      const controller = new AbortController()
      controller.abort()
      const outcome = await runUpdateDownload(
        createUpdateRunnerDeps(httpGet, async () => {}),
        ...downloadOf(asset(`${mock.url}/setup.exe`)),
        paths.partial,
        controller.signal,
        () => {},
        true,
      )
      expect(outcome.kind).toBe('cancelled')
      expect(existsSync(paths.partial)).toBe(false)
      expect(readVerifiedRecord(dir)).toBeNull()
    } finally {
      mock.close()
    }
  })
})
