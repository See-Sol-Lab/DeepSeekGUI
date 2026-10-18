/**
 * Host memory specs (B5-P7): the two flat memory.md files, their injected
 * window text (contents + contract), and the three robustness states.
 * Pure Node specs — temporary files only, no real personal data.
 * @module @see-sol-lab/deepseekgui-workbench/tests/session-memory
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SystemPrompt, renderContextSections } from '@deepseek-ai/dsh-system-prompt'
import * as memoryPlugin from '../src/index.ts'
import { AREA_BEGIN, AREA_END } from '@deepseek-ai/dsh-workbench-inspector/types'
import {
  buildMemorySectionText,
  captureMemorySection,
  memoryContract,
  memoryFilesOf,
  productGuide,
  readMemoryFile,
  readProjectMemoryFile,
  recordMemoryInjection,
} from '../src/session-memory.ts'

const roots: string[] = []
const tempHome = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'deepseekgui-memory-'))
  roots.push(root)
  return root
}

afterEach(() => {
  vi.unstubAllEnvs()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

it('keeps literal memory stable for a loaded session and disposes its contribution', async () => {
  const home = tempHome()
  const project = tempHome()
  vi.stubEnv('DSH_HOME', home)
  writeFileSync(join(home, 'memory.md'), 'template {{customer_name}}', 'utf8')
  const ctx = new Context()
  const promptFiber = await ctx.plugin(SystemPrompt, {})
  const memoryFiber = await ctx.plugin(memoryPlugin)
  const session = { header: { cwd: project } }
  const assemble = async (current = session) => renderContextSections(await ctx.get('systemPrompt').assemble({ agent: { session: current } } as never))
  try {
    const before = await assemble()
    expect(before.find(s => s.name === 'deepseekgui:memory')?.text).toContain('{{customer_name}}')
    // The product guide is its own section, ahead of the memory one, without the two-file contract.
    const guide = before.find(s => s.name === 'deepseekgui:guide')?.text ?? ''
    expect(guide).toContain('# DeepSeekGUI: where you are running')
    expect(guide).not.toContain('# Memory')
    expect(before.findIndex(s => s.name === 'deepseekgui:guide')).toBeLessThan(before.findIndex(s => s.name === 'deepseekgui:memory'))
    writeFileSync(join(home, 'memory.md'), 'edited after assembly', 'utf8')
    expect(await assemble()).toEqual(before)
    expect((await assemble({ header: { cwd: project } })).find(s => s.name === 'deepseekgui:memory')?.text).toContain('edited after assembly')
    await memoryFiber.dispose()
    expect((await assemble()).some(s => s.name === 'deepseekgui:memory')).toBe(false)
    expect((await assemble()).some(s => s.name === 'deepseekgui:guide')).toBe(false)
  } finally {
    await memoryFiber.dispose()
    await promptFiber.dispose()
  }
})

it('injects both files in every composition: a leftover memory service no longer switches them off (2026-09-29)', async () => {
  const home = tempHome()
  const project = tempHome()
  vi.stubEnv('DSH_HOME', home)
  writeFileSync(join(home, 'memory.md'), 'global text', 'utf8')
  writeFileSync(memoryFilesOf(home, project).projectPath, 'project text', 'utf8')
  const ctx = new Context()
  ctx.provide('workbenchMemory', { injectionMode: () => 'entries' } as never)
  const promptFiber = await ctx.plugin(SystemPrompt, {})
  const memoryFiber = await ctx.plugin(memoryPlugin)
  try {
    const sections = renderContextSections(await ctx.get('systemPrompt').assemble({ agent: { session: { header: { cwd: project } } } } as never))
    const memory = sections.find(s => s.name === 'deepseekgui:memory')?.text ?? ''
    expect(memory).toContain('global text')
    expect(memory).toContain('project text')
  } finally {
    await memoryFiber.dispose()
    await promptFiber.dispose()
  }
})

describe('memoryFilesOf', () => {
  it('derives the two flat files; the project file carries the folder-name prefix (D20)', () => {
    const files = memoryFilesOf('C:\\dsh-home', 'C:\\work\\project')
    expect(files.globalPath).toBe('C:\\dsh-home\\memory.md')
    expect(files.projectPath).toBe('C:\\work\\project\\project.memory.md')
    expect(memoryFilesOf('C:\\dsh-home', 'C:\\work\\my-app\\').projectPath).toBe('C:\\work\\my-app\\my-app.memory.md')
  })
})

describe('readMemoryFile', () => {
  it('distinguishes absent, empty, present, and over-cap files', () => {
    const home = tempHome()
    expect(readMemoryFile(join(home, 'missing.md'))).toMatchObject({ status: 'absent', text: '' })
    writeFileSync(join(home, 'empty.md'), '   \n', 'utf8')
    expect(readMemoryFile(join(home, 'empty.md'))).toMatchObject({ status: 'empty', text: '' })
    writeFileSync(join(home, 'ok.md'), 'a fact', 'utf8')
    expect(readMemoryFile(join(home, 'ok.md'))).toMatchObject({ status: 'present', text: 'a fact' })
    writeFileSync(join(home, 'big.md'), 'x'.repeat(100), 'utf8')
    expect(readMemoryFile(join(home, 'big.md'), 10)).toMatchObject({ status: 'truncated' })
  })
})

describe('buildMemorySectionText', () => {
  it('injects both files verbatim plus the contract', () => {
    const home = tempHome()
    const project = tempHome()
    writeFileSync(join(home, 'memory.md'), 'prefer zh replies', 'utf8')
    const files = memoryFilesOf(home, project)
    writeFileSync(files.projectPath, 'user wants commit messages in Chinese', 'utf8')
    const text = buildMemorySectionText(files)
    expect(text).toContain('## DeepSeekGUI memory')
    expect(text).toContain('prefer zh replies')
    expect(text).toContain('user wants commit messages in Chinese')
    expect(text).toContain(files.globalPath)
    expect(text).toContain(files.projectPath)
    expect(text).toContain(memoryContract().split('\n')[0] ?? '')
    expect(memoryContract()).toContain('# Memory')
    expect(productGuide()).not.toContain('# Memory')
  })

  it('reports absent and empty files explicitly and never throws', () => {
    const home = tempHome()
    const text = buildMemorySectionText(memoryFilesOf(home, home))
    expect(text).toContain('(file does not exist yet)')
    expect(text).toContain('Global memory (user-edited, model read-only)')
    writeFileSync(join(home, 'memory.md'), '', 'utf8')
    expect(buildMemorySectionText(memoryFilesOf(home, home))).toContain('(file is empty)')
  })
})

describe('readProjectMemoryFile（Phase 2：归档整理区一定带入）', () => {
  it('超过上限时缩短人写的部分，整理区整段保留；没超就原样', () => {
    const project = tempHome()
    const path = join(project, 'p.memory.md')
    const area = `${AREA_BEGIN}\n- 关键决定：改用 Node 24\n${AREA_END}`
    writeFileSync(path, `${'人写的内容。'.repeat(20_000)}\n${area}\n`, 'utf8')
    const view = readProjectMemoryFile(path, 4096)
    expect(view.status).toBe('truncated')
    expect(view.autoArea).toBe('included')
    expect(view.text.endsWith(area)).toBe(true)
    expect(Buffer.byteLength(view.text, 'utf8')).toBeLessThanOrEqual(4096)
    writeFileSync(path, `短短的\n${area}\n`, 'utf8')
    expect(readProjectMemoryFile(path, 4096)).toMatchObject({ status: 'present', autoArea: 'included' })
  })
})

describe('recordMemoryInjection（Phase 2：每次加载各记一条，带内容摘要）', () => {
  it('追加而不覆盖；同样长度不同内容的摘要不同', () => {
    const home = tempHome()
    const project = tempHome()
    const files = memoryFilesOf(home, project)
    writeFileSync(files.globalPath, 'aaaa', 'utf8')
    recordMemoryInjection(home, 'session-1', captureMemorySection(files))
    writeFileSync(files.globalPath, 'bbbb', 'utf8')
    recordMemoryInjection(home, 'session-1', captureMemorySection(files))
    const saved: unknown = JSON.parse(readFileSync(join(home, 'deepseekgui', 'memory-injections', 'session-1.json'), 'utf8'))
    expect(saved).toMatchObject({ sessionId: 'session-1' })
    const entries = typeof saved === 'object' && saved !== null && 'entries' in saved && Array.isArray(saved.entries) ? saved.entries : []
    expect(entries).toHaveLength(2)
    expect(entries[0].global.chars).toBe(entries[1].global.chars)
    expect(entries[0].global.sha256).not.toBe(entries[1].global.sha256)
  })
})
