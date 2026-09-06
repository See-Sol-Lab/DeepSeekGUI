/**
 * B5-P6 web-side notification consumer. Official interaction/permission and
 * job facts arrive through the official connection (which owns heartbeat and
 * reconnect — nothing here reconnects or compensates); this watcher turns
 * them into one-shot desktop notifications via the stateless `notify`
 * control command. Deduplication happens here, keyed by
 * `session + official event id`, exactly once per page lifetime; the desktop
 * only displays and navigates.
 *
 * The component renders nothing and lives on the sidebar footer seat so it
 * stays mounted across sessions (root scope).
 */
import { useCallback, useEffect, useRef } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { NS_NOTIFY } from './locales-notify.ts'
import { readBridge, type ControlBridgeClient } from './bridge.ts'
import {
  advanceJobMemory,
  compactLine,
  officialEventIdOf,
  readPending,
} from './notify/notifier-model.ts'

/** Full props of the invisible footer watcher. */
export type NotificationWatcherProps = PropsRuntime<'sidebar.footer.action'>
  & PropsLocale<typeof NS_NOTIFY>
  & {
    /** Bridge override for tests; defaults to the page bridge. */
    bridge?: ControlBridgeClient | null
  }

/** Notification kinds this consumer may emit. */
type NotifyKind = 'approval' | 'question' | 'job'

/**
 * Mount the invisible notifier.
 * @param props - standard root props plus the notify locale seat.
 */
export function NotificationWatcher(props: NotificationWatcherProps) {
  const bridgeRef = useRef<ControlBridgeClient | null>(null)
  if (bridgeRef.current === null) bridgeRef.current = props.bridge === undefined ? readBridge() : props.bridge
  const pending = props.useSessionPendingInteraction(snapshot => snapshot)
  const sessionFacts = props.useSessions(snapshot => ({
    current: snapshot.current,
    jobs: snapshot.jobsBySession,
  }))
  const notified = useRef(new Set<string>())
  const jobMemory = useRef(new Map<string, string>())
  const { t } = props

  const maybeNotify = useCallback((
    kind: NotifyKind,
    sessionId: SessionId,
    id: string,
    title: string,
    body: string,
    current: SessionId | undefined,
  ): void => {
    // 目标会话正被聚焦查看时官方 UI 已经展示着该事实，不打扰；桌面侧还
    // 有主窗可见+聚焦的总闸，两端一致（都只管"正在看"这一种情况）。
    if (document.hasFocus() && current === sessionId) return
    const key = `${sessionId}/${kind}/${id}`
    if (notified.current.has(key)) return
    notified.current.add(key)
    const bridge = bridgeRef.current
    if (bridge === null) return
    void bridge.run({ type: 'notify', id: key, sessionId, kind, title, body }).catch(() => {
      // Desktop gone or command rejected: notifications are an enhancement,
      // never a failure the page should surface.
    })
  }, [])

  // Pending official interactions (approvals and questions): notify each new
  // one exactly once per page lifetime.
  useEffect(() => {
    const current = sessionFacts.current
    for (const [sessionId, interaction] of pending) {
      const read = readPending(interaction)
      if (read === null) continue
      const kind: NotifyKind | null = read.kind === 'approval'
        ? 'approval'
        : read.kind === 'question' || read.kind === 'plan-review'
          ? 'question'
          : null
      if (kind === null) continue
      const id = kind === 'approval'
        ? officialEventIdOf({
          kind: 'approval',
          key: read.key,
          callId: read.callId,
          toolName: read.toolName,
          reason: read.reason,
        })
        : officialEventIdOf({
          kind: 'question',
          key: read.key,
          questions: read.questions,
        })
      const tool = read.toolName ?? 'tool'
      const reason = (read.reason ?? '').trim()
      const body = kind === 'approval'
        ? reason === ''
          ? t('body.approval.noReason', { tool })
          : t('body.approval', { tool, reason: compactLine(reason) })
        : (() => {
          const first = read.questions?.find(question => (question.question ?? '') !== '')?.question ?? ''
          return first === ''
            ? t('body.question.empty', { count: read.questions?.length ?? 0 })
            : t('body.question', { first: compactLine(first) })
        })()
      maybeNotify(
        kind,
        sessionId as SessionId,
        id === '' ? read.key : id,
        t(kind === 'approval' ? 'kind.approval.title' : 'kind.question.title'),
        body,
        current,
      )
    }
  }, [pending, sessionFacts.current, t, maybeNotify])

  // Official job transitions: completed/failed edges notify once per job;
  // first sighting only establishes memory (baseline suppression).
  useEffect(() => {
    const current = sessionFacts.current
    for (const [sessionId, jobs] of Object.entries(sessionFacts.jobs)) {
      for (const notice of advanceJobMemory(jobMemory.current, sessionId as SessionId, jobs)) {
        maybeNotify(
          'job',
          notice.sessionId,
          notice.jobId,
          t(notice.status === 'completed' ? 'kind.job.completed.title' : 'kind.job.failed.title'),
          t('body.job', { label: compactLine(notice.label), kind: notice.kind }),
          current,
        )
      }
    }
  }, [sessionFacts.jobs, sessionFacts.current, t, maybeNotify])

  return null
}
