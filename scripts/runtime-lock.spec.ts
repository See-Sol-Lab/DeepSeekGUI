/**
 * Runtime lockfile portability tests: relative tarball specs and rejection of
 * machine-specific absolute paths.
 * @module scripts/runtime-lock
 */

import { describe, expect, it } from 'vitest'
import { dropOverriddenCopies, missingDependencies, overrideViolations, portableLockfileIssues, relativeTarballSpec, runtimeNpmOverrides } from './runtime-lock.ts'

describe('dropOverriddenCopies', () => {
  const overrides = { '@deepseek-ai/libreoffice-kit': { fflate: '0.8.3' } }
  const kit = 'node_modules/@deepseek-ai/libreoffice-kit'

  it('去掉与覆盖不一致的嵌套副本及其子树，其余条目原样保留', () => {
    const lock = JSON.stringify({
      lockfileVersion: 3,
      packages: {
        [kit]: { version: '0.1.5' },
        [`${kit}/node_modules/fflate`]: { version: '0.8.2' },
        [`${kit}/node_modules/fflate/node_modules/inner`]: { version: '1.0.0' },
        [`${kit}/node_modules/fontkit`]: { version: '2.0.4' },
        'node_modules/fflate': { version: '0.8.3' },
      },
    })
    const result = dropOverriddenCopies(lock, overrides)
    expect(result.dropped).toEqual([`${kit}/node_modules/fflate`])
    expect(Object.keys((JSON.parse(result.text) as { packages: object }).packages)).toEqual([
      kit, `${kit}/node_modules/fontkit`, 'node_modules/fflate',
    ])
    expect(overrideViolations(result.text, overrides)).toEqual([])
  })

  it('父包用的是提升到上层的副本时，去掉的是那一份（DeepSeekGUI：fast-uri 3.1.7 曾这样漏过）', () => {
    const ajv = { ajv: { 'fast-uri': '3.1.8' } }
    const lock = JSON.stringify({ packages: {
      'node_modules/ajv': { version: '8.20.0' },
      'node_modules/fast-uri': { version: '3.1.7' },
    } })
    const result = dropOverriddenCopies(lock, ajv)
    // The parent goes too, so npm resolves it and its child again.
    expect(result.dropped).toEqual(['node_modules/fast-uri', 'node_modules/ajv'])
    expect(overrideViolations(lock, ajv)).toEqual(['node_modules/fast-uri is 3.1.7, override pins 3.1.8'])
  })

  it('父包缺了被覆盖的子包时算违规，预置时把父包也去掉', () => {
    const ajv = { ajv: { 'fast-uri': '3.1.8' } }
    const lock = JSON.stringify({ packages: { 'node_modules/ajv': { version: '8.20.0' } } })
    expect(overrideViolations(lock, ajv)).toEqual(['node_modules/ajv/node_modules/fast-uri is undefined, override pins 3.1.8'])
    expect(dropOverriddenCopies(lock, ajv).dropped).toEqual(['node_modules/ajv'])
  })

  it('没有违规副本时原文不变', () => {
    const lock = JSON.stringify({ packages: { [kit]: { version: '0.1.5' }, [`${kit}/node_modules/fflate`]: { version: '0.8.3' } } })
    expect(dropOverriddenCopies(lock, overrides)).toEqual({ text: lock, dropped: [] })
  })
})

describe('runtimeNpmOverrides', () => {
  it('把 parent>child 翻成 npm 嵌套 overrides，跳过不带 > 的 link 条目', () => {
    expect(runtimeNpmOverrides({
      'extract-zip>yauzl': '3.4.0',
      '@deepseek-ai/libreoffice-kit>fflate': '0.8.3',
      '@deepseek-ai/cosmokit': 'link:vendor/cosmokit',
    })).toEqual({
      'extract-zip': { yauzl: '3.4.0' },
      '@deepseek-ai/libreoffice-kit': { fflate: '0.8.3' },
    })
  })

  it('多级选择器或带 link: 的父级覆盖直接报错，不静默丢弃', () => {
    expect(() => runtimeNpmOverrides({ 'a>b>c': '1.0.0' })).toThrow('unsupported pnpm override a>b>c')
    expect(() => runtimeNpmOverrides({ 'a>b': 'link:vendor/b' })).toThrow('unsupported pnpm override')
    expect(() => runtimeNpmOverrides({ '>b': '1.0.0' })).toThrow('unsupported pnpm override')
  })
})

describe('overrideViolations', () => {
  const overrides = { '@deepseek-ai/libreoffice-kit': { fflate: '0.8.3' } }

  it('嵌套在父包下的旧副本被列出', () => {
    const lock = JSON.stringify({
      packages: {
        'node_modules/fflate': { version: '0.8.3' },
        'node_modules/@deepseek-ai/libreoffice-kit': { version: '0.1.5' },
        'node_modules/@deepseek-ai/libreoffice-kit/node_modules/fflate': { version: '0.8.2' },
      },
    })
    expect(overrideViolations(lock, overrides)).toEqual([
      'node_modules/@deepseek-ai/libreoffice-kit/node_modules/fflate is 0.8.2, override pins 0.8.3',
    ])
  })

  it('父包实际用到的副本是固定版本时没有问题，嵌套或提升都一样', () => {
    const kit = { 'node_modules/@deepseek-ai/libreoffice-kit': { version: '0.1.5' } }
    expect(overrideViolations(JSON.stringify({
      packages: { ...kit, 'node_modules/@deepseek-ai/libreoffice-kit/node_modules/fflate': { version: '0.8.3' } },
    }), overrides)).toEqual([])
    expect(overrideViolations(JSON.stringify({ packages: { ...kit, 'node_modules/fflate': { version: '0.8.3' } } }), overrides)).toEqual([])
    expect(overrideViolations(JSON.stringify({ packages: { 'node_modules/fflate': { version: '0.8.2' } } }), overrides)).toEqual([])
    expect(overrideViolations('{}', overrides)).toEqual([])
  })
})

describe('missingDependencies', () => {
  it('找不到的必需依赖被列出；可选、开发依赖与能向上找到的不算', () => {
    const lock = JSON.stringify({ packages: {
      '': { dependencies: { ajv: '^8' } },
      'node_modules/ajv': { version: '8.20.0', dependencies: { 'fast-uri': '^3.0.1', 'json-schema-traverse': '^1' } },
      'node_modules/json-schema-traverse': { version: '1.0.0' },
      'node_modules/opt': { version: '1.0.0', optional: true, dependencies: { gone: '1' } },
    } })
    expect(missingDependencies(lock)).toEqual(['node_modules/ajv requires fast-uri'])
  })
})

describe('relativeTarballSpec', () => {
  it('生成相对 file: spec（正斜杠，可跨机器提交）', () => {
    expect(relativeTarballSpec('C:\\r\\dist\\desktop\\npm-staging', 'C:\\r\\dist\\npm-dsh\\a.tgz'))
      .toBe('file:../../npm-dsh/a.tgz')
  })
})

describe('portableLockfileIssues', () => {
  it('相对 file: 与 registry 条目视为可移植', () => {
    const lock = JSON.stringify({
      packages: {
        'node_modules/@deepseek-ai/dsh': { resolved: 'file:../../npm-dsh/deepseek-ai-dsh-0.1.0-rc.5.tgz' },
        'node_modules/commander': { resolved: 'https://registry.npmjs.org/commander/-/commander-12.0.0.tgz', integrity: 'sha512-x' },
      },
    })
    expect(portableLockfileIssues(lock)).toEqual([])
  })

  it('绝对 file:// URL 与盘符路径都是问题', () => {
    expect(portableLockfileIssues('{"resolved":"file:///C:/build/dist/a.tgz"}')).not.toEqual([])
    expect(portableLockfileIssues('{"resolved":"file:C:\\\\build\\\\dist\\\\a.tgz"}')).not.toEqual([])
  })
})
