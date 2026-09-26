/**
 * Self-drawn tray menu renderer: paints the rows main pushes, reports its
 * height, and sends back only positional ids. Keyboard: arrows move, Enter
 * activates, Escape closes. Submenus render inline as a disclosure group.
 * All text is written with textContent, never innerHTML.
 * @module @see-sol-lab/deepseekgui/chrome/tray-menu
 */

import type { TrayMenuWireItem } from '../tray.ts'

interface TrayMenuPayload {
  items: TrayMenuWireItem[]
  theme: 'dark' | 'light'
  material: 'acrylic' | 'solid'
}

interface DeepSeekGUITrayApi {
  onMenu(listener: (payload: TrayMenuPayload) => void): void
  reportSize(height: number): void
  activate(id: string): void
  close(): void
}

const api = (window as unknown as { deepseekGUITray: DeepSeekGUITrayApi }).deepseekGUITray
const panel = document.getElementById('tray-panel') as HTMLElement

function focusable(): HTMLButtonElement[] {
  return [...panel.querySelectorAll<HTMLButtonElement>('button.menu-item')]
    .filter(button => !button.disabled && button.offsetParent !== null)
}

function row(item: TrayMenuWireItem): HTMLElement {
  if (item.type === 'separator') {
    const sep = document.createElement('div')
    sep.className = 'separator'
    sep.setAttribute('role', 'separator')
    return sep
  }
  // Read-only rows (active profile, status) are information, not controls.
  if (!item.actionable && item.submenu === undefined) {
    const info = document.createElement('div')
    info.className = 'info'
    info.textContent = item.label
    info.title = item.label
    return info
  }
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'menu-item'
  button.setAttribute('role', item.type === 'radio' ? 'menuitemradio' : 'menuitem')
  button.disabled = !item.enabled
  if (!item.enabled) button.setAttribute('aria-disabled', 'true')
  if (item.type === 'radio') {
    const mark = document.createElement('span')
    mark.className = 'item-mark'
    mark.textContent = item.checked === true ? '●' : ''
    button.setAttribute('aria-checked', item.checked === true ? 'true' : 'false')
    button.appendChild(mark)
  }
  const label = document.createElement('span')
  label.className = 'item-label'
  label.textContent = item.label
  button.appendChild(label)
  if (item.submenu === undefined) {
    button.addEventListener('click', () => { api.activate(item.id) })
    return button
  }
  const chevron = document.createElement('span')
  chevron.className = 'item-chevron'
  chevron.textContent = '›'
  button.appendChild(chevron)
  button.setAttribute('aria-haspopup', 'true')
  button.setAttribute('aria-expanded', 'false')
  const group = document.createElement('div')
  group.className = 'submenu'
  group.setAttribute('role', 'group')
  group.hidden = true
  for (const child of item.submenu) group.appendChild(row(child))
  button.addEventListener('click', () => {
    const open = group.hidden
    group.hidden = !open
    button.setAttribute('aria-expanded', open ? 'true' : 'false')
    reportSize()
  })
  const wrapper = document.createElement('div')
  wrapper.appendChild(button)
  wrapper.appendChild(group)
  return wrapper
}

function reportSize(): void {
  api.reportSize(Math.ceil(panel.getBoundingClientRect().height))
}

function render(payload: TrayMenuPayload): void {
  document.documentElement.dataset.theme = payload.theme
  document.documentElement.dataset.material = payload.material
  panel.replaceChildren(...payload.items.map(row))
  reportSize()
  // Focus the panel, not the first row: a native menu shows no selection
  // until the keyboard moves; ArrowDown from here lands on the first row.
  panel.tabIndex = -1
  panel.focus()
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') { api.close(); return }
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  const buttons = focusable()
  if (buttons.length === 0) return
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
  const next = event.key === 'ArrowDown'
    ? buttons[(index + 1) % buttons.length]
    : buttons[(index - 1 + buttons.length) % buttons.length]
  next?.focus()
  event.preventDefault()
})

api.onMenu(render)
