/**
 * 内嵌平台页的 preload（官方 `apps/desktop/src/preload-platform-account.ts` 的移植）。
 *
 * 只在平台 origin 的主框架里生效：向 main 要一次令牌与语言，交给平台前端的
 * 嵌入模式（`window.dsh`）。取令牌不再走 IPC；初始化失败也保持嵌入模式，平台页
 * 因此不会退回去读浏览器里的登录态。sandbox: true 下 preload 必须是 CommonJS。
 * IPC 通道名与 platform-view.ts 的 PLATFORM_IPC 一致（preload 不能 import 它）。
 * @module @see-sol-lab/deepseekgui/platform-preload
 */

import { contextBridge, ipcRenderer } from 'electron'

type PlatformLocale = 'en_US' | 'zh_CN'

const originArgument = '--deepseekgui-platform-origin='
const allowedOrigin = process.argv.find(argument => argument.startsWith(originArgument))?.slice(originArgument.length)
if (process.isMainFrame && location.origin === allowedOrigin) {
  let token: string | undefined
  let locale: PlatformLocale | undefined
  const localeListeners = new Set<(locale: PlatformLocale) => void>()
  ipcRenderer.on('deepseekgui-platform:locale-changed', (_event: unknown, value: unknown) => {
    if (value !== 'en_US' && value !== 'zh_CN') return
    locale = value
    for (const listener of localeListeners) {
      try { listener(value) } catch (error) { console.error('Platform locale listener failed', error) }
    }
  })
  try {
    const value: unknown = ipcRenderer.sendSync('deepseekgui-platform:bootstrap')
    if (typeof value === 'object' && value !== null && 'token' in value && 'origin' in value
      && typeof value.token === 'string' && value.token.length > 0 && value.origin === location.origin
      && 'locale' in value && (value.locale === 'en_US' || value.locale === 'zh_CN')) {
      token = value.token
      locale = value.locale
    }
  } catch {
    // 初始化失败仍保持嵌入模式，平台页不会改用浏览器里的登录态。
  }
  contextBridge.exposeInMainWorld('dsh', {
    protocolVersion: 1,
    displayMode: 'embedded',
    getLocale: (): PlatformLocale => {
      if (locale === undefined) throw new Error('Platform locale initialization failed')
      return locale
    },
    onLocaleChange: (listener: (locale: PlatformLocale) => void): (() => void) => {
      localeListeners.add(listener)
      return () => { localeListeners.delete(listener) }
    },
    getAuthToken: (): string => {
      if (token === undefined) throw new Error('Platform initialization failed')
      return token
    },
  })
}
