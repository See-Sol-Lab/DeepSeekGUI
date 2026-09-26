/**
 * Settings → Skills (B7-P4): the install side of the skill manager.
 * Lists what the library holds (name, description, origin, location), the
 * read-only official roots beside it, and runs the import flow — pick a
 * source, review the candidates with their issues and proposals, install the
 * selection — and uninstall. No project tick lives here: which projects may
 * use an installed skill is the session-top Project management page (B7-P5).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { RemoteResult, TypertRemoteNamespaceMap } from '@deepseek-ai/dsh-typert-protocol'
// Type-only: merges the generated `skillManager` namespace into the Remote map.
import type {} from '@deepseek-ai/dsh-skill-manager/remote'
import type {
  SkillImportOutcome,
  SkillImportPreview,
  SkillInstalledView,
  SkillInventory,
  SkillIssue,
  SkillProjectRef,
  SkillReadOnlyView,
} from '@deepseek-ai/dsh-skill-manager/types'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsSectionOwnerProps } from '@deepseek-ai/dsh-client-ui-settings/client'
import { pickSource, type ControlBridgeClient } from './bridge.ts'
import type { NS_SKILLS, SkillsKey } from './locales.ts'
import { draftReady, draftsFrom, formatBytes, formatTime, issueText, selectionsFrom, type CandidateDraft } from './model.ts'

/** The generated `skillManager` Remote namespace the plugin entry mounts. */
export type SkillManagerRemote = TypertRemoteNamespaceMap['skillManager']

/** Business props the plugin entry injects. */
export interface SkillsInjected {
  skills: SkillManagerRemote
  /** Desktop control bridge; null outside the DeepSeekGUI window. */
  bridge: ControlBridgeClient | null
  /** Subscribe to library changes forwarded from the Host (another window's install or uninstall); optional for older entries. */
  onChange?: (listener: () => void) => () => void
}

/** Locale seat, owner props, and the injected business props. */
export type SkillsSectionProps = PropsLocale<typeof NS_SKILLS> & SettingsSectionOwnerProps & SkillsInjected

type Translate = (key: SkillsKey, params?: Record<string, unknown>) => string

const page: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12, fontSize: 14, lineHeight: '22px', color: 'var(--dsw-alias-label-primary)' }
const intro: React.CSSProperties = { fontSize: 13, lineHeight: '20px', color: 'var(--dsw-alias-label-secondary)', margin: 0 }
const caption: React.CSSProperties = { fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-caption)' }
const mono: React.CSSProperties = { fontFamily: 'var(--ds-font-family-code)', overflowWrap: 'anywhere' }
const heading: React.CSSProperties = { fontSize: 15, lineHeight: '22px', fontWeight: 600, margin: '6px 0 0' }
// Same shape as the workbench plugin's shared button: the inline rule reads
// the --dsg-btn-* variables the workbench skin sets under `.dsg-btn` (glass
// fill, hover tiers), with a plain hairline as the fallback when it is absent.
const BUTTON_CLASS = 'dsg-btn'
const button: React.CSSProperties = {
  font: 'inherit', fontSize: 12, lineHeight: '18px', padding: '3px 10px', cursor: 'pointer',
  color: 'var(--dsw-alias-label-secondary)', background: 'var(--dsg-btn-bg, transparent)',
  border: '1px solid var(--dsg-btn-border, var(--dsw-alias-border-l3))', borderRadius: 8,
  transition: 'background-color 150ms ease, border-color 150ms ease',
}
const dangerButton: React.CSSProperties = { ...button, color: 'var(--dsw-alias-state-error-primary)', border: '1px solid var(--dsw-alias-state-error-secondary, var(--dsw-alias-state-error-primary))' }
const primaryButton: React.CSSProperties = { ...button, color: 'var(--dsw-alias-label-primary)', border: '1px solid var(--dsw-alias-brand-primary)' }
const input: React.CSSProperties = {
  font: 'inherit', fontSize: 13, lineHeight: '20px', padding: '3px 8px', boxSizing: 'border-box', width: '100%',
  color: 'var(--dsw-alias-label-primary)', background: 'var(--dsw-alias-bg-layer-2)',
  border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8,
}
const card: React.CSSProperties = {
  padding: '10px 14px', borderRadius: 10, border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-2)',
  display: 'flex', flexDirection: 'column', gap: 4,
}
const row: React.CSSProperties = { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }
const badge: React.CSSProperties = { ...caption, padding: '0 6px', borderRadius: 4, border: '1px solid var(--dsw-alias-border-l1)' }
const errorText: React.CSSProperties = { color: 'var(--dsw-alias-state-error-primary)' }

/** Unwrap a Remote result into a value or throw its error. */
function unwrap<T>(result: RemoteResult<T>): T {
  if (result.ok) return result.value
  throw result.error
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function IssueList({ issues, t }: { issues: SkillIssue[]; t: Translate }) {
  if (issues.length === 0) return null
  return (
    <ul style={{ margin: 0, paddingLeft: 18 }}>
      {issues.map((issue, index) => (
        <li key={`${issue.code}-${String(index)}`} style={issue.fixable === true ? caption : { ...caption, ...errorText }} title={issue.message}>
          {issueText(issue, t)}
        </li>
      ))}
    </ul>
  )
}

function InstalledRow({ item, t, onUninstall, busy, references }: {
  item: SkillInstalledView
  t: Translate
  onUninstall: (installId: string) => void
  busy: boolean
  /** Projects whose selection names this install, read when the person opens the confirmation. */
  references: (installId: string) => Promise<SkillProjectRef[]>
}) {
  const [confirming, setConfirming] = useState(false)
  const [affected, setAffected] = useState<SkillProjectRef[] | 'loading'>()
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])
  const open = async (): Promise<void> => {
    setConfirming(true)
    setAffected('loading')
    try {
      const projects = await references(item.installId)
      if (alive.current) setAffected(projects)
    } catch {
      // The lookup is advisory: the confirmation stays usable without it.
      if (alive.current) setAffected([])
    }
  }
  return (
    <div style={card} data-deepseekgui="skill-installed" data-install-id={item.installId}>
      <div style={row}>
        <span style={{ fontWeight: 600 }}>{item.name}</span>
        <span style={badge}>{t(`kind.${item.origin.kind}`)}</span>
        {item.status === 'invalid' && (
          <span style={{ ...badge, ...errorText }} title={item.issue?.message}>
            {t('installed.invalid', { message: item.issue === undefined ? '' : issueText(item.issue, t) })}
          </span>
        )}
        <span style={{ flex: 1 }} />
        {confirming
          ? (
            <>
              <button type="button" className={BUTTON_CLASS} style={dangerButton} disabled={busy} onClick={() => { onUninstall(item.installId); setConfirming(false) }}>
                {t('installed.uninstallConfirm', { name: item.name })}
              </button>
              <button type="button" className={BUTTON_CLASS} style={button} onClick={() => { setConfirming(false) }}>{t('installed.uninstallCancel')}</button>
            </>
          )
          : <button type="button" className={BUTTON_CLASS} style={button} disabled={busy} onClick={() => { void open() }}>{t('installed.uninstall')}</button>}
      </div>
      {confirming && (
        <div style={caption} data-deepseekgui="skill-uninstall-references">
          {affected === 'loading'
            ? t('installed.referencesLoading')
            : affected === undefined || affected.length === 0
              ? t('installed.noReferences')
              : t('installed.references', { paths: affected.map(project => project.path).join('; ') })}
        </div>
      )}
      <div>{item.description}</div>
      <div style={caption}>{t('installed.origin', { kind: t(`kind.${item.origin.kind}`), path: item.origin.path })}</div>
      <div style={{ ...caption, ...mono }}>{t('installed.location', { location: item.location })}</div>
      <div style={caption}>{t('installed.updated', { time: formatTime(item.updatedAt) })}</div>
    </div>
  )
}

function ReadOnlyRow({ item, t }: { item: SkillReadOnlyView; t: Translate }) {
  return (
    <div style={card} data-deepseekgui="skill-readonly">
      <div style={row}>
        <span style={{ fontWeight: 600 }}>{item.name}</span>
        <span style={badge}>{t(`readOnly.source.${item.source}`)}</span>
      </div>
      <div>{item.description}</div>
      <div style={{ ...caption, ...mono }}>{item.location}</div>
    </div>
  )
}

function CandidateCard({ preview, draft, t, onChange }: {
  preview: SkillImportPreview
  draft: CandidateDraft
  t: Translate
  onChange: (next: CandidateDraft) => void
}) {
  const candidate = preview.candidates.find(item => item.key === draft.key)
  if (candidate === undefined) return null
  const blocked = candidate.issues.some(issue => issue.fixable !== true)
  const nameProposed = candidate.name === null
  const descriptionProposed = candidate.description === null
  const replaced = candidate.replaces
  return (
    <div style={card} data-deepseekgui="skill-candidate" data-candidate-key={candidate.key}>
      <label style={row}>
        <input
          type="checkbox"
          checked={draft.selected && !blocked}
          disabled={blocked}
          onChange={(event) => { onChange({ ...draft, selected: event.target.checked }) }}
        />
        <span style={{ fontWeight: 600 }}>{draft.name === '' ? candidate.entry : draft.name}</span>
        <span style={badge}>{t(`kind.${candidate.kind === 'markdown' ? 'markdown' : 'directory'}`)}</span>
        <span style={caption}>{t('review.files', { files: candidate.files, size: formatBytes(candidate.bytes) })}</span>
      </label>
      <div style={{ ...caption, ...mono }}>{t('review.entry', { entry: candidate.entry })}</div>
      <label style={caption}>
        {t('review.name')}
        <input
          style={input}
          value={draft.name}
          readOnly={!nameProposed && candidate.issues.every(issue => issue.code !== 'invalid-name')}
          onChange={(event) => { onChange({ ...draft, name: event.target.value }) }}
        />
      </label>
      {nameProposed && <div style={caption}>{t('review.proposed')}</div>}
      <label style={caption}>
        {t('review.description')}
        <textarea
          style={{ ...input, minHeight: 44, resize: 'vertical' }}
          value={draft.description}
          onChange={(event) => { onChange({ ...draft, description: event.target.value }) }}
        />
      </label>
      {descriptionProposed && !nameProposed && <div style={caption}>{t('review.proposed')}</div>}
      {candidate.issues.length > 0 && <div style={caption}>{t('review.issues')}</div>}
      <IssueList issues={candidate.issues} t={t} />
      {replaced !== null && (
        <div style={caption} data-deepseekgui="skill-replaces">
          {t('review.replaces', { installId: replaced.installId, path: replaced.origin.path })}
        </div>
      )}
      {blocked && <div style={{ ...caption, ...errorText }}>{t('review.blocked')}</div>}
    </div>
  )
}

/** Settings → Skills. */
export function SkillsSection({ t, skills, bridge, onChange }: SkillsSectionProps) {
  const [inventory, setInventory] = useState<SkillInventory>()
  const [loadError, setLoadError] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [path, setPath] = useState('')
  const [reviewing, setReviewing] = useState(false)
  const [preview, setPreview] = useState<SkillImportPreview>()
  const [drafts, setDrafts] = useState<CandidateDraft[]>([])
  const [applying, setApplying] = useState(false)
  const [outcome, setOutcome] = useState<SkillImportOutcome>()
  const [actionError, setActionError] = useState<string>()
  const [uninstalling, setUninstalling] = useState<string>()
  const [affected, setAffected] = useState<SkillProjectRef[]>([])
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])

  const reload = useCallback(async () => {
    setLoading(true)
    setLoadError(undefined)
    try {
      const value = unwrap(await skills.inventory())
      if (!alive.current) return
      setInventory(value)
    } catch (error) {
      if (!alive.current) return
      setLoadError(errorMessage(error))
    } finally {
      if (alive.current) setLoading(false)
    }
  }, [skills])
  useEffect(() => { void reload() }, [reload])
  useEffect(() => onChange?.(() => { void reload() }), [onChange, reload])

  const references = useCallback(async (installId: string): Promise<SkillProjectRef[]> => {
    return unwrap(await skills.installReferences(installId)).projects
  }, [skills])

  const review = useCallback(async (source: string) => {
    const trimmed = source.trim()
    if (trimmed === '') return
    setReviewing(true)
    setActionError(undefined)
    setOutcome(undefined)
    try {
      const value = unwrap(await skills.previewImport(trimmed))
      if (!alive.current) return
      setPreview(value)
      setDrafts(draftsFrom(value))
    } catch (error) {
      if (!alive.current) return
      setActionError(errorMessage(error))
    } finally {
      if (alive.current) setReviewing(false)
    }
  }, [skills])

  const pick = async (kind: 'directory' | 'file'): Promise<void> => {
    if (bridge === null) return
    setActionError(undefined)
    try {
      const chosen = await pickSource(bridge, kind)
      if (!alive.current || chosen === null) return
      setPath(chosen)
      await review(chosen)
    } catch (error) {
      if (alive.current) setActionError(errorMessage(error))
    }
  }

  const apply = async (): Promise<void> => {
    if (preview === undefined) return
    const selections = selectionsFrom(preview, drafts)
    if (selections.length === 0) return
    setApplying(true)
    setActionError(undefined)
    try {
      const value = unwrap(await skills.applyImport({ path: preview.source.path, selections }))
      if (!alive.current) return
      setOutcome(value)
      setPreview(undefined)
      setDrafts([])
      await reload()
    } catch (error) {
      if (alive.current) setActionError(errorMessage(error))
    } finally {
      if (alive.current) setApplying(false)
    }
  }

  const uninstall = async (installId: string): Promise<void> => {
    setUninstalling(installId)
    setActionError(undefined)
    setAffected([])
    try {
      const value = unwrap(await skills.uninstall(installId))
      if (!alive.current) return
      if (!value.removed) {
        setActionError(t('installed.uninstallFailed', { message: value.issue === undefined ? '' : issueText(value.issue, t) }))
      } else {
        setAffected(value.affected)
      }
      await reload()
    } catch (error) {
      if (alive.current) setActionError(t('installed.uninstallFailed', { message: errorMessage(error) }))
    } finally {
      if (alive.current) setUninstalling(undefined)
    }
  }

  const readyCount = preview === undefined
    ? 0
    : preview.candidates.filter((candidate) => {
      const draft = drafts.find(item => item.key === candidate.key)
      return draft !== undefined && draftReady(candidate, draft)
    }).length

  return (
    <section style={page} aria-label={t('nav.skills')} data-deepseekgui="skills-section">
      <p style={intro}>{t('page.intro')}</p>
      {inventory !== undefined && <div style={{ ...caption, ...mono }}>{t('page.library', { dir: inventory.libraryDir })}</div>}

      <div style={row}>
        <button type="button" className={BUTTON_CLASS} style={button} disabled={bridge === null || reviewing} onClick={() => { void pick('directory') }} data-deepseekgui="skill-import-directory">
          {t('import.directory')}
        </button>
        <button type="button" className={BUTTON_CLASS} style={button} disabled={bridge === null || reviewing} onClick={() => { void pick('file') }} data-deepseekgui="skill-import-file">
          {t('import.file')}
        </button>
        <span style={{ flex: 1 }} />
        <button type="button" className={BUTTON_CLASS} style={button} disabled={loading} onClick={() => { void reload() }}>{t('page.refresh')}</button>
      </div>
      {bridge === null && <div style={caption}>{t('import.noDesktop')}</div>}
      <label style={{ ...row, ...caption }}>
        <span>{t('import.pathLabel')}</span>
        <input
          style={{ ...input, flex: 1, width: 'auto' }}
          value={path}
          placeholder={t('import.pathPlaceholder')}
          onChange={(event) => { setPath(event.target.value) }}
          onKeyDown={(event) => { if (event.key === 'Enter') void review(path) }}
          data-deepseekgui="skill-import-path"
        />
        <button type="button" className={BUTTON_CLASS} style={button} disabled={reviewing || path.trim() === ''} onClick={() => { void review(path) }} data-deepseekgui="skill-import-review">
          {reviewing ? t('import.reviewing') : t('import.review')}
        </button>
      </label>
      {actionError !== undefined && <div role="alert" style={errorText}>{actionError}</div>}

      {preview !== undefined && (
        <div style={{ ...card, gap: 8 }} data-deepseekgui="skill-review">
          <div style={row}>
            <span style={{ fontWeight: 600 }}>{t('review.title')}</span>
            <span style={{ ...caption, ...mono }}>{t('review.source', { kind: t(`kind.${preview.source.kind}`), path: preview.source.path })}</span>
            <span style={{ flex: 1 }} />
            <button type="button" className={BUTTON_CLASS} style={button} disabled={applying} onClick={() => { setPreview(undefined); setDrafts([]) }}>{t('review.close')}</button>
          </div>
          {preview.problems.length > 0 && (
            <>
              <div style={caption}>{t('review.problems')}</div>
              <IssueList issues={preview.problems} t={t} />
            </>
          )}
          <div style={caption}>{preview.candidates.length === 0 ? t('review.none') : t('review.candidates', { count: preview.candidates.length })}</div>
          {drafts.map(draft => (
            <CandidateCard
              key={draft.key}
              preview={preview}
              draft={draft}
              t={t}
              onChange={(next) => { setDrafts(current => current.map(item => item.key === next.key ? next : item)) }}
            />
          ))}
          {preview.candidates.length > 0 && (
            <div style={row}>
              <button type="button" className={BUTTON_CLASS} style={primaryButton} disabled={applying || readyCount === 0} onClick={() => { void apply() }} data-deepseekgui="skill-import-apply">
                {applying ? t('review.applying') : t('review.apply', { count: readyCount })}
              </button>
            </div>
          )}
        </div>
      )}

      {outcome !== undefined && (
        <div style={card} role="status" data-deepseekgui="skill-outcome">
          <div>{t('outcome.installed', { count: outcome.installed.length })}</div>
          {outcome.installed.map(item => (
            <div key={item.installId} style={{ ...caption, ...mono }}>{t('outcome.item.installed', { name: item.name, installId: item.installId })}</div>
          ))}
          {outcome.failures.length > 0 && <div style={errorText}>{t('outcome.failed', { count: outcome.failures.length })}</div>}
          {outcome.failures.map(failure => (
            <div key={failure.key} style={{ ...caption, ...errorText }} title={failure.issue.message}>
              {t('outcome.item.failed', { key: failure.key, message: issueText(failure.issue, t) })}
            </div>
          ))}
        </div>
      )}

      <h3 style={heading}>{t('installed.title')}</h3>
      <div style={caption}>{t('installed.hint')}</div>
      {loading && <div role="status" style={caption}>{t('page.loading')}</div>}
      {loadError !== undefined && <div role="alert" style={errorText}>{t('page.failed', { message: loadError })}</div>}
      {inventory !== undefined && inventory.installed.length === 0 && !loading && <div style={caption}>{t('installed.empty')}</div>}
      {affected.length > 0 && (
        <div role="status" style={{ ...card, ...caption }} data-deepseekgui="skill-uninstall-affected">
          {t('outcome.affected', { count: affected.length, paths: affected.map(project => project.path).join('; ') })}
        </div>
      )}
      {inventory?.installed.map(item => (
        <InstalledRow
          key={item.installId}
          item={item}
          t={t}
          busy={uninstalling !== undefined}
          onUninstall={(installId) => { void uninstall(installId) }}
          references={references}
        />
      ))}
      {inventory !== undefined && inventory.orphans.length > 0 && (
        <div style={caption}>{t('orphans.title', { count: inventory.orphans.length, names: inventory.orphans.join(', ') })}</div>
      )}

      <h3 style={heading}>{t('readOnly.title')}</h3>
      <div style={caption}>{t('readOnly.intro')}</div>
      {inventory !== undefined && inventory.readOnly.length === 0 && !loading && <div style={caption}>{t('readOnly.empty')}</div>}
      {inventory?.readOnly.map(item => <ReadOnlyRow key={item.location} item={item} t={t} />)}
    </section>
  )
}
