/* oxlint-disable typescript/no-unsafe-assignment -- Vitest asymmetric matchers are typed as any. */
import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { contentHash, normalizeContent, sameScope, scopeMatches } from '../src/index.ts'
import { realClock } from '../src/store.ts'
import { assistant, cleanup, mount, projectScope, temp, user } from './support.ts'

afterEach(async () => { await cleanup() })

const GLOBAL = { kind: 'global' } as const

describe('remember and read', () => {
  it('persists an entry with a stable id, origin source and version 1, then reads it back after a restart', async () => {
    const first = await mount()
    const scope = await projectScope(first, temp('dsh-project-'))
    const result = await first.api.remember({ scope, kind: 'fact', content: '  Build with pnpm run build  ', keywords: ['build', ' build ', ''], source: assistant }, first.signal)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.entry).toEqual({
      id: 'm_000000000001',
      scope,
      kind: 'fact',
      content: 'Build with pnpm run build',
      keywords: ['build'],
      source: { kind: 'assistant', sessionId: 's1', evidence: 'package.json', at: '2026-09-13T12:00:00.000Z' },
      version: 1,
      createdAt: '2026-09-13T12:00:00.000Z',
      updatedAt: '2026-09-13T12:00:00.000Z',
    })
    expect(first.changes).toEqual([{ action: 'remember', ids: ['m_000000000001'] }])
    // One readable document per entry.
    const document = JSON.parse(readFileSync(join(first.domainRoot, 'entries', 'm_000000000001.json'), 'utf8')) as Record<string, unknown>
    expect(JSON.stringify(document)).toContain('Build with pnpm run build')
    expect(await first.api.get('m_000000000001', first.signal)).toEqual(result.entry)
    expect(await first.api.get('m_ffffffffffff', first.signal)).toBeNull()
    await first.ctx.fiber.dispose()
    const again = await mount({ home: first.home })
    expect((await again.api.list({ scope: { kind: 'all' } }, again.signal)).entries).toEqual([result.entry])
    expect(await again.api.status(again.signal)).toEqual({ injection: 'markdown', active: 1, forgotten: 0, globalFile: join(first.home, 'memory.md') })
  })

  it('rejects empty, oversized and malformed input before writing anything', async () => {
    const harness = await mount({ config: { contentMaxBytes: 20, maxKeywords: 2 } })
    const { api, signal } = harness
    const cases = [
      { scope: GLOBAL, kind: 'fact', content: '   ', source: user },
      { scope: GLOBAL, kind: 'fact', content: 'x'.repeat(21), source: user },
      { scope: GLOBAL, kind: 'fact', content: 'ok', keywords: ['a', 'b', 'c'], source: user },
      { scope: GLOBAL, kind: 'wish', content: 'ok', source: user },
      { scope: { kind: 'project', projectKey: '', path: '' }, kind: 'fact', content: 'ok', source: user },
    ] as const
    for (const input of cases) {
      const result = await api.remember(input as never, signal)
      expect(result.ok, JSON.stringify(input)).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('MEMORY_INVALID')
    }
    expect(await api.status(signal)).toMatchObject({ active: 0 })
    expect(existsSync(join(harness.domainRoot, 'entries'))).toBe(false)
  })

  it('keeps global and project entries apart, and two projects with one folder name apart', async () => {
    const harness = await mount()
    const { api, signal } = harness
    const leftDir = join(temp('dsh-a-'), 'proj')
    const rightDir = join(temp('dsh-b-'), 'proj')
    mkdirSync(leftDir)
    mkdirSync(rightDir)
    const left = await projectScope(harness, leftDir)
    const right = await projectScope(harness, rightDir)
    expect(left.kind === 'project' && right.kind === 'project' && left.projectKey !== right.projectKey).toBe(true)
    await api.remember({ scope: GLOBAL, kind: 'preference', content: 'Answer in Chinese', source: user }, signal)
    harness.tick()
    await api.remember({ scope: left, kind: 'fact', content: 'left uses vitest', source: assistant }, signal)
    harness.tick()
    await api.remember({ scope: right, kind: 'fact', content: 'right uses jest', source: assistant }, signal)
    const key = (scope: typeof left): string => scope.kind === 'project' ? scope.projectKey : ''
    expect((await api.list({ scope: { kind: 'global' } }, signal)).entries.map(entry => entry.content)).toEqual(['Answer in Chinese'])
    expect((await api.list({ scope: { kind: 'project', projectKey: key(left) } }, signal)).entries.map(entry => entry.content)).toEqual(['left uses vitest'])
    expect((await api.list({ scope: { kind: 'session', projectKey: key(right) } }, signal)).entries.map(entry => entry.content))
      .toEqual(['right uses jest', 'Answer in Chinese'])
    expect((await api.list({ scope: { kind: 'all' } }, signal)).total).toBe(3)
    expect((await api.list({ scope: { kind: 'all' }, kinds: ['preference'] }, signal)).entries.map(entry => entry.kind)).toEqual(['preference'])
    expect((await api.list({ scope: { kind: 'all' }, text: 'uses VITEST' }, signal)).entries.map(entry => entry.content)).toEqual(['left uses vitest'])
    expect((await api.list({ scope: { kind: 'all' }, text: 'uses nothing' }, signal)).entries).toEqual([])
    expect((await api.list({ scope: { kind: 'all' }, limit: 1 }, signal))).toMatchObject({ total: 3, entries: [expect.objectContaining({ content: 'right uses jest' })] })
    expect(await api.projectScope(join(harness.home, 'gone'), signal)).toBeNull()
  })
})

describe('correct, undo, forget, restore', () => {
  it('corrects without losing the origin, undoes one level, and redoes on a second undo', async () => {
    const harness = await mount()
    const { api, signal } = harness
    const created = await api.remember({ scope: GLOBAL, kind: 'fact', content: 'Port is 3000', keywords: ['port'], source: assistant }, signal)
    if (!created.ok) throw new Error('remember failed')
    harness.tick()
    const corrected = await api.correct({ id: created.entry.id, expectedVersion: 1, content: 'Port is 3100', source: user }, signal)
    expect(corrected.ok).toBe(true)
    if (!corrected.ok) return
    expect(corrected.entry).toMatchObject({
      version: 2,
      content: 'Port is 3100',
      keywords: ['port'],
      source: created.entry.source,
      revised: { action: 'correct', at: '2026-09-13T12:00:01.000Z', source: { kind: 'user', sessionId: 's1', at: '2026-09-13T12:00:01.000Z' } },
      previous: { version: 1, content: 'Port is 3000', keywords: ['port'], kind: 'fact', updatedAt: '2026-09-13T12:00:00.000Z' },
      updatedAt: '2026-09-13T12:00:01.000Z',
    })
    expect(corrected.entry.previous?.revised).toBeUndefined()
    // Only the corrected text is findable now.
    expect((await api.list({ scope: { kind: 'all' }, text: '3000' }, signal)).entries).toEqual([])
    expect((await api.list({ scope: { kind: 'all' }, text: '3100' }, signal)).entries).toHaveLength(1)
    harness.tick()
    const undone = await api.undo({ id: created.entry.id, expectedVersion: 2, source: user }, signal)
    expect(undone.ok).toBe(true)
    if (!undone.ok) return
    expect(undone.entry).toMatchObject({ version: 3, content: 'Port is 3000', revised: { action: 'undo' }, previous: { version: 2, content: 'Port is 3100', revised: { action: 'correct' } } })
    const redone = await api.undo({ id: created.entry.id, expectedVersion: 3, source: user }, signal)
    expect(redone.ok && redone.entry.content).toBe('Port is 3100')
    expect(harness.changes.map(change => change.action)).toEqual(['remember', 'correct', 'undo', 'undo'])
    // A kind or keyword change alone is a correction too; an empty one is not.
    const rekind = await api.correct({ id: created.entry.id, expectedVersion: 4, kind: 'preference', keywords: [], source: user }, signal)
    expect(rekind.ok && rekind.entry).toMatchObject({ kind: 'preference', keywords: [], content: 'Port is 3100', version: 5 })
    const nothing = await api.correct({ id: created.entry.id, expectedVersion: 5, source: user }, signal)
    expect(!nothing.ok && nothing.error.code).toBe('MEMORY_INVALID')
    const blank = await api.correct({ id: created.entry.id, expectedVersion: 5, content: ' ', source: user }, signal)
    expect(!blank.ok && blank.error.code).toBe('MEMORY_INVALID')
    const badKind = await api.correct({ id: created.entry.id, expectedVersion: 5, kind: 'wish' as never, source: user }, signal)
    expect(!badKind.ok && badKind.error.code).toBe('MEMORY_INVALID')
  })

  it('refuses a stale version, an unknown id, and undo without a previous state', async () => {
    const harness = await mount()
    const { api, signal } = harness
    const created = await api.remember({ scope: GLOBAL, kind: 'fact', content: 'A', source: user }, signal)
    if (!created.ok) throw new Error('remember failed')
    const stale = await api.correct({ id: created.entry.id, expectedVersion: 7, content: 'B', source: user }, signal)
    expect(stale).toEqual({ ok: false, error: { code: 'MEMORY_CONFLICT', message: expect.stringContaining('version 1'), currentVersion: 1 } })
    expect((await api.get(created.entry.id, signal))?.content).toBe('A')
    const missing = await api.correct({ id: 'm_ffffffffffff', expectedVersion: 1, content: 'B', source: user }, signal)
    expect(!missing.ok && missing.error.code).toBe('MEMORY_NOT_FOUND')
    const noPrevious = await api.undo({ id: created.entry.id, expectedVersion: 1, source: user }, signal)
    expect(!noPrevious.ok && noPrevious.error.code).toBe('MEMORY_NO_PREVIOUS')
    const staleForget = await api.forget({ id: created.entry.id, expectedVersion: 0, source: user }, signal)
    expect(!staleForget.ok && staleForget.error.code).toBe('MEMORY_CONFLICT')
  })

  it('serializes two windows writing one entry so the second sees a conflict instead of losing the first', async () => {
    const harness = await mount()
    const { api, signal } = harness
    const created = await api.remember({ scope: GLOBAL, kind: 'fact', content: 'v1', source: user }, signal)
    if (!created.ok) throw new Error('remember failed')
    const [left, right] = await Promise.all([
      api.correct({ id: created.entry.id, expectedVersion: 1, content: 'from window A', source: { kind: 'user', sessionId: 'a' } }, signal),
      api.correct({ id: created.entry.id, expectedVersion: 1, content: 'from window B', source: { kind: 'user', sessionId: 'b' } }, signal),
    ])
    expect(left.ok).toBe(true)
    expect(right).toEqual({ ok: false, error: expect.objectContaining({ code: 'MEMORY_CONFLICT', currentVersion: 2 }) })
    expect((await api.get(created.entry.id, signal))?.content).toBe('from window A')
    // Two concurrent remembers never collide on ids and both land.
    const [one, two] = await Promise.all([
      api.remember({ scope: GLOBAL, kind: 'fact', content: 'one', source: user }, signal),
      api.remember({ scope: GLOBAL, kind: 'fact', content: 'two', source: user }, signal),
    ])
    expect(one.ok && two.ok && one.entry.id !== two.entry.id).toBe(true)
    expect((await api.status(signal)).active).toBe(3)
  })

  it('forgets out of every read, keeps a tombstone that refuses stale writes, and restores only on request', async () => {
    const harness = await mount()
    const { api, signal } = harness
    const created = await api.remember({ scope: GLOBAL, kind: 'fact', content: 'secret token lives in .env', keywords: ['env'], source: user }, signal)
    if (!created.ok) throw new Error('remember failed')
    harness.tick()
    const forgotten = await api.forget({ id: created.entry.id, expectedVersion: 1, source: user }, signal)
    expect(forgotten.ok && forgotten.entry.content).toBe('secret token lives in .env')
    expect(await api.get(created.entry.id, signal)).toBeNull()
    expect((await api.list({ scope: { kind: 'all' }, text: 'token' }, signal)).entries).toEqual([])
    expect((await api.list({ scope: { kind: 'all' } }, signal)).total).toBe(0)
    expect(await api.status(signal)).toMatchObject({ active: 0, forgotten: 1 })
    // The text is on disk only under forgotten/, and the live document is a tombstone.
    expect(readdirSync(join(harness.domainRoot, 'forgotten'))).toEqual([`${created.entry.id}.json`])
    const tombstone = readFileSync(join(harness.domainRoot, 'entries', `${created.entry.id}.json`), 'utf8')
    expect(tombstone).not.toContain('secret token')
    // A window that still holds version 1 cannot revive it through a correction or an undo.
    const revive = await api.correct({ id: created.entry.id, expectedVersion: 1, content: 'back', source: user }, signal)
    expect(revive).toEqual({ ok: false, error: expect.objectContaining({ code: 'MEMORY_FORGOTTEN', currentVersion: 2 }) })
    expect(!(await api.undo({ id: created.entry.id, expectedVersion: 2, source: user }, signal)).ok).toBe(true)
    expect(await api.get(created.entry.id, signal)).toBeNull()
    // The forgotten page lists it; restore is the only way back.
    const kept = await api.listForgotten({ kind: 'global' }, signal)
    expect(kept).toEqual([{ entry: expect.objectContaining({ id: created.entry.id, content: 'secret token lives in .env' }), forgottenAt: '2026-09-13T12:00:01.000Z', forgottenBy: expect.objectContaining({ kind: 'user' }) }])
    expect(await api.listForgotten({ kind: 'project', projectKey: 'other' }, signal)).toEqual([])
    harness.tick()
    const restored = await api.restore({ id: created.entry.id, source: user }, signal)
    expect(restored.ok && restored.entry).toMatchObject({ version: 3, content: 'secret token lives in .env', revised: { action: 'restore' } })
    expect((await api.list({ scope: { kind: 'all' }, text: 'token' }, signal)).entries).toHaveLength(1)
    expect(await api.status(signal)).toMatchObject({ active: 1, forgotten: 0 })
    expect(!(await api.restore({ id: created.entry.id, source: user }, signal)).ok).toBe(true)
    expect(harness.changes.map(change => change.action)).toEqual(['remember', 'forget', 'restore'])
  })

  it('refuses to restore an entry that is live or unknown', async () => {
    const harness = await mount()
    const { api, signal } = harness
    const created = await api.remember({ scope: GLOBAL, kind: 'fact', content: 'live', source: user }, signal)
    if (!created.ok) throw new Error('remember failed')
    expect(!(await api.restore({ id: 'm_ffffffffffff', source: user }, signal)).ok).toBe(true)
    // A forgotten copy beside a live entry (a crash between the two writes) answers a conflict, never a second live copy.
    await api.forget({ id: created.entry.id, expectedVersion: 1, source: user }, signal)
    const stillForgotten = readFileSync(join(harness.domainRoot, 'forgotten', `${created.entry.id}.json`), 'utf8')
    await api.restore({ id: created.entry.id, source: user }, signal)
    writeFileSync(join(harness.domainRoot, 'forgotten', `${created.entry.id}.json`), stillForgotten)
    await harness.ctx.fiber.dispose()
    const again = await mount({ home: harness.home })
    const conflict = await again.api.restore({ id: created.entry.id, source: user }, again.signal)
    expect(conflict).toEqual({ ok: false, error: expect.objectContaining({ code: 'MEMORY_CONFLICT', currentVersion: 3 }) })
    // A tombstone without its forgotten copy (the copy was removed by hand) is simply not found.
    const loner = await again.api.remember({ scope: GLOBAL, kind: 'fact', content: 'loner', source: user }, again.signal)
    if (!loner.ok) throw new Error('remember failed')
    await again.api.forget({ id: loner.entry.id, expectedVersion: 1, source: user }, again.signal)
    rmSync(join(again.domainRoot, 'forgotten', `${loner.entry.id}.json`))
    await again.ctx.fiber.dispose()
    const third = await mount({ home: harness.home })
    expect(!(await third.api.restore({ id: loner.entry.id, source: user }, third.signal)).ok).toBe(true)
  })
})

describe('durability', () => {
  it('reports MEMORY_IO and changes nothing when the backend cannot write', async () => {
    const harness = await mount()
    const { api, signal } = harness
    const created = await api.remember({ scope: GLOBAL, kind: 'fact', content: 'stays', source: user }, signal)
    if (!created.ok) throw new Error('remember failed')
    // A file where the entries directory must be: every later entry write fails at the backend.
    rmSync(join(harness.domainRoot, 'entries'), { recursive: true, force: true })
    writeFileSync(join(harness.domainRoot, 'entries'), 'blocked')
    const blocked = await api.remember({ scope: GLOBAL, kind: 'fact', content: 'never lands', source: user }, signal)
    expect(blocked).toEqual({ ok: false, error: { code: 'MEMORY_IO', message: expect.stringContaining('remember was not persisted') } })
    expect((await api.list({ scope: { kind: 'all' } }, signal)).entries.map(entry => entry.content)).toEqual(['stays'])
    const corrected = await api.correct({ id: created.entry.id, expectedVersion: 1, content: 'changed', source: user }, signal)
    expect(!corrected.ok && corrected.error.code).toBe('MEMORY_IO')
    expect((await api.get(created.entry.id, signal))?.content).toBe('stays')
    // Forget: the copy goes into forgotten/, the tombstone fails, the copy is taken back out.
    const forgotten = await api.forget({ id: created.entry.id, expectedVersion: 1, source: user }, signal)
    expect(!forgotten.ok && forgotten.error.code).toBe('MEMORY_IO')
    expect((await api.get(created.entry.id, signal))?.content).toBe('stays')
    expect(await api.listForgotten({ kind: 'all' }, signal)).toEqual([])
    expect(harness.changes).toHaveLength(1)
  })

  it('reports MEMORY_IO when the forgotten copy cannot be written, leaving the entry live', async () => {
    const harness = await mount()
    const { api, signal } = harness
    const created = await api.remember({ scope: GLOBAL, kind: 'fact', content: 'stays', source: user }, signal)
    if (!created.ok) throw new Error('remember failed')
    writeFileSync(join(harness.domainRoot, 'forgotten'), 'blocked')
    const forgotten = await api.forget({ id: created.entry.id, expectedVersion: 1, source: user }, signal)
    expect(!forgotten.ok && forgotten.error.code).toBe('MEMORY_IO')
    expect((await api.get(created.entry.id, signal))?.version).toBe(1)
  })

  it('switches the injection mode only on request and reports it', async () => {
    const harness = await mount()
    const { api, signal } = harness
    expect((await api.status(signal)).injection).toBe('markdown')
    expect((await api.setInjection('entries', signal)).injection).toBe('entries')
    expect((await api.setInjection('entries', signal)).injection).toBe('entries')
    expect(harness.changes).toEqual([{ action: 'injection', ids: [] }])
    await expect(api.setInjection('sideways' as never, signal)).rejects.toThrow('unknown injection mode')
    await harness.ctx.fiber.dispose()
    const again = await mount({ home: harness.home })
    expect((await again.api.status(again.signal)).injection).toBe('entries')
  })

  it('refuses already-aborted calls', async () => {
    const harness = await mount()
    const aborted = AbortSignal.abort()
    const calls: Array<Promise<unknown>> = [
      harness.api.status(aborted),
      harness.api.setInjection('entries', aborted),
      harness.api.projectScope(harness.home, aborted),
      harness.api.list({ scope: { kind: 'all' } }, aborted),
      harness.api.get('m_000000000001', aborted),
      harness.api.listForgotten({ kind: 'all' }, aborted),
      harness.api.remember({ scope: GLOBAL, kind: 'fact', content: 'x', source: user }, aborted),
      harness.api.correct({ id: 'm_000000000001', expectedVersion: 1, content: 'x', source: user }, aborted),
      harness.api.forget({ id: 'm_000000000001', expectedVersion: 1, source: user }, aborted),
      harness.api.undo({ id: 'm_000000000001', expectedVersion: 1, source: user }, aborted),
      harness.api.restore({ id: 'm_000000000001', source: user }, aborted),
      harness.api.previewImport({ kind: 'global' }, aborted),
      harness.api.applyImport({ source: { kind: 'global' }, selections: [] }, aborted),
    ]
    for (const call of calls) await expect(call).rejects.toThrow()
    expect(existsSync(harness.domainRoot)).toBe(false)
  })
})

describe('edge paths', () => {
  it('lists several forgotten entries newest first with a stable tie-break, and undoes back to an entry without keywords', async () => {
    const harness = await mount()
    const { api, signal } = harness
    const a = await api.remember({ scope: GLOBAL, kind: 'fact', content: 'a', source: user }, signal)
    const b = await api.remember({ scope: GLOBAL, kind: 'fact', content: 'b', source: user }, signal)
    if (!a.ok || !b.ok) throw new Error('remember failed')
    await api.forget({ id: b.entry.id, expectedVersion: 1, source: user }, signal)
    await api.forget({ id: a.entry.id, expectedVersion: 1, source: user }, signal)
    expect((await api.listForgotten({ kind: 'all' }, signal)).map(item => item.entry.id)).toEqual([a.entry.id, b.entry.id])
    const c = await api.remember({ scope: GLOBAL, kind: 'fact', content: 'no keywords', source: user }, signal)
    if (!c.ok) throw new Error('remember failed')
    await api.correct({ id: c.entry.id, expectedVersion: 1, keywords: ['k'], source: user }, signal)
    const undone = await api.undo({ id: c.entry.id, expectedVersion: 2, source: user }, signal)
    expect(undone.ok && undone.entry.keywords).toBeUndefined()
    expect(undone.ok && undone.entry.content).toBe('no keywords')
  })

  it('restores from a forgotten copy whose tombstone is gone, and reports MEMORY_IO when the restore cannot be written', async () => {
    const harness = await mount()
    const { api, signal } = harness
    const created = await api.remember({ scope: GLOBAL, kind: 'fact', content: 'orphan copy', source: user }, signal)
    if (!created.ok) throw new Error('remember failed')
    await api.forget({ id: created.entry.id, expectedVersion: 1, source: user }, signal)
    rmSync(join(harness.domainRoot, 'entries', `${created.entry.id}.json`))
    await harness.ctx.fiber.dispose()
    const again = await mount({ home: harness.home })
    const restored = await again.api.restore({ id: created.entry.id, source: user }, again.signal)
    expect(restored.ok && restored.entry).toMatchObject({ version: 2, content: 'orphan copy' })
    await again.api.forget({ id: created.entry.id, expectedVersion: 2, source: user }, again.signal)
    rmSync(join(again.domainRoot, 'entries'), { recursive: true, force: true })
    writeFileSync(join(again.domainRoot, 'entries'), 'blocked')
    const blocked = await again.api.restore({ id: created.entry.id, source: user }, again.signal)
    expect(!blocked.ok && blocked.error.code).toBe('MEMORY_IO')
    expect(await again.api.listForgotten({ kind: 'all' }, again.signal)).toHaveLength(1)
  })

  it('recovers the write queue after a task throws', async () => {
    const harness = await mount()
    const { api, signal } = harness
    const broken = api.applyImport({ source: { kind: 'global' }, selections: undefined as never }, signal)
    const fine = api.remember({ scope: GLOBAL, kind: 'fact', content: 'after', source: user }, signal)
    await expect(broken).rejects.toThrow()
    expect((await fine).ok).toBe(true)
  })

  it('mints ids and stamps time from the real clock by default', () => {
    expect(realClock.hex()).toMatch(/^[0-9a-f]{12}$/u)
    expect(realClock.now()).toBeInstanceOf(Date)
  })
})

describe('helpers', () => {
  it('normalizes content for duplicate detection and matches scopes', () => {
    expect(normalizeContent('  Two   words\nHere ')).toBe('two words here')
    expect(contentHash('A b')).toBe(contentHash('a   B'))
    expect(contentHash('a')).not.toBe(contentHash('b'))
    const project = { kind: 'project' as const, projectKey: 'k', path: '/p' }
    expect(sameScope(GLOBAL, GLOBAL)).toBe(true)
    expect(sameScope(GLOBAL, project)).toBe(false)
    expect(sameScope(project, { ...project, path: '/other' })).toBe(true)
    expect(sameScope(project, { ...project, projectKey: 'x' })).toBe(false)
    expect(scopeMatches({ kind: 'all' }, project)).toBe(true)
    expect(scopeMatches({ kind: 'global' }, project)).toBe(false)
    expect(scopeMatches({ kind: 'project', projectKey: 'k' }, GLOBAL)).toBe(false)
    expect(scopeMatches({ kind: 'session', projectKey: 'k' }, GLOBAL)).toBe(true)
    expect(scopeMatches({ kind: 'session', projectKey: 'x' }, project)).toBe(false)
  })
})
