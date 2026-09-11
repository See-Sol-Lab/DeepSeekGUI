/**
 * Desktop Chrome 的可序列化控制模型与封闭命令联合。
 * ControlModel 由 main 单处构建（launcher state + controller 七相状态 +
 * 只读 discovery 的快照），经窄 preload 推给受信任的 Chrome renderer；
 * renderer 不读写 launcher JSON、不 spawn、不自行判断 recovery。
 * DesktopControlCommand 是封闭联合：parseControlCommand 在 main 侧做
 * IPC 输入边界验证，未知类型、多余字段与非法 profile 名一律拒绝。
 * 纯 Node 模块，不依赖 Electron，便于单元测试。
 * @module @see-sol-lab/deepseekgui/control-model
 */

import type { HarnessStatus } from './harness-controller.ts'
import {
  isValidProfileName,
  type BootFailure,
  type BootStage,
  type HarnessSelection,
  type LauncherStateV1,
} from './launcher-state.ts'
import { redactSecrets } from './redact.ts'
import type { DiscoveredProfile, ProfileDiscoveryV1 } from './profile-discovery.ts'
import { isPluginAction, type PluginAction, type PluginInventory } from './plugin-service.ts'
import type { PermissionsView } from './permission-view.ts'
import type { RecoveryJournalState } from './plugin-recovery.ts'
import type { SessionPressure } from './session-pressure.ts'

/** 把 home 引用渲染成可读文本。 */
export function homeKindLabel(home: HarnessSelection['home']): string {
  return home.kind === 'managed' ? 'Managed' : 'Existing'
}

/** 把一条 selection 渲染成可读文本（Pending 行与恢复详情用）。 */
export function selectionLabel(selection: HarnessSelection): string {
  return selection.home.kind === 'managed'
    ? `Managed / ${selection.profile}`
    : `Existing ${selection.home.path} / ${selection.profile}`
}

/** Chrome 面板里一个 profile 条目的展示事实。 */
interface DesktopProfileItem {
  name: string
  staticStatus: 'web-capable' | 'headless' | 'candidate' | 'malformed'
  /** 是当前 active profile（勾选显示）。 */
  active: boolean
  /** malformed 的脱敏限长原因；其余状态不存在该字段。 */
  error?: string
  /** 该 profile 是最近一次 boot 失败的目标时，失败阶段（boot-failing 标记）。 */
  bootFailingStage?: BootStage
}

/** 状态胶囊/运行状态行的七相映射（running 拆出 recovered）。 */
export type DesktopRuntimeStatus =
  | { phase: 'idle' }
  | { phase: 'stopping' }
  | { phase: 'starting'; profile: string }
  | { phase: 'switching'; profile: string }
  | { phase: 'recovering'; profile: string }
  | { phase: 'running'; profile: string; recovered: boolean }
  | { phase: 'failed'; stage: BootStage }

/** Plugin Manager 面板里一次运行中/已结算的操作。 */
export interface PluginOperationView {
  action: PluginAction
  profile: string
  spec: string | null
  /** 当前步骤：运行中 / 验证中 / 完成 / 失败 / 已取消。 */
  step: 'running' | 'post-check' | 'done' | 'failed' | 'cancelled'
  /** 已脱敏限长的流式输出（stdout/stderr 合并，最新在上层渲染）。 */
  output: string[]
  /** 最终 exit code（结算后存在；spawn 失败为 null）。 */
  exitCode: number | null
  /** post-check 结果（exit 0 且已执行验证后存在）。 */
  postCheck: { ok: boolean; evidence: string } | null
  /** 结算错误/诊断文案（失败与取消时给用户一句话）。 */
  message: string | null
}

/** Plugin Manager 面板的完整展示事实（全量 inventory + 运行中操作 + handoff）。 */
interface PluginManagerView {
  /** 每个已发现 profile 的 inventory（三分类事实；空数组 = 尚未发现）。 */
  profiles: { name: string; inventory: PluginInventory }[]
  /** inventory 无法取得的明确原因（discovery 错误等）。 */
  error: string | null
  /** 运行中/已结算的操作；null = 空闲。 */
  operation: PluginOperationView | null
  /** restart handoff 待用户确认（Restart Now / Later）。 */
  handoffPending: boolean
  /**
   * Plugin Mutation Recovery 的当前事实；null = 无未决事务。展示层只读：
   * 恢复动作经封闭命令回 main，绝不在 renderer 直接执行。
   */
  recovery: {
    state: RecoveryJournalState
    profile: string
    /** 脱敏失败/漂移摘要。 */
    failure: string | null
    /** Managed Home 是否已执行过一次自动恢复（UI 说明用）。 */
    autoRecoveredOnce: boolean
  } | null
  /**
   * DeepSeekGUI 随包内置插件（B3-13）：launcher overlay 层的真实来源，
   * 只读投影，绝不提供重复安装入口。
   */
  builtin: readonly string[]
}

/** Desktop Chrome renderer 消费的完整可序列化模型。 */
export interface DesktopControlModel {
  /**
   * 模型内容版本号（main 单处递增）：控制桥的条件拉取（`/control/model?since=`
   * 与 settings-plugin 的轮询）靠它判断「内容是否变了」——没有变化时只回
   * `{ revision, changed: false }` 小包，全量模型只在变化时传输。
   */
  revision: number
  /** 文案语言：zh 用中文字典，其余 locale 回退英文。 */
  locale: 'zh' | 'en'
  homeKind: 'managed' | 'existing'
  /** 解析后的绝对 DSH_HOME；只允许出现在面板内（单行省略 + hover 全值）。 */
  dshHome: string
  activeProfile: string
  /** pending selection 的可读标签；不存在为 null。 */
  pending: string | null
  status: DesktopRuntimeStatus
  /** null = 尚未 discovery；空数组 = 该 Home 下没有 profile。 */
  profiles: DesktopProfileItem[] | null
  /** discovery 失败的脱敏原因；成功为 null。 */
  discoveryError: string | null
  /** lastBootFailure 存在时的恢复详情（已脱敏限长）。 */
  recovery: {
    stage: BootStage
    message: string
    /** 失败目标 selection 标签；P3 前的旧记录可能缺失。 */
    failedTarget: string | null
    /** 恢复目标（当前 active）标签。 */
    recoveredTo: string
    logPath: string | null
  } | null
  /** Existing Home 两段式流程的候选（已选目录 + 其只读 discovery）。 */
  existingHomeCandidate: { path: string; profiles: DesktopProfileItem[] } | null
  /** 实际生效主题（system 已解析为 light/dark）。 */
  effectiveTheme: 'light' | 'dark'
  /** 系统是否处于 high contrast 模式（renderer 据此保持基本可读）。 */
  highContrast: boolean
  /**
   * 待显示的一次性恢复提示；null = 无提示。只由 main 在两种真实事实
   * （lastBootFailure + 本次已恢复到 lastKnownGood；或 interruptedSwitch
   * + 本次成功启动）下给出，确认后 ackKey 进入 UI state，同一条提示
   * 不再出现。kind 决定 renderer 用哪条横幅文案。
   */
  recoveryNotice: { profile: string; kind: 'boot-failure' | 'interrupted-switch' } | null
  /**
   * 会话数量已越过警戒线时的读数；null = 没到线，不显示任何东西。
   *
   * 投影缓存每个会话一行且从不删除（删掉的会话也留着行），所以文件只增
   * 不减。几千行时毫无感觉，几万行时上游有人被它撑到每次启动都 V8 OOM。
   * DeepSeekGUI 不替用户清理——那是他自己的对话；只把数字摆出来。
   */
  sessionPressure: SessionPressure | null
  /** Plugin Manager 面板事实（inventory 三分类 + 操作 + handoff）。 */
  pluginManager: PluginManagerView
  /** Update service 面板事实（比较对象只能是 DeepSeekGUI app version）。 */
  update: UpdateView
  /** Diagnostics Center 面板事实。 */
  diagnostics: DiagnosticsView
  /** Feedback 面板事实（P7-A~E）。 */
  feedback: FeedbackView
  /** Harness 权限事实（官方 settings 现算；fail closed）。 */
  permissions: PermissionsView
  /** PowerShell 7 是否已安装（仅用户 Terminal 的推荐项；绝不影响 Agent sandbox）。 */
  powerShell7Available: boolean
  /** 内置浏览器 pane（B3-11）：present = 曾被插件创建；open = 当前展开。 */
  browserPane: { present: boolean; open: boolean }
  /** 首启引导是否显示（B6-P5；main 单处持有）。当前步骤由客户端从官方事实推导，进度不落盘。 */
  firstRun: { pending: boolean }
  /** 数据位置与迁移收尾事实（B6-P7；main 单处持有）。 */
  dataHome: DataHomeView
  /**
   * 当前界面形态（B3-P2）：Workbench（带 DeepSeekGUI 产品插件）或
   * Compatibility View（不带 Workbench 插件的官方界面）。内存态，
   * 不持久化——应用重开默认 Workbench。
   */
  viewMode: 'workbench' | 'compatibility'
  /**
   * 一次性的会话导航请求（B4-P8 通知点击）：main 在系统通知被点击时
   * 写入 { sessionId, nonce }，Workbench 的桌面动作轮询读到后打开该
   * 会话并记住 nonce——同一请求不会重复导航。null = 无请求。
   * Compatibility View 没有 Workbench 插件，读不到此字段；通知点击
   * 在那里只聚焦窗口。
   */
  navigateRequest: { sessionId: string; nonce: number } | null
  /**
   * D5-c（莉莉丝 2026-09-06）：全局记忆 memory.md 的当前内容，给设置页的
   * 「记忆（全局）」分区做编辑起点。main 每次构建模型时读一次盘（有界，
   * 见 MEMORY_GLOBAL_CONTENT_MAX）；文件不存在为空串，读不到为 null。
   */
  globalMemory: string | null
}

/** Update service 的运行状态（单一状态机，main 单处持有）。 */
export interface UpdateView {
  /** 更新通道：未配置显示为 null，UI 明示"当前未配置公开更新通道"。 */
  channel: string | null
  state: 'idle' | 'checking' | 'available' | 'downloading' | 'verified' | 'error'
  /** 最近一次 check 的语义结果（文案归 view-model 字典，绝不硬编码进模型）。 */
  result: 'unconfigured' | 'current' | 'error' | null
  /** provider 声明的 latest DeepSeekGUI app version；available/verified 时存在。 */
  latestVersion: string | null
  /** release note 摘要（纯文本）；available/verified 时可能存在。 */
  releaseNotes: string | null
  /** 下载进度（已下载字节）；downloading 时更新。 */
  progressBytes: number | null
  /** 下载总量（期望字节）；downloading 时存在。 */
  progressTotal: number | null
  /** 用户可读的错误详情（error 时）；其余为操作提示（安装已取消等）。 */
  message: string | null
  /**
   * 发现更新后是否后台自动下载（B6-P6）。偏好存在 UI state 里；这里只
   * 给面板显示开关当前状态，main 是唯一写者。
   */
  autoDownload: boolean
}

/**
 * 数据位置事实（B6-P7；main 单处持有）。只陈述位置与"上次迁移还有多少项
 * 没清理"——清理的判定与执行全部由代码完成，模型不参与。
 */
export interface DataHomeView {
  /** 当前 DSH_HOME 绝对路径。 */
  readonly homePath: string
  readonly homeKind: 'managed' | 'existing'
  /**
   * 迁移已切指向、等用户重启完成核对；null = 无此状态。
   *
   * 这个状态下面板只请用户重启，绝不出现任何删除入口——同进程读得通不等于
   * 从零启动能用，而删旧副本不可逆（B6-P7，句芒 2026-09-10 定）。
   */
  readonly awaitingRestart: { readonly targetHome: string } | null
  /** 重启核对发现对不上；旧副本原样保留，用户可以切回去。null = 无失败。 */
  readonly verifyFailed: { readonly failures: readonly string[]; readonly sourceHome: string } | null
  /**
   * 旧副本可以删了：重启核对已通过、清单未清理完、旧路径仍在。null = 不提示。
   * 这是搬家的收尾主动作（用户正是为了腾出原盘空间才搬的），不是残留清理。
   */
  readonly pendingCleanup: { readonly count: number; readonly sourceHome: string; readonly bytes: number } | null
}

/** Diagnostics Center 面板事实。 */
export interface DiagnosticsView {
  /**
   * 组装好的 Build Info 行（allowlist 事实，绝无凭据/环境变量）。
   * 形状见 diagnostics-service 的 BuildInfoLine：`key` 供界面本地化、
   * `value` 是打码后的显示值、`exportValue` 是复制用原值、`exportOnly`
   * 的行只进导出文本不上界面。
   */
  buildInfo: {
    label: string
    key: string
    value: string
    valueKey?: string
    exportValue?: string
    exportOnly?: boolean
  }[]
  /**
   * Harness 目录的**打码**显示值（面板用；真路径在 `dshHome`）。
   * 用户报 bug 多半是截图，界面上不该出现 `C:\Users\<真名>\…`。
   */
  homeDisplay: string
  /** 诊断日志位置（可缺失）。 */
  logPath: string | null
  /** 最近一次 bundle 导出目录（可缺失）。 */
  lastExport: string | null
  /** 上次退出是否正常（true=上次未正常退出；null=无历史证据）。 */
  uncleanExit: boolean | null
}

/**
 * Feedback 面板事实（P7-A~E）：诊断包文本（已脱敏、用户可见可编辑）、
 * AI 排查阶段与结果、issue 组装结果。main 单处持有；renderer 只读快照，
 * 一切动作经封闭命令回 main。发送永不因 AI 不可用而不可用——degraded
 * 是路径不是禁用。
 */
export interface FeedbackView {
  /** 面板是否打开。 */
  open: boolean
  /** 已脱敏的诊断包文本（收集一次，用户在面板里可编辑；编辑稿在 renderer）。 */
  diagnostics: string
  /** 阶段：idle（未发送）/ sending（AI 排查中）/ replied（AI 已回复）/ degraded（降级静态模板）。 */
  phase: 'idle' | 'sending' | 'replied' | 'degraded'
  /** AI 排查回复全文；replied 时存在。 */
  reply: string | null
  /** 已组装的 issue 标题（replied / degraded 时可用）。 */
  issueTitle: string
  /** 降级原因（人话一句；degraded 时存在）。 */
  degradedReason: string | null
  /** 最近一次操作的提示（复制完成/失败等）；null = 无。 */
  notice: string | null
  /**
   * 无 GitHub 通道（P8-D32）的形态：网关已配置时按钮做直传，未配置时
   * 按钮直接导出反馈文件。事实由 main 从环境/常量解析。
   */
  gatewayConfigured: boolean
}

/** Chrome renderer 能发出的全部动作（封闭联合）。 */
export type DesktopControlCommand =
  | { type: 'refresh-profiles' }
  | { type: 'switch-profile'; profile: string }
  | { type: 'choose-existing-home' }
  | { type: 'choose-existing-profile'; profile: string }
  | { type: 'cancel-existing-home' }
  | { type: 'use-managed-home' }
  | { type: 'restart-harness' }
  | { type: 'show-recovery-details' }
  | { type: 'acknowledge-recovery' }
  | { type: 'copy-full-path' }
  | { type: 'show-about' }
  | {
    type: 'show-terminal'
    /**
     * 当前选中会话（P9-3，可选）：Workbench 桌面动作携带官方 client-runtime
     * 的当前选择；main 从权威 session.list 解析该会话的 cwd——浏览器只送
     * id，绝不送路径。无此字段（tray/chrome 菜单入口）走 Profile/Home 回退。
     */
    sessionId?: string
  }
  | { type: 'quit' }
  | { type: 'plugin-op-request'; action: PluginAction; profile: string; spec: string | null }
  | { type: 'plugin-op-cancel' }
  | { type: 'plugin-handoff-restart' }
  | { type: 'plugin-handoff-later' }
  | { type: 'plugin-recovery-restore' }
  | { type: 'plugin-recovery-abandon' }
  | { type: 'plugin-recovery-open-profile' }
  | { type: 'check-for-updates' }
  | { type: 'update-dismiss' }
  | { type: 'update-download' }
  | { type: 'update-cancel-download' }
  | { type: 'update-install' }
  | { type: 'open-log-folder' }
  | { type: 'export-diagnostics' }
  | { type: 'set-permission-mode'; mode: 'sandbox' | 'full-access' }
  | { type: 'open-feedback' }
  | { type: 'close-feedback' }
  /** 发送：用户问题 + 面板里（可能被编辑过的）诊断包文本。 */
  | { type: 'feedback-send'; text: string; diagnostics: string }
  | { type: 'feedback-copy-open' }
  /** 无 GitHub 通道（P8-D32）：网关直传，未配置/失败降级导出反馈文件。 */
  | { type: 'feedback-submit-gateway' }
  /** 内置浏览器 pane 开合（B3-11；pane 未创建时为 no-op）。 */
  | { type: 'browser-pane-toggle' }
  /**
   * 收起内置浏览器 pane（已收起/未创建时 no-op）。官方右侧 Sidebar 展开时由
   * Workbench 客户端发出：两者同占窗口右侧，只能开一个（2026-09-11 人工测试
   * #13）。用 toggle 会在 pane 早已收起时反把它打开，所以要一个幂等的"收起"。
   */
  | { type: 'browser-pane-hide' }
  /** 切到 Compatibility View（不带 Workbench 插件的官方界面；重启 Harness）。 */
  | { type: 'open-compatibility-view' }
  /** 回到 Workbench（重启 Harness）。 */
  | { type: 'open-workbench' }
  /**
   * B5-P6 桌面通知：Web 侧的官方事件消费端推来的一次性通知请求。桌面
   * 只弹系统通知并在点击时写一次性会话导航请求（navigateRequest）——
   * 不缓存、不记账、不持久化任何事件状态；去重由 Web 侧以官方事件 id
   * 负责。
   */
  | {
    type: 'notify'
    /** Web 侧去重键（会话 + 官方事件 id）；桌面只用于日志与调试，不存储。 */
    id: string
    /** 事件归属的会话；点击导航回到该会话。 */
    sessionId: string
    kind: 'approval' | 'question' | 'job'
    /** 通知标题。 */
    title: string
    /** 通知正文（发送端已按官方事实生成并限长）。 */
    body: string
  }
  /**
   * B5-P7 记忆管理（本机交互，不是新数据面）：在系统文件管理器打开记忆
   * 文件（全局 = active DSH home 的 memory.md；项目 = 官方 session.list
   * 解析出会话 cwd 后的 memory.md）。绝不接受调用方传来的任意路径。
   */
  | { type: 'open-memory'; which: 'global' | 'project' | 'global-agents' | 'project-agents'; sessionId?: string }
  /**
   * D20（莉莉丝 2026-09-06）：把随包的项目 AGENTS.md 模板写进会话工作区。
   * 只在文件不存在时写；路径由 main 从官方 session.list 解析。
   */
  | { type: 'create-project-agents'; sessionId: string }
  /**
   * B5-P7：保存全局记忆 memory.md（用户经面板编辑，桌面主进程写盘——走
   * 本机权限，不经 agent 权限门；模型对全局文件只读）。
   */
  | { type: 'save-global-memory'; content: string; home: string; expected: string }
  /**
   * D7（莉莉丝 2026-09-06）：在系统文件管理器里打开会话的整个工作区。
   * 路径由 main 从官方 session.list 解析，不接受调用方传路径。
   */
  /**
   * D5-f / D6（莉莉丝 2026-09-06）：在文件管理器里定位工作区内的一个
   * 文件或目录。`path` 相对会话 cwd，也可以是绝对路径；main 一律按 cwd
   * 解析，解析结果必须落在 cwd 之内，或落在会话所属仓库根之内（B6-2：
   * Changes 视图列的是整个仓库的改动，子目录会话也要能定位到它们），
   * 否则拒绝——对话里任何一段像路径的文字都可能点到这里，越界一律不开。
   */
  | { type: 'reveal-path'; sessionId: string; path: string }
  /**
   * B6-P5：用户完成或跳过首启引导。完成事实由 main 单处原子写入
   * userData/first-run.json——不用埋点或推断代替。
   */
  | { type: 'first-run-dismiss' }
  /**
   * B6-P6：切换"发现更新后自动下载"。偏好写进现有 UI state 文件；
   * 关闭只影响将来的自动启动，不中断已经开始的下载。
   */
  | { type: 'update-toggle-auto-download' }
  /**
   * B6-P7：把 Managed Home 数据搬到用户选择的位置。目标目录由 main 弹
   * 原生选择器取得，命令本身不带路径；迁移全程由代码完成，不调用模型。
   */
  | { type: 'migrate-managed-home' }
  /**
   * B6-P7：清理上次迁移留下的旧副本。只删清单里列出的项，逐项报告失败。
   */
  | { type: 'migration-cleanup' }
  /**
   * 莉莉丝 2026-09-10 人工验收：删掉一个归档会话在磁盘上的数据。上游从
   * 持久化层到 RPC 面都没有删除通道（归档只是把会话从侧边栏藏起来），
   * 所以这件事由 main 直办。只删 Home 之内属于这个会话的东西，删不掉
   * 一律报错，绝不假装删成功。
   */
  | { type: 'session-delete'; sessionId: string }

/** 不带载荷的命令类型集合。 */
const BARE_COMMANDS = new Set([
  'refresh-profiles',
  'choose-existing-home',
  'cancel-existing-home',
  'use-managed-home',
  'restart-harness',
  'show-recovery-details',
  'acknowledge-recovery',
  'copy-full-path',
  'show-about',
  'quit',
  'plugin-op-cancel',
  'plugin-handoff-restart',
  'plugin-handoff-later',
  'plugin-recovery-restore',
  'plugin-recovery-abandon',
  'plugin-recovery-open-profile',
  'check-for-updates',
  'update-dismiss',
  'update-download',
  'update-cancel-download',
  'update-install',
  'open-log-folder',
  'export-diagnostics',
  'open-feedback',
  'close-feedback',
  'feedback-copy-open',
  'feedback-submit-gateway',
  'browser-pane-toggle',
  'browser-pane-hide',
  'first-run-dismiss',
  'update-toggle-auto-download',
  'migrate-managed-home',
  'migration-cleanup',
  'open-compatibility-view',
  'open-workbench',
])

/** 带 profile 载荷的命令类型集合。 */
const PROFILE_COMMANDS = new Set(['switch-profile', 'choose-existing-profile'])

/**
 * 解析控制桥条件拉取的 `?since=` 参数（P7）：合法非负整数返回它，
 * 其余（缺失/空串/非数字/负数）返回 undefined——undefined 语义为
 * 「无条件取全量」。
 * @param raw - URL query 里的原始值。
 * @returns 客户端已知的 revision，或 undefined。
 */
export function parseModelSinceParam(raw: string | null): number | undefined {
  if (raw === null || raw === '') return undefined
  if (!/^\d+$/.test(raw)) return undefined
  const value = Number(raw)
  return Number.isSafeInteger(value) ? value : undefined
}

/** set-permission-mode 的合法模式（UI 只暴露 sandbox / full-access 两个动作）。 */
const PERMISSION_MODES: readonly string[] = ['sandbox', 'full-access']

/** feedback-send 的自由文本最大长度（字符；IPC 边界限长，防失控）。 */
const FEEDBACK_TEXT_MAX = 20_000

/** feedback-send 的诊断包文本最大长度（字符；编辑稿的 IPC 边界限长）。 */
const FEEDBACK_DIAGNOSTICS_MAX = 200_000

/** notify 载荷各字段的边界（字符；Web 侧生成，桌面侧只校验与展示）。 */
const NOTIFY_ID_MAX = 200
const NOTIFY_SESSION_ID_MAX = 200
const NOTIFY_TITLE_MAX = 200
const NOTIFY_BODY_MAX = 800
const NOTIFY_KINDS: readonly string[] = ['approval', 'question', 'job']

/** 全局记忆 memory.md 内容上限（字符；面板编辑的 IPC 边界限长）。 */
export const MEMORY_GLOBAL_CONTENT_MAX = 200_000
/** reveal-path 的路径字符上限（Windows 长路径也远在此之下）。 */
export const REVEAL_PATH_MAX = 4_096
/** session-delete 的会话 id 长度上限（远宽于任何真实 id）。 */
export const SESSION_ID_MAX = 256

/**
 * IPC 输入边界验证：把 renderer 发来的未知值解析为封闭命令联合。
 * 未知 type、多余字段、非法 profile 名与非法主题一律返回 null
 * （调用方明确拒绝），绝不猜测或降级。
 * @param raw - renderer 经 IPC 发来的值。
 * @returns 合法命令，或 null。
 */
export function parseControlCommand(raw: unknown): DesktopControlCommand | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const type = record.type
  if (typeof type !== 'string') return null
  const keys = Object.keys(record)
  if (BARE_COMMANDS.has(type)) {
    if (keys.length !== 1) return null
    return { type } as DesktopControlCommand
  }
  if (type === 'show-terminal') {
    // P9-3：可选 sessionId（Workbench 桌面动作携带当前会话；tray/chrome
    // 菜单不带）。多余字段或非法值照旧整条拒绝，绝不静默剥离。
    if (keys.length === 1) return { type }
    if (keys.length !== 2 || typeof record.sessionId !== 'string' || record.sessionId === '') return null
    return { type, sessionId: record.sessionId }
  }
  if (PROFILE_COMMANDS.has(type)) {
    if (keys.length !== 2 || !isValidProfileName(record.profile)) return null
    return { type, profile: record.profile } as DesktopControlCommand
  }
  if (type === 'set-permission-mode') {
    if (keys.length !== 2 || !PERMISSION_MODES.includes(record.mode as string)) return null
    return { type, mode: record.mode as 'sandbox' | 'full-access' }
  }
  if (type === 'plugin-op-request') {
    const { action, profile, spec } = record
    if (keys.length !== 4) return null
    if (!isPluginAction(action)) return null
    if (!isValidProfileName(profile) || profile.length > 256) return null
    if (spec !== null && (typeof spec !== 'string' || spec.length > 4096)) return null
    return { type, action, profile, spec }
  }
  if (type === 'feedback-send') {
    const { text, diagnostics } = record
    if (keys.length !== 3) return null
    if (typeof text !== 'string' || text.trim() === '' || text.length > FEEDBACK_TEXT_MAX) return null
    if (typeof diagnostics !== 'string' || diagnostics.length > FEEDBACK_DIAGNOSTICS_MAX) return null
    return { type, text, diagnostics }
  }
  if (type === 'notify') {
    const { id, sessionId, kind, title, body } = record
    if (keys.length !== 6) return null
    if (typeof id !== 'string' || id === '' || id.length > NOTIFY_ID_MAX) return null
    if (typeof sessionId !== 'string' || sessionId === '' || sessionId.length > NOTIFY_SESSION_ID_MAX) return null
    if (typeof kind !== 'string' || !NOTIFY_KINDS.includes(kind)) return null
    if (typeof title !== 'string' || title.trim() === '' || title.length > NOTIFY_TITLE_MAX) return null
    if (typeof body !== 'string' || body.length > NOTIFY_BODY_MAX) return null
    return { type, id, sessionId, kind: kind as 'approval' | 'question' | 'job', title, body }
  }
  if (type === 'open-memory') {
    // 全局类：{type, which:'global' | 'global-agents'}；项目类：{type, which:
    // 'project' | 'project-agents', sessionId}。多余字段、非法 which、项目缺
    // sessionId 一律整条拒绝。
    const which = record.which
    if (which === 'global' || which === 'global-agents') {
      if (keys.length !== 2) return null
      return { type, which }
    }
    if (which !== 'project' && which !== 'project-agents') return null
    if (keys.length !== 3 || typeof record.sessionId !== 'string' || record.sessionId === '') return null
    return { type, which, sessionId: record.sessionId }
  }
  if (type === 'create-project-agents') {
    if (keys.length !== 2 || typeof record.sessionId !== 'string' || record.sessionId === '') return null
    return { type, sessionId: record.sessionId }
  }
  if (type === 'save-global-memory') {
    const { content, home, expected } = record
    if (keys.length !== 4 || typeof home !== 'string' || home === '' || typeof expected !== 'string') return null
    if (typeof content !== 'string' || content.length > MEMORY_GLOBAL_CONTENT_MAX) return null
    if (expected.length > MEMORY_GLOBAL_CONTENT_MAX) return null
    return { type, content, home, expected }
  }
  if (type === 'session-delete') {
    // 会话 id 拿去拼路径，所以在边界就限死形状：非空、限长、只含 id 该有
    // 的字符。真实 id 都在这个集合里；别的一律整条拒绝，不做清洗后放行。
    const { sessionId } = record
    if (keys.length !== 2 || typeof sessionId !== 'string') return null
    if (sessionId === '' || sessionId.length > SESSION_ID_MAX) return null
    if (!/^[A-Za-z0-9._-]+$/u.test(sessionId) || sessionId === '.' || sessionId === '..') return null
    return { type, sessionId }
  }
  if (type === 'reveal-path') {
    const { sessionId, path } = record
    if (keys.length !== 3 || typeof sessionId !== 'string' || sessionId === '') return null
    // 相对路径、限长、不含控制字符；是否在工作区之内由 main 解析后判定。
    if (typeof path !== 'string' || path === '' || path.length > REVEAL_PATH_MAX || /[\u0000-\u001f]/u.test(path)) return null
    return { type, sessionId, path }
  }
  return null
}

/** 把 discovery 条目映射成面板条目（active 勾选 + boot-failing 标记）。 */
function toProfileItems(
  profiles: DiscoveredProfile[],
  activeHomeSelection: HarnessSelection,
  failure: BootFailure | null,
): DesktopProfileItem[] {
  return profiles.map((profile) => {
    const failingStage = failure !== null && failure.selection !== undefined
      && failure.selection.profile === profile.name
      && sameHome(failure.selection.home, activeHomeSelection.home)
      ? failure.stage
      : undefined
    return {
      name: profile.name,
      staticStatus: profile.staticStatus,
      active: profile.name === activeHomeSelection.profile,
      ...profile.error === undefined ? {} : { error: redactSecrets(profile.error) },
      ...failingStage === undefined ? {} : { bootFailingStage: failingStage },
    }
  })
}

/** 两个 home 引用是否指向同一处（与 control-menu 同语义）。 */
function sameHome(left: HarnessSelection['home'], right: HarnessSelection['home']): boolean {
  if (left.kind === 'managed' || right.kind === 'managed') {
    return left.kind === 'managed' && right.kind === 'managed'
  }
  return left.path === right.path
}

/** controller 七相状态 → 可序列化胶囊状态。 */
export function toRuntimeStatus(status: HarnessStatus): DesktopRuntimeStatus {
  switch (status.phase) {
    case 'idle': return { phase: 'idle' }
    case 'stopping': return { phase: 'stopping' }
    case 'starting': return { phase: 'starting', profile: status.selection.profile }
    case 'switching': return { phase: 'switching', profile: status.selection.profile }
    case 'recovering': return { phase: 'recovering', profile: status.selection.profile }
    case 'running': return { phase: 'running', profile: status.selection.profile, recovered: status.recovered }
    case 'failed': return { phase: 'failed', stage: status.failure.stage }
  }
}

/** buildControlModel 的输入快照（全部来自 main 已有的唯一来源）。 */
export interface ControlModelInput {
  /** 模型内容版本号（main 单处维护；见 {@link DesktopControlModel.revision}）。 */
  revision: number
  locale: 'zh' | 'en'
  state: LauncherStateV1
  status: HarnessStatus
  /** active home 解析后的绝对 DSH_HOME。 */
  activeDshHome: string
  discovery: ProfileDiscoveryV1 | null
  discoveryError: string | null
  logPath: string | undefined
  existingHomeCandidate: { path: string; discovery: ProfileDiscoveryV1 } | null
  /** 实际生效主题。 */
  effectiveTheme: 'light' | 'dark'
  /** 系统 high contrast 模式。 */
  highContrast: boolean
  /** 待显示的一次性恢复提示；null = 无提示（kind 选文案，见模型注释）。 */
  recoveryNotice: { profile: string; kind: 'boot-failure' | 'interrupted-switch' } | null
  /** 会话数量警戒读数；缺省视作未越线（main 单处计算）。 */
  sessionPressure?: SessionPressure | null
  /** Plugin Manager 面板事实（main 单处持有）。 */
  pluginManager: PluginManagerView
  /** Update service 面板事实（main 单处持有）。 */
  update: UpdateView
  /** Diagnostics Center 面板事实（main 单处持有）。 */
  diagnostics: DiagnosticsView
  /** Feedback 面板事实（main 单处持有）。 */
  feedback: FeedbackView
  /** Harness 权限事实（main 从官方 describe 现算）。 */
  permissions: PermissionsView
  /** PowerShell 7 是否已安装（启动时探测一次）。 */
  powerShell7Available: boolean
  /** 内置浏览器 pane 事实（B3-11；main 单处持有）。 */
  browserPane: { present: boolean; open: boolean }
  /**
   * 首启引导是否显示（B6-P5；main 单处持有）。只给"是否显示"，
   * 当前步骤由客户端从官方事实推导——引导进度不落盘。
   */
  firstRun: { pending: boolean }
  /** 数据位置与迁移收尾事实（B6-P7；main 单处持有）。 */
  dataHome: DataHomeView
  /** 当前界面形态（B3-P2；main 内存持有，不持久化）。 */
  viewMode: 'workbench' | 'compatibility'
  /** 一次性会话导航请求（B4-P8 通知点击）；缺省为 null。 */
  navigateRequest?: { sessionId: string; nonce: number } | null
  /** 全局记忆 memory.md 当前内容（D5-c）；缺省为 null = 读不到。 */
  globalMemory?: string | null
}

/**
 * 由唯一来源构建可序列化 ControlModel。纯函数：不读文件、不触 Electron。
 * @param input - 快照输入。
 * @returns Chrome renderer 消费的模型。
 */
export function buildControlModel(input: ControlModelInput): DesktopControlModel {
  const { state } = input
  const failure = state.lastBootFailure
  return {
    revision: input.revision,
    locale: input.locale,
    homeKind: state.active.home.kind,
    dshHome: input.activeDshHome,
    activeProfile: state.active.profile,
    pending: state.pending === null ? null : selectionLabel(state.pending),
    status: toRuntimeStatus(input.status),
    profiles: input.discovery === null
      ? null
      : toProfileItems(input.discovery.profiles, state.active, failure),
    discoveryError: input.discoveryError === null ? null : redactSecrets(input.discoveryError),
    recovery: failure === null ? null : {
      stage: failure.stage,
      message: redactSecrets(failure.message),
      failedTarget: failure.selection === undefined ? null : selectionLabel(failure.selection),
      recoveredTo: `${homeKindLabel(state.active.home)} / ${state.active.profile}`,
      logPath: input.logPath ?? null,
    },
    existingHomeCandidate: input.existingHomeCandidate === null ? null : {
      path: input.existingHomeCandidate.path,
      // 候选 Home 尚未 active：条目不勾选、不带 boot-failing 标记。
      profiles: input.existingHomeCandidate.discovery.profiles.map(profile => ({
        name: profile.name,
        staticStatus: profile.staticStatus,
        active: false,
        ...profile.error === undefined ? {} : { error: redactSecrets(profile.error) },
      })),
    },
    effectiveTheme: input.effectiveTheme,
    highContrast: input.highContrast,
    recoveryNotice: input.recoveryNotice,
    sessionPressure: input.sessionPressure ?? null,
    pluginManager: input.pluginManager,
    update: input.update,
    diagnostics: input.diagnostics,
    feedback: input.feedback,
    permissions: input.permissions,
    powerShell7Available: input.powerShell7Available,
    browserPane: input.browserPane,
    firstRun: input.firstRun,
    dataHome: input.dataHome,
    viewMode: input.viewMode,
    navigateRequest: input.navigateRequest ?? null,
    globalMemory: input.globalMemory ?? null,
  }
}
