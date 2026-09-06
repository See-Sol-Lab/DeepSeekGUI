/**
 * D20 出厂种子规格：只在缺失时写、绝不覆盖、按语言选模板、模板缺失报错。
 * 只用临时目录与合成内容。
 * @module @see-sol-lab/deepseekgui-desktop/tests/memory-seed
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { GLOBAL_MEMORY_SEED, seedManagedHome, seedProjectAgents } from '../src/memory-seed.ts'

const TEMPLATES = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'templates')

const roots: string[] = []
const tempDir = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'deepseekgui-seed-'))
  roots.push(root)
  return root
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe('seedManagedHome', () => {
  it('creates AGENTS.md from the locale template and a title-only memory.md', () => {
    const home = tempDir()
    expect(seedManagedHome(home, 'zh', TEMPLATES)).toEqual({ agents: 'created', memory: 'created' })
    expect(readFileSync(join(home, 'AGENTS.md'), 'utf8')).toBe(readFileSync(join(TEMPLATES, 'AGENTS.global.zh.md'), 'utf8'))
    expect(readFileSync(join(home, 'memory.md'), 'utf8')).toBe(GLOBAL_MEMORY_SEED.zh)
  })

  it('picks the English template for en', () => {
    const home = tempDir()
    seedManagedHome(home, 'en', TEMPLATES)
    expect(readFileSync(join(home, 'AGENTS.md'), 'utf8')).toBe(readFileSync(join(TEMPLATES, 'AGENTS.global.en.md'), 'utf8'))
    expect(readFileSync(join(home, 'memory.md'), 'utf8')).toBe(GLOBAL_MEMORY_SEED.en)
  })

  it('never overwrites existing files, independently per file', () => {
    const home = tempDir()
    writeFileSync(join(home, 'memory.md'), 'user text', 'utf8')
    expect(seedManagedHome(home, 'zh', TEMPLATES)).toEqual({ agents: 'created', memory: 'exists' })
    expect(readFileSync(join(home, 'memory.md'), 'utf8')).toBe('user text')
    expect(seedManagedHome(home, 'en', TEMPLATES)).toEqual({ agents: 'exists', memory: 'exists' })
    expect(readFileSync(join(home, 'AGENTS.md'), 'utf8')).toBe(readFileSync(join(TEMPLATES, 'AGENTS.global.zh.md'), 'utf8'))
  })

  it('creates a missing home directory', () => {
    const home = join(tempDir(), 'nested', 'home')
    expect(seedManagedHome(home, 'zh', TEMPLATES).agents).toBe('created')
  })

  it('throws when the shipped template is missing (broken package, not a silent blank)', () => {
    expect(() => seedManagedHome(tempDir(), 'zh', join(tempDir(), 'nowhere'))).toThrow()
  })
})

describe('seedProjectAgents', () => {
  it('writes the project template once and keeps the existing file afterwards', () => {
    const cwd = tempDir()
    expect(seedProjectAgents(cwd, 'en', TEMPLATES)).toBe('created')
    expect(readFileSync(join(cwd, 'AGENTS.md'), 'utf8')).toBe(readFileSync(join(TEMPLATES, 'AGENTS.project.en.md'), 'utf8'))
    writeFileSync(join(cwd, 'AGENTS.md'), 'edited by user', 'utf8')
    expect(seedProjectAgents(cwd, 'zh', TEMPLATES)).toBe('exists')
    expect(readFileSync(join(cwd, 'AGENTS.md'), 'utf8')).toBe('edited by user')
  })
})
