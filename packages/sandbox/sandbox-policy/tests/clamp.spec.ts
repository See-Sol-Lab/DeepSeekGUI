/**
 * Tests for DeepSeekGUI's policy clamp (2026-09-24): a chat-only workspace is
 * read-only even for an approved escalation; DeepSeekGUI's own code is
 * read-only as a standing mode but honours an approved escalation; an
 * administrator desktop never runs with standing full access. The policy text
 * tells the model why, so it stops probing.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, parse } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ELEVATED_ENV, GUI_ROOTS_ENV } from '@deepseek-ai/dsh-sandbox'
import type { SandboxMode } from '@deepseek-ai/dsh-sandbox'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import SandboxPolicyService, { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'

let install: string
let project: string

beforeEach(() => {
  install = mkdtempSync(join(tmpdir(), 'dsh-clamp-install-'))
  project = mkdtempSync(join(tmpdir(), 'dsh-clamp-project-'))
  vi.stubEnv(GUI_ROOTS_ENV, install)
  vi.stubEnv(ELEVATED_ENV, '')
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(install, { recursive: true, force: true })
  rmSync(project, { recursive: true, force: true })
})

async function mounted(mode: SandboxMode = 'workspace-write') {
  const ctx = new Context()
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(SandboxPolicyService, { mode, workspaceRoot: project })
  return ctx
}

function session(cwd: string, mode?: SandboxMode): Session {
  const id = SessionId(`clamp-${Math.random().toString(36).slice(2)}`)
  const created = Session.create(id, undefined, { version: SESSION_FORMAT_VERSION, id, createdAt: 0, isSeeded: false, cwd })
  if (mode !== undefined) setSandboxMode(created, mode)
  return created
}

async function policyText(ctx: Context, active: Session): Promise<string | undefined> {
  return (await ctx.systemPrompt.assemble({ agent: { session: active } as Partial<Agent> as Agent }))
    .contexts.find(context => context.name === 'sandbox:policy')?.text
}

describe('chat-only workspaces', () => {
  it.each([
    ['the home directory', () => homedir()],
    ['a drive root', () => parse(tmpdir()).root],
  ])('%s is read-only, even for an approved escalation', async (_name, root) => {
    const ctx = await mounted('danger-full-access')
    const active = session(root(), 'danger-full-access')
    expect(ctx.sandboxPolicy.resolve({ session: active }).mode).toBe('read-only')
    expect(ctx.sandboxPolicy.resolve({ session: active, mode: 'danger-full-access' }).mode).toBe('read-only')
    expect(await policyText(ctx, active)).toContain('it is chat-only')
  })
})

describe("DeepSeekGUI's own code", () => {
  it('is read-only as a standing mode, while an approved escalation applies to its call', async () => {
    const ctx = await mounted()
    const active = session(join(install, 'resources'), 'danger-full-access')
    expect(ctx.sandboxPolicy.resolve({ session: active }).mode).toBe('read-only')
    expect(ctx.sandboxPolicy.resolve({ session: active, mode: 'workspace-write' }).mode).toBe('workspace-write')
    expect(await policyText(ctx, active)).toContain("DeepSeekGUI's own code")
  })
})

describe('an administrator desktop', () => {
  it('turns standing full access into workspace-write, but honours an approved escalation', async () => {
    vi.stubEnv(ELEVATED_ENV, '1')
    const ctx = await mounted()
    const active = session(project, 'danger-full-access')
    expect(ctx.sandboxPolicy.resolve({ session: active }).mode).toBe('workspace-write')
    expect(ctx.sandboxPolicy.resolve({ session: active, mode: 'danger-full-access' }).mode).toBe('danger-full-access')
    expect(await policyText(ctx, active)).toContain('running as administrator')
  })

  it('leaves narrower modes alone', async () => {
    vi.stubEnv(ELEVATED_ENV, '1')
    const ctx = await mounted()
    expect(ctx.sandboxPolicy.resolve({ session: session(project, 'read-only') }).mode).toBe('read-only')
    expect(ctx.sandboxPolicy.resolve({ session: session(project, 'workspace-write') }).mode).toBe('workspace-write')
  })
})

describe('an ordinary project on an ordinary desktop', () => {
  it('keeps the mode it asked for and adds no notice', async () => {
    const ctx = await mounted()
    const active = session(project, 'danger-full-access')
    expect(ctx.sandboxPolicy.resolve({ session: active }).mode).toBe('danger-full-access')
    expect(await policyText(ctx, active)).toBe('Current DSH file policy: danger-full-access. The DSH file sandbox does not restrict file modifications by available operations.')
  })
})
