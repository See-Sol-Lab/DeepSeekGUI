// @vitest-environment jsdom
/**
 * Settings → Skills rendering: the inventory lists, the import
 * review flow (typed path and desktop pick), install outcome, and uninstall
 * with confirmation — all against a fake of the mounted Remote namespace.
 * @module @see-sol-lab/deepseekgui-skills/tests/section
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { SkillImportPreview, SkillInstalledView, SkillInventory } from '@deepseek-ai/dsh-skill-manager/types'
import { SkillsSection, type SkillManagerRemote } from '../src/client/SkillsSection.tsx'
import type { ControlBridgeClient } from '../src/client/bridge.ts'
import { zh } from '../src/client/locales.ts'

afterEach(() => { cleanup() })

const t = ((key: keyof typeof zh, params?: Record<string, string | number>) => {
  let text: string = zh[key]
  for (const [name, value] of Object.entries(params ?? {})) text = text.replaceAll(`{${name}}`, String(value))
  return text
}) as never
const ok = <T,>(value: T) => ({ ok: true as const, value })
const failed = (message: string) => ({ ok: false as const, error: new Error(message) as never })

const installed: SkillInstalledView = {
  schemaVersion: 1,
  installId: 'alpha-00000001',
  name: 'alpha',
  description: 'alpha description',
  installedAt: '2026-09-13T04:00:00.000Z',
  updatedAt: '2026-09-13T04:00:00.000Z',
  origin: { kind: 'directory', path: 'E:/src/alpha', entry: 'SKILL.md' },
  files: 3,
  bytes: 300,
  location: 'E:/home/deepseekgui/skills/alpha-00000001',
  status: 'ok',
}

function inventory(over: Partial<SkillInventory> = {}): SkillInventory {
  return {
    libraryDir: 'E:/home/deepseekgui/skills',
    installed: [installed, { ...installed, installId: 'beta-00000002', name: 'beta', status: 'invalid', issue: { code: 'missing-description', message: 'no description' } }],
    orphans: ['stray-dir'],
    readOnly: [{ source: 'user-dsh', name: 'user-one', description: 'from user root', location: 'E:/home/skills/user-one/SKILL.md' }],
    ...over,
  }
}

function previewOf(over: Partial<SkillImportPreview> = {}): SkillImportPreview {
  return {
    source: { kind: 'zip', path: 'E:/downloads/pack.zip' },
    candidates: [
      {
        key: 'a/SKILL.md', entry: 'a/SKILL.md', kind: 'skill', name: 'a', description: 'a desc', proposed: {}, issues: [], files: 2, bytes: 2048,
        replaces: { installId: 'alpha-00000001', name: 'a', origin: { kind: 'directory', path: 'E:/src/alpha', entry: 'SKILL.md' }, location: 'E:/lib/alpha-00000001' },
        installable: true,
      },
      {
        key: 'docs/Plain.md', entry: 'docs/Plain.md', kind: 'markdown', name: null, description: null,
        proposed: { name: 'plain', description: 'First line' },
        issues: [{ code: 'missing-frontmatter', message: 'no frontmatter', fixable: true }], files: 1, bytes: 10, replaces: null, installable: true,
      },
      {
        key: 'b/SKILL.md', entry: 'b/SKILL.md', kind: 'skill', name: 'b', description: 'b desc', proposed: {},
        issues: [{ code: 'legacy-key', message: 'legacy' }], files: 1, bytes: 10, replaces: null, installable: false,
      },
    ],
    problems: [{ code: 'unsafe-path', message: 'bad', path: '../x' }],
    ...over,
  }
}

function fakeSkills(over: Partial<Record<keyof SkillManagerRemote, (...args: never[]) => unknown>> = {}): SkillManagerRemote {
  return {
    inventory: vi.fn(async () => ok(inventory())),
    previewImport: vi.fn(async () => ok(previewOf())),
    applyImport: vi.fn(async () => ok({ installed: [installed], failures: [] })),
    uninstall: vi.fn(async () => ok({ installId: 'alpha-00000001', location: installed.location, removed: true, affected: [] })),
    installReferences: vi.fn(async () => ok({ installId: 'alpha-00000001', projects: [] })),
    ...over,
  } as unknown as SkillManagerRemote
}

const close = (): void => {}

describe('SkillsSection', () => {
  it('lists installed, invalid, orphan and read-only entries with their sources', async () => {
    const skills = fakeSkills()
    render(<SkillsSection t={t} skills={skills} bridge={null} close={close} />)
    await screen.findByText('alpha')
    expect(screen.getByText(zh['page.library'].replace('{dir}', 'E:/home/deepseekgui/skills'))).toBeTruthy()
    const rows = document.querySelectorAll('[data-deepseekgui="skill-installed"]')
    expect(rows).toHaveLength(2)
    expect(within(rows[0] as HTMLElement).getByText(zh['installed.origin'].replace('{kind}', zh['kind.directory']).replace('{path}', 'E:/src/alpha'))).toBeTruthy()
    expect(within(rows[1] as HTMLElement).getByText(/无效/u).textContent).toContain(zh['issue.missing-description'])
    expect(screen.getByText(/stray-dir/u)).toBeTruthy()
    expect(screen.getByText('user-one')).toBeTruthy()
    expect(screen.getByText(zh['readOnly.source.user-dsh'])).toBeTruthy()
    expect(screen.getByText(zh['import.noDesktop'])).toBeTruthy()
    expect((screen.getByText(zh['import.directory']) as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows the empty states and a load failure', async () => {
    const empty = fakeSkills({ inventory: vi.fn(async () => ok(inventory({ installed: [], orphans: [], readOnly: [] }))) })
    render(<SkillsSection t={t} skills={empty} bridge={null} close={close} />)
    await screen.findByText(zh['installed.empty'])
    expect(screen.getByText(zh['readOnly.empty'])).toBeTruthy()
    cleanup()
    render(<SkillsSection t={t} skills={fakeSkills({ inventory: vi.fn(async () => failed('boom')) })} bridge={null} close={close} />)
    await screen.findByRole('alert')
    expect(screen.getByRole('alert').textContent).toContain('boom')
  })

  it('reviews a typed path, shows candidates with issues, proposals and the replacement target, then installs the selection', async () => {
    const skills = fakeSkills()
    render(<SkillsSection t={t} skills={skills} bridge={null} close={close} />)
    await screen.findByText('alpha')
    const pathInput = document.querySelector('[data-deepseekgui="skill-import-path"]') as HTMLInputElement
    fireEvent.change(pathInput, { target: { value: ' E:/downloads/pack.zip ' } })
    fireEvent.click(document.querySelector('[data-deepseekgui="skill-import-review"]') as HTMLButtonElement)
    await waitFor(() => { expect(document.querySelectorAll('[data-deepseekgui="skill-candidate"]')).toHaveLength(3) })
    expect(skills.previewImport).toHaveBeenCalledWith('E:/downloads/pack.zip')
    // Source problem and candidate issues are localized with their path.
    expect(screen.getByText(`${zh['issue.unsafe-path']} — ../x`)).toBeTruthy()
    expect(screen.getByText(zh['issue.missing-frontmatter'])).toBeTruthy()
    expect(screen.getByText(zh['issue.legacy-key'])).toBeTruthy()
    expect(screen.getByText(zh['review.blocked'])).toBeTruthy()
    // The replacement names the actual target by install id and its origin, not the display name.
    const replaces = document.querySelector('[data-deepseekgui="skill-replaces"]')!
    expect(replaces.textContent).toContain('alpha-00000001')
    expect(replaces.textContent).toContain('E:/src/alpha')
    // The Markdown candidate carries the proposal as its editable values.
    const plain = document.querySelector('[data-candidate-key="docs/Plain.md"]') as HTMLElement
    const nameInput = within(plain).getByDisplayValue('plain') as HTMLInputElement
    expect(nameInput.readOnly).toBe(false)
    fireEvent.change(within(plain).getByDisplayValue('First line'), { target: { value: 'Edited line' } })
    // Two of three are ready (the legacy-key one is blocked).
    const apply = document.querySelector('[data-deepseekgui="skill-import-apply"]') as HTMLButtonElement
    expect(apply.textContent).toBe(zh['review.apply'].replace('{count}', '2'))
    fireEvent.click(apply)
    await screen.findByRole('status')
    expect(skills.applyImport).toHaveBeenCalledWith({
      path: 'E:/downloads/pack.zip',
      selections: [
        { key: 'a/SKILL.md', replaces: 'alpha-00000001' },
        { key: 'docs/Plain.md', name: 'plain', description: 'Edited line', replaces: null },
      ],
    })
    expect(screen.getByRole('status').textContent).toContain('alpha → alpha-00000001')
    // The review closed and the inventory reloaded.
    expect(document.querySelector('[data-deepseekgui="skill-review"]')).toBeNull()
    expect(skills.inventory).toHaveBeenCalledTimes(2)
  })

  it('unticking a candidate removes it from the request and an empty selection disables install', async () => {
    const single = previewOf({ problems: [], candidates: [previewOf().candidates[0]!] })
    const skills = fakeSkills({ previewImport: vi.fn(async () => ok(single)) })
    render(<SkillsSection t={t} skills={skills} bridge={null} close={close} />)
    await screen.findByText('alpha')
    fireEvent.change(document.querySelector('[data-deepseekgui="skill-import-path"]') as HTMLInputElement, { target: { value: 'E:/downloads/pack.zip' } })
    fireEvent.keyDown(document.querySelector('[data-deepseekgui="skill-import-path"]') as HTMLInputElement, { key: 'Enter' })
    await waitFor(() => { expect(document.querySelectorAll('[data-deepseekgui="skill-candidate"]')).toHaveLength(1) })
    const checkbox = document.querySelector('[data-deepseekgui="skill-candidate"] input[type="checkbox"]') as HTMLInputElement
    fireEvent.click(checkbox)
    const apply = document.querySelector('[data-deepseekgui="skill-import-apply"]') as HTMLButtonElement
    expect(apply.disabled).toBe(true)
    fireEvent.click(screen.getByText(zh['review.close']))
    expect(document.querySelector('[data-deepseekgui="skill-review"]')).toBeNull()
  })

  it('reports failures of the apply call and of the review call', async () => {
    const skills = fakeSkills({
      previewImport: vi.fn(async () => ok(previewOf({ problems: [], candidates: [previewOf().candidates[0]!] }))),
      applyImport: vi.fn(async () => ok({ installed: [], failures: [{ key: 'a/SKILL.md', issue: { code: 'name-conflict', message: 'taken' } }] })),
    })
    render(<SkillsSection t={t} skills={skills} bridge={null} close={close} />)
    await screen.findByText('alpha')
    fireEvent.change(document.querySelector('[data-deepseekgui="skill-import-path"]') as HTMLInputElement, { target: { value: 'E:/downloads/pack.zip' } })
    fireEvent.click(document.querySelector('[data-deepseekgui="skill-import-review"]') as HTMLButtonElement)
    await waitFor(() => { expect(document.querySelector('[data-deepseekgui="skill-import-apply"]')).not.toBeNull() })
    fireEvent.click(document.querySelector('[data-deepseekgui="skill-import-apply"]') as HTMLButtonElement)
    await screen.findByRole('status')
    expect(screen.getByRole('status').textContent).toContain(zh['issue.name-conflict'])
    cleanup()
    render(<SkillsSection t={t} skills={fakeSkills({ previewImport: vi.fn(async () => failed('unreadable')) })} bridge={null} close={close} />)
    await screen.findByText('alpha')
    fireEvent.change(document.querySelector('[data-deepseekgui="skill-import-path"]') as HTMLInputElement, { target: { value: 'E:/x' } })
    fireEvent.click(document.querySelector('[data-deepseekgui="skill-import-review"]') as HTMLButtonElement)
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('unreadable') })
  })

  it('picks a source through the desktop bridge and reviews it; a cancelled pick does nothing', async () => {
    const skills = fakeSkills()
    let cancelled = false
    const bridge: ControlBridgeClient = {
      run: vi.fn(async (command: Record<string, unknown>) => ({
        skillPick: { nonce: 1, kind: command.kind as 'directory' | 'file', path: cancelled ? null : 'E:/skills/picked' },
      })),
    }
    render(<SkillsSection t={t} skills={skills} bridge={bridge} close={close} />)
    await screen.findByText('alpha')
    expect(screen.queryByText(zh['import.noDesktop'])).toBeNull()
    fireEvent.click(document.querySelector('[data-deepseekgui="skill-import-directory"]') as HTMLButtonElement)
    await waitFor(() => { expect(skills.previewImport).toHaveBeenCalledWith('E:/skills/picked') })
    expect(bridge.run).toHaveBeenCalledWith({ type: 'skill-pick-source', kind: 'directory' })
    expect((document.querySelector('[data-deepseekgui="skill-import-path"]') as HTMLInputElement).value).toBe('E:/skills/picked')
    cancelled = true
    fireEvent.click(document.querySelector('[data-deepseekgui="skill-import-file"]') as HTMLButtonElement)
    await waitFor(() => { expect(bridge.run).toHaveBeenCalledTimes(2) })
    expect(skills.previewImport).toHaveBeenCalledTimes(1)
  })

  it('uninstalls only after confirmation and reports a refusal', async () => {
    const skills = fakeSkills()
    render(<SkillsSection t={t} skills={skills} bridge={null} close={close} />)
    await screen.findByText('alpha')
    const row = document.querySelector('[data-install-id="alpha-00000001"]') as HTMLElement
    fireEvent.click(within(row).getByText(zh['installed.uninstall']))
    expect(skills.uninstall).not.toHaveBeenCalled()
    fireEvent.click(within(row).getByText(zh['installed.uninstallCancel']))
    expect(within(row).queryByText(zh['installed.uninstallCancel'])).toBeNull()
    fireEvent.click(within(row).getByText(zh['installed.uninstall']))
    fireEvent.click(within(row).getByText(zh['installed.uninstallConfirm'].replace('{name}', 'alpha')))
    await waitFor(() => { expect(skills.uninstall).toHaveBeenCalledWith('alpha-00000001') })
    await waitFor(() => { expect(skills.inventory).toHaveBeenCalledTimes(2) })
    cleanup()
    const refusing = fakeSkills({
      uninstall: vi.fn(async () => ok({
        installId: 'alpha-00000001', location: installed.location, removed: false, issue: { code: 'not-managed', message: 'no manifest' }, affected: [],
      })),
    })
    render(<SkillsSection t={t} skills={refusing} bridge={null} close={close} />)
    await screen.findByText('alpha')
    const again = document.querySelector('[data-install-id="alpha-00000001"]') as HTMLElement
    fireEvent.click(within(again).getByText(zh['installed.uninstall']))
    fireEvent.click(within(again).getByText(zh['installed.uninstallConfirm'].replace('{name}', 'alpha')))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain(zh['issue.not-managed']) })
  })

  it('names the affected projects before confirming and after removing (B7-P5)', async () => {
    const projects = [{ key: 'k1', path: 'E:/projects/writing' }, { key: 'k2', path: 'E:/projects/art' }]
    const skills = fakeSkills({
      installReferences: vi.fn(async () => ok({ installId: 'alpha-00000001', projects })),
      uninstall: vi.fn(async () => ok({ installId: 'alpha-00000001', location: installed.location, removed: true, affected: projects })),
    })
    render(<SkillsSection t={t} skills={skills} bridge={null} close={close} />)
    await screen.findByText('alpha')
    const row = document.querySelector('[data-install-id="alpha-00000001"]') as HTMLElement
    fireEvent.click(within(row).getByText(zh['installed.uninstall']))
    expect(skills.installReferences).toHaveBeenCalledWith('alpha-00000001')
    await waitFor(() => {
      expect(row.querySelector('[data-deepseekgui="skill-uninstall-references"]')?.textContent).toContain('E:/projects/writing; E:/projects/art')
    })
    fireEvent.click(within(row).getByText(zh['installed.uninstallConfirm'].replace('{name}', 'alpha')))
    await waitFor(() => {
      const notice = document.querySelector('[data-deepseekgui="skill-uninstall-affected"]')
      expect(notice?.textContent).toContain('2')
      expect(notice?.textContent).toContain('E:/projects/art')
    })
    cleanup()
    // A failing lookup leaves the confirmation usable and says nothing references it.
    const blind = fakeSkills({ installReferences: vi.fn(async () => failed('offline')) })
    render(<SkillsSection t={t} skills={blind} bridge={null} close={close} />)
    await screen.findByText('alpha')
    const again = document.querySelector('[data-install-id="alpha-00000001"]') as HTMLElement
    fireEvent.click(within(again).getByText(zh['installed.uninstall']))
    await waitFor(() => { expect(again.textContent).toContain(zh['installed.noReferences']) })
  })

  it('re-reads the inventory when the Host reports a change', async () => {
    const skills = fakeSkills()
    let listener: (() => void) | undefined
    const onChange = vi.fn((fn: () => void) => { listener = fn; return () => { listener = undefined } })
    const view = render(<SkillsSection t={t} skills={skills} bridge={null} close={close} onChange={onChange} />)
    await screen.findByText('alpha')
    expect(skills.inventory).toHaveBeenCalledTimes(1)
    listener?.()
    await waitFor(() => { expect(skills.inventory).toHaveBeenCalledTimes(2) })
    view.unmount()
    expect(listener).toBeUndefined()
  })
})
