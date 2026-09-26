/* oxlint-disable typescript/no-unsafe-assignment -- Vitest asymmetric matchers are typed as any. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { join, sep } from 'node:path'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SkillCandidate } from '@deepseek-ai/dsh-skill'
import { MANAGED_PROVIDER_NAME, MANAGED_RANK, MANAGED_SOURCE, projectKeyOf } from '../src/index.ts'
import { buildProjectView, nameOfInstallId, resolveProject } from '../src/selection.ts'
import { cleanup, install, mount, temp, writeSkill, type Harness } from './support.ts'

afterEach(async () => {
  vi.unstubAllEnvs()
  await cleanup()
})

const sid = (id: string): SessionId => id as SessionId

/** Two projects and two installs: the acceptance script's writing / art folders. */
async function twoProjects(): Promise<Harness & { writing: string; art: string; proof: string; images: string }> {
  const writing = temp('dsh-project-writing-')
  const art = temp('dsh-project-art-')
  const harness = await mount({ sessions: { 'writing-a': writing, 'writing-b': writing, 'art-a': art, 'no-folder': undefined } })
  const proof = await install(harness, writeSkill(join(harness.home, 'src', 'proofread'), 'proofread'))
  const images = await install(harness, writeSkill(join(harness.home, 'src', 'image-tools'), 'image-tools'))
  return { ...harness, writing, art, proof, images }
}

describe('project identity', () => {
  it('hashes the canonical folder and treats spellings of one folder as one project', async () => {
    const folder = temp('dsh-identity-')
    const plain = await resolveProject(folder)
    expect(plain.project).toEqual({ key: projectKeyOf(folder), path: folder })
    expect(plain.project?.key).toMatch(/^[0-9a-f]{32}$/u)
    const trailing = await resolveProject(`${folder}${sep}`)
    expect(trailing.project?.key).toBe(plain.project?.key)
    const dotted = await resolveProject(join(folder, 'sub', '..'))
    expect(dotted.project?.key).toBe(plain.project?.key)
    if (process.platform === 'win32') {
      const upper = await resolveProject(folder.toUpperCase())
      expect(upper.project?.key).toBe(plain.project?.key)
    }
    const link = join(temp('dsh-identity-link-'), 'link')
    try {
      symlinkSync(folder, link, 'dir')
    } catch {
      return
    }
    // A symlink resolves to its target: the same project.
    expect((await resolveProject(link)).project?.key).toBe(plain.project?.key)
  })

  it('reports why a session has no project', async () => {
    expect(await resolveProject(undefined)).toEqual({ project: null, problem: 'no-cwd' })
    expect(await resolveProject('')).toEqual({ project: null, problem: 'no-cwd' })
    expect(await resolveProject(join(temp(), 'gone'))).toEqual({ project: null, problem: 'missing-folder' })
    expect(await resolveProject('relative/path')).toEqual({ project: null, problem: 'missing-folder' })
  })

  it('recovers a display name from an install id', () => {
    expect(nameOfInstallId('pdf-tools-0a1b2c3d')).toBe('pdf-tools')
    expect(nameOfInstallId('weird')).toBe('weird')
  })

  it('folds case only on Windows', () => {
    expect(projectKeyOf('/Proj', 'linux')).not.toBe(projectKeyOf('/proj', 'linux'))
    expect(projectKeyOf('C:\\Proj', 'win32')).toBe(projectKeyOf('c:\\proj', 'win32'))
  })
})

describe('project page and selection', () => {
  it('starts every project unselected: a fresh install is in no session catalog', async () => {
    const harness = await twoProjects()
    const { api, signal, writing, proof, images } = harness
    const view = await api.projectView(sid('writing-a'), signal)
    expect(view.project).toEqual({ key: projectKeyOf(writing), path: writing })
    expect(view.revision).toBe(0)
    expect(view.catalogComplete).toBe(true)
    expect(view.entries.map(entry => [entry.installId, entry.enabled, entry.effect])).toEqual([
      [images, false, 'inactive'],
      [proof, false, 'inactive'],
    ])
    expect(await harness.ctx.skills.list({ cwd: writing })).toEqual([])
    expect(await harness.ctx.skills.get('proofread', { cwd: writing })).toBeUndefined()
  })

  it('saves per project, shares the selection across sessions of one folder, and keeps folders apart', async () => {
    const harness = await twoProjects()
    const { api, signal, writing, art, proof, images, ctx } = harness
    const saved = await api.setProjectSelection({ sessionId: 'writing-a', enabled: [proof], revision: 0 }, signal)
    expect(saved.saved).toBe(true)
    expect(saved.view.revision).toBe(1)
    expect(saved.view.entries.find(entry => entry.installId === proof)).toMatchObject({ enabled: true, effect: 'active' })
    expect(harness.changes.at(-1)).toEqual({ kind: 'selection', projectKey: projectKeyOf(writing) })
    // The other session of the same folder reads the same selection.
    const sibling = await api.projectView(sid('writing-b'), signal)
    expect(sibling.revision).toBe(1)
    expect(sibling.entries.find(entry => entry.installId === proof)?.enabled).toBe(true)
    // The art folder is untouched.
    const other = await api.projectView(sid('art-a'), signal)
    expect(other.revision).toBe(0)
    expect(other.entries.every(entry => !entry.enabled)).toBe(true)
    await api.setProjectSelection({ sessionId: 'art-a', enabled: [images], revision: 0 }, signal)
    // The real catalog follows: each folder sees only its own choice, with the managed source and rank.
    const writingSkills = await ctx.skills.list({ cwd: writing })
    expect(writingSkills.map(skill => [skill.name, skill.provider, skill.source])).toEqual([['proofread', MANAGED_PROVIDER_NAME, MANAGED_SOURCE]])
    expect((await ctx.skills.list({ cwd: art })).map(skill => skill.name)).toEqual(['image-tools'])
    const loaded = await ctx.skills.get('proofread', { cwd: writing })
    expect(loaded?.content).toContain('Body of proofread')
    expect(loaded?.resourceBase).toEqual({ kind: 'directory', path: join(api.libraryDir, proof) })
    expect(await ctx.skills.get('image-tools', { cwd: writing })).toBeUndefined()
    expect(await ctx.skills.get('proofread', { cwd: art })).toBeUndefined()
    // The record is one small document per project under the storage root.
    const documents = readdirSync(join(harness.home, 'storages', 'deepseekgui_skills', 'projects'))
    expect(documents.sort()).toEqual([`${projectKeyOf(art)}.json`, `${projectKeyOf(writing)}.json`].sort())
    expect(readFileSync(join(harness.home, 'storages', 'deepseekgui_skills', 'projects', `${projectKeyOf(writing)}.json`), 'utf8')).toContain(proof)
  })

  it('unticking removes the skill from the catalog and the loader without touching the package', async () => {
    const harness = await twoProjects()
    const { api, signal, writing, proof, ctx } = harness
    await api.setProjectSelection({ sessionId: 'writing-a', enabled: [proof], revision: 0 }, signal)
    expect((await ctx.skills.list({ cwd: writing })).map(skill => skill.name)).toEqual(['proofread'])
    const changes = vi.fn()
    ctx.on('skills/change', changes)
    const cleared = await api.setProjectSelection({ sessionId: 'writing-a', enabled: [], revision: 1 }, signal)
    expect(cleared.saved).toBe(true)
    expect(changes).toHaveBeenCalled()
    expect(await ctx.skills.list({ cwd: writing })).toEqual([])
    expect(await ctx.skills.get('proofread', { cwd: writing })).toBeUndefined()
    expect(existsSync(join(api.libraryDir, proof, 'SKILL.md'))).toBe(true)
    expect((await api.inventory(signal)).installed.map(item => item.installId)).toContain(proof)
  })

  it('refuses a stale page and hands back the winning selection', async () => {
    const harness = await twoProjects()
    const { api, signal, proof, images } = harness
    await api.setProjectSelection({ sessionId: 'writing-a', enabled: [proof], revision: 0 }, signal)
    const stale = await api.setProjectSelection({ sessionId: 'writing-b', enabled: [images], revision: 0 }, signal)
    expect(stale.saved).toBe(false)
    expect(stale.issue).toEqual({ code: 'revision-conflict', message: expect.stringContaining('revision 1') })
    expect(stale.view.revision).toBe(1)
    expect(stale.view.entries.find(entry => entry.installId === proof)?.enabled).toBe(true)
    expect(stale.view.entries.find(entry => entry.installId === images)?.enabled).toBe(false)
  })

  it('refuses an install id that is not in the library', async () => {
    const harness = await twoProjects()
    const { api, signal } = harness
    const outcome = await api.setProjectSelection({ sessionId: 'writing-a', enabled: ['ghost-00000000'], revision: 0 }, signal)
    expect(outcome.saved).toBe(false)
    expect(outcome.issue).toEqual({ code: 'unknown-install', message: expect.stringContaining('ghost-00000000') })
    expect(outcome.view.revision).toBe(0)
  })

  it('has no project for a session without a folder or with a folder that is gone', async () => {
    const harness = await twoProjects()
    const { api, signal, proof } = harness
    const none = await api.projectView(sid('no-folder'), signal)
    expect(none).toMatchObject({ project: null, problem: 'no-cwd', revision: 0, catalogComplete: false })
    expect(none.entries.every(entry => entry.effect === 'inactive')).toBe(true)
    const refused = await api.setProjectSelection({ sessionId: 'no-folder', enabled: [proof], revision: 0 }, signal)
    expect(refused.saved).toBe(false)
    expect(refused.issue?.code).toBe('no-project')
    const gone = join(harness.home, 'gone')
    harness.sessions.set('writing-a', gone)
    expect((await api.projectView(sid('writing-a'), signal)).problem).toBe('missing-folder')
    expect(await harness.ctx.skills.list({ cwd: gone })).toEqual([])
    await expect(api.projectView(sid('unknown-session'), signal)).rejects.toThrow('not found')
  })

  it('survives a restart of the same home and stays apart from another home', async () => {
    const first = await twoProjects()
    await first.api.setProjectSelection({ sessionId: 'writing-a', enabled: [first.proof], revision: 0 }, first.signal)
    await first.ctx.fiber.dispose()
    const again = await mount({ home: first.home, sessions: { 'writing-a': first.writing } })
    const view = await again.api.projectView(sid('writing-a'), again.signal)
    expect(view.revision).toBe(1)
    expect(view.entries.find(entry => entry.installId === first.proof)).toMatchObject({ enabled: true, effect: 'active' })
    expect((await again.ctx.skills.list({ cwd: first.writing })).map(skill => skill.name)).toEqual(['proofread'])
    // Another home: its own library and its own selection for the very same folder.
    const elsewhere = await mount({ sessions: { 'writing-a': first.writing } })
    const foreign = await elsewhere.api.projectView(sid('writing-a'), elsewhere.signal)
    expect(foreign.revision).toBe(0)
    expect(foreign.entries).toEqual([])
    expect(await elsewhere.ctx.skills.list({ cwd: first.writing })).toEqual([])
  })
})

describe('update, uninstall and shadowing', () => {
  it('keeps the selection across a replacement of the same install', async () => {
    const harness = await twoProjects()
    const { api, signal, writing, proof, ctx } = harness
    await api.setProjectSelection({ sessionId: 'writing-a', enabled: [proof], revision: 0 }, signal)
    const source = writeSkill(join(harness.home, 'src', 'proofread'), 'proofread', 'second edition')
    const outcome = await api.applyImport({ path: source, selections: [{ key: 'SKILL.md', replaces: proof }] }, signal)
    expect(outcome.installed[0]?.installId).toBe(proof)
    const view = await api.projectView(sid('writing-a'), signal)
    expect(view.entries.find(entry => entry.installId === proof)).toMatchObject({ enabled: true, effect: 'active', description: 'second edition' })
    expect((await ctx.skills.list({ cwd: writing }))[0]?.description).toBe('second edition')
  })

  it('names the affected projects before and after an uninstall, and leaves a missing reference the project clears itself', async () => {
    const harness = await twoProjects()
    const { api, signal, writing, art, proof, ctx } = harness
    await api.setProjectSelection({ sessionId: 'writing-a', enabled: [proof], revision: 0 }, signal)
    await api.setProjectSelection({ sessionId: 'art-a', enabled: [proof], revision: 0 }, signal)
    const refs = await api.installReferences(proof, signal)
    expect(refs.projects.map(project => project.path).sort()).toEqual([art, writing].sort())
    expect((await api.installReferences('nobody-00000000', signal)).projects).toEqual([])
    // Another package with the same name sits in the library; nothing must switch to it.
    const twin = await install(harness, writeSkill(join(harness.home, 'src', 'twin'), 'proofread-twin'))
    const outcome = await api.uninstall(proof, signal)
    expect(outcome.removed).toBe(true)
    expect(outcome.affected.map(project => project.path).sort()).toEqual([art, writing].sort())
    const view = await api.projectView(sid('writing-a'), signal)
    const missing = view.entries.find(entry => entry.installId === proof)
    expect(missing).toMatchObject({ enabled: true, effect: 'missing', name: 'proofread', status: 'invalid', issue: { code: 'unknown-install' } })
    expect(view.entries.find(entry => entry.installId === twin)?.enabled).toBe(false)
    expect(await ctx.skills.list({ cwd: writing })).toEqual([])
    // Saving around the missing reference keeps it; dropping it clears it.
    const kept = await api.setProjectSelection({ sessionId: 'writing-a', enabled: [proof, twin], revision: 1 }, signal)
    expect(kept.saved).toBe(true)
    expect(kept.view.entries.find(entry => entry.installId === proof)?.effect).toBe('missing')
    const cleared = await api.setProjectSelection({ sessionId: 'writing-a', enabled: [twin], revision: 2 }, signal)
    expect(cleared.view.entries.map(entry => entry.installId)).toEqual([harness.images, twin])
    expect((await api.installReferences(proof, signal)).projects.map(project => project.path)).toEqual([art])
  })

  it('marks a selected install that fails validation, and one an official same-name skill shadows', async () => {
    const harness = await twoProjects()
    const { api, signal, writing, proof, images, ctx } = harness
    await api.setProjectSelection({ sessionId: 'writing-a', enabled: [proof, images], revision: 0 }, signal)
    // Corrupt the installed copy: the row says invalid instead of pretending it loads.
    writeFileSync(join(api.libraryDir, images, 'SKILL.md'), '---\nname: image-tools\n---\n')
    // An official-style provider with the same name at a better rank wins the merge.
    ctx.skills.registerProvider(() => ({
      name: 'official-user-root',
      list: async (): Promise<SkillCandidate[]> => [{
        name: 'proofread',
        description: 'the user root copy',
        invocation: { modelInvocable: true, userInvocable: true },
        source: 'user-dsh',
        provider: 'official-user-root',
        rank: 400,
        locator: {},
      }],
      get: async () => undefined,
    }))
    const view = await api.projectView(sid('writing-a'), signal)
    expect(view.entries.find(entry => entry.installId === images)).toMatchObject({ effect: 'invalid', status: 'invalid' })
    expect(view.entries.find(entry => entry.installId === proof)).toMatchObject({
      effect: 'shadowed',
      shadowedBy: { source: 'user-dsh', provider: 'official-user-root' },
    })
    const winners = await ctx.skills.list({ cwd: writing })
    expect(winners.map(skill => [skill.name, skill.provider])).toEqual([['proofread', 'official-user-root']])
    expect(MANAGED_RANK).toBeGreaterThan(400)
  })

  it('serializes concurrent saves so a revision is never overwritten unseen', async () => {
    const harness = await twoProjects()
    const { api, signal, proof, images } = harness
    const [first, second] = await Promise.all([
      api.setProjectSelection({ sessionId: 'writing-a', enabled: [proof], revision: 0 }, signal),
      api.setProjectSelection({ sessionId: 'writing-b', enabled: [images], revision: 0 }, signal),
    ])
    expect([first.saved, second.saved].filter(Boolean)).toHaveLength(1)
    const view = await api.projectView(sid('writing-a'), signal)
    expect(view.revision).toBe(1)
    expect(view.entries.filter(entry => entry.enabled)).toHaveLength(1)
  })
})

describe('buildProjectView', () => {
  const installed = (installId: string, name: string, status: 'ok' | 'invalid' = 'ok') => ({
    schemaVersion: 1 as const,
    installId,
    name,
    description: `${name} description`,
    installedAt: 't',
    updatedAt: 't',
    origin: { kind: 'directory' as const, path: '/src', entry: 'SKILL.md' },
    files: 1,
    bytes: 1,
    location: `/lib/${installId}`,
    status,
    ...status === 'invalid' ? { issue: { code: 'missing-description' as const, message: 'no description' } } : {},
  })
  const resolution = { project: { key: 'k', path: '/p' } }

  it('guesses active when the catalog could not be read and falls back to invalid when a complete catalog lacks the name', () => {
    const record = { path: '/p', enabled: ['a-00000001'], revision: 3, updatedAt: 't' }
    const unread = buildProjectView({ sessionId: 's', resolution, record, installed: [installed('a-00000001', 'a')], catalog: undefined })
    expect(unread.entries[0]).toMatchObject({ effect: 'active' })
    expect(unread.catalogComplete).toBe(false)
    const partial = buildProjectView({ sessionId: 's', resolution, record, installed: [installed('a-00000001', 'a')], catalog: { skills: [], complete: false } })
    expect(partial.entries[0]).toMatchObject({ effect: 'active' })
    const complete = buildProjectView({ sessionId: 's', resolution, record, installed: [installed('a-00000001', 'a')], catalog: { skills: [], complete: true } })
    expect(complete.entries[0]).toMatchObject({ effect: 'invalid' })
    expect(complete.revision).toBe(3)
  })

  it('sorts rows by name then id and carries invalid issues through', () => {
    const view = buildProjectView({
      sessionId: 's',
      resolution: { project: null, problem: 'no-cwd' },
      record: undefined,
      installed: [installed('b-00000002', 'b'), installed('a-00000002', 'a', 'invalid'), installed('a-00000001', 'a')],
      catalog: undefined,
    })
    expect(view.entries.map(entry => entry.installId)).toEqual(['a-00000001', 'a-00000002', 'b-00000002'])
    expect(view.entries[1]).toMatchObject({ status: 'invalid', issue: { code: 'missing-description' }, effect: 'inactive' })
    expect(view.problem).toBe('no-cwd')
  })
})
