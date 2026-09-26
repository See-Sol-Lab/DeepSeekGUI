/**
 * The full-loop harness the Harness-face specs share: the production agent
 * loop and its dependencies, the real storage stack under a temp home, the
 * memory service, and scripted model adapters that record every request —
 * plus readers for what the model was sent and what the session log kept.
 * @module @deepseek-ai/dsh-workbench-memory/tests/loop-support
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage, type ContentBlock, type GenerateOptions } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import {
  apply as storageDomainApply, Config as storageDomainConfig, inject as storageDomainInject, name as storageDomainName,
} from '@deepseek-ai/dsh-storage-domain'
import {
  apply as storageJsonApply, Config as storageJsonConfig, inject as storageJsonInject, name as storageJsonName,
} from '@deepseek-ai/dsh-storage-json'
import { MockAdapter } from '../../../core/agent-loop/tests/mock-adapter.ts'
import WorkbenchMemory, { WORKBENCH_MEMORY_LIMITS, type MemoryInjectionMode, type MemoryScope } from '../src/index.ts'
import { temp } from './support.ts'

/** A scripted adapter's script. */
export type Script = ConstructorParameters<typeof MockAdapter>[0]

/** Options of one composition. */
export interface LoopOptions {
  /** Injection mode set after mount; `entries` by default. */
  injection?: MemoryInjectionMode
  /** Extra service config. */
  config?: Record<string, unknown>
  /** Reuse a home (an application restart over the same data); a fresh temp home by default. */
  home?: string
  /** Further scripted adapters by provider name, beside the `mock` one. */
  adapters?: Record<string, Script>
  /** The seconds offset of the deterministic clock's first tick; keeps ids apart across compositions over one home. */
  clockOffset?: number
}

/** One mounted composition. */
export interface Loop {
  readonly ctx: Context
  readonly home: string
  /** The `mock` provider's adapter. */
  readonly adapter: MockAdapter
  /** Every adapter by provider. */
  readonly adapters: Record<string, MockAdapter>
  readonly api: WorkbenchMemory
  readonly agents: Awaited<ReturnType<typeof mountAgentLoopTestHarness>>
  readonly signal: AbortSignal
  readonly domainRoot: string
  dispose(): Promise<void>
}

/**
 * Mount a full composition: loop, model runtime, storage, and the memory service.
 * @param script - the `mock` provider's script.
 * @param options - mode, config, home, extra adapters.
 * @returns the composition.
 */
export async function loop(script: Script, options: LoopOptions = {}): Promise<Loop> {
  const home = options.home ?? temp('dsh-memory-loop-')
  const ctx = new Context()
  const adapters: Record<string, MockAdapter> = { mock: new MockAdapter(script) }
  for (const [provider, extra] of Object.entries(options.adapters ?? {})) adapters[provider] = new MockAdapter(extra)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(Storage)
  await ctx.plugin(
    { name: storageJsonName, inject: storageJsonInject, apply: storageJsonApply, Config: storageJsonConfig },
    { root: join(home, 'storages') },
  )
  await ctx.plugin(
    { name: storageDomainName, inject: storageDomainInject, apply: storageDomainApply, Config: storageDomainConfig },
    { backend: 'json' },
  )
  ctx.provide('typert', {} as never)
  await ctx.plugin(WorkbenchMemory, { ...WORKBENCH_MEMORY_LIMITS, dshHome: home, ...options.config })
  const agents = await mountAgentLoopTestHarness(ctx)
  for (const [provider, adapter] of Object.entries(adapters)) ctx.llm.registerAdapter([provider], adapter)
  const api = ctx.get('workbenchMemory')
  if (api === undefined) throw new Error('memory service did not mount')
  let ids = options.clockOffset ?? 0
  api.clock = { now: () => new Date(Date.UTC(2026, 8, 13, 12, 0, ids)), hex: () => (ids += 1).toString(16).padStart(12, '0') }
  const signal = new AbortController().signal
  await api.setInjection(options.injection ?? 'entries', signal)
  const adapter = adapters.mock as MockAdapter
  return {
    ctx,
    home,
    adapter,
    adapters,
    api,
    agents,
    signal,
    domainRoot: join(home, 'storages', 'deepseekgui_memory'),
    dispose: async () => { await ctx.fiber.dispose() },
  }
}

/**
 * A fresh project folder.
 * @param name - folder name (two calls with one name are two different folders).
 * @returns the absolute path.
 */
export function project(name: string): string {
  const folder = join(temp('dsh-memory-project-'), name)
  mkdirSync(folder)
  return folder
}

/**
 * The project scope of a folder.
 * @param api - the service.
 * @param folder - the folder.
 * @param signal - cancellation.
 * @returns the scope.
 */
export async function scopeOf(api: WorkbenchMemory, folder: string, signal: AbortSignal): Promise<MemoryScope> {
  const scope = await api.projectScope(folder, signal)
  if (scope === null) throw new Error(`no project for ${folder}`)
  return scope
}

/**
 * Every text block of a request's messages, tool results included, joined.
 * @param request - a recorded request.
 * @returns the text.
 */
export function requestText(request: GenerateOptions | undefined): string {
  return request?.messages.map(message => blocksText(message.content)).join('\n') ?? ''
}

/**
 * The newest recalled-memory list in a request; earlier lists stay in the history, superseded by their successors.
 * @param request - a recorded request.
 * @returns the list's text, or empty.
 */
export function latestRecall(request: GenerateOptions | undefined): string {
  const marker = '<system-reminder>\nDeepSeekGUI memory recalled'
  const text = requestText(request)
  const start = text.lastIndexOf(marker)
  if (start < 0) return ''
  return text.slice(start, text.indexOf('</system-reminder>', start))
}

/**
 * The newest runtime-context snapshot in a request (the guide rides it), with everything sent after it.
 * @param request - a recorded request.
 * @returns the text from the newest snapshot on, or empty.
 */
export function latestRuntimeContext(request: GenerateOptions | undefined): string {
  const text = requestText(request)
  const start = text.lastIndexOf('Current runtime context')
  return start < 0 ? '' : text.slice(start)
}

/**
 * How many recalled-memory lists a request carries in its model-visible messages.
 * @param request - a recorded request.
 * @returns the count.
 */
export function recallListCount(request: GenerateOptions | undefined): number {
  return requestText(request).split('<system-reminder>\nDeepSeekGUI memory recalled').length - 1
}

/**
 * The text of the newest tool result the model was sent.
 * @param request - a recorded request.
 * @returns the text, or empty.
 */
export function lastToolResult(request: GenerateOptions | undefined): string {
  // 0.1.7: tool results are `role: 'tool'` messages whose content is the result blocks.
  const last = (request?.messages ?? []).filter(message => message.role === 'tool').at(-1)
  return last === undefined ? '' : blocksText(last.content)
}

function blocksText(blocks: readonly ContentBlock[]): string {
  return blocks.map(block => (block.type === 'text' ? block.text : '')).join('\n')
}

/** A recall record as the session log keeps it. */
export interface RecallRecord {
  seq: number
  source: Record<string, unknown>
  text: string
}

/**
 * The `user/message` events carrying a recall source.
 * @param events - a session's events.
 * @returns the records in order.
 */
export function recallEvents(events: readonly SessionEvent[]): RecallRecord[] {
  const found: RecallRecord[] = []
  for (const event of events) {
    if (event.type !== 'user/message' || event.data.source.kind !== 'deepseekgui-memory') continue
    found.push({
      seq: event.seq,
      source: event.data.source as unknown as Record<string, unknown>,
      text: event.data.content.map(block => block.type === 'text' ? block.text : '').join('\n'),
    })
  }
  return found
}

/**
 * A user message.
 * @param text - the text.
 * @returns the message.
 */
export function user(text: string) {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
}
