/**
 * Tests for DeepSeekGUI's full-access refusals (2026-09-24): the picker cannot
 * switch a chat-only workspace, DeepSeekGUI's own code, or an administrator
 * desktop to full access, and a deployment default of full access falls back
 * to workspace-write where it is refused. Each refusal names a keyword the
 * picker turns into the person's language.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ELEVATED_ENV, GUI_ROOTS_ENV } from '@deepseek-ai/dsh-sandbox'
import SessionStore, { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { createScope } from '@deepseek-ai/dsh-scope'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import PermissionPresetService from '@deepseek-ai/dsh-permission-presets'

let install: string
let project: string

beforeEach(() => {
  install = mkdtempSync(join(tmpdir(), 'dsh-refuse-install-'))
  project = mkdtempSync(join(tmpdir(), 'dsh-refuse-project-'))
  vi.stubEnv(GUI_ROOTS_ENV, install)
  vi.stubEnv(ELEVATED_ENV, '')
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(install, { recursive: true, force: true })
  rmSync(project, { recursive: true, force: true })
})

async function mounted(config: NonNullable<Parameters<typeof PermissionPresetService.Config>[0]> = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  ctx.provide('shell', {
    sandboxMode: 'workspace-write',
    resolve() { throw new Error('permission tests do not execute bash') },
    run() { throw new Error('permission tests do not execute bash') },
    start() { throw new Error('permission tests do not execute bash') },
  })
  ctx.provide('approval', { config: { policy: 'ask' } })
  await ctx.plugin(PermissionPresetService, config)
  return ctx
}

function session(cwd: string): Session {
  const id = SessionId(`refuse-${Math.random().toString(36).slice(2)}`)
  return Session.create(id, undefined, { version: SESSION_FORMAT_VERSION, id, createdAt: 0, isSeeded: false, cwd })
}

describe('switching to full access', () => {
  it('is refused in a chat-only workspace', async () => {
    const ctx = await mounted()
    expect(() => { ctx.permissionPresets.set(session(homedir()), 'danger-full-access') }).toThrow(/permission refused: chat-only workspace/)
  })

  it("is refused in DeepSeekGUI's own code", async () => {
    const ctx = await mounted()
    expect(() => { ctx.permissionPresets.set(session(install), 'danger-full-access') }).toThrow(/permission refused: DeepSeekGUI code/)
  })

  it('is refused on an administrator desktop', async () => {
    vi.stubEnv(ELEVATED_ENV, '1')
    const ctx = await mounted()
    expect(() => { ctx.permissionPresets.set(session(project), 'danger-full-access') }).toThrow(/permission refused: administrator/)
  })

  it('works in an ordinary project, and narrower presets are never refused', async () => {
    vi.stubEnv(ELEVATED_ENV, '1')
    const ctx = await mounted()
    expect(() => { ctx.permissionPresets.set(session(homedir()), 'workspace-write') }).not.toThrow()
    vi.stubEnv(ELEVATED_ENV, '')
    const active = session(project)
    ctx.permissionPresets.set(active, 'danger-full-access')
    expect(ctx.permissionPresets.current(active)).toBe('danger-full-access')
  })

  it('is refused through the /permission command the picker sends, leaving the session unchanged', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(CommandRuntime)
    ctx.provide('shell', {
      sandboxMode: 'workspace-write',
      resolve() { throw new Error('permission tests do not execute bash') },
      run() { throw new Error('permission tests do not execute bash') },
      start() { throw new Error('permission tests do not execute bash') },
    })
    await ctx.plugin(ApprovalService)
    await ctx.plugin(PermissionPresetService, {})
    const active = ctx.sessions.create(SessionId('refuse-command'), { meta: { cwd: homedir() } })
    const agent = { id: active.id, session: active, inject: vi.fn() } as Partial<Agent> as Agent
    await ctx.plugin(Object.assign((inner: Context) => { createScope(inner, agent) }, { inject: ['commands'] }))

    await expect(ctx.commands.execute(agent, '/permission danger-full-access', [], new AbortController().signal))
      .rejects.toThrow(/permission refused: chat-only workspace/)
    expect(ctx.permissionPresets.current(active)).toBe('workspace-write')
    expect(active.snapshotEvents().find(event => event.type === 'command/done')?.data).toMatchObject({ kind: 'error' })
  })
})

describe('a deployment default of full access', () => {
  it('falls back to workspace-write where full access is refused', async () => {
    vi.stubEnv(ELEVATED_ENV, '1')
    const ctx = await mounted({ defaultPreset: 'danger-full-access' })
    const active = ctx.sessions.create(SessionId('default-elevated'), { meta: { cwd: project } })
    expect(ctx.permissionPresets.current(active)).toBe('workspace-write')
    expect(active.snapshotEvents().find(event => event.type === 'sandbox/mode')?.data).toEqual({ mode: 'workspace-write' })
  })

  it('stays full access in an ordinary project', async () => {
    const ctx = await mounted({ defaultPreset: 'danger-full-access' })
    const active = ctx.sessions.create(SessionId('default-ordinary'), { meta: { cwd: project } })
    expect(ctx.permissionPresets.current(active)).toBe('danger-full-access')
  })
})
