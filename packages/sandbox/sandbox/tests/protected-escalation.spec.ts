/**
 * Tests for DeepSeekGUI's guarded approvals (2026-09-24): an escalation in a
 * chat-only workspace is refused before anyone is asked, an escalation that
 * touches a protected place carries its concerns to the approval (the red
 * warning), and under standing full access a protected action stops for a
 * person while an ordinary one — or a `.git` change — passes untouched.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { approveEscalation, approveProtectedAction, ELEVATED_ENV, GUI_ROOTS_ENV } from '@deepseek-ai/dsh-sandbox'
import type { EscalationApproval, EscalationApprover, EscalationOutcome } from '@deepseek-ai/dsh-sandbox'

let install: string
let workspace: string

beforeEach(() => {
  install = mkdtempSync(join(tmpdir(), 'dsh-guard-install-'))
  workspace = mkdtempSync(join(tmpdir(), 'dsh-guard-ws-'))
  vi.stubEnv(GUI_ROOTS_ENV, install)
  vi.stubEnv(ELEVATED_ENV, '')
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(install, { recursive: true, force: true })
  rmSync(workspace, { recursive: true, force: true })
})

/** An approver that records each request and answers `outcome`. */
function approver(outcome: EscalationOutcome = 'allowed-once') {
  const request = vi.fn<EscalationApprover<string>['request']>(() => Promise.resolve(outcome))
  return { approver: { request }, request }
}

const approval = (over: Partial<EscalationApproval<string>> = {}): EscalationApproval<string> => ({
  approver: undefined,
  agent: 'agent-1',
  toolName: 'pwsh',
  callId: 'call-1',
  ...over,
})

describe('approveEscalation with an action', () => {
  it('refuses a chat-only workspace before asking anyone', async () => {
    const { approver: a, request } = approver()
    await expect(approveEscalation({
      requestedMode: 'workspace-write',
      justification: 'write a file',
      effectiveMode: 'read-only',
      subject: 'command',
      action: { workspaceRoot: homedir(), command: 'echo hi > a.txt' },
    }, approval({ approver: a }))).rejects.toThrow(/chat-only/)
    expect(request).not.toHaveBeenCalled()
  })

  it('carries the protected concerns to the approval', async () => {
    const { approver: a, request } = approver()
    const mode = await approveEscalation({
      requestedMode: 'danger-full-access',
      justification: 'patch the installed app',
      effectiveMode: 'workspace-write',
      subject: 'command',
      action: { workspaceRoot: workspace, paths: [join(install, 'resources', 'x.js')] },
    }, approval({ approver: a }))
    expect(mode).toBe('danger-full-access')
    expect(request.mock.calls[0]?.[0]).toMatchObject({ danger: ['gui'] })
  })

  it('marks every full-access escalation on an administrator desktop', async () => {
    vi.stubEnv(ELEVATED_ENV, '1')
    const { approver: a, request } = approver()
    await approveEscalation({
      requestedMode: 'danger-full-access',
      justification: 'run the build',
      effectiveMode: 'workspace-write',
      subject: 'command',
      action: { workspaceRoot: workspace, command: 'npm run build' },
    }, approval({ approver: a }))
    expect(request.mock.calls[0]?.[0]).toMatchObject({ danger: ['elevated'] })
  })

  it('sends an ordinary escalation without a danger field', async () => {
    const { approver: a, request } = approver()
    await approveEscalation({
      requestedMode: 'workspace-write',
      justification: 'write a file',
      effectiveMode: 'read-only',
      subject: 'command',
      action: { workspaceRoot: workspace, command: 'echo hi > a.txt' },
    }, approval({ approver: a }))
    expect(request.mock.calls[0]?.[0]).not.toHaveProperty('danger')
  })
})

describe('repeating standing full access', () => {
  it('still stops a protected action for a person', async () => {
    const { approver: a, request } = approver('rejected')
    await expect(approveEscalation({
      requestedMode: 'danger-full-access',
      justification: 'already allowed',
      effectiveMode: 'danger-full-access',
      subject: 'operation',
      action: { workspaceRoot: workspace, paths: [join(install, 'x')] },
    }, approval({ approver: a }))).rejects.toThrow(/did not approve this operation/)
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ danger: ['gui'] }))
  })

  it('returns the mode without asking for an ordinary action', async () => {
    const { approver: a, request } = approver()
    await expect(approveEscalation({
      requestedMode: 'danger-full-access',
      justification: 'already allowed',
      effectiveMode: 'danger-full-access',
      subject: 'operation',
      action: { workspaceRoot: workspace, paths: [join(workspace, 'a.ts')] },
    }, approval({ approver: a }))).resolves.toBe('danger-full-access')
    expect(request).not.toHaveBeenCalled()
  })
})

describe('approveProtectedAction (standing full access)', () => {
  it('lets an ordinary action through without asking', async () => {
    const { approver: a, request } = approver()
    await approveProtectedAction({ workspaceRoot: workspace, command: 'npm test' }, 'command', approval({ approver: a }))
    expect(request).not.toHaveBeenCalled()
  })

  it('does not guard .git or the administrator marker under full access', async () => {
    vi.stubEnv(ELEVATED_ENV, '1')
    const { approver: a, request } = approver()
    await approveProtectedAction({ workspaceRoot: workspace, paths: [join(workspace, '.git', 'config')] }, 'operation', approval({ approver: a }))
    expect(request).not.toHaveBeenCalled()
  })

  it('stops a protected action for a person and proceeds when allowed', async () => {
    const { approver: a, request } = approver('allowed-once')
    await approveProtectedAction({ workspaceRoot: workspace, paths: [join(install, 'resources', 'app.asar')] }, 'operation', approval({ approver: a }))
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ toolName: 'pwsh', callId: 'call-1', danger: ['gui'] }))
    expect(request.mock.calls[0]?.[0].reason).toContain('protected locations (gui)')
  })

  it.each(['rejected', 'cancelled'] as const)('refuses when the person answers %s, telling the model not to route around it', async (outcome) => {
    const { approver: a } = approver(outcome)
    await expect(approveProtectedAction({ workspaceRoot: workspace, paths: [join(install, 'x')] }, 'operation', approval({ approver: a })))
      .rejects.toThrow(/did not approve this operation.*do not retry it another way/)
  })

  it('fails closed without an approval channel', async () => {
    await expect(approveProtectedAction({ workspaceRoot: workspace, paths: [join(install, 'x')] }, 'command', approval()))
      .rejects.toThrow(/no approval channel/)
    const { approver: a } = approver()
    await expect(approveProtectedAction({ workspaceRoot: workspace, paths: [join(install, 'x')] }, 'command', { ...approval({ approver: a }), agent: undefined }))
      .rejects.toThrow(/no approval channel/)
  })
})
