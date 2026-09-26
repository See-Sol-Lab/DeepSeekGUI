/**
 * DeepSeekGUI's welcome overlay: the official Desktop welcome window
 * (0.1.7-rc.2 `apps/desktop/src/client/WelcomePage.tsx`) ported into a
 * full-window `shell.overlay` of the DeepSeekGUI page (住户 2026-09-25: 首次
 * 引导全换官方的). Sign in with a DeepSeek account, add an API key, or set up
 * later; after sign-in the official in-page onboarding takes over.
 *
 * Differences from the official window: the brand reads DeepSeekGUI with the
 * official fish mark, there is no native titlebar, and the operations run in
 * the page — account calls through the official `remote.account`, the key
 * through the Host shim's `dshOnboarding`. The browser opening on sign-in
 * stays in the desktop main process, as in the official Desktop.
 * @module @see-sol-lab/deepseekgui-workbench/client/welcome/WelcomeOverlay
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { FormEvent } from 'react'
import { FishLogo, StateDot, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AccountView } from '@deepseek-ai/dsh-deepseek-account/types'
import type { WelcomeController } from './welcome-controller.ts'
import { WELCOME_CSS } from './welcome-style.ts'

/** Account operations the overlay needs (the official account Remote). */
export interface WelcomeAccountOperations {
  start(): Promise<AccountView>
  cancel(id: NonNullable<AccountView['attempt']>['id']): Promise<AccountView>
}

/** What `shell.overlay` injects. */
export interface WelcomeInjected {
  controller: WelcomeController
  account: WelcomeAccountOperations
}

/** Slot props. */
export type WelcomeOverlayProps = PropsRuntime<'shell.overlay'> & PropsLocale<'deepseekgui.welcome'> & WelcomeInjected

/**
 * The overlay: renders nothing unless the controller says the welcome is needed.
 * @param props - controller, account operations and copy.
 * @returns the welcome layer, or null.
 */
export function WelcomeOverlay({ controller, account, t }: WelcomeOverlayProps) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  if (!snapshot.visible) return null
  return <Welcome controller={controller} account={account} t={t} view={snapshot.view} expiredNotice={snapshot.expiredNotice} />
}

type Page = 'entry' | 'key' | 'account'

function Welcome({ controller, account, t, view, expiredNotice }: WelcomeInjected & Pick<WelcomeOverlayProps, 't'> & {
  view: AccountView | undefined
  expiredNotice: boolean
}) {
  const [page, setPage] = useState<Page>('entry')
  const pageRef = useRef<Page>('entry')
  const [attempt, setAttempt] = useState<AccountView['attempt']>(null)
  const attemptRef = useRef<AccountView['attempt']>(null)
  const [starting, setStarting] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [copyState, setCopyState] = useState<'idle' | 'busy' | 'copied' | 'failed'>('idle')
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const mounted = useRef(true)
  const revision = useRef(0)
  const input = useRef<HTMLInputElement>(null)
  const keyButton = useRef<HTMLButtonElement>(null)
  const focusEntry = useRef(false)

  function navigate(next: Page) {
    pageRef.current = next
    setPage(next)
  }
  function showAccount(state: AccountView) {
    if (pageRef.current === 'key' || (state.attempt === null && pageRef.current === 'entry')) return
    attemptRef.current = state.attempt
    setAttempt(state.attempt)
    setStarting(false)
    setCopyState('idle')
    navigate(state.attempt === null || state.attempt.phase === 'cancelled' ? 'entry' : 'account')
  }

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  // Every account frame (the official stream, through the controller) moves the sign-in page.
  useEffect(() => {
    if (view === undefined) return
    revision.current++
    showAccount(view)
  }, [view])
  useEffect(() => {
    if (page === 'key') input.current?.focus()
    else if (page === 'entry' && focusEntry.current) {
      focusEntry.current = false
      keyButton.current?.focus()
    }
  }, [page])
  useEffect(() => {
    if (copyState !== 'copied' && copyState !== 'failed') return
    const timer = setTimeout(() => { setCopyState('idle') }, 2000)
    return () => { clearTimeout(timer) }
  }, [copyState])

  async function saveKey(event: FormEvent) {
    event.preventDefault()
    if (busyRef.current) return
    const value = draft.trim()
    if (!/^[\x21-\x7e]+$/.test(value) || /^[A-Z][A-Z0-9_]*=[^=]/.test(value)
      || ((value.startsWith('"') || value.startsWith("'") || value.charCodeAt(0) === 96) && value.at(-1) === value[0])) {
      setError(value === '' ? t('key.blank') : t('key.invalid'))
      input.current?.focus()
      return
    }
    busyRef.current = true
    setBusy(true)
    setError('')
    try {
      const saved = await controller.saveApiKey(value)
      if (!mounted.current) return
      if (saved) setDraft('')
      else setError(t('key.failed'))
    } catch {
      if (mounted.current) setError(t('key.failed'))
    } finally {
      busyRef.current = false
      if (mounted.current) setBusy(false)
    }
  }
  function skip() {
    if (busyRef.current) return
    setDraft('')
    controller.skip()
  }
  async function start() {
    navigate('account')
    setStarting(true)
    setAttempt(null)
    attemptRef.current = null
    const current = ++revision.current
    try {
      const state = await account.start()
      if (mounted.current && revision.current === current) showAccount(state)
    } catch {
      if (mounted.current && revision.current === current) setStarting(false)
    }
  }
  async function cancel() {
    if (cancelling || attemptRef.current === null) return
    setCancelling(true)
    const current = ++revision.current
    try {
      const state = await account.cancel(attemptRef.current.id)
      if (mounted.current && revision.current === current) showAccount(state)
    } catch {
      // The current attempt remains visible so cancellation can be retried.
    } finally {
      if (mounted.current) setCancelling(false)
    }
  }
  async function copyLink() {
    const current = attemptRef.current
    if (current?.phase !== 'waiting-browser' || current.authorizeUrl === undefined || copyState === 'busy' || copyState === 'copied') return
    setCopyState('busy')
    try {
      const url = new URL(current.authorizeUrl)
      url.searchParams.set('theme', window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      await navigator.clipboard.writeText(url.href)
      if (mounted.current && attemptRef.current === current) setCopyState('copied')
    } catch {
      if (mounted.current && attemptRef.current === current) setCopyState('failed')
    }
  }

  const phase = starting ? 'initializing' : attempt?.phase ?? 'failed'
  const waiting = phase === 'waiting-browser'
  const failed = phase === 'expired' || phase === 'failed'
  const title = phase === 'initializing' ? t('auth.starting')
    : waiting ? t('auth.waiting') : phase === 'expired' ? t('auth.expired')
      : phase === 'failed' ? t('auth.failed') : t('auth.exchanging')
  const heading = page === 'entry' ? 'dsgw-welcome-heading' : page === 'key' ? 'dsgw-key-title' : 'dsgw-auth-status'

  return <div className="dsgw-root" data-deepseekgui="welcome">
    <style>{WELCOME_CSS}</style>
    {expiredNotice && <Toast text={t('sessionExpired')} onDone={() => { controller.dismissNotice() }} />}
    <main className="dsgw-welcome" aria-labelledby={heading}>
      <div className="dsgw-brand" aria-label={t('brand')}><FishLogo size={36} /><span aria-hidden="true">{t('brand')}</span></div>
      <div className="dsgw-tagline" hidden={page !== 'entry'}>
        <h1 id="dsgw-welcome-heading"><span>{t('tagline.before')}</span><em>{t('tagline.brand')}</em><span>{t('tagline.after')}</span></h1>
        <p>{t('description')}</p>
      </div>
      <form id="dsgw-key-form" className="dsgw-key-form" hidden={page !== 'key'} noValidate onSubmit={(event) => { void saveKey(event) }} aria-busy={busy}>
        <header className="dsgw-key-heading"><h1 id="dsgw-key-title">{t('key.title')}</h1><p id="dsgw-key-description">{t('key.description')}</p></header>
        <div className="dsgw-key-field">
          <label className="dsgw-visually-hidden" htmlFor="dsgw-key-input">{t('key.placeholder')}</label>
          <input ref={input} id="dsgw-key-input" type="password" autoComplete="new-password" autoCapitalize="off" spellCheck={false} required
            aria-describedby="dsgw-key-description dsgw-key-error" aria-invalid={error !== ''} placeholder={t('key.placeholder')}
            value={draft} disabled={busy} onChange={(event) => { setDraft(event.target.value); setError('') }} />
          <p id="dsgw-key-error" className="dsgw-key-error" role="alert" hidden={error === ''}>{error}</p>
        </div>
      </form>
      <section className={`dsgw-auth-page dsgw-key-heading ${waiting ? 'dsgw-auth-waiting' : phase === 'expired' ? 'dsgw-auth-expired' : ''}`}
        hidden={page !== 'account'} aria-live="polite">
        <h1 id="dsgw-auth-status">{title}</h1>
        <p hidden={!waiting && phase !== 'expired'}>{waiting ? t('auth.waitingDescription') : t('auth.expiredDescription')}</p>
        <button className="dsgw-copy-link" type="button" hidden={!waiting} disabled={!waiting || copyState === 'busy' || copyState === 'copied'}
          onClick={() => { void copyLink() }}>
          {copyState === 'copied' ? t('auth.copied') : copyState === 'failed' ? t('auth.copyFailed') : t('auth.copyLink')}
        </button>
      </section>
      <div className="dsgw-actions" hidden={page !== 'account'}>
        <button className="dsgw-primary dsgw-loading" type="button" hidden={failed} disabled aria-label={t('auth.exchanging')}>
          <StateDot state="ongoing" size={16} />
        </button>
        <button className="dsgw-primary" type="button" hidden={!failed} onClick={() => { void start() }}>{t('auth.retry')}</button>
        <button className="dsgw-secondary" type="button" hidden={!failed} onClick={() => { navigate('key') }}>{t('apiKey')}</button>
        <button className="dsgw-secondary" type="button" hidden={failed}
          disabled={cancelling || phase === 'committing' || phase === 'succeeded' || (phase === 'initializing' && !attempt?.id)}
          onClick={() => { void cancel() }}>{t('auth.cancel')}</button>
      </div>
      <div className="dsgw-actions" hidden={page !== 'entry'}>
        <button className="dsgw-primary" type="button" data-deepseekgui="welcome-sign-in" onClick={() => { void start() }}>{t('signIn')}</button>
        <button ref={keyButton} className="dsgw-secondary" type="button" onClick={() => { navigate('key') }}>{t('apiKey')}</button>
      </div>
      <div className="dsgw-actions" hidden={page !== 'key'}>
        <button className="dsgw-primary" type="submit" form="dsgw-key-form" disabled={busy || draft.trim() === ''}>{t('key.save')}</button>
        <button className="dsgw-secondary" type="button" data-deepseekgui="welcome-later" disabled={busy} onClick={skip}>{t('key.later')}</button>
        <button className="dsgw-back" type="button" disabled={busy} onClick={() => {
          if (busyRef.current) return
          setDraft(''); setError(''); focusEntry.current = true; navigate('entry')
        }}>{t('key.back')}</button>
      </div>
    </main>
  </div>
}
