/**
 * When DeepSeekGUI's welcome overlay shows, and what its actions do — the
 * decisions the official Desktop keeps in its main process and welcome
 * backend (0.1.7-rc.2 `needsWelcome`), moved into the page.
 *
 * - Shown only while the account is signed out AND no API key is configured on
 *   any configurable provider (`dshOnboarding.hasApiKey`, the official
 *   reading). Either route hides it: a completed sign-in hands over to the
 *   official in-page onboarding, a saved key lets that onboarding record
 *   itself as `api-key`.
 * - "Set up later" hides it for this app run only (session storage, like the
 *   official skip that writes no completion setting); a later sign-out brings
 *   it back, as the official Desktop does after a completed sign-out.
 * - An unknown key state never shows it: no flash for someone who has a key.
 * @module @see-sol-lab/deepseekgui-workbench/client/welcome/welcome-controller
 */

import type { AccountView } from '@deepseek-ai/dsh-deepseek-account/types'

/** The page carrier the Host shim installs (`packages/api/workbench-inspector/src/desktop-account.ts`). */
export interface OnboardingCarrier {
  hasApiKey(): Promise<boolean>
  saveApiKey(value: string): Promise<boolean>
}

/** What the overlay renders from. */
export interface WelcomeSnapshot {
  readonly visible: boolean
  readonly view: AccountView | undefined
  /** The account signed out because its sign-in expired; shown once as a toast. */
  readonly expiredNotice: boolean
}

/** Session-storage key of this run's "set up later". */
export const WELCOME_SKIP_KEY = 'deepseekgui.welcome.skipped'

/** The overlay's store and actions. */
export interface WelcomeController {
  subscribe(listener: () => void): () => void
  getSnapshot(): WelcomeSnapshot
  /** A new account frame from the official account stream. */
  setView(view: AccountView): void
  /** Credentials or providers changed: read key presence again. */
  invalidateKey(): void
  /** The official `deepseek-account/session-expired` event. */
  sessionExpired(): void
  dismissNotice(): void
  /** Save a key through the official credential reference; hides on success. */
  saveApiKey(value: string): Promise<boolean>
  /** "Set up later": hide for this run. */
  skip(): void
}

/**
 * Build the controller.
 * @param carrier - the Host shim's onboarding carrier.
 * @param storage - session storage, or null where the page refuses it.
 * @returns the controller.
 */
export function createWelcomeController(carrier: OnboardingCarrier, storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null): WelcomeController {
  const listeners = new Set<() => void>()
  let view: AccountView | undefined
  let hasApiKey: boolean | undefined
  let generation = 0
  let expiredNotice = false
  let skipped = ((): boolean => {
    try { return storage?.getItem(WELCOME_SKIP_KEY) === '1' } catch { return false }
  })()
  let snapshot: WelcomeSnapshot = { visible: false, view: undefined, expiredNotice: false }
  const publish = (): void => {
    const visible = view?.status === 'signed-out' && hasApiKey === false && !skipped
    if (visible === snapshot.visible && view === snapshot.view && expiredNotice === snapshot.expiredNotice) return
    snapshot = { visible, view, expiredNotice }
    for (const listener of listeners) listener()
  }
  const readKey = (): void => {
    const current = ++generation
    hasApiKey = undefined
    carrier.hasApiKey().then((present) => {
      if (current !== generation) return
      hasApiKey = present
      publish()
    }).catch(() => {
      // An unreadable answer must not trap someone behind the overlay; they
      // can still add a key or sign in from Settings.
      if (current === generation) { hasApiKey = true; publish() }
    })
  }
  readKey()
  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    getSnapshot: () => snapshot,
    setView(next) {
      if (view?.status === 'credential-stored' && next.status === 'signed-out') {
        skipped = false
        try { storage?.removeItem(WELCOME_SKIP_KEY) } catch { /* 取不到 storage：本次运行照常 */ }
        readKey()
      }
      view = next
      publish()
    },
    invalidateKey() { readKey() },
    sessionExpired() { expiredNotice = true; publish() },
    dismissNotice() { expiredNotice = false; publish() },
    async saveApiKey(value) {
      const saved = await carrier.saveApiKey(value)
      if (saved) readKey()
      return saved
    },
    skip() {
      skipped = true
      try { storage?.setItem(WELCOME_SKIP_KEY, '1') } catch { /* 取不到 storage：只在内存里跳过 */ }
      publish()
    },
  }
}
