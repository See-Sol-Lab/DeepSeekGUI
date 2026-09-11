/**
 * First-run step derivation (B6-P5; reordered in P11): every step comes from
 * official facts, a pending approval wins, the key step only appears while the
 * official credential is missing, and completion is never inferred here.
 * @module @see-sol-lab/deepseekgui-workbench/tests/first-run
 */
import { describe, expect, it } from 'vitest'
import { firstRunStep, type FirstRunFacts } from '../src/client/first-run.ts'

function facts(over: Partial<FirstRunFacts> = {}): FirstRunFacts {
  return {
    awaitingFirstMessage: false,
    awaitingFirstReply: false,
    pendingApprovalTool: null,
    credentialConfigured: false,
    ...over,
  }
}

describe('firstRunStep', () => {
  it('starts at the key step before the user has spoken while the credential is missing', () => {
    expect(firstRunStep(facts({ awaitingFirstMessage: true, awaitingFirstReply: true })))
      .toEqual({ id: 'model', tool: null })
  })

  it('skips the key step when the official credential is already configured', () => {
    expect(firstRunStep(facts({
      awaitingFirstMessage: true, awaitingFirstReply: true, credentialConfigured: true,
    }))).toEqual({ id: 'message', tool: null })
  })

  it('waits for the first reply after the first message', () => {
    expect(firstRunStep(facts({ awaitingFirstReply: true, credentialConfigured: true })))
      .toEqual({ id: 'waiting', tool: null })
  })

  it('explains a pending approval with the tool it is about, even mid-reply', () => {
    expect(firstRunStep(facts({ awaitingFirstReply: true, pendingApprovalTool: 'write_file' })))
      .toEqual({ id: 'approval', tool: 'write_file' })
  })

  it('ends at the first answer — the guide has nothing left to say', () => {
    // 句芒 2026-09-10: it used to close by pointing at the Changes tab, but a
    // user with no repository has nothing to look at there.
    expect(firstRunStep(facts())).toBeNull()
    expect(firstRunStep(facts({ credentialConfigured: true }))).toBeNull()
  })
})
