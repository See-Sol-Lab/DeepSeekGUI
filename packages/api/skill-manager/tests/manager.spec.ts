import { afterEach, expect, it, vi } from 'vitest'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, install, mount, temp, writeSkill } from './support.ts'

afterEach(async () => {
  vi.unstubAllEnvs()
  await cleanup()
})

it('mounts under the skillManager key with the library under the configured home', async () => {
  const { home, api } = await mount()
  expect(api.libraryDir).toBe(join(home, 'deepseekgui', 'skills'))
  expect(api.typertRemote).toBeDefined()
})

it('applies every location override and follows a switched DSH home when none is given', async () => {
  const home = temp()
  const { api } = await mount({
    config: {
      libraryDir: join(home, 'lib'),
      stagingDir: join(home, 'stage'),
      bundledSkillDir: join(home, 'bundled'),
    },
  })
  expect(api.libraryDir).toBe(join(home, 'lib'))
  const first = temp()
  const second = temp()
  vi.stubEnv('DSH_HOME', first)
  const roaming = await mount({ home: first, config: { dshHome: undefined, agentsHome: undefined } })
  expect(roaming.api.libraryDir).toBe(join(first, 'deepseekgui', 'skills'))
  writeSkill(join(second, 'deepseekgui', 'skills', 'alpha-00000001'), 'alpha')
  writeFileSync(join(second, 'deepseekgui', 'skills', 'alpha-00000001', 'deepseekgui-skill.json'), JSON.stringify({
    schemaVersion: 1,
    installId: 'alpha-00000001',
    name: 'alpha',
    description: 'd',
    installedAt: 't',
    updatedAt: 't',
    origin: { kind: 'directory', path: '/x', entry: 'SKILL.md' },
    files: 1,
    bytes: 1,
  }))
  vi.stubEnv('DSH_HOME', second)
  expect(roaming.api.libraryDir).toBe(join(second, 'deepseekgui', 'skills'))
  const inventory = await roaming.api.inventory(roaming.signal)
  expect(inventory.installed.map(item => item.installId)).toEqual(['alpha-00000001'])
})

it('reviews, installs, lists and uninstalls through the Remote methods and emits library changes', async () => {
  const { home, api, changes, signal } = await mount()
  const source = writeSkill(join(home, 'src', 'alpha'), 'alpha')
  const preview = await api.previewImport(source, signal)
  expect(preview.candidates.map(candidate => candidate.key)).toEqual(['SKILL.md'])
  const outcome = await api.applyImport({ path: source, selections: [{ key: 'SKILL.md', replaces: null }] }, signal)
  expect(outcome.failures).toEqual([])
  const installId = outcome.installed[0]!.installId
  expect((await api.inventory(signal)).installed.map(item => item.installId)).toEqual([installId])
  expect(await api.uninstall(installId, signal)).toMatchObject({ installId, removed: true, affected: [] })
  expect(existsSync(join(api.libraryDir, installId))).toBe(false)
  expect(changes).toEqual([{ kind: 'install', installId }, { kind: 'uninstall', installId }])
})

it('invalidates the registry catalog on every library change', async () => {
  const harness = await mount({ sessions: { s: temp('dsh-project-') } })
  const { api, ctx, signal } = harness
  const invalidations = vi.fn()
  ctx.on('skills/change', invalidations)
  const installId = await install(harness, writeSkill(join(harness.home, 'src', 'alpha'), 'alpha'))
  expect(invalidations).toHaveBeenCalledTimes(1)
  await api.applyImport({ path: join(harness.home, 'src', 'alpha'), selections: [{ key: 'SKILL.md', replaces: installId }] }, signal)
  expect(invalidations).toHaveBeenCalledTimes(2)
  await api.uninstall(installId, signal)
  expect(invalidations).toHaveBeenCalledTimes(3)
})

it('serializes writes and recovers the queue after a failed write', async () => {
  const { home, api, signal } = await mount()
  const source = writeSkill(join(home, 'src', 'alpha'), 'alpha')
  const broken = api.applyImport({ path: source, selections: undefined as never }, signal)
  const installing = api.applyImport({ path: source, selections: [{ key: 'SKILL.md', replaces: null }] }, signal)
  const uninstalling = installing.then(outcome => api.uninstall(outcome.installed[0]!.installId, signal))
  await expect(broken).rejects.toThrow()
  expect((await installing).installed).toHaveLength(1)
  expect((await uninstalling).removed).toBe(true)
  expect((await api.inventory(signal)).installed).toEqual([])
})

it('refuses already-aborted calls before touching the disk', async () => {
  const { home, api } = await mount()
  const aborted = AbortSignal.abort()
  await expect(api.inventory(aborted)).rejects.toThrow()
  await expect(api.previewImport(home, aborted)).rejects.toThrow()
  await expect(api.applyImport({ path: home, selections: [] }, aborted)).rejects.toThrow()
  await expect(api.uninstall('alpha-00000001', aborted)).rejects.toThrow()
  await expect(api.installReferences('alpha-00000001', aborted)).rejects.toThrow()
  await expect(api.projectView('s' as never, aborted)).rejects.toThrow()
  await expect(api.setProjectSelection({ sessionId: 's', enabled: [], revision: 0 }, aborted)).rejects.toThrow()
  expect(existsSync(join(home, 'deepseekgui'))).toBe(false)
})
