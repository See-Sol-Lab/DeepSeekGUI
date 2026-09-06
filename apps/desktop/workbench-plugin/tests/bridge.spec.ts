/**
 * Control-bridge parsing specs (pure, no DOM): the page query parameter
 * format the settings plugin and this plugin share.
 * @module @see-sol-lab/deepseekgui-workbench/tests/bridge
 */

import { describe, expect, it } from 'vitest'
import { parseControlBridge } from '../src/client/bridge.ts'

describe('parseControlBridge', () => {
  it('parses the DeepSeekGUI control parameter from a page query', () => {
    expect(parseControlBridge('?deepseekgui-control=47621.abc123def')).toEqual({ port: '47621', token: 'abc123def' })
    expect(parseControlBridge('?x=1&deepseekgui-control=9.token&y=2')).toEqual({ port: '9', token: 'token' })
  })

  it('returns null without the parameter', () => {
    expect(parseControlBridge('')).toBeNull()
    expect(parseControlBridge('?other=1')).toBeNull()
  })

  it('rejects malformed values (no dot, empty port, dot at start)', () => {
    expect(parseControlBridge('?deepseekgui-control=notoken')).toBeNull()
    expect(parseControlBridge('?deepseekgui-control=.token')).toBeNull()
  })

  it('decodes URL-encoded tokens', () => {
    expect(parseControlBridge('?deepseekgui-control=1234.a%2Fb')).toEqual({ port: '1234', token: 'a/b' })
  })
})
