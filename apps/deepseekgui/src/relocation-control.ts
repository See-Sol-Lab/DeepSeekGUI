/**
 * 程序与托管数据整体搬家的执行面（Phase 1，2026-10-05；Sol 审查后返工）。纯逻辑在 relocation.ts。
 *
 * 顺序固定，每一步都为「出错时有一份能用的」服务：
 *   选目标 → 判定（空间按迁移清单的同一规则异步估算）→ 用户确认一次计划
 *   → 取得同版本安装包并放进受控副本（这一步不停任何东西）：在线的按发布清单核摘要，
 *     本地的复制进来；两种都核安装包自带的产品名与版本
 *   → 搬 Managed Home（复用现有数据迁移：停 Harness、复制、逐项校验、切指向、起 Harness）
 *   → 交接前再核一次副本摘要与版本 → 写搬家记录 → 启动短生命周期助手 → 有序退出
 *   → 助手等应用的进程全部退出后才运行安装器（见 relocation.ts 的 RELOCATION_HELPER_SCRIPT）
 *   → 新位置的应用启动后对照记录与助手状态确认，数据那一半由现有的重启核对接手。
 *
 * 失败边界：
 * - 安装包拿不到、计划被取消：什么都没动。
 * - 数据迁移失败：现有迁移自己回滚，这里再删掉自己建的空根目录。
 * - 助手起不来：记录删掉，应用继续在原位置运行（数据已在新位置，这是有效状态）。
 * - 有序退出失败：停掉助手、删记录，应用照常可用，安装器一步都没走。
 * - 安装器没装成：助手打开仍在的旧程序；旧程序已被卸掉就用同一个副本装回原位置；再不行
 *   弹框写明副本与数据位置。下次启动对照助手状态如实显示，给重试与放弃。
 *
 * 不依赖 Electron：服务控制、对话框、网络与进程启动都经注入面传入。
 * @module @see-sol-lab/deepseekgui/relocation-control
 */

import { copyFileSync, createReadStream, existsSync, mkdirSync, readdirSync, realpathSync, renameSync, rmdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import {
  checkRelocationTarget,
  checkRetryTarget,
  clearRelocationRecord,
  readHelperState,
  readRelocationRecord,
  relocationManifestCandidates,
  relocationOutcome,
  RELOCATION_DIR_NAME,
  RELOCATION_HELPER_CONFIG_NAME,
  RELOCATION_HELPER_SCRIPT,
  RELOCATION_HELPER_SCRIPT_NAME,
  RELOCATION_HELPER_STATE_NAME,
  writeRelocationRecord,
  type RelocationFacts,
  type RelocationHelperConfig,
  type RelocationLayout,
  type RelocationRecord,
} from './relocation.ts'
import { parseUpdateManifest, selectPlatformAsset, sha256Stream, verifyDigest, type UpdateAsset } from './update-service.ts'
import type { MigrationControl } from './migration-control.ts'
import type { RelocationView } from './control-model.ts'

/** 产品名：安装包版本资源里的 ProductName。 */
const PRODUCT_NAME = 'DeepSeekGUI'

/** 已取得、已校验、放进受控副本的安装包。 */
export interface RelocationInstaller {
  /** userData/relocation 下的副本。 */
  readonly path: string
  readonly sha256: string
  /**
   * kept = 安装器留在本机的那份；manifest = 与发布清单核对过；local = 用户选的文件。
   * kept 与 local 只核了安装包自带的产品名与版本。
   */
  readonly source: 'kept' | 'manifest' | 'local'
}

/** 给用户确认的一次计划。 */
export interface RelocationPlan {
  readonly layout: RelocationLayout
  readonly currentAppDir: string
  readonly currentHome: string
  readonly homeKind: 'managed' | 'existing'
  /** 正在跑的会话数（确认文案要说清会被停掉）；null = 查不到。 */
  readonly runningSessions: number | null
}

/** 执行面要用到的宿主能力。 */
export interface RelocationControlDeps {
  readonly win: boolean
  readonly packaged: boolean
  readonly execPath: string
  /** 应用主进程 pid（助手等它退出）。 */
  readonly pid: number
  readonly appVersion: string
  readonly userDataDir: string
  /** 当前 Home。 */
  readonly home: () => { readonly kind: 'managed' | 'existing'; readonly path: string }
  /** 现有数据迁移（搬 Managed Home 那一半）。 */
  readonly migration: MigrationControl
  /** 有没有别的事占着（更新下载 / 安装交接、退出中）：返回原因文案，空 = 没有。 */
  readonly busyReason: () => string | null
  /** 系统位置（%SystemRoot%、Program Files、ProgramData…）。 */
  readonly protectedRoots: () => readonly string[]
  readonly facts: RelocationFacts
  /** 一棵树按迁移规则要占多少字节（读不到抛错）。 */
  readonly measure: (dir: string) => Promise<number>
  /** 目录选择器；取消返回 undefined。 */
  readonly pickParent: () => Promise<string | undefined>
  /** 正在跑的会话数；null = 查不到。 */
  readonly runningSessions: () => Promise<number | null>
  /** 让用户确认整份计划；false = 取消。 */
  readonly confirmPlan: (plan: RelocationPlan) => Promise<boolean>
  /** 当前生效的更新通道与备用通道（找同版本清单用）。 */
  readonly feeds: () => readonly (string | null)[]
  /** 抓清单文本。 */
  readonly fetchText: (url: string, signal: AbortSignal) => Promise<string>
  /** 下载资产到 destPath，返回实际字节数与 SHA-256。 */
  readonly downloadAsset: (
    asset: UpdateAsset,
    destPath: string,
    signal: AbortSignal,
    onProgress: (bytes: number) => void,
  ) => Promise<{ bytes: number; sha256: string }>
  /** 安装器在本机留的同版本安装包（{@link keptInstallerPath}）；不在 Windows 上为 null。 */
  readonly keptInstaller: string | null
  /** 安装包自带的版本资源：产品名与产品版本；读不到为 null。 */
  readonly installerIdentity: (path: string) => Promise<{ productName: string; productVersion: string } | null>
  /**
   * 找不到发布清单时问用户要不要选一个本地安装包；返回路径或 undefined。
   * @param reason - 为什么在线取不到（给用户看）。
   */
  readonly offerLocalInstaller: (reason: string) => Promise<string | undefined>
  /** 本地安装包无法与清单核对：把 SHA-256 与版本摆给用户确认。 */
  readonly confirmLocalInstaller: (path: string, sha256: string) => Promise<boolean>
  /** 最坏情况弹框的文案（按界面语言，含副本与数据位置）。 */
  readonly failureMessages: (record: RelocationRecord) => RelocationHelperConfig['messages']
  /** 启动助手（spawn 确认成功才返回；失败抛错）。返回能把它停掉的句柄。 */
  readonly spawnHelper: (scriptPath: string, configPath: string) => Promise<{ kill: () => void }>
  /** 有序退出（与托盘「退出」同一条路径）；清理失败会抛错、应用不退出。 */
  readonly quit: () => Promise<void>
  /** 给助手留一条事实（events.md）。 */
  readonly note: (home: string, title: string, sections: readonly (readonly [string, string])[]) => void
  readonly text: (key: string, vars?: Record<string, string>) => string
  readonly zh: () => boolean
  readonly broadcast: () => void
}

/** 搬家执行面。 */
export interface RelocationControl {
  readonly isRunning: () => boolean
  readonly view: () => RelocationView
  /** 选目标、确认、开搬。 */
  readonly relocate: () => Promise<void>
  /** 上次程序没搬成：用同一个目标再交给助手一次（目标重新核过）。 */
  readonly retry: () => Promise<void>
  /** 不搬程序了：清掉记录与副本（已搬的数据留在新位置）。 */
  readonly dismiss: () => void
  /** 下载安装包期间取消。 */
  readonly cancel: () => void
  /** 启动时对照记录与助手状态确认上一次搬家的结果。 */
  readonly resolveOnStartup: () => void
}

/**
 * 建一个搬家执行面。
 * @param deps - 宿主能力。
 * @returns 搬家执行面。
 */
export function createRelocationControl(deps: RelocationControlDeps): RelocationControl {
  let phase: RelocationView['phase'] = 'idle'
  let progress: { bytes: number; total: number } | null = null
  let last: RelocationView['last'] = null
  let abort: AbortController | null = null
  const cacheDir = join(deps.userDataDir, RELOCATION_DIR_NAME)
  const installerCopy = join(cacheDir, `DeepSeekGUI-Setup-${deps.appVersion}.exe`)
  const currentAppDir = (): string => dirname(deps.execPath)

  const unsupported = (): RelocationView['unsupported'] => (!deps.win ? 'not-windows' : !deps.packaged ? 'not-packaged' : null)

  const view = (): RelocationView => ({ unsupported: unsupported(), appDir: currentAppDir(), phase, progress, last })

  const setPhase = (next: RelocationView['phase']): void => {
    phase = next
    if (next !== 'downloading') progress = null
    deps.broadcast()
  }

  const fileSha256 = async (path: string): Promise<string> => sha256Stream(createReadStream(path))

  /** 安装包自带的产品名与版本要对得上：改了名字的旧包、别的产品都过不去。 */
  const assertIdentity = async (path: string): Promise<void> => {
    const identity = await deps.installerIdentity(path)
    if (identity === null || identity.productName !== PRODUCT_NAME || identity.productVersion !== deps.appVersion) {
      throw new Error(deps.text('error.relocation-installer-identity', {
        expected: `${PRODUCT_NAME} ${deps.appVersion}`,
        actual: identity === null ? '?' : `${identity.productName} ${identity.productVersion}`,
      }))
    }
  }

  /**
   * 取得同版本安装包并放进受控副本：先用安装器留在本机的那份，没有再按清单在线下载并核对，
   * 都取不到才问用户要本地文件。
   * @param signal - 取消。
   * @returns 安装包；用户放弃返回 null。
   */
  const acquireInstaller = async (signal: AbortSignal): Promise<RelocationInstaller | null> => {
    const failures: string[] = []
    mkdirSync(cacheDir, { recursive: true })
    if (deps.keptInstaller !== null && existsSync(deps.keptInstaller)) {
      try {
        rmSync(installerCopy, { force: true })
        copyFileSync(deps.keptInstaller, installerCopy)
        await assertIdentity(installerCopy)
        return { path: installerCopy, sha256: await fileSha256(installerCopy), source: 'kept' }
      } catch (error) {
        rmSync(installerCopy, { force: true })
        failures.push(`${deps.keptInstaller}: ${String(error instanceof Error ? error.message : error)}`)
      }
    }
    for (const url of relocationManifestCandidates(deps.appVersion, deps.feeds())) {
      signal.throwIfAborted()
      let asset: UpdateAsset
      try {
        const manifest = parseUpdateManifest(await deps.fetchText(url, signal), deps.zh())
        // 只要与当前运行版本一模一样的安装包：搬家不是升级，版本不能顺手变。
        if (manifest.latestVersion !== deps.appVersion) {
          failures.push(`${url}: ${manifest.latestVersion}`)
          continue
        }
        const picked = selectPlatformAsset(manifest.assets, 'win32')
        if (!picked.ok) {
          failures.push(`${url}: no Windows asset`)
          continue
        }
        asset = picked.asset
      } catch (error) {
        if (signal.aborted) throw error
        failures.push(`${url}: ${String(error instanceof Error ? error.message : error)}`)
        continue
      }
      const partial = `${installerCopy}.partial`
      rmSync(partial, { force: true })
      progress = { bytes: 0, total: asset.size }
      deps.broadcast()
      const { bytes, sha256 } = await deps.downloadAsset(asset, partial, signal, (done) => {
        progress = { bytes: done, total: asset.size }
        deps.broadcast()
      })
      if (bytes !== asset.size || !verifyDigest(asset.sha256, sha256).ok) {
        rmSync(partial, { force: true })
        throw new Error(deps.text('error.relocation-installer-digest'))
      }
      rmSync(installerCopy, { force: true })
      renameSync(partial, installerCopy)
      await assertIdentity(installerCopy)
      return { path: installerCopy, sha256, source: 'manifest' }
    }
    const local = await deps.offerLocalInstaller(failures.join('\n'))
    if (local === undefined) return null
    // 本地文件复制进受控副本再核：交接时执行的是这份副本，原文件之后被换掉也无关。
    rmSync(installerCopy, { force: true })
    copyFileSync(local, installerCopy)
    await assertIdentity(installerCopy)
    const sha256 = await fileSha256(installerCopy)
    if (!await deps.confirmLocalInstaller(local, sha256)) {
      rmSync(installerCopy, { force: true })
      return null
    }
    return { path: installerCopy, sha256, source: 'local' }
  }

  /**
   * 交接：再核一次副本，写记录与助手文件，启动助手，然后有序退出。
   * 退出失败就停掉助手、删记录——安装器一步都还没走（助手只在应用进程全部退出后才动手）。
   */
  const handOff = async (record: RelocationRecord): Promise<void> => {
    if (!existsSync(record.installerPath) || await fileSha256(record.installerPath) !== record.installerSha256) {
      throw new Error(deps.text('error.relocation-installer-changed'))
    }
    await assertIdentity(record.installerPath)
    const statePath = join(cacheDir, RELOCATION_HELPER_STATE_NAME)
    rmSync(statePath, { force: true })
    const scriptPath = join(cacheDir, RELOCATION_HELPER_SCRIPT_NAME)
    const configPath = join(cacheDir, RELOCATION_HELPER_CONFIG_NAME)
    const config: RelocationHelperConfig = {
      parentPid: deps.pid,
      installer: record.installerPath,
      sha256: record.installerSha256,
      fromAppDir: record.fromAppDir,
      toAppDir: record.toAppDir,
      exeName: basename(deps.execPath),
      statePath,
      messages: deps.failureMessages(record),
    }
    writeFileSync(scriptPath, RELOCATION_HELPER_SCRIPT, 'utf8')
    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8')
    writeRelocationRecord(deps.userDataDir, record)
    setPhase('handing-off')
    let helper: { kill: () => void }
    try {
      helper = await deps.spawnHelper(scriptPath, configPath)
    } catch (error) {
      clearRelocationRecord(deps.userDataDir)
      last = { kind: 'spawn-failed', root: record.root, appDir: record.toAppDir, dataMoved: record.dataMoved, helperPhase: null }
      setPhase('idle')
      throw new Error(deps.text('error.relocation-spawn-failed', { reason: String(error instanceof Error ? error.message : error) }))
    }
    try {
      await deps.quit()
    } catch (error) {
      helper.kill()
      clearRelocationRecord(deps.userDataDir)
      last = { kind: 'quit-failed', root: record.root, appDir: record.toAppDir, dataMoved: record.dataMoved, helperPhase: null }
      setPhase('idle')
      throw error
    }
  }

  let running = false
  const guard = (): void => {
    const reason = unsupported()
    if (reason !== null) throw new Error(deps.text(`error.relocation-${reason}`))
    if (running) throw new Error(deps.text('error.relocation-busy'))
    if (deps.migration.isRunning()) throw new Error(deps.text('error.migration-busy'))
    const busy = deps.busyReason()
    if (busy !== null) throw new Error(busy)
  }

  /** 拿安装包这一段：可取消；取消或用户放弃返回 null。 */
  const obtain = async (): Promise<RelocationInstaller | null> => {
    abort = new AbortController()
    setPhase('downloading')
    try {
      return await acquireInstaller(abort.signal)
    } catch (error) {
      if (abort.signal.aborted) return null
      throw error
    } finally {
      abort = null
      setPhase('idle')
    }
  }

  const performRelocation = async (): Promise<void> => {
    const pending = readRelocationRecord(deps.userDataDir)
    if (pending.record !== null || pending.error !== null) throw new Error(deps.text('error.relocation-pending'))
    // 只移动数据那一趟还没走完：再搬一次会用新的迁移清单盖掉那一趟的（旧副本从此没人认领）。
    const data = deps.migration.view()
    if (data.awaitingRestart !== null || data.verifyFailed !== null || data.pendingCleanup !== null) {
      throw new Error(deps.text('error.relocation-data-unsettled'))
    }
    const picked = await deps.pickParent()
    if (picked === undefined || picked === '') return
    const parent = realpathSync(picked)
    const home = deps.home()
    const homeIsManaged = home.kind === 'managed'
    let requiredBytes: number
    try {
      requiredBytes = await deps.measure(currentAppDir()) + (homeIsManaged ? await deps.measure(home.path) : 0)
    } catch (error) {
      throw new Error(deps.text('error.relocation-measure-failed', { reason: String(error instanceof Error ? error.message : error) }))
    }
    const verdict = checkRelocationTarget({
      parent, currentAppDir: currentAppDir(), currentHome: home.path, homeIsManaged, requiredBytes,
      protectedRoots: deps.protectedRoots(), win: deps.win, facts: deps.facts,
    })
    if (!verdict.ok) throw new Error(deps.text(`error.relocation-${verdict.reason}`, { path: verdict.detail }))
    const { layout } = verdict
    const plan: RelocationPlan = {
      layout, currentAppDir: currentAppDir(), currentHome: home.path, homeKind: home.kind,
      runningSessions: await deps.runningSessions(),
    }
    if (!await deps.confirmPlan(plan)) return

    // 1. 先拿安装包：这一步不停任何服务，拿不到就什么都没动。
    const installer = await obtain()
    if (installer === null) return

    // 下载期间目标可能变了：动手前按当前事实再判一次（空间也重算）。
    const again = checkRelocationTarget({
      parent, currentAppDir: currentAppDir(), currentHome: home.path, homeIsManaged, requiredBytes,
      protectedRoots: deps.protectedRoots(), win: deps.win, facts: deps.facts,
    })
    if (!again.ok) throw new Error(deps.text(`error.relocation-${again.reason}`, { path: again.detail }))

    // 2. 搬数据（Managed Home）：现有迁移负责停服务、复制、校验、切指向与失败回滚。
    const rootExisted = existsSync(layout.root)
    let dataMoved = false
    if (homeIsManaged) {
      setPhase('migrating')
      mkdirSync(layout.root, { recursive: true })
      try {
        await deps.migration.migrate(layout.root)
        const same = (left: string, right: string): boolean => (deps.win ? left.toLowerCase() === right.toLowerCase() : left === right)
        dataMoved = same(deps.home().path, layout.home)
        if (!dataMoved) throw new Error(deps.text('error.migration-switch-failed', { path: layout.home }))
      } catch (error) {
        if (!rootExisted) {
          try { if (readdirSync(layout.root).length === 0) rmdirSync(layout.root) } catch { /* 留着一个空目录无害 */ }
        }
        setPhase('idle')
        throw error
      }
    }

    // 3. 写记录、交给助手、退出。
    const record: RelocationRecord = {
      schemaVersion: 1,
      startedAt: new Date().toISOString(),
      fromAppDir: currentAppDir(),
      toAppDir: layout.appDir,
      root: layout.root,
      version: deps.appVersion,
      dataMoved,
      fromHome: home.path,
      installerPath: installer.path,
      installerSha256: installer.sha256,
    }
    deps.note(deps.home().path, deps.zh() ? '程序与数据开始整体搬家' : 'Moving the program and data together', [
      [deps.zh() ? '发生了什么' : 'What happened', deps.zh()
        ? `用户选择把 DeepSeekGUI 整体搬到 ${layout.root}。${dataMoved ? `托管数据已复制并逐项校验到 ${layout.home}，启动指向已切过去；` : `当前用的是用户自己的 Existing Home（${home.path}），它不随程序搬；`}接下来应用退出，由一个短时助手在应用进程全部退出后运行同一版本（${deps.appVersion}）的安装器，把程序装到 ${layout.appDir}，旧程序目录 ${currentAppDir()} 由安装器移除。`
        : `The user chose to move DeepSeekGUI to ${layout.root}. ${dataMoved ? `The managed data was copied to ${layout.home}, verified item by item, and the launch target now points there; ` : `The current Home is the user's own Existing Home (${home.path}) and does not move with the program; `}next the app quits, and a short-lived helper runs the installer for the same version (${deps.appVersion}) only after every app process has exited, putting the program into ${layout.appDir}; the installer removes the old program folder ${currentAppDir()}.`],
      [deps.zh() ? '如果用户问起' : 'If the user asks', deps.zh()
        ? '这是用户自己发起的搬家。旧数据副本在新位置启动核对通过后，由用户在「数据位置」里确认删除。'
        : 'The user started this move. The old data copy is deleted only after the new location passes its startup check and the user confirms it under Data location.'],
    ])
    await handOff(record)
  }

  const relocate = async (): Promise<void> => {
    guard()
    running = true
    try { await performRelocation() } finally { running = false; if (phase !== 'handing-off') setPhase('idle') }
  }

  const retry = async (): Promise<void> => {
    guard()
    const { record, error } = readRelocationRecord(deps.userDataDir)
    if (record === null) throw new Error(error ?? deps.text('error.relocation-nothing-to-retry'))
    // 允许继续自己的目标，但按当前事实重新核：链接、陌生内容、系统位置、可写。
    const verdict = checkRetryTarget({
      root: record.root, appDir: record.toAppDir, protectedRoots: deps.protectedRoots(), win: deps.win, facts: deps.facts,
    })
    if (!verdict.ok) throw new Error(deps.text(`error.relocation-${verdict.reason}`, { path: verdict.detail }))
    running = true
    try {
      const installer = await obtain()
      if (installer === null) return
      await handOff({
        ...record,
        startedAt: new Date().toISOString(),
        fromAppDir: currentAppDir(),
        version: deps.appVersion,
        installerPath: installer.path,
        installerSha256: installer.sha256,
      })
    } finally {
      running = false
      if (phase !== 'handing-off') setPhase('idle')
    }
  }

  const dismiss = (): void => {
    if (running) throw new Error(deps.text('error.relocation-busy'))
    clearRelocationRecord(deps.userDataDir)
    rmSync(cacheDir, { recursive: true, force: true })
    last = null
    deps.broadcast()
  }

  const cancel = (): void => { abort?.abort() }

  const resolveOnStartup = (): void => {
    const { record, error } = readRelocationRecord(deps.userDataDir)
    const helper = readHelperState(deps.userDataDir)
    if (record === null) {
      if (error !== null) last = { kind: 'record-unreadable', root: '', appDir: '', dataMoved: false, helperPhase: helper?.phase ?? null }
      return
    }
    const outcome = relocationOutcome(record, deps.execPath, deps.win)
    if (outcome === 'not-moved') {
      // 记录与副本都留着：用户可以重试或放弃。助手状态说明了为什么没搬成。
      last = { kind: 'not-moved', root: record.root, appDir: record.toAppDir, dataMoved: record.dataMoved, helperPhase: helper?.phase ?? null }
      return
    }
    clearRelocationRecord(deps.userDataDir)
    rmSync(cacheDir, { recursive: true, force: true })
    last = { kind: outcome, root: record.root, appDir: outcome === 'moved' ? record.toAppDir : currentAppDir(), dataMoved: record.dataMoved, helperPhase: helper?.phase ?? null }
    const zh = deps.zh()
    deps.note(deps.home().path, outcome === 'moved'
      ? (zh ? '程序已搬到新位置' : 'The program now runs from its new location')
      : (zh ? '程序运行位置与搬家计划不同' : 'The program runs from a different location than planned'), [
      [zh ? '发生了什么' : 'What happened', outcome === 'moved'
        ? (zh ? `安装器已把程序装到 ${record.toAppDir}，这次启动就是从那里启动的。桌面、开始菜单和卸载入口都指向新位置，以后的更新也装到那里。` : `The installer placed the program in ${record.toAppDir}, and this launch came from there. Desktop, Start menu and uninstall entries point to the new location, and future updates install there.`)
        : (zh ? `搬家计划的目标是 ${record.toAppDir}，但这次是从 ${currentAppDir()} 启动的（多半是手动装到了别处）。记录已清除，不再提示。` : `The planned target was ${record.toAppDir}, but this launch came from ${currentAppDir()} (likely a manual install elsewhere). The record was cleared and will not be shown again.`)],
      [zh ? '现在的状态' : 'Current state', record.dataMoved
        ? (zh ? '数据那一半由「数据位置」的重启核对接手：核对通过后才会提示删除旧副本。' : 'The data half is handled by the Data location startup check: deleting the old copy is offered only after it passes.')
        : (zh ? '这次没有搬数据（用的是用户自己的 Existing Home）。' : 'No data was moved this time (the user\'s own Existing Home is in use).')],
    ])
  }

  return { isRunning: () => running, view, relocate, retry, dismiss, cancel, resolveOnStartup }
}
