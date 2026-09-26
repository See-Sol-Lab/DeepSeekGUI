/**
 * `deepseekgui.welcome` namespace dictionaries: the welcome overlay ported from
 * the official Desktop welcome window (0.1.7-rc.2 `apps/desktop/src/locale.ts`).
 * The copy is the official copy; only the product name in the tagline reads
 * DeepSeekGUI, since this overlay is DeepSeekGUI's own entry screen.
 * The zh dictionary is the key-set source of truth; en mirrors it exactly.
 */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'brand': 'DeepSeekGUI',
  'tagline.before': '欢迎使用 ',
  'tagline.brand': 'DeepSeekGUI',
  'tagline.after': '',
  'description': '组装无限可能，共探智能上限',
  'auth.starting': '正在打开登录…',
  'auth.waiting': '没有自动打开浏览器？',
  'auth.waitingDescription': '复制登录链接，用浏览器手动打开完成登录',
  'auth.exchanging': '正在完成登录…',
  'auth.expired': '登录已超时',
  'auth.expiredDescription': '请重新登录后继续操作',
  'auth.failed': '登录未完成，请重试。',
  'auth.copyLink': '复制登录链接',
  'auth.copied': '已复制',
  'auth.copyFailed': '复制失败，请重试',
  'auth.cancel': '取消',
  'auth.retry': '重新登录',
  'signIn': '登录',
  'apiKey': '添加 API Key',
  'key.title': '添加一个 API Key 开始使用',
  'key.description': '配置 DeepSeek 官方模型，即可开始使用',
  'key.placeholder': '输入 API 密钥',
  'key.save': '保存并继续',
  'key.later': '稍后配置',
  'key.back': '返回登录',
  'sessionExpired': '登录信息已失效，请重新登录',
  'key.blank': '请输入 API 密钥。',
  'key.invalid': '请仅输入 API 密钥，不要包含引号、空格或环境变量赋值。',
  'key.failed': '无法保存 API 密钥，请重试。',
  'continueFailed': '无法打开工作区，请重试。',
} as const

/** The welcome namespace key union. */
export type WelcomeKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'brand': 'DeepSeekGUI',
  'tagline.before': 'Welcome to ',
  'tagline.brand': 'DeepSeekGUI',
  'tagline.after': '',
  'description': 'Build potential. Explore intelligence.',
  'auth.starting': 'Opening sign in…',
  'auth.waiting': 'Browser didn’t open automatically?',
  'auth.waitingDescription': 'Copy the sign-in link and open it in your browser to sign in.',
  'auth.exchanging': 'Completing sign in…',
  'auth.expired': 'Sign in timed out',
  'auth.expiredDescription': 'Sign in again to continue',
  'auth.failed': 'Could not complete sign in. Please try again.',
  'auth.copyLink': 'Copy sign-in link',
  'auth.copied': 'Copied',
  'auth.copyFailed': 'Could not copy. Try again.',
  'auth.cancel': 'Cancel',
  'auth.retry': 'Sign in again',
  'signIn': 'Sign in',
  'apiKey': 'Add API Key',
  'key.title': 'Add an API key to get started',
  'key.description': 'Configure official DeepSeek models to start using Harness',
  'key.placeholder': 'Enter API key',
  'key.save': 'Save and continue',
  'key.later': 'Set up later',
  'key.back': 'Back to sign in',
  'sessionExpired': 'You have signed out of your account, please log in again.',
  'key.blank': 'Enter an API key.',
  'key.invalid': 'Enter the API key itself, without quotes, spaces, or an environment-variable assignment.',
  'key.failed': 'Could not save the API key. Please try again.',
  'continueFailed': 'Could not open the workspace. Please try again.',
} satisfies Record<WelcomeKey, string>
