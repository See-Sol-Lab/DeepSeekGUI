/**
 * Managed Home 迁移的执行面（B6-P7）。
 *
 * 事务顺序是固定的，每一步都为「出错时旧数据仍然完好」服务：
 * 校验目标 → 停服务 → 收集清单 → 复制并逐项校验 → 写清单 → 切指向 → 起不来就回滚。
 * 用户选择目标之外没有任何岔路口。
 *
 * 两条不可让步的规矩：
 *
 * 1. **同一个进程里绝不宣布迁移成功。** 切指向后清单钉在 `awaiting-restart`，
 *    因为这次运行还攥着旧的解析结果与文件句柄，读得通证明不了什么。真正的
 *    考验是整个应用重启一遍、从零解析新位置（句芒 2026-09-10 定）。
 * 2. **删旧副本不可逆，所以要过两道闸。** 面板只在 `verified` 时给入口，
 *    而 {@link MigrationControl.cleanup} 自己再查一次——命令可以从别处进来。
 *
 * 服务控制、目录选择与文案都经注入面传入，所以这个模块不依赖 Electron：
 * 「失败了旧数据还在不在」这件事可以在单测里直接验证，不必真搬一次家。
 * @module @see-sol-lab/deepseekgui/migration-control
 */

import { existsSync, realpathSync } from 'node:fs'
import { appendDesktopEvent } from './desktop-events.ts'
import { formatStampLocal } from './diagnostics-service.ts'
import {
  awaitingRestartOf,
  checkMigrationTarget,
  collectMigrationItems,
  copyAndVerifyItems,
  deleteOldCopy,
  manifestAfterCleanup,
  manifestAfterVerification,
  nodeMigrationFacts,
  pendingCleanupOf,
  readMigrationManifest,
  removeTargetCopy,
  totalBytesOf,
  verificationFailureOf,
  verifyMigratedHome,
  writeMigrationManifest,
  type MigrationManifest,
  type MigrationItem,
} from './migration.ts'
import type { DataHomeView } from './control-model.ts'

/** 目标判定失败 → 字典文案键（拒绝理由各自成文，绝不合并成一句"失败"）。 */
const MIGRATION_REASON_KEYS = {
  'same-as-source': 'error.migration-same-as-source',
  'target-inside-source': 'error.migration-target-inside-source',
  'source-inside-target': 'error.migration-source-inside-target',
  'target-not-writable': 'error.migration-target-not-writable',
  'not-enough-space': 'error.migration-not-enough-space',
  'target-not-empty': 'error.migration-target-not-empty',
} as const

/** 当前 launcher selection 里与迁移有关的部分。 */
export interface MigrationHomeState {
  /** 'managed' 之外一律拒绝迁移——Existing Home 是用户自己的目录。 */
  readonly homeKind: 'managed' | 'existing'
  /** 当前 Home 的绝对路径。 */
  readonly homePath: string
  /** 当前 profile。 */
  readonly profile: string
}

/** 执行面要用到的宿主能力。 */
export interface MigrationControlDeps {
  /** 现读现取的 Home 状态。 */
  readonly home: () => MigrationHomeState
  /** 把当前 selection 记为 lastKnownGood；switchTo 失败时靠它回退。 */
  readonly markLastKnownGood: () => void
  /** 切到新 Home 并返回切换后是否在跑。 */
  readonly switchHome: (targetHome: string, profile: string) => Promise<boolean>
  /** 停 Harness（复制期间必须已停）。 */
  readonly stopHarness: () => Promise<void>
  /** 复制失败后尽力恢复服务。 */
  readonly startHarness: () => Promise<void>
  /** 弹目录选择器；返回用户选的父目录，取消返回 undefined。 */
  readonly pickTargetParent: () => Promise<string | undefined>
  /** 取一条本地化文案。 */
  readonly text: (key: string, vars?: Record<string, string>) => string
  /** 事实变化后推送控制模型。 */
  readonly broadcast: () => void
  /** 当前是否中文界面（事件文本的语言）。 */
  readonly zh: () => boolean
}

/** 迁移执行面。 */
export interface MigrationControl {
  /** Whether a migration owns the Home switch and file-copy operation. */
  readonly isRunning: () => boolean
  /** 数据位置事实：当前位置 + 上次迁移未清理的旧副本。 */
  readonly view: () => DataHomeView
  /** 把 Managed Home 搬到用户选择的位置。 */
  readonly migrate: () => Promise<void>
  /** 启动时的核对：清单说「等重启核对」就按它逐项验一遍。 */
  readonly verifyOnStartup: () => void
  /** 清理上次迁移留下的旧副本。 */
  readonly cleanup: () => void
}

/**
 * 建一个迁移执行面。
 * @param deps - 宿主能力。
 * @returns 迁移执行面。
 */
export function createMigrationControl(deps: MigrationControlDeps): MigrationControl {
  /**
   * 迁移清单的内存缓存。清单只在迁移/清理后变化，绝不每次广播都读盘；
   * home 变了（切换/迁移）即失效重读。
   */
  let cache: { home: string; manifest: MigrationManifest | null } | null = null
  const invalidate = (): void => { cache = null }

  const manifestOf = (homePath: string): MigrationManifest | null => {
    if (cache === null || cache.home !== homePath) {
      cache = { home: homePath, manifest: readMigrationManifest(homePath).manifest }
    }
    return cache.manifest
  }

  /**
   * 给会话里的助手留一条事实（`<home>/deepseekgui/events.md`）。
   *
   * 迁移之前这条路什么都不写：助手是靠"全局记忆的路径字符串变了"自己反推出
   * 搬家的，还被清单里 `cleanup.status = pending` + `remaining = []` 迷惑，以为
   * 卡住了（2026-09-11 人工测试 #17，DS 自己排查报上来的）。它本来就读这个
   * 文件，写清楚它就不用猜。
   * @param home - 事件该落在哪个 Home（切指向之后是新 Home）。
   * @param title - 一句话标题。
   * @param sections - 三段式正文。
   */
  const note = (home: string, title: string, sections: readonly (readonly [string, string])[]): void => {
    appendDesktopEvent(home, { at: formatStampLocal(new Date().toISOString()), title, sections }, deps.zh())
  }

  const view = (): DataHomeView => {
    const { homePath, homeKind } = deps.home()
    const manifest = manifestOf(homePath)
    return {
      homePath,
      homeKind,
      awaitingRestart: awaitingRestartOf(manifest),
      verifyFailed: verificationFailureOf(manifest),
      pendingCleanup: pendingCleanupOf(manifest),
    }
  }

  let migrating = false
  const performMigration = async (): Promise<void> => {
    const { homeKind, homePath: sourceHome, profile } = deps.home()
    if (homeKind !== 'managed') throw new Error(deps.text('error.migration-existing-home'))
    if (!existsSync(sourceHome)) {
      throw new Error(deps.text('error.migration-source-missing', { path: sourceHome }))
    }
    const picked = await deps.pickTargetParent()
    if (picked === undefined || picked === '') return
    const current = deps.home()
    if (current.homeKind !== homeKind || current.homePath !== sourceHome || current.profile !== profile) {
      throw new Error(deps.text('error.migration-selection-changed'))
    }
    const targetParent = realpathSync(picked)
    // 0. 目标的结构性判定（同源、包含、非空、不可写）不需要清单，先做——
    // 明显错的目标不值得停一次服务。
    const check = (requiredBytes: number): string => {
      const verdict = checkMigrationTarget({ sourceHome: realpathSync(sourceHome), targetParent, requiredBytes, facts: nodeMigrationFacts })
      if (!verdict.ok) throw new Error(deps.text(MIGRATION_REASON_KEYS[verdict.reason], { path: verdict.detail }))
      return verdict.targetHome
    }
    check(0)
    // 1. 停掉会写这些数据的服务，**然后**才收集清单：Harness 活着的时候会话
    // 日志还在追加、投影缓存还在落盘，先算的摘要复制完必然对不上（假失败）；
    // 收集之后新建的文件更是根本不在清单里——不复制，还会随旧副本一起清掉。
    await deps.stopHarness()
    let items: MigrationItem[]
    let targetHome: string | undefined
    try {
      const current = deps.home()
      if (current.homeKind !== homeKind || current.homePath !== sourceHome || current.profile !== profile) {
        throw new Error(deps.text('error.migration-selection-changed'))
      }
      items = collectMigrationItems(sourceHome)
      targetHome = check(totalBytesOf(items))
      copyAndVerifyItems(items, sourceHome, targetHome)
      writeMigrationManifest(targetHome, {
        schemaVersion: 1, completedAt: new Date().toISOString(), sourceHome, targetHome, items,
        verification: { status: 'awaiting-restart', checkedAt: null, failures: [] },
        cleanup: { status: 'pending', remaining: [] },
      })
      deps.markLastKnownGood()
      if (!await deps.switchHome(targetHome, profile)) {
        throw new Error(deps.text('error.migration-switch-failed', { path: targetHome }))
      }
    } catch (error) {
      // Keep a target which has become active; never erase a live Home after a late switch error.
      const failures: unknown[] = [error]
      try {
        if (targetHome !== undefined && deps.home().homePath !== targetHome) removeTargetCopy(targetHome)
      } catch (cleanupError) { failures.push(cleanupError) }
      try { await deps.startHarness() } catch (restartError) { failures.push(restartError) }
      if (failures.length === 1) throw error
      throw new AggregateError(failures, failures.map(value => String(value instanceof Error ? value.message : value)).join('; '))
    }
    // 5. 到此为止：指向已切、旧副本完好、清单等着重启核对。
    const zh = deps.zh()
    note(targetHome, zh ? '数据目录已迁移' : 'The data directory was migrated', [
      [
        zh ? '发生了什么' : 'What happened',
        zh
          ? `用户在设置里把 DeepSeekGUI 的数据目录从 ${sourceHome} 搬到了 ${targetHome}：共 ${String(items.length)} 项，复制后逐项按大小与 SHA-256 校验通过，然后把启动指向切到了新位置。复制期间 Harness 是停止的，所以没有任何写入会落到旧位置或丢失。`
          : `The user moved the DeepSeekGUI data directory from ${sourceHome} to ${targetHome} in Settings: ${String(items.length)} items were copied, each verified by size and SHA-256, and the launch target now points at the new location. The Harness was stopped during the copy, so no write could land in the old location or be lost.`,
      ],
      [
        zh ? '现在的状态' : 'Current state',
        zh
          ? `旧副本原样保留在 ${sourceHome}，等应用重启后逐项核对新位置；核对通过后设置页会出现"删除旧副本"，由用户确认后才删。清单 migration-manifest.json 里 cleanup.status = pending 的意思就是"等用户确认删除"，remaining 只在删了一半时才会有内容——这不是卡住。`
          : `The old copy stays untouched at ${sourceHome} until the app restarts and re-checks the new location; after that check passes, Settings offers "delete the old copy", and nothing is deleted before the user confirms. In migration-manifest.json, cleanup.status = pending means "awaiting the user confirmation"; remaining is only filled after a partial deletion. This is not a stuck state.`,
      ],
      [
        zh ? '如果用户问起' : 'If the user asks',
        zh
          ? '这是用户自己发起的搬家，不是故障。会话、记忆、设置都已经在新位置，路径变了是正常的；旧位置暂时还在，删不删由用户决定。'
          : 'This was a move the user started, not a failure. Sessions, memory and settings are all at the new location, so changed paths are expected; the old location still exists for now, and the user decides whether to delete it.',
      ],
    ])
    invalidate()
    deps.broadcast()
  }

  const migrate = async (): Promise<void> => {
    if (migrating) throw new Error(deps.text('error.migration-busy'))
    migrating = true
    try { await performMigration() } finally { migrating = false }
  }

  const verifyOnStartup = (): void => {
    const homePath = deps.home().homePath
    const { manifest } = readMigrationManifest(homePath)
    if (manifest === null || manifest.verification.status !== 'awaiting-restart') return
    const result = verifyMigratedHome(homePath, manifest.items)
    if (!result.ok) {
      const zh = deps.zh()
      note(homePath, zh ? '迁移后的核对没有通过' : 'The post-migration check failed', [
        [
          zh ? '发生了什么' : 'What happened',
          zh
            ? `重启后逐项核对新位置 ${homePath}，有 ${String(result.failures.length)} 项缺失或读不到：${result.failures.slice(0, 5).join('、')}${result.failures.length > 5 ? '…' : ''}。`
            : `After the restart, ${String(result.failures.length)} item(s) at ${homePath} were missing or unreadable: ${result.failures.slice(0, 5).join(', ')}${result.failures.length > 5 ? '…' : ''}.`,
        ],
        [
          zh ? '现在的状态' : 'Current state',
          zh
            ? `旧副本仍完整保留在 ${manifest.sourceHome}，不会提示删除。用户可以在设置里切回旧位置。`
            : `The old copy is kept intact at ${manifest.sourceHome} and deletion will not be offered. The user can switch back to the old location in Settings.`,
        ],
        [
          zh ? '如果用户问起' : 'If the user asks',
          zh
            ? '不要建议删除旧副本；先确认新位置的磁盘还在、路径可读，再考虑重新迁移。'
            : 'Do not suggest deleting the old copy; first confirm the disk of the new location is present and readable, then consider migrating again.',
        ],
      ])
    }
    try {
      writeMigrationManifest(homePath, manifestAfterVerification(manifest, result))
    } catch (error) {
      // 写不回去就保持 awaiting-restart：下次启动再核对一次。绝不因为写
      // 失败而放行删除入口。
      console.error(`[deepseekgui] 迁移核对结果写回失败: ${String(error instanceof Error ? error.message : error)}`)
      return
    }
    invalidate()
    deps.broadcast()
  }

  const cleanup = (): void => {
    if (migrating) throw new Error(deps.text('error.migration-busy'))
    const homePath = deps.home().homePath
    const { manifest, error } = readMigrationManifest(homePath)
    if (manifest === null) {
      // fail closed：清单缺失/损坏时不提示、不删除。
      if (error !== null) console.error(`[deepseekgui] 迁移清单不可读，已跳过清理: ${error}`)
      return
    }
    // 没经过重启核对就不许删：面板在这个状态下本就不给入口，这里是第二道
    // 闸——命令可以从别处进来，而删除是不可逆的。
    if (manifest.cleanup.status === 'done') return
    if (manifest.verification.status !== 'verified') {
      throw new Error(deps.text('error.migration-not-verified'))
    }
    if (!existsSync(manifest.sourceHome)) {
      invalidate()
      deps.broadcast()
      return
    }
    const outcome = deleteOldCopy(manifest)
    writeMigrationManifest(homePath, manifestAfterCleanup(manifest, outcome))
    const zh = deps.zh()
    const leftBehind = outcome.failed.slice(0, 3).map(entry => entry.path)
    note(homePath, zh ? '迁移的旧副本已清理' : 'The old migration copy was cleaned up', [
      [
        zh ? '发生了什么' : 'What happened',
        zh
          ? `用户确认后删除了 ${manifest.sourceHome} 里清单列出的旧副本：删掉 ${String(outcome.deleted.length)} 项${outcome.failed.length === 0 ? '' : `，${String(outcome.failed.length)} 项没删掉（${leftBehind.join('、')}）`}。只删清单里的路径，链接只摘链接点，清单之外的文件一个没动。`
          : `After the user confirmed, the old copy listed in the manifest was removed from ${manifest.sourceHome}: ${String(outcome.deleted.length)} item(s) deleted${outcome.failed.length === 0 ? '' : `, ${String(outcome.failed.length)} left behind (${leftBehind.join(', ')})`}. Only manifest paths were removed, links were unlinked as links, and nothing outside the manifest was touched.`,
      ],
      [
        zh ? '现在的状态' : 'Current state',
        zh
          ? (outcome.failed.length === 0 ? `搬家彻底完成，数据只在 ${homePath} 一处。` : `${homePath} 是唯一有效位置；旧位置残留的那几项需要用户自己处理，应用不会再自动重试。`)
          : (outcome.failed.length === 0 ? `The move is complete; the data lives only at ${homePath}.` : `${homePath} is the only active location; the items left in the old location need the user to handle them, and the app will not retry on its own.`),
      ],
      [
        zh ? '如果用户问起' : 'If the user asks',
        zh ? '这是用户自己确认的清理，不是故障。' : 'This cleanup was confirmed by the user; it is not a failure.',
      ],
    ])
    invalidate()
    deps.broadcast()
    if (outcome.failed.length > 0) {
      throw new Error(deps.text('error.migration-cleanup-partial', { count: String(outcome.failed.length) }))
    }
  }

  return { view, migrate, verifyOnStartup, cleanup, isRunning: () => migrating }
}
