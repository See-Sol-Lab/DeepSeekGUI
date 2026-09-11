/**
 * 首次启动时，问用户要不要把他自己那套 DSH 的对话搬进来。
 *
 * 很多人装 DeepSeekGUI 之前机器上已经跑着官方 DSH。两者本来互不相干——我们自带
 * runtime、用自己的 Home——但他的历史都在那边，而新装的 DeepSeekGUI 是空的。
 *
 * 无论他选哪个，都把权责说清楚：原件我们只读不删、留着不卸也没事、真正危险
 * 的是让两个程序写同一份数据，而那件事不是 DeepSeekGUI 造成的。凭据一律不搬，
 * 让他自己重填一次——省他一次粘贴不值得我们去碰他的密钥文件。
 *
 * 对话框经注入面传入，所以这个模块不依赖 Electron：一次「用户拒绝了会发生
 * 什么」的验证不需要真的弹窗，也不需要真的有一台装过 DSH 的机器。
 * @module @see-sol-lab/deepseekgui/session-import-offer
 */

import { join, resolve } from 'node:path'
import { redactSecrets } from './redact.ts'
import { importSessions, markImportOffered, shouldOfferImport, surveyImportableSessions } from './session-import.ts'

/** 一次消息框请求（字段与 Electron 的 showMessageBox 同名同义）。 */
export interface ImportOfferMessageBox {
  readonly type: 'info' | 'question' | 'error'
  readonly title: string
  readonly message: string
  readonly detail: string
  readonly buttons: readonly string[]
  readonly defaultId: number
  readonly cancelId?: number
  readonly noLink: true
}

/** 询问要用到的宿主能力。 */
export interface ImportOfferDeps {
  /**
   * 弹一次消息框。
   * @param request - 消息框内容。
   * @returns 用户点中的按钮下标。
   */
  readonly showMessageBox: (request: ImportOfferMessageBox) => Promise<{ response: number }>
  /** 当前是否中文界面。 */
  readonly zh: () => boolean
  /** 用户主目录：官方 DSH 的默认 Home 在它下面。 */
  readonly homeDir: string
}

/**
 * 若这台机器上有另一套 DSH 的对话，问一次要不要导入。
 *
 * 问过一次就记下来，无论用户答什么——每次启动都问一遍是骚扰。
 * @param targetHome - DeepSeekGUI 当前的 Home。
 * @param deps - 宿主能力。
 * @returns 询问（以及用户同意时的导入）完成后 resolve。
 */
export async function offerSessionImport(targetHome: string, deps: ImportOfferDeps): Promise<void> {
  if (!shouldOfferImport(targetHome)) return
  const source = join(deps.homeDir, '.dsh')
  // 用户本来就把 DeepSeekGUI 指向了这个目录：没有"两套"，也没什么可搬的。
  if (resolve(source) === resolve(targetHome)) return
  const survey = surveyImportableSessions(source)
  if (survey === null) return

  const zh = deps.zh()
  const shared = zh
    ? [
      '注意：',
      '• 电脑原本的 DSH 数据保持不变——导入只是复制。',
      '• 请自行选择是否卸载原本的 DSH，如不卸载也没关系，两个程序互不干扰。',
      '• 请勿让两个程序同时写入同一个 Harness 数据目录（保存会话和设置的 Home）。普通项目文件夹可以共用，但同时修改项目文件时需要自行协调。',
      '• API key 不会导入，请在 DeepSeekGUI 里重新填写。',
    ]
    : [
      'Note:',
      '• The existing DSH data is unchanged — importing only copies it.',
      '• Whether to uninstall the existing DSH is up to you. Keeping both is fine; the two do not interfere.',
      '• Do not let both programs write to the same Harness Home containing conversations and settings. Project folders can be shared, but concurrent file edits need coordination.',
      '• API keys are not imported. Please enter yours again in DeepSeekGUI.',
    ]

  if (!survey.importable) {
    // 格式对不上就别搬：Harness 会直接拒绝打开，搬过来只是一堆点不开的对话。
    await deps.showMessageBox({
      type: 'info',
      title: zh ? '检测到你电脑上已有 DSH' : 'An existing DSH was found',
      message: zh ? '找到已有对话，但本次无法导入' : 'Conversations found, but they cannot be imported',
      detail: [
        zh
          ? `在 ${source} 找到 ${String(survey.count)} 个对话，但其存储格式（v${String(survey.formatVersion ?? -1)}）与 DeepSeekGUI 使用的（v${String(survey.supportedVersion)}）不一致，导入后无法打开，因此本次不导入。`
          : `Found ${String(survey.count)} conversations in ${source}, but their storage format (v${String(survey.formatVersion ?? -1)}) does not match the one DeepSeekGUI uses (v${String(survey.supportedVersion)}). They would not open, so nothing is imported.`,
        '',
        ...shared,
      ].join('\n'),
      buttons: [zh ? '知道了' : 'OK'],
      defaultId: 0,
      noLink: true,
    })
    markImportOffered(targetHome)
    return
  }

  const choice = await deps.showMessageBox({
    type: 'question',
    title: zh ? '检测到你电脑上已有 DSH' : 'An existing DSH was found',
    message: zh
      ? `在 ${source} 找到 ${String(survey.count)} 个对话，要导入 DeepSeekGUI 吗？`
      : `Found ${String(survey.count)} conversations in ${source}. Import them into DeepSeekGUI?`,
    detail: shared.join('\n'),
    buttons: zh ? ['导入', '暂不导入'] : ['Import', 'Not now'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  })
  // 先记下"问过了"：无论他答什么，都不该每次启动再问一遍。
  markImportOffered(targetHome)
  if (choice.response !== 0) return

  let result: { copied: number; skipped: number }
  try {
    result = importSessions(source, targetHome)
  } catch (error) {
    await deps.showMessageBox({
      type: 'error',
      title: zh ? '导入未完成' : 'Import did not finish',
      message: zh ? '导入过程中出现错误' : 'An error occurred during the import',
      detail: [
        zh
          ? '电脑原本的 DSH 数据未被改动。可以稍后重试，或跳过此步骤，不影响 DeepSeekGUI 使用。'
          : 'The existing DSH data was not modified. You can retry later or skip this step; DeepSeekGUI works either way.',
        '',
        redactSecrets(String(error)),
      ].join('\n'),
      buttons: [zh ? '知道了' : 'OK'],
      defaultId: 0,
      noLink: true,
    })
    return
  }
  await deps.showMessageBox({
    type: 'info',
    title: zh ? '导入完成' : 'Import complete',
    message: zh
      ? `已导入 ${String(result.copied)} 个对话`
      : `Imported ${String(result.copied)} conversations`,
    detail: [
      ...result.skipped > 0
        ? [zh
          ? `另有 ${String(result.skipped)} 个已跳过：DeepSeekGUI 中已存在相同对话，未做覆盖。`
          : `${String(result.skipped)} were skipped: DeepSeekGUI already had conversations with those ids, and nothing was overwritten.`]
        : [],
      zh
        ? '电脑原本的 DSH 数据未做任何改动。'
        : 'The existing DSH data was not changed.',
    ].join('\n'),
    buttons: [zh ? '好' : 'OK'],
    defaultId: 0,
    noLink: true,
  })
}
