/**
 * Shared harness for the memory specs: a Context with the real storage
 * stack (json backend under a temp home) and the memory service with a
 * deterministic clock and sequential ids.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import {
  apply as storageDomainApply, Config as storageDomainConfig, inject as storageDomainInject, name as storageDomainName,
} from '@deepseek-ai/dsh-storage-domain'
import {
  apply as storageJsonApply, Config as storageJsonConfig, inject as storageJsonInject, name as storageJsonName,
} from '@deepseek-ai/dsh-storage-json'
import WorkbenchMemory, { WORKBENCH_MEMORY_LIMITS, type MemoryChangeEvent, type MemoryScope } from '../src/index.ts'

const roots: string[] = []
const contexts: Context[] = []

/** Dispose every context and remove every temp root created since the last call. */
export async function cleanup(): Promise<void> {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
}

/**
 * A fresh temp directory removed by {@link cleanup}.
 * @param prefix - directory name prefix.
 * @returns the absolute path.
 */
export function temp(prefix = 'dsh-memory-'): string {
  const root = mkdtempSync(join(tmpdir(), prefix))
  roots.push(root)
  return root
}

/** One mounted service and the knobs the specs turn. */
export interface Harness {
  home: string
  ctx: Context
  api: WorkbenchMemory
  changes: MemoryChangeEvent[]
  signal: AbortSignal
  /** Advance the deterministic clock by one second. */
  tick: () => void
  /** The storage root of the memory domain. */
  domainRoot: string
}

/** Harness options. */
export interface HarnessOptions {
  /** Reuse a home (a "restart" of the same installation). */
  home?: string
  config?: Record<string, unknown>
}

/**
 * Mount the service over the real storage stack.
 * @param options - home reuse and extra config.
 * @returns the harness.
 */
export async function mount(options: HarnessOptions = {}): Promise<Harness> {
  const home = options.home ?? temp()
  const ctx = new Context()
  contexts.push(ctx)
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
  const api = ctx.get('workbenchMemory')
  if (api === undefined) throw new Error('memory service did not mount')
  let seconds = 0
  let ids = 0
  api.clock = {
    now: () => new Date(Date.UTC(2026, 8, 13, 12, 0, seconds)),
    hex: () => (ids += 1).toString(16).padStart(12, '0'),
  }
  const changes: MemoryChangeEvent[] = []
  ctx.on('workbench-memory/change', (change) => { changes.push(change) })
  return {
    home,
    ctx,
    api,
    changes,
    signal: new AbortController().signal,
    tick: () => { seconds += 1 },
    domainRoot: join(home, 'storages', 'deepseekgui_memory'),
  }
}

/**
 * A project scope for a folder that exists.
 * @param harness - mounted service.
 * @param folder - existing directory.
 * @returns the scope.
 */
export async function projectScope(harness: Harness, folder: string): Promise<MemoryScope> {
  const scope = await harness.api.projectScope(folder, harness.signal)
  if (scope === null) throw new Error(`no project for ${folder}`)
  return scope
}

/**
 * Write a legacy memory file.
 * @param path - absolute file path.
 * @param text - content.
 */
export function writeMemoryFile(path: string, text: string): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, text)
}

/** A user source for writes. */
export const user = { kind: 'user' as const, sessionId: 's1' }

/** An assistant source with evidence. */
export const assistant = { kind: 'assistant' as const, sessionId: 's1', evidence: 'package.json' }
