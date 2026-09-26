/** Composer takeover for one pending approval waterfall. */
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Button, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ApprovalComposerProps, ApprovalDanger, PendingApproval } from './contract/slots.ts'
import css from './ApprovalPanel.module.css'

/**
 * Render one pending approval and its optional Tool-owned detail.
 * @param props - selector-matched request and standard Slot props.
 * @returns The approval composer takeover.
 */
export function ApprovalPanel(props: ApprovalComposerProps) {
  const approval = props.matched
  const detail = approval.callId === undefined
    ? null
    : props.renderSlot('conversation.approval.detail', { callId: approval.callId })
  const reason = approval.displayReason === undefined ? approval.reason : props.resolveReason(approval.displayReason)
  return <ApprovalFlow key={approval.key} pending={approval} reason={reason} detail={detail} t={props.t} />
}

/** Concerns that turn the prompt into a red warning; `.git` alone stays an ordinary prompt with a note. */
const RED: readonly ApprovalDanger[] = ['system', 'apps', 'gui', 'elevated']

/** The reason `approveProtectedAction` (`@deepseek-ai/dsh-sandbox`) records for a protected-location stop. */
const PROTECTED_REASON = /^this (command|operation) touches protected locations /u

function ApprovalFlow({ pending, reason, detail, t }: {
  pending: PendingApproval
  reason: string | undefined
  detail: ReactNode
  t: ApprovalComposerProps['t']
}) {
  const [answered, setAnswered] = useState(false)
  const waiting = useRef(false)
  const active = useRef(true)
  const composing = useRef(false)
  const compositionEnded = useRef(false)
  const rejectButton = useRef<HTMLButtonElement>(null)
  // DeepSeekGUI (2026-09-24): an action on Windows, installed programs, or
  // DeepSeekGUI's own code — or any widening while running as administrator —
  // pauses the assistant behind a red, page-covering warning; rejecting is the
  // prominent choice.
  const red = pending.danger.filter(concern => RED.includes(concern))
  const gitNote = pending.danger.includes('git')
  // The protected-location stop explains itself through the concern list; its
  // model-facing reason would only repeat that list in English.
  const ownReason = pending.reason !== undefined && PROTECTED_REASON.test(pending.reason)
  useEffect(() => {
    active.current = true
    return () => { active.current = false }
  }, [])
  // The red warning is a modal dialog: keyboard focus starts on its safe choice.
  useEffect(() => {
    if (red.length > 0) rejectButton.current?.focus()
  }, [red.length])
  const answer = (outcome: 'allowed-once' | 'rejected'): void => {
    if (waiting.current || !pending.answerable) return
    waiting.current = true
    setAnswered(true)
    void pending.answer(outcome).catch(() => {
      if (!active.current || !pending.answerable) return
      waiting.current = false
      setAnswered(false)
    })
  }
  const keydown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const element = event.target as Element
    if (event.defaultPrevented || !event.currentTarget.contains(document.activeElement)
      || element.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]') !== null) return
    if (event.key !== 'Enter' && event.key !== 'Escape') return
    if (event.key === 'Enter' && element.closest('button, a[href], [role="button"]') !== null) return
    // DeepSeekGUI: a bare Enter never allows a red warning; Escape still rejects it.
    if (event.key === 'Enter' && red.length > 0) return
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return
    event.preventDefault()
    event.stopPropagation()
    // oxlint-disable-next-line typescript/no-deprecated -- IME 229 covers engines without isComposing.
    if (event.repeat || composing.current || compositionEnded.current || event.nativeEvent.isComposing || event.keyCode === 229) return
    answer(event.key === 'Enter' ? 'allowed-once' : 'rejected')
  }
  // Keyboard handling lives on the element that contains the focused card: the
  // root for an ordinary prompt, the portalled overlay for a red warning.
  const keys = {
    onKeyDown: keydown,
    onKeyUpCapture: () => { compositionEnded.current = false },
    onCompositionStartCapture: () => { composing.current = true },
    onCompositionEndCapture: () => { composing.current = false; compositionEnded.current = true },
  }
  const card = (
    <div className={red.length > 0 ? `${css.card} ${css.dangerCard}` : css.card}>
      <div className={red.length > 0 ? `${css.strip} ${css.dangerStrip}` : css.strip}>
        <StateDot state={answered ? 'ongoing' : red.length > 0 ? 'error' : 'warning'} />
        {red.length > 0 ? t('danger.title') : t('waiting')}
      </div>
      <div
        className={css.body}
        data-approval-scroll=""
        tabIndex={0}
        role="group"
        aria-label={t('detail.aria')}
      >
        {red.length > 0 && (
          <ul className={css.dangerList}>
            {red.map(concern => <li key={concern}>{t(`danger.${concern}`)}</li>)}
          </ul>
        )}
        {gitNote && <div className={css.gitNote}>{t('danger.git')}</div>}
        {!(red.length > 0 && ownReason) && (
          <div className={css.headline}>{reason ?? t('escalation', { toolName: pending.toolName })}</div>
        )}
        {detail !== null && <div className={css.command}>{detail}</div>}
        {red.length > 0 && <div className={css.dangerHint}>{t('danger.hint')}</div>}
      </div>
      <div className={css.actionRow}>
        {red.length > 0
          ? (
            <>
              <Button variant="outline" className={css.dangerAllow} disabled={answered} onClick={() => { answer('allowed-once') }}>
                {t('danger.allow')}
              </Button>
              <Button ref={rejectButton} variant="primary" disabled={answered} onClick={() => { answer('rejected') }}>
                {t('reject')}
              </Button>
            </>
          )
          : (
            <>
              <Button variant="outline" className={css.reject} disabled={answered} onClick={() => { answer('rejected') }}>
                {t('reject')}
              </Button>
              <Button variant="primary" disabled={answered} onClick={() => { answer('allowed-once') }}>
                {t('allowOnce')}
              </Button>
            </>
          )}
      </div>
    </div>
  )
  if (red.length === 0) {
    return <div className={css.root} data-approval-key={pending.key} aria-busy={answered} {...keys}>{card}</div>
  }
  return (
    <div className={css.root} data-approval-key={pending.key} aria-busy={answered}>
      {createPortal(
        <div className={css.dangerOverlay} role="alertdialog" aria-modal="true" aria-label={t('danger.title')} {...keys}>{card}</div>,
        document.body,
      )}
    </div>
  )
}
