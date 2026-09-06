/** The dirty-tree gate: refuses `+dirty` unless overridden by flag or env; never gates a non-git checkout. */
import { describe, expect, it } from 'vitest'
import { ALLOW_DIRTY_ENV, ALLOW_DIRTY_FLAG, cleanTreeVerdict } from './require-clean-tree.ts'

describe('cleanTreeVerdict', () => {
  it('passes a clean commit', () => {
    expect(cleanTreeVerdict('abc123', [], {})).toEqual({ kind: 'clean', commit: 'abc123' })
  })

  it('refuses a dirty tree by default', () => {
    expect(cleanTreeVerdict('abc123+dirty', ['node', 'script'], {})).toEqual({ kind: 'dirty-refused', commit: 'abc123+dirty' })
  })

  it('allows a dirty tree with the flag or the variable', () => {
    expect(cleanTreeVerdict('abc123+dirty', ['node', 'script', ALLOW_DIRTY_FLAG], {}).kind).toBe('dirty-allowed')
    expect(cleanTreeVerdict('abc123+dirty', [], { [ALLOW_DIRTY_ENV]: '1' }).kind).toBe('dirty-allowed')
    expect(cleanTreeVerdict('abc123+dirty', [], { [ALLOW_DIRTY_ENV]: '' }).kind).toBe('dirty-refused')
  })

  it('leaves a non-git checkout to the assemble step', () => {
    expect(cleanTreeVerdict(null, [], {})).toEqual({ kind: 'no-git' })
  })
})
