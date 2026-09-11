/**
 * Permission 执行面：读权限事实、写权限预设，Harness 是唯一权限事实源。
 *
 * 这里只有一条规矩，其余都是它的推论：**fail closed**。读不到权限设置时，
 * 视图进入 unavailable 而不是显示成 Sandbox，切换动作也一律拒绝——把"读
 * 不到"渲染成"看起来最安全的那个值"，会让用户以为自己被沙箱保护着。
 *
 * 所有写入都走官方 settings service，DeepSeekGUI 不持有任何私有权限文件。
 * Managed Home 在没有明确 defaultPreset 时会被写入推荐预设（唯一写路径）；
 * Existing Home 绝不静默改写——那是用户自己的 Harness 设置。
 *
 * RPC 与对话框经注入面传入，所以模块不依赖 Electron，fail-closed 语义可以
 * 被直接验证，不必真的把 Harness 弄坏一次。
 * @module @see-sol-lab/deepseekgui/permission-control
 */

import { redactSecrets } from './redact.ts'
import { FULL_ACCESS_PRESET, RECOMMENDED_PRESET, resolvePermissionView } from './permission-view.ts'
import type { PermissionsView } from './permission-view.ts'
import type { HarnessApi, SettingsDescribeValue } from './harness-api.ts'

/** 一次风险确认框（字段与 Electron 的 showMessageBox 同名同义）。 */
export interface PermissionMessageBox {
  readonly type: 'warning' | 'error'
  readonly noLink: true
  readonly buttons: readonly string[]
  readonly message: string
  readonly detail: string
  readonly defaultId?: number
  readonly cancelId?: number
}

/** 当前 Home 的身份；Existing Home 的确认框要把它摆给用户看。 */
export interface PermissionHomeFacts {
  readonly kind: 'managed' | 'existing'
  readonly path: string
  readonly profile: string
}

/** 执行面要用到的宿主能力。 */
export interface PermissionControlDeps {
  /** 官方 settings service（只用到 describe 与 mutate 两个方法）。 */
  readonly rpc: Pick<HarnessApi, 'settingsDescribe' | 'settingsMutate'>
  /** 弹一次消息框；返回用户点中的按钮下标。 */
  readonly showMessageBox: (request: PermissionMessageBox) => Promise<{ response: number }>
  /** 当前是否中文界面。 */
  readonly zh: () => boolean
  /** 当前 Home 的身份，现读现取——用户可能已经切过 Home。 */
  readonly home: () => PermissionHomeFacts
  /** 事实变化后推送控制模型。 */
  readonly broadcast: () => void
}

/** 权限执行面。 */
export interface PermissionControl {
  /** 现算的权限视图（describe 失败时是 unavailable）。 */
  readonly view: () => PermissionsView
  /** 从官方 settings service 刷新权限事实（只读 describe，零写入）。 */
  readonly refresh: () => Promise<void>
  /** Managed Home 的推荐默认；Existing Home 上是空操作。 */
  readonly ensureManagedDefault: () => Promise<void>
  /** 切换权限模式；风险确认在这里，用户取消即不写。 */
  readonly switchMode: (mode: 'sandbox' | 'full-access') => Promise<void>
}

/**
 * 建一个权限执行面。
 * @param deps - 宿主能力。
 * @returns 持有 describe 事实的执行面。
 */
export function createPermissionControl(deps: PermissionControlDeps): PermissionControl {
  /** 最近一次 settings.describe 结果（权限视图现算的事实来源）。 */
  let describe: SettingsDescribeValue | null = null
  /** describe 失败的脱敏原因；非 null 时权限视图 fail closed。 */
  let failure: string | null = null

  const view = (): PermissionsView => resolvePermissionView(describe, failure)

  const refresh = async (): Promise<void> => {
    try {
      describe = await deps.rpc.settingsDescribe()
      failure = null
    } catch (error) {
      // fail closed：读取失败绝不静默显示成 Sandbox，视图进入 unavailable。
      describe = null
      failure = redactSecrets(error instanceof Error ? error.message : String(error))
    }
    deps.broadcast()
  }

  const ensureManagedDefault = async (): Promise<void> => {
    if (deps.home().kind !== 'managed') return
    const current = view()
    if (current.mode !== 'custom' || current.preset !== null) return
    try {
      await deps.rpc.settingsMutate('permission', [
        { op: 'set', path: ['defaultPreset'], value: RECOMMENDED_PRESET },
      ])
      await refresh()
    } catch (error) {
      const detail = String(error instanceof Error ? error.message : error)
      console.error(deps.zh()
        ? `[deepseekgui] 写入 Managed Home 推荐权限预设失败（官方推断默认仍生效）: ${detail}`
        : `[deepseekgui] could not write the recommended preset for the Managed Home; the inferred default still applies: ${detail}`)
    }
  }

  const switchMode = async (mode: 'sandbox' | 'full-access'): Promise<void> => {
    const zh = deps.zh()
    const target = deps.home()
    if (view().mode === 'unavailable') {
      // fail closed：permission service 不可用时绝不允许任何切换动作。
      void deps.showMessageBox({
        type: 'warning',
        noLink: true,
        buttons: [zh ? '确定' : 'OK'],
        message: zh ? '权限控制当前不可用' : 'Permission controls are currently unavailable',
        detail: zh
          ? '无法从 Harness 读取权限设置，DeepSeekGUI 不会在此时修改任何权限配置。'
          : 'DeepSeekGUI could not read the permission settings from Harness and will not modify any permission configuration right now.',
      }).catch(() => undefined)
      return
    }
    if (mode === 'full-access') {
      const choice = await deps.showMessageBox({
        type: 'warning',
        noLink: true,
        buttons: [zh ? '启用完全访问' : 'Enable Full Access', zh ? '取消' : 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        message: zh ? '确认启用完全访问权限？' : 'Enable Full Access?',
        detail: zh
          ? '完全访问权限会让 Agent 工具获得当前 Windows 账户允许的更大访问范围。当前工作区之外的文件也可能被读取、修改或删除。只有明确理解风险时才使用。'
          : 'Full Access allows Agent tools to act with the permissions of your Windows account. Files outside the current workspace may be readable, writable, or deletable. Use this only when you understand the risk.',
      })
      if (choice.response !== 0) return
    } else {
      const home = deps.home()
      if (home.kind === 'existing') {
        const choice = await deps.showMessageBox({
          type: 'warning',
          noLink: true,
          buttons: [zh ? '使用 Sandbox（推荐）' : 'Use Sandbox (recommended)', zh ? '取消' : 'Cancel'],
          defaultId: 1,
          cancelId: 1,
          message: zh ? '切换到这个 Existing Home 的 Sandbox 预设？' : 'Switch this Existing Home to the Sandbox preset?',
          detail: [
            `Home：${zh ? '已有目录' : 'Existing'}`,
            `${zh ? '完整路径' : 'Full path'}：${home.path}`,
            `Profile：${home.profile}`,
            '',
            zh ? '这会修改你选择的现有 Harness 设置。' : 'This modifies the existing Harness settings you selected.',
          ].join('\n'),
        })
        if (choice.response !== 0) return
      }
    }
    const currentHome = deps.home()
    if (currentHome.path !== target.path || currentHome.profile !== target.profile || currentHome.kind !== target.kind) {
      throw new Error(zh ? 'Harness 目录或 Profile 已改变，请在当前目标重新确认权限。' : 'The Harness home or profile changed. Confirm permissions again for the current target.')
    }
    try {
      await deps.rpc.settingsMutate('permission', [
        { op: 'set', path: ['defaultPreset'], value: mode === 'full-access' ? FULL_ACCESS_PRESET : RECOMMENDED_PRESET },
      ])
    } catch (error) {
      void deps.showMessageBox({
        type: 'error',
        noLink: true,
        buttons: [zh ? '确定' : 'OK'],
        message: zh ? '权限设置写入失败' : 'Writing the permission setting failed',
        detail: redactSecrets(error instanceof Error ? error.message : String(error)),
      }).catch(() => undefined)
    }
    await refresh()
  }

  return { view, refresh, ensureManagedDefault, switchMode }
}
