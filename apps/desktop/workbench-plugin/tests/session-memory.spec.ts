/**
 * Host memory specs (B5-P7): the two flat memory.md files, their injected
 * window text (contents + contract), and the three robustness states.
 * Pure Node specs — temporary files only, no real personal data.
 * @module @see-sol-lab/deepseekgui-workbench/tests/session-memory
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SystemPrompt, renderContextSections } from '@deepseek-ai/dsh-system-prompt'
import * as memoryPlugin from '../src/index.ts'
import {
  buildMemorySectionText,
  memoryContract,
  memoryFilesOf,
  readMemoryFile,
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
    writeFileSync(join(home, 'memory.md'), 'edited after assembly', 'utf8')
    expect(await assemble()).toEqual(before)
    expect((await assemble({ header: { cwd: project } })).find(s => s.name === 'deepseekgui:memory')?.text).toContain('edited after assembly')
    await memoryFiber.dispose()
    expect((await assemble()).some(s => s.name === 'deepseekgui:memory')).toBe(false)
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
