/**
 * Self-drawn tray menu helpers: wire rows never carry actions and resolve
 * back by positional id; placement stays inside the work area and opens
 * upward from the cursor like the native menu.
 * @module @see-sol-lab/deepseekgui/tests/tray-menu-window
 */

import { describe, expect, it } from 'vitest'
import { placeTrayMenu, trayMenuItemAt, wireTrayMenu, type TrayMenuItem } from '../src/tray.ts'

const template: TrayMenuItem[] = [
  { label: 'Open', action: { kind: 'show-window' } },
  { label: 'Status: running', enabled: false },
  { type: 'separator' },
  {
    label: 'Profiles',
    submenu: [
      { label: 'web', type: 'radio', checked: true, action: { kind: 'switch-profile', profile: 'web' } },
      { label: 'tui', type: 'radio', checked: false, enabled: false },
    ],
  },
  { label: 'Quit', action: { kind: 'quit' } },
]

describe('wireTrayMenu', () => {
  it('serialises rows with positional ids and no action payload', () => {
    const wire = wireTrayMenu(template)
    expect(wire.map(row => row.id)).toEqual(['0', '1', '2', '3', '4'])
    expect(wire[0]).toEqual({ id: '0', label: 'Open', enabled: true, type: 'normal', actionable: true })
    expect(wire[1]).toMatchObject({ enabled: false, actionable: false })
    expect(wire[2]).toMatchObject({ type: 'separator', label: '' })
    expect(wire[3]?.submenu?.map(row => row.id)).toEqual(['3.0', '3.1'])
    expect(wire[3]?.submenu?.[0]).toMatchObject({ type: 'radio', checked: true, actionable: true })
    expect(JSON.stringify(wire)).not.toContain('kind')
  })
})

describe('trayMenuItemAt', () => {
  it('resolves top-level and nested ids back to the template rows', () => {
    expect(trayMenuItemAt(template, '0')?.action).toEqual({ kind: 'show-window' })
    expect(trayMenuItemAt(template, '3.0')?.action).toEqual({ kind: 'switch-profile', profile: 'web' })
    expect(trayMenuItemAt(template, '3.1')?.enabled).toBe(false)
  })

  it('rejects malformed or out-of-range ids instead of throwing', () => {
    for (const id of ['', 'x', '9', '3.7', '0.0', '-1', '3.', '1e0']) {
      expect(trayMenuItemAt(template, id)).toBeUndefined()
    }
  })
})

describe('placeTrayMenu', () => {
  const area = { x: 0, y: 0, width: 1920, height: 1040 }
  const size = { width: 300, height: 260 }

  it('opens upward from the cursor, horizontally centred', () => {
    expect(placeTrayMenu({ x: 1800, y: 1030 }, area, size)).toEqual({ x: 1620, y: 762 })
  })

  it('pushes back inside the work area at the right edge', () => {
    expect(placeTrayMenu({ x: 1910, y: 1030 }, area, size).x).toBe(1620)
  })

  it('flips below the cursor when there is no room above (top taskbar)', () => {
    expect(placeTrayMenu({ x: 900, y: 10 }, area, size)).toEqual({ x: 750, y: 18 })
  })

  it('respects a work area that does not start at the origin (second display)', () => {
    const second = { x: 1920, y: 0, width: 1920, height: 1040 }
    const pos = placeTrayMenu({ x: 1925, y: 1030 }, second, size)
    expect(pos.x).toBe(1920)
    expect(pos.y).toBe(762)
  })
})
