/**
 * welcome-controller: when the ported official welcome shows and what its
 * actions change (the official Desktop's `needsWelcome` moved into the page).
 * @module @see-sol-lab/deepseekgui-workbench/tests/welcome-controller
 */

import { describe, expect, it, vi } from 'vitest'
import type { AccountView } from '@deepseek-ai/dsh-deepseek-account/types'
import { createWelcomeController, WELCOME_SKIP_KEY } from '../src/client/welcome/welcome-controller.ts'

const links = { usageUrl: 'https://platform.deepseek.com/usage', topUpUrl: 'https://platform.deepseek.com/top_up' }
const signedOut = { status: 'signed-out', attempt: null, links } as AccountView
const signedIn = { status: 'credential-stored', attempt: null, links } as AccountView

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  }
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0))

describe('createWelcomeController', () => {
  it('shows only while signed out with no key anywhere; never before both facts are known', async () => {
    const carrier = { hasApiKey: vi.fn(async () => false), saveApiKey: vi.fn(async () => true) }
    const controller = createWelcomeController(carrier, memoryStorage())
    expect(controller.getSnapshot().visible).toBe(false)
    await settle()
    expect(controller.getSnapshot().visible).toBe(false)
    controller.setView(signedOut)
    expect(controller.getSnapshot().visible).toBe(true)
    controller.setView(signedIn)
    expect(controller.getSnapshot().visible).toBe(false)
  })

  it('stays hidden for someone who already has a key, and when the key read fails', async () => {
    const withKey = createWelcomeController({ hasApiKey: async () => true, saveApiKey: async () => true }, null)
    withKey.setView(signedOut)
    await settle()
    expect(withKey.getSnapshot().visible).toBe(false)
    const unreadable = createWelcomeController({ hasApiKey: async () => { throw new Error('rpc') }, saveApiKey: async () => true }, null)
    unreadable.setView(signedOut)
    await settle()
    expect(unreadable.getSnapshot().visible).toBe(false)
  })

  it('a saved key re-reads presence and hides; a refused save keeps it', async () => {
    let present = false
    const carrier = { hasApiKey: vi.fn(async () => present), saveApiKey: vi.fn(async (value: string) => value === 'sk-ok') }
    const controller = createWelcomeController(carrier, null)
    controller.setView(signedOut)
    await settle()
    expect(await controller.saveApiKey('nope')).toBe(false)
    expect(controller.getSnapshot().visible).toBe(true)
    present = true
    expect(await controller.saveApiKey('sk-ok')).toBe(true)
    await settle()
    expect(controller.getSnapshot().visible).toBe(false)
  })

  it('"set up later" lasts this run; a completed sign-out brings the welcome back', async () => {
    const storage = memoryStorage()
    const controller = createWelcomeController({ hasApiKey: async () => false, saveApiKey: async () => true }, storage)
    controller.setView(signedOut)
    await settle()
    controller.skip()
    expect(controller.getSnapshot().visible).toBe(false)
    expect(storage.getItem(WELCOME_SKIP_KEY)).toBe('1')
    // A reload in the same run keeps the skip.
    const reloaded = createWelcomeController({ hasApiKey: async () => false, saveApiKey: async () => true }, storage)
    reloaded.setView(signedOut)
    await settle()
    expect(reloaded.getSnapshot().visible).toBe(false)
    // Signing in and then out again shows it once more.
    reloaded.setView(signedIn)
    reloaded.setView(signedOut)
    await settle()
    expect(reloaded.getSnapshot().visible).toBe(true)
    expect(storage.getItem(WELCOME_SKIP_KEY)).toBeNull()
  })

  it('carries the expired sign-in notice until dismissed', async () => {
    const controller = createWelcomeController({ hasApiKey: async () => false, saveApiKey: async () => true }, null)
    const listener = vi.fn()
    controller.subscribe(listener)
    controller.sessionExpired()
    expect(controller.getSnapshot().expiredNotice).toBe(true)
    controller.dismissNotice()
    expect(controller.getSnapshot().expiredNotice).toBe(false)
    expect(listener).toHaveBeenCalledTimes(2)
  })
})
