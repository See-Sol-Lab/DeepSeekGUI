/**
 * DeepSeekGUI 对官方 Harness Remote HTTP RPC 的最小客户端（B5-P1 迁移）：
 * `settings/describe`、`settings/mutate` 走官方 settings Remote namespace
 * （唯一写路径），`session/list`、`session/create`、`session/prompt` 走官方
 * session Remote namespace——DeepSeekGUI 绝不直接编辑 settings.yaml 或
 * session 文件来实现设置切换与诊断会话。
 *
 * 传输契约（官方 client-connection 的 client-request 信封 + API Gateway
 * Remote 方法，dsh 0.1.2）：
 * - POST `${base}/api/<namespace>/<method>`，JSON 信封
 *   `{ type: 'client-request', rpcId, method, payload: { args } }`；
 *   端点与 args 键名 = host Remote 方法声明（单 `request` 参数的端点
 *   args 为 `{ request }`；多参数端点平铺，如 settings/mutate 的
 *   `{ ns, ops, expectedRevision }`）；
 * - 响应 `{ type: 'server-response', rpcId, result: { ok, value | error } }`，
 *   业务错误恒为 HTTP 200 + `ok: false`；
 * - 本客户端只向 `127.0.0.1:<APP_PORT>`（loopback）发调用。
 *
 * 所有解析严格：响应形状不符按错误处理（fail closed），绝不猜测降级。
 * 纯 Node 模块，fetch 经注入面传入（单测用 fake），不依赖 Electron。
 * @module @see-sol-lab/deepseekgui/harness-api
 */

import { randomUUID } from 'node:crypto'
import type { SettingsDescribeValue, SettingsNamespaceView, SettingsPathOp } from './harness-api-types.ts'

export type { SettingsDescribeValue } from './harness-api-types.ts'

/** 官方 RPC 业务错误。 */
export class HarnessRpcError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'HarnessRpcError'
  }
}

/** 可注入的 fetch 面（Node 全局 fetch 满足）。 */
interface FetchLike {
  (url: string, init: {
    method: string
    headers: Record<string, string>
    body: string
    signal: AbortSignal
  }): Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>
}

/** 创建官方 RPC 客户端的输入。 */
export interface HarnessApiOptions {
  /** 官方服务基址（恒为 http://127.0.0.1:<APP_PORT>）。 */
  baseUrl: string
  /** fetch 实现（测试注入 fake）。 */
  fetch: FetchLike
  /** 单次调用的超时（毫秒）。 */
  timeoutMs?: number
  /** 读取当前界面是否使用中文；每次响应解析时重新读取。 */
  zh?: () => boolean
}

/** 官方 RPC 客户端：只暴露 DeepSeekGUI 需要的 settings 与 session 方法。 */
export interface HarnessApi {
  settingsDescribe(): Promise<SettingsDescribeValue>
  settingsMutate(ns: string, ops: SettingsPathOp[], expectedRevision?: number): Promise<SettingsNamespaceView>
  /** 枚举当前会话（session/list）；P7-F 退出确认用它数运行中会话。 */
  sessionList(): Promise<SessionListValue>
  /** 新建诊断会话（session/create；cwd 与工作区隔离）。 */
  sessionCreate(payload: SessionCreatePayload): Promise<SessionCreateValue>
  /** 向会话发一条用户消息（session/prompt，queue 模式；requestId 由本客户端 mint）。 */
  sessionPrompt(payload: SessionPromptPayload): Promise<void>
  /** `session/rename`：给会话一个标题（反馈排查会话用它自报身份）。 */
  sessionRename(sessionId: string, title: string): Promise<void>
  /** `workspace/archiveSession`：把会话收进归档（排查完的隐藏会话不留在列表里）。 */
  sessionArchive(sessionId: string): Promise<void>
  /** `workbenchInspector/lastReply`：最新一条助手回复及其是否已完成（#15）。 */
  workbenchLastReply(sessionId: string): Promise<{ text: string | null; complete: boolean }>
  /** Wait for the Session owner, then remove its content under desktop authorization. */
  sessionDelete(sessionId: string, signature: string): Promise<void>
}

/** session/list 的一行摘要（官方 SessionSummary 的受信面）。 */
interface SessionSummary {
  sessionId: string
  updatedAt: number
  /** 该会话是否正在执行（官方 agent/status running 位的同一事实）。 */
  running: boolean
  /** 空会话（尚未开始轮次）。 */
  blank: boolean
  parentSessionId?: string
  origin?: 'subagent'
  cwd?: string
  agentPreset?: string
  projections?: unknown
}

/** session/list 的响应值。 */
export interface SessionListValue {
  items: SessionSummary[]
}

/** session/create 的请求载荷（cwd 与 workspaceId 二选一；诊断会话只用 cwd）。 */
interface SessionCreatePayload {
  cwd?: string
  agentPreset?: string
}

/** session/create 的响应值。 */
interface SessionCreateValue {
  sessionId: string
  agentPreset?: string
}

/** session/prompt 的请求载荷。 */
interface SessionPromptPayload {
  sessionId: string
  mode: 'queue' | 'steer'
  content: { type: 'text'; text: string }[]
}

/** 默认单次调用超时（毫秒）。 */
const DEFAULT_RPC_TIMEOUT_MS = 5_000

/** 严格解析 settings namespace 视图（值字段保持 unknown，调用方再解释）。 */
function parseNamespaceView(raw: unknown, where: string, zh: boolean): SettingsNamespaceView {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new HarnessRpcError('bad-response', zh ? `${where}: 必须是对象` : `${where}: must be an object`)
  }
  const record = raw as Record<string, unknown>
  const { ns, applies, revision } = record
  if (typeof ns !== 'string' || ns.length === 0) {
    throw new HarnessRpcError('bad-response', zh ? `${where}.ns: 必须是非空字符串` : `${where}.ns: must be a non-empty string`)
  }
  if (applies !== 'live' && applies !== 'restart') {
    throw new HarnessRpcError('bad-response', zh ? `${where}.applies: 未知值 ${JSON.stringify(applies)}` : `${where}.applies: unknown value ${JSON.stringify(applies)}`)
  }
  if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 0) {
    throw new HarnessRpcError('bad-response', zh ? `${where}.revision: 必须是非负整数` : `${where}.revision: must be a non-negative integer`)
  }
  if (!('value' in record)) {
    throw new HarnessRpcError('bad-response', zh ? `${where}.value: 缺失` : `${where}.value: is missing`)
  }
  return { ns, value: record.value, applies, revision }
}

/** 严格解析 settings/describe 的 value。 */
function parseDescribeValue(raw: unknown, zh: boolean): SettingsDescribeValue {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new HarnessRpcError('bad-response', zh ? 'settings/describe value: 必须是对象' : 'settings/describe value: must be an object')
  }
  const record = raw as Record<string, unknown>
  if (typeof record.writable !== 'boolean') {
    throw new HarnessRpcError('bad-response', zh ? 'settings/describe value.writable: 必须是布尔值' : 'settings/describe value.writable: must be a boolean')
  }
  if (typeof record.hasDocument !== 'boolean') {
    throw new HarnessRpcError('bad-response', zh ? 'settings/describe value.hasDocument: 必须是布尔值' : 'settings/describe value.hasDocument: must be a boolean')
  }
  if (!Array.isArray(record.namespaces)) {
    throw new HarnessRpcError('bad-response', zh ? 'settings/describe value.namespaces: 必须是数组' : 'settings/describe value.namespaces: must be an array')
  }
  return {
    writable: record.writable,
    hasDocument: record.hasDocument,
    namespaces: record.namespaces.map((row, index) => parseNamespaceView(row, `namespaces[${index}]`, zh)),
  }
}

/** 是否为普通对象（非 null、非数组）。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 严格解析 session/list 的一行摘要。只校验 DeepSeekGUI 消费的受信字段
 * （sessionId / updatedAt / running / blank），未知字段容忍（上游扩展
 * 不破坏本客户端）；形状不符按错误处理（fail closed），绝不猜测降级。
 * @param raw - 一行原始值。
 * @param where - 定位用字段路径。
 * @returns 校验通过的摘要。
 */
function parseSessionSummary(raw: unknown, where: string, zh: boolean): SessionSummary {
  if (!isRecord(raw)) throw new HarnessRpcError('bad-response', zh ? `${where}: 必须是对象` : `${where}: must be an object`)
  const { sessionId, updatedAt, running, blank } = raw
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    throw new HarnessRpcError('bad-response', zh ? `${where}.sessionId: 必须是非空字符串` : `${where}.sessionId: must be a non-empty string`)
  }
  if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) {
    throw new HarnessRpcError('bad-response', zh ? `${where}.updatedAt: 必须是有限数字` : `${where}.updatedAt: must be a finite number`)
  }
  if (typeof running !== 'boolean') {
    throw new HarnessRpcError('bad-response', zh ? `${where}.running: 必须是布尔值` : `${where}.running: must be a boolean`)
  }
  if (typeof blank !== 'boolean') {
    throw new HarnessRpcError('bad-response', zh ? `${where}.blank: 必须是布尔值` : `${where}.blank: must be a boolean`)
  }
  return {
    sessionId,
    updatedAt,
    running,
    blank,
    ...typeof raw.parentSessionId === 'string' ? { parentSessionId: raw.parentSessionId } : {},
    ...raw.origin === undefined ? {} : { origin: raw.origin as 'subagent' },
    ...typeof raw.cwd === 'string' ? { cwd: raw.cwd } : {},
    ...typeof raw.agentPreset === 'string' ? { agentPreset: raw.agentPreset } : {},
    ...raw.projections === undefined ? {} : { projections: raw.projections },
  }
}

/** 严格解析 session/list 的响应值。 */
function parseSessionListValue(raw: unknown, zh: boolean): SessionListValue {
  if (!isRecord(raw) || !Array.isArray(raw.items)) {
    throw new HarnessRpcError('bad-response', zh ? 'session/list value: 必须是含 items 数组的对象' : 'session/list value: must be an object containing an items array')
  }
  return { items: raw.items.map((row, index) => parseSessionSummary(row, `items[${index}]`, zh)) }
}

/** 严格解析 session/create 的响应值。 */
function parseSessionCreateValue(raw: unknown, zh: boolean): SessionCreateValue {
  if (!isRecord(raw)) throw new HarnessRpcError('bad-response', zh ? 'session/create value: 必须是对象' : 'session/create value: must be an object')
  if (typeof raw.sessionId !== 'string' || raw.sessionId.length === 0) {
    throw new HarnessRpcError('bad-response', zh ? 'session/create value.sessionId: 必须是非空字符串' : 'session/create value.sessionId: must be a non-empty string')
  }
  return {
    sessionId: raw.sessionId,
    ...typeof raw.agentPreset === 'string' ? { agentPreset: raw.agentPreset } : {},
  }
}

/** 严格解析 session/prompt 的响应值。 */
function assertSessionPromptValue(raw: unknown, zh: boolean): void {
  if (!isRecord(raw) || raw.accepted !== true) {
    throw new HarnessRpcError('bad-response', zh ? 'session/prompt value: accepted 必须为 true' : 'session/prompt value: accepted must be true')
  }
}

/**
 * 创建官方 RPC 客户端。
 * @param options - 基址、fetch 与超时。
 * @returns settings 与 session 最小面。
 */
export function createHarnessApi(options: HarnessApiOptions): HarnessApi {
  const timeoutMs = options.timeoutMs ?? DEFAULT_RPC_TIMEOUT_MS
  const zh = options.zh ?? (() => true)

  /** 单次调用的超时上限：调用方传更紧的超时（如退出确认的 1500ms）时取更小值。 */
  const call = async (method: string, args: unknown, callTimeoutMs: number | null = timeoutMs): Promise<unknown> => {
    const rpcId = randomUUID()
    let response: { ok: boolean; status: number; json: () => Promise<unknown> }
    try {
      response = await options.fetch(`${options.baseUrl}/api/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId, method, payload: { args } }),
        signal: callTimeoutMs === null ? new AbortController().signal : AbortSignal.timeout(Math.min(callTimeoutMs, timeoutMs)),
      })
    } catch (error) {
      // 网络失败/超时：明确错误，调用方按"权限控制不可用"处理（fail closed）。
      throw new HarnessRpcError('unreachable', error instanceof Error ? error.message : String(error))
    }
    if (!response.ok || response.status !== 200) {
      throw new HarnessRpcError('transport', zh()
        ? `官方服务返回 HTTP ${String(response.status)}`
        : `The Harness service returned HTTP ${String(response.status)}`)
    }
    let body: unknown
    try {
      body = await response.json()
    } catch {
      throw new HarnessRpcError('bad-response', zh() ? '响应不是有效 JSON' : 'The response is not valid JSON')
    }
    if (!isRecord(body) || body.type !== 'server-response' || body.rpcId !== rpcId || !('result' in body)) {
      throw new HarnessRpcError('bad-response', zh() ? '响应信封不符合官方 RPC 契约' : 'The response envelope does not match the Harness RPC contract')
    }
    const result = body.result
    if (!isRecord(result)) throw new HarnessRpcError('bad-response', zh() ? 'result: 必须是对象' : 'result: must be an object')
    if (result.ok === true) {
      if (!('value' in result)) throw new HarnessRpcError('bad-response', zh() ? 'ok 响应缺少 value' : 'The successful response is missing value')
      return result.value
    }
    const error = result.error
    if (isRecord(error) && typeof error.code === 'string' && typeof error.message === 'string') {
      throw new HarnessRpcError(error.code, error.message)
    }
    throw new HarnessRpcError('bad-response', zh() ? '错误响应的 error 形状不符' : 'The error response has an invalid error value')
  }

  return {
    async settingsDescribe() {
      return parseDescribeValue(await call('settings/describe', {}), zh())
    },
    async settingsMutate(ns, ops, expectedRevision) {
      const value = await call('settings/mutate', {
        ns,
        ops,
        ...expectedRevision === undefined ? {} : { expectedRevision },
      })
      return parseNamespaceView(value, 'settings/mutate value', zh())
    },
    async sessionList() {
      // 官方 session-controller 的 list 方法签名参数名是 `_request`
      // （保留空请求参数），typert 网关按签名参数名生成 wire 字段——
      // 因此 args 键为 `_request`，与 create/prompt 的 `request` 不同。
      return parseSessionListValue(await call('session/list', { _request: {} }, 1_500), zh())
    },
    async sessionCreate(payload) {
      const value = await call('session/create', { request: payload })
      return parseSessionCreateValue(value, zh())
    },
    async sessionPrompt(payload) {
      // requestId 由客户端 mint（官方 prompt 请求的必填关联身份；host 以它
      // 关联持久 user/message 的 rpcId 来源，桌面不消费回显）。
      const requestId = randomUUID()
      assertSessionPromptValue(await call('session/prompt', { request: { requestId, ...payload } }), zh())
    },
    async sessionRename(sessionId, title) {
      await call('session/rename', { request: { sessionId, title } })
    },
    async sessionArchive(sessionId) {
      await call('workspace/archiveSession', { request: { sessionId } })
    },
    async workbenchLastReply(sessionId) {
      const value = await call('workbenchInspector/lastReply', { sessionId })
      if (!isRecord(value) || (value.text !== null && typeof value.text !== 'string') || typeof value.complete !== 'boolean') {
        throw new HarnessRpcError('bad-response', zh() ? 'lastReply: 形状不符' : 'lastReply: unexpected shape')
      }
      return { text: value.text, complete: value.complete }
    },
    async sessionDelete(sessionId, signature) {
      // Deletion waits for the current reply rather than an ordinary RPC deadline.
      await call('workbenchInspector/deleteSession', { sessionId, signature }, null)
    },
  }
}
