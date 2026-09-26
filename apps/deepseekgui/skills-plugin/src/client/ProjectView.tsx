/**
 * Project management (B7-P5): the session-top page where a project folder
 * picks the library skills it may use. It reads the page for the current
 * session, lets the person tick installs, and saves the complete list with
 * the revision it was rendered from; the Host refuses a stale page and hands
 * back the winning selection. Every row says what the tick does in this
 * session's real catalog (active / shadowed by an official same-name skill /
 * invalid / uninstalled), and the page states the effect timing: the next
 * message of an open session, never a retroactive removal from history.
 *
 * Stale async results never overwrite a newer target: every read and save is
 * keyed by the session it was issued for and by a generation counter, and a
 * result lands only if both still match.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { RemoteResult, TypertRemoteNamespaceMap } from '@deepseek-ai/dsh-typert-protocol'
// Type-only: merges the generated `skillManager` namespace into the Remote map.
import type {} from '@deepseek-ai/dsh-skill-manager/remote'
import type { SkillProjectEntry, SkillProjectView } from '@deepseek-ai/dsh-skill-manager/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS_SKILLS, SkillsKey } from './locales.ts'
import { issueText } from './model.ts'

/** The generated `skillManager` Remote namespace the plugin entry mounts. */
export type SkillManagerRemote = TypertRemoteNamespaceMap['skillManager']

/** Business props the plugin entry injects. */
export interface ProjectInjected {
  skills: SkillManagerRemote
  /**
   * Subscribe to library / selection changes forwarded from the Host; the
   * page re-reads on each so a sibling session's save shows up here.
   */
  onChange: (listener: () => void) => () => void
}

/** Locale seat, the session, and the injected business props. */
export type ProjectViewProps = PropsLocale<typeof NS_SKILLS> & ProjectInjected & { sessionId: SessionId | undefined }

type Translate = (key: SkillsKey, params?: Record<string, unknown>) => string

const view: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 0', boxSizing: 'border-box',
  // 和 Workbench 的几个视图同一条：内容滚到底会跑到 composer 卡片后面，从
  // 半透明的卡片里透出来。留白的高度由皮肤层按 composer 的实测高度给
  // （--deepseekgui-view-bottom-inset，见 workbench-plugin 的 skin.ts）。
  paddingBottom: 'var(--deepseekgui-view-bottom-inset, 12px)',
  width: '100%', maxWidth: 'var(--dsh-chat-content-width, 920px)', margin: '0 auto',
  fontSize: 14, lineHeight: '22px', color: 'var(--dsw-alias-label-primary)',
}
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
const primaryButton: React.CSSProperties = { ...button, color: 'var(--dsw-alias-label-primary)', border: '1px solid var(--dsw-alias-brand-primary)' }
const row: React.CSSProperties = { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }
const card: React.CSSProperties = {
  padding: '10px 14px', borderRadius: 10, border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-2)',
  display: 'flex', flexDirection: 'column', gap: 4,
}
const badge: React.CSSProperties = { ...caption, padding: '0 6px', borderRadius: 4, border: '1px solid var(--dsw-alias-border-l1)' }
const errorText: React.CSSProperties = { color: 'var(--dsw-alias-state-error-primary)' }
const warnText: React.CSSProperties = { color: 'var(--dsw-alias-state-warning-primary, var(--dsw-alias-label-secondary))' }

/** Unwrap a Remote result into a value or throw its error. */
function unwrap<T>(result: RemoteResult<T>): T {
  if (result.ok) return result.value
  throw result.error
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The badge style of one effect. */
function effectStyle(effect: SkillProjectEntry['effect']): React.CSSProperties {
  switch (effect) {
    case 'active': return badge
    case 'shadowed': return { ...badge, ...warnText }
    case 'invalid':
    case 'missing': return { ...badge, ...errorText }
    case 'inactive': return badge
  }
}

function EntryRow({ entry, checked, onToggle, disabled, t }: {
  entry: SkillProjectEntry
  checked: boolean
  onToggle: (installId: string, next: boolean) => void
  disabled: boolean
  t: Translate
}) {
  const gone = entry.effect === 'missing'
  return (
    <label style={{ ...card, cursor: disabled ? 'default' : 'pointer' }} data-deepseekgui="skill-project-entry" data-install-id={entry.installId}>
      <div style={row}>
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event) => { onToggle(entry.installId, event.target.checked) }}
          aria-label={entry.name}
        />
        <span style={{ fontWeight: 600 }}>{entry.name}</span>
        {checked && (
          <span style={effectStyle(entry.effect)} title={entry.shadowedBy === undefined ? undefined : t('effect.shadowedBy', { source: entry.shadowedBy.source })}>
            {t(`effect.${entry.effect}`)}
          </span>
        )}
        {!checked && entry.status === 'invalid' && !gone && (
          <span style={{ ...badge, ...errorText }} title={entry.issue?.message}>{t('effect.invalid')}</span>
        )}
        <span style={{ flex: 1 }} />
        <span style={{ ...caption, ...mono }}>{entry.installId}</span>
      </div>
      {entry.description !== '' && <div>{entry.description}</div>}
      {gone && <div style={caption}>{t('effect.missingHint')}</div>}
      {entry.status === 'invalid' && !gone && entry.issue !== undefined && (
        <div style={{ ...caption, ...errorText }}>{issueText(entry.issue, t)}</div>
      )}
      {entry.effect === 'shadowed' && entry.shadowedBy !== undefined && checked && (
        <div style={caption}>{t('effect.shadowedBy', { source: entry.shadowedBy.source })}</div>
      )}
    </label>
  )
}

/** One read or save outcome, tagged with the target it was issued for. */
interface PageState {
  sessionId: SessionId
  page: SkillProjectView
  /** The ticks as edited; reset from the page on every fresh read. */
  ticks: Set<string>
}

export function ProjectView({ sessionId, skills, onChange, t }: ProjectViewProps) {
  const [state, setState] = useState<PageState>()
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string>()
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'saved' | 'conflict' | 'failed'; message?: string }>()
  // The current target plus a generation: a result may land only if the
  // session it was read for is still the one shown AND no newer read started.
  const generation = useRef(0)
  const savingFor = useRef<SessionId>()
  const target = useRef(sessionId)
  target.current = sessionId

  const load = useCallback(async (): Promise<void> => {
    const forSession = sessionId
    generation.current += 1
    const mine = generation.current
    if (forSession === undefined) {
      setState(undefined)
      setLoading(false)
      return
    }
    setLoading(true)
    setLoadError(undefined)
    const controller = new AbortController()
    try {
      const page = unwrap(await skills.projectView(forSession, controller.signal))
      if (mine !== generation.current || target.current !== forSession) return
      setState({ sessionId: forSession, page, ticks: new Set(page.entries.filter(entry => entry.enabled).map(entry => entry.installId)) })
      setNotice(undefined)
    } catch (error) {
      if (mine !== generation.current || target.current !== forSession) return
      setLoadError(errorMessage(error))
    } finally {
      if (mine === generation.current && target.current === forSession) setLoading(false)
    }
  }, [sessionId, skills])

  useEffect(() => { void load() }, [load])
  useEffect(() => onChange(() => {
    // The save response includes the refreshed page. Its own change event
    // must not invalidate that response before it clears the pending action.
    if (savingFor.current !== sessionId) void load()
  }), [onChange, load, sessionId])

  const current = state !== undefined && state.sessionId === sessionId ? state : undefined
  const dirty = current !== undefined && (
    current.ticks.size !== current.page.entries.filter(entry => entry.enabled).length
    || current.page.entries.some(entry => entry.enabled !== current.ticks.has(entry.installId))
  )

  const toggle = (installId: string, next: boolean): void => {
    setState((previous) => {
      if (previous === undefined) return previous
      const ticks = new Set(previous.ticks)
      if (next) ticks.add(installId)
      else ticks.delete(installId)
      return { ...previous, ticks }
    })
  }

  const save = async (): Promise<void> => {
    if (current === undefined) return
    const forSession = current.sessionId
    savingFor.current = forSession
    generation.current += 1
    const mine = generation.current
    setSaving(true)
    setNotice(undefined)
    try {
      const outcome = unwrap(await skills.setProjectSelection({
        sessionId: forSession,
        enabled: [...current.ticks],
        revision: current.page.revision,
      }, new AbortController().signal))
      if (mine !== generation.current || target.current !== forSession) return
      const page = outcome.view
      setState({ sessionId: forSession, page, ticks: new Set(page.entries.filter(entry => entry.enabled).map(entry => entry.installId)) })
      if (outcome.saved) setNotice({ kind: 'saved' })
      else if (outcome.issue?.code === 'revision-conflict') setNotice({ kind: 'conflict' })
      else setNotice({ kind: 'failed', message: outcome.issue === undefined ? '' : issueText(outcome.issue, t) })
    } catch (error) {
      if (mine !== generation.current || target.current !== forSession) return
      setNotice({ kind: 'failed', message: errorMessage(error) })
    } finally {
      savingFor.current = undefined
      setSaving(false)
    }
  }

  const page = current?.page
  const problem = page?.problem
  return (
    <section style={view} aria-label={t('view.project')} data-deepseekgui="skill-project-view">
      <div style={row}>
        <span style={heading}>{t('project.title')}</span>
        <span style={{ flex: 1 }} />
        <button type="button" className={BUTTON_CLASS} style={button} disabled={loading || saving} onClick={() => { void load() }}>{t('project.refresh')}</button>
      </div>
      <p style={intro}>{t('project.intro')}</p>
      {page?.project !== null && page?.project !== undefined && (
        <div style={{ ...caption, ...mono }} data-deepseekgui="skill-project-folder">{t('project.folder', { path: page.project.path })}</div>
      )}
      {problem === 'no-cwd' && <div role="note" style={caption}>{t('project.noCwd')}</div>}
      {problem === 'missing-folder' && <div role="alert" style={errorText}>{t('project.missingFolder')}</div>}
      {loading && <div role="status" style={caption}>{t('project.loading')}</div>}
      {loadError !== undefined && <div role="alert" style={errorText}>{t('project.failed', { message: loadError })}</div>}
      {page !== undefined && page.project !== null && !page.catalogComplete && <div style={caption}>{t('project.catalogIncomplete')}</div>}
      {page !== undefined && page.entries.length === 0 && !loading && <div style={caption}>{t('project.empty')}</div>}
      {current !== undefined && page !== undefined && page.entries.map(entry => (
        <EntryRow
          key={entry.installId}
          entry={entry}
          checked={current.ticks.has(entry.installId)}
          disabled={saving || page.project === null}
          onToggle={toggle}
          t={t}
        />
      ))}
      {page !== undefined && page.project !== null && (
        <div style={row}>
          <button type="button" className={BUTTON_CLASS} style={primaryButton} disabled={saving || !dirty} onClick={() => { void save() }} data-deepseekgui="skill-project-save">
            {saving ? t('project.saving') : t('project.save')}
          </button>
          {dirty && !saving && <span style={caption}>{t('project.dirty')}</span>}
          {notice?.kind === 'saved' && <span role="status" style={caption}>{t('project.saved')}</span>}
          {notice?.kind === 'conflict' && <span role="alert" style={warnText}>{t('project.conflict')}</span>}
          {notice?.kind === 'failed' && <span role="alert" style={errorText}>{t('project.saveFailed', { message: notice.message ?? '' })}</span>}
        </div>
      )}
      {page !== undefined && page.project !== null && <p role="note" style={intro}>{t('project.effectNote')}</p>}
    </section>
  )
}
