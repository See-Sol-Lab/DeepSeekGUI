/**
 * Placeholder detection for the embedded pane (DS 验房 2026-09-06): reads
 * against the shell's empty-state page must fail loudly instead of returning
 * its copy as if it were the browsed site.
 * @module @see-sol-lab/deepseekgui/tests/browser-plugin/placeholder
 */
import { describe, expect, it } from 'vitest'
import { isChromiumErrorPage, isPanePlaceholder } from '../../browser-plugin/src/browser.ts'

describe('isPanePlaceholder', () => {
  it('recognizes the shell marker page by scheme and title', () => {
    expect(isPanePlaceholder('data:text/html;charset=utf-8,%3C!doctype%20html%3E', 'deepseekgui-browser-pane')).toBe(true)
  })

  it('leaves real pages and other data documents alone', () => {
    expect(isPanePlaceholder('https://example.com/', 'deepseekgui-browser-pane')).toBe(false)
    expect(isPanePlaceholder('data:text/html,hello', 'hello')).toBe(false)
    expect(isPanePlaceholder('about:blank', '')).toBe(false)
  })
})

describe('isChromiumErrorPage', () => {
  it('recognizes the error document Chromium commits when a page dies', () => {
    expect(isChromiumErrorPage('chrome-error://chromewebdata/')).toBe(true)
  })

  it('leaves live pages alone, including data and about documents', () => {
    expect(isChromiumErrorPage('https://example.com/')).toBe(false)
    expect(isChromiumErrorPage('data:text/html,hello')).toBe(false)
    expect(isChromiumErrorPage('about:blank')).toBe(false)
  })
})
