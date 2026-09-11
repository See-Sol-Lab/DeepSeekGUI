/**
 * Keyed `tool.call.toolview` rows for the DeepSeekGUI coding tools and the
 * browser toolset (B5-P5). The rows replace the generic fallback for their
 * keys: a collapsed one-line conclusion (state dot + title + summary or
 * error line), and an expansion that folds the full output and the call
 * arguments behind disclosure sections. When a follow-up needs human input —
 * a commit message, push remote/ref, or a PR title/body/base — a small form
 * opens inline on the owning card and sends the request through the official
 * Session queue without replacing the draft; cards never execute tools directly.
 *
 * Pure presentation: every summary derives from the frozen call slice via
 * tool-models.ts (the client only sees rendered content text, so parsers
 * target the deterministic coding-tools render formats and degrade to
 * readable first lines otherwise).
 */
import type { InstructionSender } from '../instructions.ts'
import { useState, type FormEvent, type ReactNode } from 'react'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { NS_TOOLS, type ToolsKey } from '../locales-tools.ts'
import {
  contentText,
  familyOf,
  gitSummary,
  isSettled,
  toolCardModel,
  type ToolCardModel,
} from './tool-models.ts'

/** Full props of one registered row. */
type ToolRowProps = ToolCallViewProps & PropsLocale<typeof NS_TOOLS> & { submitInstruction: InstructionSender }

/** State dot palette (mirrors the official state hues). */
const STATE_COLORS = {
  running: 'var(--dsw-alias-state-info-primary)',
  ok: 'var(--dsw-alias-state-success-primary)',
  error: 'var(--dsw-alias-state-error-primary)',
  stopped: 'var(--dsw-alias-state-warning-primary)',
} as const

/** Visually-hidden status copy for the color dots. */
const STATE_KEYS: Record<keyof typeof STATE_COLORS, ToolsKey> = {
  running: 'row.running',
  ok: 'row.succeeded',
  error: 'row.failed',
  stopped: 'row.stopped',
}

/** Localized titles per git/pr wire name. */
const TITLE_KEYS: Partial<Record<string, ToolsKey>> = {
  git_status: 'title.gitStatus',
  git_diff: 'title.gitDiff',
  git_stage: 'title.gitStage',
  git_unstage: 'title.gitUnstage',
  git_revert: 'title.gitRevert',
  git_commit: 'title.gitCommit',
  git_push_preview: 'title.gitPushPreview',
  git_push: 'title.gitPush',
  pr_availability: 'title.prAvailability',
  pr_existing: 'title.prExisting',
  pr_create: 'title.prCreate',
}

/** 单行省略文本：summary 行与 error 行共用，只有颜色不同。 */
const SUMMARY_TEXT = {
  flex: '1 1 auto',
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap' as const,
  fontSize: 'var(--dsh-content-font-size-secondary, 13px)',
  lineHeight: '24px',
  color: 'var(--dsw-alias-label-tertiary)',
}

/** Inline-style tokens shared by the row chrome (official alias tokens only). */
const ROW_STYLE = {
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    border: 'none',
    background: 'none',
    padding: '2px 0',
    textAlign: 'left' as const,
    cursor: 'pointer',
    font: 'inherit',
    color: 'inherit',
  },
  title: {
    flex: 'none',
    maxWidth: '40%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    fontSize: 13,
    lineHeight: '24px',
    color: 'var(--dsw-alias-label-secondary)',
  },
  summary: SUMMARY_TEXT,
  // 错误行与 summary 行是同一种单行省略文本，只有颜色不同。
  error: { ...SUMMARY_TEXT, color: 'var(--dsw-alias-state-error-primary)' },
  chevron: {
    flex: 'none',
    color: 'var(--dsw-alias-label-secondary)',
    fontSize: 10,
  },
} satisfies Record<string, React.CSSProperties>

function dotStyle(color: string): React.CSSProperties {
  return { flex: 'none', width: 8, height: 8, borderRadius: '50%', background: color }
}

function buttonStyle(primary: boolean): React.CSSProperties {
  return {
    padding: '3px 10px',
    border: '1px solid var(--dsw-alias-label-caption)',
    borderRadius: 6,
    background: primary ? 'var(--dsw-alias-state-business-primary)' : 'transparent',
    // Text on the brand fill uses the official inverted label, never bg-base:
    // the DeepSeekGUI skin sets bg-base to transparent so the sea backdrop
    // shows through (2026-09-05 acceptance: a blue button with no text).
    color: primary ? 'var(--dsw-alias-label-primary-inverted)' : 'var(--dsw-alias-label-secondary)',
    fontSize: 12,
    lineHeight: '18px',
    cursor: 'pointer',
    fontFamily: 'inherit',
  }
}

const labelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  fontSize: 12,
  lineHeight: '18px',
  color: 'var(--dsw-alias-label-secondary)',
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '4px 8px',
  border: '1px solid var(--dsw-alias-label-caption)',
  borderRadius: 6,
  // layer-2 stays readable under the skin (bg-base is transparent there).
  background: 'var(--dsw-alias-bg-layer-2)',
  color: 'var(--dsw-alias-label-primary)',
  fontSize: 12,
  lineHeight: '18px',
  fontFamily: 'inherit',
  resize: 'vertical',
}

const mutedStyle: React.CSSProperties = {
  fontSize: 11,
  lineHeight: '16px',
  color: 'var(--dsw-alias-label-caption)',
}

/** Monospace output/argument body with its own scroll once very long. */
function CodeBlock({ text }: { text: string }) {
  return (
    <pre
      style={{
        margin: '6px 0 2px',
        maxHeight: '55vh',
        overflow: 'auto',
        fontFamily: 'var(--ds-font-family-code)',
        fontSize: 12,
        lineHeight: '18px',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        color: 'var(--dsw-alias-label-primary)',
      }}
    >
      {text}
    </pre>
  )
}

/** One <details> disclosure section inside the expanded row body. */
function Disclosure({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details style={{ borderTop: '1px solid var(--dsw-alias-label-caption)', padding: '6px 0 2px' }}>
      <summary
        style={{
          cursor: 'pointer',
          fontSize: 12,
          lineHeight: '18px',
          color: 'var(--dsw-alias-label-secondary)',
          fontFamily: 'inherit',
        }}
      >
        {summary}
      </summary>
      {children}
    </details>
  )
}

/** The output and (when present) raw-arguments disclosures every expanded row ends with. */
function OutputAndArgs({ body, argsRaw, t }: { body: string | null; argsRaw: string | null; t: ToolRowProps['t'] }) {
  return (
    <>
      <Disclosure summary={t('section.output')}>
        <CodeBlock text={body ?? t('summary.noOutput')} />
      </Disclosure>
      {argsRaw !== null && (
        <Disclosure summary={t('section.arguments')}>
          <CodeBlock text={argsRaw} />
        </Disclosure>
      )}
    </>
  )
}

/** One labeled field of a small form. */
function Field({
  label,
  value,
  onChange,
  placeholder,
  textarea,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  textarea?: boolean
}) {
  return (
    <label style={labelStyle}>
      <span>{label}</span>
      {textarea
        ? (
          <textarea
            rows={4}
            value={value}
            placeholder={placeholder}
            onChange={event => onChange(event.target.value)}
            style={inputStyle}
          />
        )
        : (
          <input
            value={value}
            placeholder={placeholder}
            onChange={event => onChange(event.target.value)}
            style={inputStyle}
          />
        )}
    </label>
  )
}

/** Shared small-form chrome: title, hint, send. */
function FormShell({
  title,
  hint,
  sendLabel,
  canSend,
  onSend,
  children,
}: {
  title: string
  hint: string
  sendLabel: string
  canSend: boolean
  onSend: () => void
  children: ReactNode
}) {
  const onSubmit = (event: FormEvent): void => {
    event.preventDefault()
    if (canSend) onSend()
  }
  return (
    <form
      onSubmit={onSubmit}
      style={{ borderTop: '1px solid var(--dsw-alias-label-caption)', padding: '8px 0 2px', display: 'flex', flexDirection: 'column', gap: 6 }}
    >
      <div style={{ fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)' }}>{title}</div>
      {children}
      <div style={mutedStyle}>{hint}</div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" disabled={!canSend} style={buttonStyle(true)}>{sendLabel}</button>
      </div>
    </form>
  )
}

/**
 * Small human-input forms opened from a settled card (B5-P5). Each form
 * composes one user instruction carrying the exact human text and dispatches
 * it through the official input actions — the agent then runs the tool and
 * the P4 approval gates keep guarding every write.
 */
function sendInstruction(
  text: string,
  submitInstruction: ToolRowProps['submitInstruction'],
  done: () => void,
): void {
  void submitInstruction(text).then((accepted) => { if (accepted) done() })
}

/** Commit-message form (opened from the git_status card). */
function CommitForm({
  t,
  submitInstruction,
  onSent,
}: {
  t: ToolRowProps['t']
  submitInstruction: ToolRowProps['submitInstruction']
  onSent: () => void
}) {
  const [message, setMessage] = useState('')
  const canSend = message.trim() !== ''
  const send = (): void => {
    sendInstruction(t('instruction.commit', { message }), submitInstruction, onSent)
  }
  return (
    <FormShell
      title={t('form.commitTitle')}
      hint={t('form.sendHint')}
      sendLabel={t('form.send')}
      canSend={canSend}
      onSend={send}
    >
      <Field
        label={t('form.commitMessageLabel')}
        placeholder={t('form.commitMessagePlaceholder')}
        value={message}
        onChange={setMessage}
        textarea
      />
    </FormShell>
  )
}

/** Push form (opened from the git_push_preview card). */
function PushForm({
  t,
  submitInstruction,
  defaults,
  onSent,
}: {
  t: ToolRowProps['t']
  submitInstruction: ToolRowProps['submitInstruction']
  defaults: { remote: string; localBranch: string; remoteBranch: string }
  onSent: () => void
}) {
  const [remote, setRemote] = useState(defaults.remote)
  const [localBranch, setLocalBranch] = useState(defaults.localBranch)
  const [remoteBranch, setRemoteBranch] = useState(defaults.remoteBranch)
  const canSend = remote.trim() !== '' && localBranch.trim() !== '' && remoteBranch.trim() !== ''
  const send = (): void => {
    sendInstruction(
      t('instruction.push', { remote, localBranch, remoteBranch }),
      submitInstruction,
      onSent,
    )
  }
  return (
    <FormShell title={t('form.pushTitle')} hint={t('form.sendHint')} sendLabel={t('form.send')} canSend={canSend} onSend={send}>
      <Field label={t('form.remoteLabel')} value={remote} onChange={setRemote} />
      <Field label={t('form.localBranchLabel')} value={localBranch} onChange={setLocalBranch} />
      <Field label={t('form.remoteBranchLabel')} value={remoteBranch} onChange={setRemoteBranch} />
    </FormShell>
  )
}

/** PR-creation form (opened from a pr_existing card that found no PR). */
function PrCreateForm({
  t,
  submitInstruction,
  defaults,
  onSent,
}: {
  t: ToolRowProps['t']
  submitInstruction: ToolRowProps['submitInstruction']
  defaults: { head: string; base: string }
  onSent: () => void
}) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [base, setBase] = useState(defaults.base)
  const [head, setHead] = useState(defaults.head)
  const [draft, setDraft] = useState(false)
  const canSend = title.trim() !== '' && base.trim() !== '' && head.trim() !== ''
  const send = (): void => {
    sendInstruction(
      t('instruction.pr', {
        title,
        body,
        base,
        head,
        draft: draft ? t('instruction.draftYes') : t('instruction.draftNo'),
      }),
      submitInstruction,
      onSent,
    )
  }
  return (
    <FormShell title={t('form.prTitleLabel')} hint={t('form.sendHint')} sendLabel={t('form.send')} canSend={canSend} onSend={send}>
      <Field label={t('form.prTitleLabel')} placeholder={t('form.prTitlePlaceholder')} value={title} onChange={setTitle} />
      <Field label={t('form.prBodyLabel')} placeholder={t('form.prBodyPlaceholder')} value={body} onChange={setBody} textarea />
      <div style={{ display: 'flex', gap: 8 }}>
        <Field label={t('form.baseLabel')} value={base} onChange={setBase} />
        <Field label={t('form.headLabel')} value={head} onChange={setHead} />
      </div>
      <label style={{ ...labelStyle, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <input type="checkbox" checked={draft} onChange={event => setDraft(event.target.checked)} />
        <span>{t('form.draftLabel')}</span>
      </label>
    </FormShell>
  )
}

/** Which form a settled card may open, keyed by tool name. */
type EligibleForm = 'commit' | 'push' | 'pr-create' | null

function eligibleForm(
  toolName: string,
  block: ToolCallViewProps['block'],
  model: ToolCardModel,
): EligibleForm {
  if (model.state !== 'ok' || !isSettled(block)) return null
  if (toolName === 'git_status') return 'commit'
  if (toolName === 'git_push_preview') return 'push'
  if (toolName === 'pr_existing' && model.output !== null
    && model.output.startsWith('no existing pull request')) return 'pr-create'
  return null
}

/** Defaults from explicit arguments and the tool's structured presentation metadata. */
function pushDefaults(model: ToolCardModel): { remote: string; localBranch: string; remoteBranch: string } {
  const meta = typeof model.meta === 'object' && model.meta !== null ? model.meta : {}
  const values = { ...model.args, ...meta } as Record<string, unknown>
  const field = (key: string): string => typeof values[key] === 'string' ? values[key] : ''
  return { remote: field('remote'), localBranch: field('localBranch'), remoteBranch: field('remoteBranch') }
}

/** Row content for one settled git/pr tool call plus its eligible action. */
const FORM_ACTION_KEYS: Record<Exclude<EligibleForm, null>, ToolsKey> = {
  commit: 'form.commitAction',
  push: 'form.pushAction',
  'pr-create': 'form.prAction',
}

export function GitPrToolRow({ block, toolName, t, submitInstruction }: ToolRowProps) {
  const [expanded, setExpanded] = useState(false)
  const [openForm, setOpenForm] = useState<EligibleForm>(null)
  const model = toolCardModel(block)
  const family = familyOf(toolName)
  const presentation = family === 'git-status' || family === 'git-diff' ? gitSummary(toolName, model) : null
  const counts = family === 'git-status' ? presentation?.counts ?? null : null
  const body = isSettled(block) ? contentText(block) : null
  const titleKey = TITLE_KEYS[toolName]
  const title = titleKey === undefined ? toolName : t(titleKey)
  let summary = model.summary
  if (presentation !== null && presentation.summary !== '') summary = presentation.summary
  if (family === 'git-diff' && presentation !== null && presentation.diffFiles.length > 0) {
    const added = presentation.diffFiles.reduce((sum, file) => sum + file.added, 0)
    const deleted = presentation.diffFiles.reduce((sum, file) => sum + file.deleted, 0)
    summary = t('diff.stat', { files: presentation.diffFiles.length, added, deleted })
  }
  const statusCopy = t(STATE_KEYS[model.state])
  const eligible = eligibleForm(toolName, block, model)
  const toggle = (): void => {
    setExpanded(value => !value)
    setOpenForm(null)
  }
  const closeForm = (): void => {
    setOpenForm(null)
    setExpanded(false)
  }
  return (
    <div data-tool={toolName} data-state={model.state}>
      <button
        type="button"
        aria-expanded={expanded}
        aria-label={`${title}${summary === '' ? '' : `: ${summary}`} (${statusCopy})`}
        onClick={toggle}
        style={ROW_STYLE.header}
      >
        <span style={dotStyle(STATE_COLORS[model.state])} aria-hidden />
        <span style={ROW_STYLE.title}>{title}</span>
        <span style={model.errorSummary === null ? ROW_STYLE.summary : ROW_STYLE.error}>
          {model.errorSummary ?? summary}
        </span>
        <span style={ROW_STYLE.chevron} aria-hidden>{expanded ? '▾' : '▸'}</span>
      </button>
      {expanded && (
        <div>
          {counts !== null && counts.total > 0 && (
            <div style={mutedStyle}>
              {t('changes.counts', {
                staged: counts.staged,
                unstaged: counts.unstaged,
                untracked: counts.untracked,
                conflict: counts.conflict,
              })}
            </div>
          )}
          {presentation !== null && presentation.diffFiles.length > 0 && (
            <div style={mutedStyle}>
              {presentation.diffFiles.slice(0, 10).map(file => (
                <div key={file.path} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {file.path}{file.binary ? ` ${t('row.binary')}` : ` +${file.added} −${file.deleted}`}
                </div>
              ))}
              {presentation.diffFiles.length > 10 && (
                <div>{t('list.more', { count: presentation.diffFiles.length - 10 })}</div>
              )}
            </div>
          )}
          <OutputAndArgs body={body} argsRaw={model.argsRaw} t={t} />
          {eligible !== null && openForm === null && (
            <div style={{ borderTop: '1px solid var(--dsw-alias-label-caption)', padding: '6px 0 2px', display: 'flex', gap: 8 }}>
              <button type="button" onClick={() => setOpenForm(eligible)} style={buttonStyle(false)}>
                {t(FORM_ACTION_KEYS[eligible])}
              </button>
            </div>
          )}
          {openForm === 'commit' && (
            <CommitForm t={t} submitInstruction={submitInstruction} onSent={closeForm} />
          )}
          {openForm === 'push' && (
            <PushForm
              t={t}
              submitInstruction={submitInstruction}
              defaults={pushDefaults(model)}
              onSent={closeForm}
            />
          )}
          {openForm === 'pr-create' && (
            <PrCreateForm
              t={t}
              submitInstruction={submitInstruction}
              defaults={{ head: typeof model.args?.head === 'string' ? model.args.head : '', base: '' }}
              onSent={closeForm}
            />
          )}
        </div>
      )}
    </div>
  )
}

/** Row for the DeepSeekGUI browser tools: URL/selector summary + folded output. */
export function BrowserToolRow({ block, toolName, t }: ToolRowProps) {
  const [expanded, setExpanded] = useState(false)
  const model = toolCardModel(block)
  const body = isSettled(block) ? contentText(block) : null
  const statusCopy = t(STATE_KEYS[model.state])
  return (
    <div data-tool={toolName} data-state={model.state}>
      <button
        type="button"
        aria-expanded={expanded}
        aria-label={`${t('title.browser')}: ${model.summary} (${statusCopy})`}
        onClick={() => setExpanded(value => !value)}
        style={ROW_STYLE.header}
      >
        <span style={dotStyle(STATE_COLORS[model.state])} aria-hidden />
        <span style={ROW_STYLE.title}>{t('title.browser')}</span>
        <span style={model.errorSummary === null ? ROW_STYLE.summary : ROW_STYLE.error}>
          {model.errorSummary ?? model.summary}
        </span>
        <span style={ROW_STYLE.chevron} aria-hidden>{expanded ? '▾' : '▸'}</span>
      </button>
      {expanded && (
        <div>
          <OutputAndArgs body={body} argsRaw={model.argsRaw} t={t} />
        </div>
      )}
    </div>
  )
}
