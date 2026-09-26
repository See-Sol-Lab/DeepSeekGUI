import { afterEach, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
import { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SkillCandidate, SkillProviderControl } from '@deepseek-ai/dsh-skill'
import { ManagedSkillProvider, MANAGED_RANK, MANAGED_SOURCE } from '../src/provider.ts'
import { projectKeyOf } from '../src/selection.ts'
import { cleanup, install, mount, temp, writeSkill } from './support.ts'

afterEach(async () => { await cleanup() })

const control: SkillProviderControl = { signal: new AbortController().signal, invalidate: () => {} }

function candidate(directory: string, name: string): SkillCandidate {
  return {
    name,
    description: 'd',
    invocation: { modelInvocable: true, userInvocable: true },
    source: 'custom',
    provider: 'deepseekgui-skills',
    rank: 300,
    locator: { path: join(directory, 'SKILL.md'), directory },
  }
}

describe('ManagedSkillProvider', () => {
  it('does not load a selected install whose declared name no longer matches its manifest', async () => {
    const cwd = temp('dsh-project-')
    const harness = await mount({ sessions: { s: cwd } })
    const installId = await install(harness, writeSkill(join(harness.home, 'src', 'alpha'), 'alpha'))
    writeFileSync(join(harness.api.libraryDir, installId, 'SKILL.md'), '---\nname: other\ndescription: changed name\n---\nBody')
    const result = await harness.api.setProjectSelection({ sessionId: 's', enabled: [installId], revision: 0 }, harness.signal)
    expect(result.view.entries[0]?.effect).toBe('invalid')
    expect(await harness.ctx.skills.list({ cwd })).toEqual([])
    expect(await harness.ctx.skills.get('other', { cwd })).toBeUndefined()
  })

  it('lists nothing without a cwd, without a project, or with an empty selection', async () => {
    const list = vi.fn(async () => [candidate('/lib/a-00000001', 'a')])
    const enabledFor = vi.fn(async (cwd: string) => cwd === '/none' ? undefined : [])
    const provider = new ManagedSkillProvider(new Context(), control, { libraryDir: '/lib', watch: false, enabledFor, delegate: { list, get: async () => undefined } })
    expect(await provider.list({})).toEqual([])
    expect(await provider.list({ cwd: '/none' })).toEqual([])
    expect(await provider.list({ cwd: '/empty' })).toEqual([])
    expect(list).not.toHaveBeenCalled()
  })

  it('keeps only selected installs and relabels them, preserving an incomplete observation', async () => {
    const delegate = {
      list: vi.fn(async () => ({ candidates: [candidate('/lib/a-00000001', 'a'), candidate('/lib/b-00000002', 'b')], complete: false })),
      get: vi.fn(async () => undefined),
    }
    const provider = new ManagedSkillProvider(new Context(), control, {
      libraryDir: '/lib',
      watch: false,
      enabledFor: async () => ['b-00000002'],
      delegate,
    })
    const observation = await provider.list({ cwd: '/p' })
    expect(observation).toEqual({
      candidates: [expect.objectContaining({ name: 'b', source: MANAGED_SOURCE, rank: MANAGED_RANK })],
      complete: false,
    })
    const only = candidate('/lib/b-00000002', 'b')
    expect(await provider.get(only, { cwd: '/p' })).toBeUndefined()
    expect(delegate.get).toHaveBeenCalledWith(only, { cwd: '/p' })
  })

  it('builds the official filesystem delegate over the library when none is injected', async () => {
    const harness = await mount({ sessions: { s: temp('dsh-project-') } })
    const installId = await install(harness, writeSkill(join(harness.home, 'src', 'alpha'), 'alpha'))
    const cwd = harness.sessions.get('s')!
    const view = await harness.api.setProjectSelection({ sessionId: 's', enabled: [installId], revision: 0 }, harness.signal)
    expect(view.saved).toBe(true)
    const skills = await harness.ctx.skills.list({ cwd })
    expect(skills.map(skill => [skill.name, skill.source, skill.provider])).toEqual([['alpha', MANAGED_SOURCE, 'deepseekgui-skills']])
    expect(projectKeyOf(cwd)).toHaveLength(32)
  })
})

describe('session scope resolution', () => {
  it('reads the catalog under the live agent, else the recorded preset, else the global layer', async () => {
    const folder = temp('dsh-project-')
    const live = {}
    const standing = {}
    // 0.1.7: the registry hands out a reference-counted lease instead of a bare key; the provider
    // must release it after the read (counted here so a leak would show up as released < acquired).
    let released = 0
    const acquireScope = vi.fn(async (preset: string | undefined) => {
      if (preset === 'default') return { key: standing, [Symbol.asyncDispose]: async () => { released++ } }
      throw new Error('unknown preset')
    })
    const harness = await mount({
      sessions: { 'live-session': folder, 'cold-session': folder },
      agents: { get: sessionId => sessionId === 'live-session' ? live : undefined },
      agentPresets: { acquireScope },
    })
    const snapshot = vi.spyOn(harness.ctx.skills, 'snapshot')
    await harness.api.projectView('live-session' as SessionId, harness.signal)
    expect(snapshot).toHaveBeenLastCalledWith(expect.objectContaining({ cwd: folder, scope: live }))
    await harness.api.projectView('cold-session' as SessionId, harness.signal)
    expect(snapshot).toHaveBeenLastCalledWith(expect.objectContaining({ cwd: folder, scope: standing }))
    acquireScope.mockRejectedValueOnce(new Error('preset gone'))
    await harness.api.projectView('cold-session' as SessionId, harness.signal)
    expect(snapshot).toHaveBeenLastCalledWith(expect.objectContaining({ cwd: folder, scope: undefined }))
    // A session recorded without a preset, or read without projections, asks for the default standing scope.
    harness.presets.set('cold-session', null)
    await harness.api.projectView('cold-session' as SessionId, harness.signal)
    expect(acquireScope).toHaveBeenLastCalledWith(undefined)
    harness.presets.set('cold-session', 'none')
    await harness.api.projectView('cold-session' as SessionId, harness.signal)
    expect(acquireScope).toHaveBeenLastCalledWith(undefined)
    expect(released).toBe(1) // only the one successful acquire (the others rejected) — and it was released
  })

  it('still renders the page when the catalog read fails, marking it incomplete', async () => {
    const folder = temp('dsh-project-')
    const harness = await mount({ sessions: { s: folder } })
    const installId = await install(harness, writeSkill(join(harness.home, 'src', 'alpha'), 'alpha'))
    await harness.api.setProjectSelection({ sessionId: 's', enabled: [installId], revision: 0 }, harness.signal)
    const controller = new AbortController()
    // The session read succeeds, then the caller goes away before the catalog read.
    harness.onObserve = () => { controller.abort() }
    const view = await harness.api.projectView('s' as SessionId, controller.signal)
    expect(view.catalogComplete).toBe(false)
    expect(view.entries[0]).toMatchObject({ installId, enabled: true, effect: 'active' })
  })
})
