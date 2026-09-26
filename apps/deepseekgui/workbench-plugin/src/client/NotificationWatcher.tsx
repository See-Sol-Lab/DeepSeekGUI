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
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { NS_NOTIFY } from './locales-notify.ts'
import { readBridge, type ControlBridgeClient } from './bridge.ts'
import {
  advanceJobMemory,
  compactLine,
  officialEventIdOf,
  readPending,
  type NotifyJobLike,
} from './notify/notifier-model.ts'

/** Full props of the invisible footer watcher. */
export type NotificationWatcherProps = PropsRuntime<'sidebar.footer.action'>
  & PropsLocale<typeof NS_NOTIFY>
  & {
    /** Bridge override for tests; defaults to the page bridge. */
    bridge?: ControlBridgeClient | null
    /** Client jobs snapshot (0.1.7: jobs left the session list for the job controller). */
    jobs: { getSnapshot(): { rows: Readonly<Record<string, readonly NotifyJobLike[]>> }; subscribe(listener: () => void): () => void }
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
  // 0.1.7: pending interactions ride on the per-session status map. The session the user is
  // looking at is the one the main view retains, unless another panel covers the main area —
  // the same rule the document title follows. The desktop shows whatever arrives here.
  const statuses = props.useSessionStatus(snapshot => snapshot)
  const mainAreaShowsSession = props.usePanelInfo(info => info.activePanelId === null)
  const viewedSession = props.useSessions(state => Object.values(state.byId)
    .find(session => (session.retainedBy.mainView ?? 0) > 0)?.id)
  const pending = useMemo((): ReadonlyMap<SessionId, unknown> => new Map(
    [...statuses].flatMap(([sessionId, status]) =>
      (status.pendingInteraction === undefined ? [] : [[sessionId, status.pendingInteraction] as const])),
  ), [statuses])
  // The store is a class instance (ClientJobsModel): its methods read `this`, so they are called
  // through the object rather than passed around detached.
  const jobs = props.jobs
  const subscribeJobs = useCallback((listener: () => void) => jobs.subscribe(listener), [jobs])
  const readJobs = useCallback(() => jobs.getSnapshot(), [jobs])
  const jobRows = useSyncExternalStore(subscribeJobs, readJobs).rows
  const sessionFacts = { current: mainAreaShowsSession ? viewedSession : undefined, jobs: jobRows }
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
    const key = `${sessionId}/${kind}/${id}`
    if (notified.current.has(key)) return
    notified.current.add(key)
    // 只有"窗口有焦点且正看着这个会话"才不打扰：官方 UI 已经展示着该事实，
    // 也算处理过了（切走以后不再补弹）。看着别的会话、在首页或设置页时照常通知。
    if (document.hasFocus() && current === sessionId) return
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
