/**
 * Clickable paths in the conversation (D6, 2026-09-06). The official chat
 * renders file names the assistant mentions as `<code>` spans. A click on a
 * span whose text looks like a path asks the desktop to reveal it in the
 * file manager; the desktop resolves it against the session's workspace and
 * refuses anything outside, so a wrong guess costs nothing. Pure DOM
 * delegation: no official component is touched.
 */
import type { ControlBridgeClient } from './bridge.ts'

/** Whether one code span's text is worth offering as a path. */
export function looksLikePath(text: string): boolean {
  const value = text.trim()
  if (value.length < 2 || value.length > 1_024 || value.includes('\n')) return false
  // A separator somewhere, or a plain file name with an extension; never a
  // URL, a shell command, or something with characters no path can carry.
  if (/^[a-z]+:\/\//iu.test(value) || /[<>"|*?]/u.test(value) || /\s{2,}/u.test(value)) return false
  if (/^\$|^-{1,2}[a-z]/iu.test(value) || /\s(--?\w|\||&&)/u.test(value)) return false
  return /[\\/]/u.test(value) || /^[^\s]+\.[a-z0-9]{1,8}$/iu.test(value)
}

/** Nearest `code` span (not inside a code block) under the event target. */
function codeSpanOf(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null
  const code = target.closest('code')
  if (code === null || code.closest('pre') !== null) return null
  return code
}

/**
 * Delegate clicks on path-like code spans to the desktop reveal command.
 * @param bridge - desktop control bridge.
 * @param currentSession - reads the session the person is looking at.
 * @param title - hover title for spans that qualify.
 * @returns disposer removing both listeners.
 */
export function installPathClicks(
  bridge: ControlBridgeClient,
  currentSession: () => string | undefined,
  title: string,
): () => void {
  const onClick = (event: MouseEvent): void => {
    const code = codeSpanOf(event.target)
    if (code === null || !looksLikePath(code.textContent ?? '')) return
    const sessionId = currentSession()
    if (sessionId === undefined) return
    event.preventDefault()
    void bridge.run({ type: 'reveal-path', sessionId, path: (code.textContent ?? '').trim() }).catch(() => undefined)
  }
  const onOver = (event: MouseEvent): void => {
    const code = codeSpanOf(event.target)
    if (code === null || code.dataset.deepseekguiPath !== undefined) return
    if (!looksLikePath(code.textContent ?? '')) return
    code.dataset.deepseekguiPath = '1'
    code.style.cursor = 'pointer'
    code.title = title
  }
  document.addEventListener('click', onClick)
  document.addEventListener('mouseover', onOver)
  return () => {
    document.removeEventListener('click', onClick)
    document.removeEventListener('mouseover', onOver)
  }
}
