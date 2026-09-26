// @vitest-environment jsdom
/**
 * Project management view (B7-P5): reads the page for the current session,
 * ticks and saves with the rendered revision, shows what each tick does
 * (active / shadowed / invalid / uninstalled), handles the no-folder and
 * conflict outcomes, re-reads on Host changes, and never lets a stale async
 * result overwrite a newer session target.
 * @module @see-sol-lab/deepseekgui-skills/tests/project-view
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SkillProjectEntry, SkillProjectView as ProjectPage } from '@deepseek-ai/dsh-skill-manager/types'
import { ProjectView, type SkillManagerRemote } from '../src/client/ProjectView.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(() => { cleanup() })

const t = ((key: keyof typeof zh, params?: Record<string, string | number>) => {
  let text: string = zh[key]
  for (const [name, value] of Object.entries(params ?? {})) text = text.replaceAll(`{${name}}`, String(value))
  return text
}) as never
const ok = <T,>(value: T) => ({ ok: true as const, value })
const failed = (message: string) => ({ ok: false as const, error: new Error(message) as never })
const sid = (id: string): SessionId => id as SessionId

function entry(installId: string, name: string, over: Partial<SkillProjectEntry> = {}): SkillProjectEntry {
  return { installId, name, description: `${name} description`, status: 'ok', enabled: false, effect: 'inactive', ...over }
}

function page(sessionId: string, over: Partial<ProjectPage> = {}): ProjectPage {
  return {
    sessionId,
    project: { key: 'k-writing', path: 'E:/projects/writing' },
    revision: 1,
    catalogComplete: true,
    entries: [
      entry('image-tools-00000002', 'image-tools'),
      entry('proofread-00000001', 'proofread', { enabled: true, effect: 'active' }),
    ],
    ...over,
  }
}

function fakeSkills(over: Partial<Record<keyof SkillManagerRemote, (...args: never[]) => unknown>> = {}): SkillManagerRemote {
  return {
    projectView: vi.fn(async (sessionId: SessionId) => ok(page(sessionId))),
    setProjectSelection: vi.fn(async () => ok({ saved: true, view: page('s1', { revision: 2 }) })),
    ...over,
  } as unknown as SkillManagerRemote
}

const noChange = (): (() => void) => () => {}

describe('ProjectView', () => {
  it('finishes saving when the Host broadcasts the saved selection before returning it', async () => {
    let changed: (() => void) | undefined
    const onChange = (listener: () => void) => { changed = listener; return () => { changed = undefined } }
    const skills = fakeSkills({
      setProjectSelection: vi.fn(async () => {
        changed?.()
        return ok({ saved: true, view: page('s1', { revision: 2 }) })
      }),
    })
    render(<ProjectView t={t} skills={skills} onChange={onChange} sessionId={sid('s1')} />)
    await screen.findByLabelText('image-tools')
    fireEvent.click(screen.getByLabelText('image-tools'))
    fireEvent.click(document.querySelector('[data-deepseekgui="skill-project-save"]')!)
    await waitFor(() => { expect(screen.queryByText(zh['project.saving'])).toBeNull() })
    expect((screen.getByLabelText('image-tools') as HTMLInputElement).disabled).toBe(false)
  })

  it('shows the folder, the ticks and each effect, and saves the complete list with the rendered revision', async () => {
    const skills = fakeSkills()
    render(<ProjectView t={t} skills={skills} onChange={noChange} sessionId={sid('s1')} />)
    await screen.findByText(zh['project.folder'].replace('{path}', 'E:/projects/writing'))
    expect(skills.projectView).toHaveBeenCalledWith('s1', expect.any(AbortSignal))
    const proof = screen.getByLabelText('proofread') as HTMLInputElement
    const images = screen.getByLabelText('image-tools') as HTMLInputElement
    expect(proof.checked).toBe(true)
    expect(images.checked).toBe(false)
    expect(screen.getByText(zh['effect.active'])).toBeTruthy()
    const save = document.querySelector('[data-deepseekgui="skill-project-save"]') as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.click(images)
    fireEvent.click(proof)
    expect(save.disabled).toBe(false)
    expect(screen.getByText(zh['project.dirty'])).toBeTruthy()
    fireEvent.click(save)
    await waitFor(() => {
      expect(skills.setProjectSelection).toHaveBeenCalledWith(
        { sessionId: 's1', enabled: ['image-tools-00000002'], revision: 1 },
        expect.any(AbortSignal),
      )
    })
    await screen.findByText(zh['project.saved'])
    expect(screen.getByText(zh['project.effectNote'])).toBeTruthy()
  })

  it('renders shadowed, invalid and uninstalled rows with their explanations', async () => {
    const skills = fakeSkills({
      projectView: vi.fn(async () => ok(page('s1', {
        catalogComplete: false,
        entries: [
          entry('a-00000001', 'a', { enabled: true, effect: 'shadowed', shadowedBy: { source: 'user-dsh', provider: 'filesystem' } }),
          entry('b-00000002', 'b', { enabled: true, effect: 'invalid', status: 'invalid', issue: { code: 'missing-description', message: 'no description' } }),
          entry('c-00000003', 'c', { enabled: true, effect: 'missing', status: 'invalid', issue: { code: 'unknown-install', message: 'gone' } }),
          entry('d-00000004', 'd', { enabled: false, status: 'invalid', issue: { code: 'legacy-key', message: 'legacy' } }),
        ],
      }))),
    })
    render(<ProjectView t={t} skills={skills} onChange={noChange} sessionId={sid('s1')} />)
    await screen.findByText(zh['effect.shadowed'])
    expect(screen.getByText(zh['effect.shadowedBy'].replace('{source}', 'user-dsh'))).toBeTruthy()
    expect(screen.getAllByText(zh['effect.invalid'])).toHaveLength(2)
    expect(screen.getByText(zh['effect.missing'])).toBeTruthy()
    expect(screen.getByText(zh['effect.missingHint'])).toBeTruthy()
    expect(screen.getByText(zh['project.catalogIncomplete'])).toBeTruthy()
    expect(screen.getByText(zh['issue.missing-description'])).toBeTruthy()
  })

  it('explains a session without a folder and a folder that is gone, and disables the ticks', async () => {
    const skills = fakeSkills({
      projectView: vi.fn(async (sessionId: SessionId) => ok(page(sessionId, {
        project: null,
        problem: sessionId === 'gone' ? 'missing-folder' : 'no-cwd',
        revision: 0,
      }))),
    })
    render(<ProjectView t={t} skills={skills} onChange={noChange} sessionId={sid('blank')} />)
    await screen.findByText(zh['project.noCwd'])
    expect((screen.getByLabelText('proofread') as HTMLInputElement).disabled).toBe(true)
    expect(document.querySelector('[data-deepseekgui="skill-project-save"]')).toBeNull()
    cleanup()
    render(<ProjectView t={t} skills={skills} onChange={noChange} sessionId={sid('gone')} />)
    await screen.findByText(zh['project.missingFolder'])
    cleanup()
    render(<ProjectView t={t} skills={skills} onChange={noChange} sessionId={undefined} />)
    expect(skills.projectView).toHaveBeenCalledTimes(2)
  })

  it('shows the empty library hint and a read failure', async () => {
    const empty = fakeSkills({ projectView: vi.fn(async () => ok(page('s1', { entries: [] }))) })
    render(<ProjectView t={t} skills={empty} onChange={noChange} sessionId={sid('s1')} />)
    await screen.findByText(zh['project.empty'])
    cleanup()
    render(<ProjectView t={t} skills={fakeSkills({ projectView: vi.fn(async () => failed('boom')) })} onChange={noChange} sessionId={sid('s1')} />)
    await screen.findByRole('alert')
    expect(screen.getByRole('alert').textContent).toContain('boom')
  })

  it('takes the winning selection on a conflict and reports other refusals and transport errors', async () => {
    const skills = fakeSkills({
      setProjectSelection: vi.fn()
        .mockResolvedValueOnce(ok({
          saved: false,
          issue: { code: 'revision-conflict', message: 'elsewhere' },
          view: page('s1', { revision: 3, entries: [entry('image-tools-00000002', 'image-tools', { enabled: true, effect: 'active' }), entry('proofread-00000001', 'proofread')] }),
        }))
        .mockResolvedValueOnce(ok({ saved: false, issue: { code: 'unknown-install', message: 'ghost' }, view: page('s1', { revision: 3 }) }))
        .mockResolvedValueOnce(failed('offline')),
    })
    render(<ProjectView t={t} skills={skills} onChange={noChange} sessionId={sid('s1')} />)
    await screen.findByLabelText('proofread')
    const save = document.querySelector('[data-deepseekgui="skill-project-save"]') as HTMLButtonElement
    fireEvent.click(screen.getByLabelText('image-tools'))
    fireEvent.click(save)
    await screen.findByText(zh['project.conflict'])
    // The page now shows what won: image-tools ticked, proofread not, revision 3.
    expect((screen.getByLabelText('image-tools') as HTMLInputElement).checked).toBe(true)
    expect((screen.getByLabelText('proofread') as HTMLInputElement).checked).toBe(false)
    fireEvent.click(screen.getByLabelText('proofread'))
    fireEvent.click(save)
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain(zh['issue.unknown-install']) })
    expect(skills.setProjectSelection).toHaveBeenLastCalledWith(expect.objectContaining({ revision: 3 }), expect.any(AbortSignal))
    fireEvent.click(screen.getByLabelText('proofread'))
    fireEvent.click(save)
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('offline') })
  })

  it('never lets an older session\u2019s result overwrite the newer target', async () => {
    const pending = new Map<string, (value: unknown) => void>()
    const skills = fakeSkills({
      projectView: vi.fn((sessionId: SessionId) => new Promise((resolve) => { pending.set(sessionId, resolve) })),
    })
    const view = render(<ProjectView t={t} skills={skills} onChange={noChange} sessionId={sid('old')} />)
    view.rerender(<ProjectView t={t} skills={skills} onChange={noChange} sessionId={sid('new')} />)
    await waitFor(() => { expect(pending.size).toBe(2) })
    // The old session answers late, with its own folder: it must not show.
    pending.get('old')!(ok(page('old', { project: { key: 'k-old', path: 'E:/projects/old' } })))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(screen.queryByText(zh['project.folder'].replace('{path}', 'E:/projects/old'))).toBeNull()
    expect(screen.getByRole('status').textContent).toBe(zh['project.loading'])
    pending.get('new')!(ok(page('new', { project: { key: 'k-new', path: 'E:/projects/new' } })))
    await screen.findByText(zh['project.folder'].replace('{path}', 'E:/projects/new'))
  })

  it('drops a save result when the session changed underneath it', async () => {
    let resolveSave: ((value: unknown) => void) | undefined
    const skills = fakeSkills({
      setProjectSelection: vi.fn(() => new Promise((resolve) => { resolveSave = resolve })),
    })
    const view = render(<ProjectView t={t} skills={skills} onChange={noChange} sessionId={sid('s1')} />)
    await screen.findByLabelText('image-tools')
    fireEvent.click(screen.getByLabelText('image-tools'))
    fireEvent.click(document.querySelector('[data-deepseekgui="skill-project-save"]') as HTMLButtonElement)
    await waitFor(() => { expect(resolveSave).toBeDefined() })
    view.rerender(<ProjectView t={t} skills={skills} onChange={noChange} sessionId={sid('s2')} />)
    await screen.findByText(zh['project.folder'].replace('{path}', 'E:/projects/writing'))
    resolveSave!(ok({ saved: true, view: page('s1', { revision: 9 }) }))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(screen.queryByText(zh['project.saved'])).toBeNull()
    expect(skills.projectView).toHaveBeenLastCalledWith('s2', expect.any(AbortSignal))
  })

  it('re-reads when the Host reports a change and unsubscribes on unmount', async () => {
    const skills = fakeSkills()
    let listener: (() => void) | undefined
    const onChange = vi.fn((fn: () => void) => { listener = fn; return () => { listener = undefined } })
    const view = render(<ProjectView t={t} skills={skills} onChange={onChange} sessionId={sid('s1')} />)
    await screen.findByLabelText('proofread')
    expect(skills.projectView).toHaveBeenCalledTimes(1)
    listener?.()
    await waitFor(() => { expect(skills.projectView).toHaveBeenCalledTimes(2) })
    fireEvent.click(screen.getByText(zh['project.refresh']))
    await waitFor(() => { expect(skills.projectView).toHaveBeenCalledTimes(3) })
    view.unmount()
    expect(listener).toBeUndefined()
  })
})
