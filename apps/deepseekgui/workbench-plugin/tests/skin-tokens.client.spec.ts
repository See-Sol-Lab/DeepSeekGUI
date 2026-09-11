/**
 * Guard: the DeepSeekGUI skin (theme-plugin) sets `--dsw-alias-bg-base` to
 * transparent so the sea backdrop shows through the official UI. Any surface
 * or text color this plugin paints with that token becomes invisible — the
 * 2026-09-05 acceptance found a see-through inspector popover and blue
 * buttons with no label. Surfaces use bg-overlay / bg-layer-2; text on the
 * brand fill uses label-primary-inverted.
 * @module @see-sol-lab/deepseekgui-workbench/tests/skin-tokens
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.(tsx?|css)$/.test(name) ? [path] : []
  })
}

describe('skin-safe tokens', () => {
  it('never paints with --dsw-alias-bg-base (transparent under the DeepSeekGUI skin)', () => {
    const offenders = sources(join(import.meta.dirname, '..', 'src', 'client'))
      .filter(path => readFileSync(path, 'utf8').includes('--dsw-alias-bg-base'))
    expect(offenders).toEqual([])
  })
})
