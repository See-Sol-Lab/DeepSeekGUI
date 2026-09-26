/**
 * plugin-inventory 测试：profile 清单的 dependencies 只读解析（反馈诊断
 * 列出已装插件用）。纯 Node 环境，无 Electron、无模型、无凭据。
 * @module @see-sol-lab/deepseekgui/tests/plugin-inventory
 */

import { describe, expect, it } from 'vitest'
import { parseManifestDependencies } from '../src/plugin-inventory.ts'

describe('parseManifestDependencies（只读文档，绝不猜测）', () => {
  it('缺 dependencies = 空记录', () => {
    expect(parseManifestDependencies('{"name":"dsh-profile-web"}', 'dir')).toEqual({ ok: true, dependencies: {} })
  })

  it('正常读取 name → spec', () => {
    expect(parseManifestDependencies('{"dependencies":{"a":"^1.0.0","@s/b":"2.0.0"}}', 'dir'))
      .toEqual({ ok: true, dependencies: { a: '^1.0.0', '@s/b': '2.0.0' } })
  })

  it('非 JSON / 非对象 / 非字符串 spec 都明确报错', () => {
    expect(parseManifestDependencies('not json', 'dir').ok).toBe(false)
    expect(parseManifestDependencies('[]', 'dir').ok).toBe(false)
    expect(parseManifestDependencies('{"dependencies":["x"]}', 'dir').ok).toBe(false)
    expect(parseManifestDependencies('{"dependencies":{"a":42}}', 'dir').ok).toBe(false)
  })

  it('英文文案', () => {
    const result = parseManifestDependencies('not json', 'dir', false)
    expect(result.ok ? '' : result.error).toMatch(/^The profile manifest is not valid JSON/)
  })
})
