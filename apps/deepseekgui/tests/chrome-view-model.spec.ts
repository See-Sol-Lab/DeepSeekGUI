/**
 * chrome/view-model 单测：中文与英文 fallback 文案、七相状态胶囊映射
 * （颜色 + 实时文案）、profile 条目 enabled/disabled/reason、信息行与
 * 恢复详情文本。
 * @module @see-sol-lab/deepseekgui/tests/chrome-view-model
 */

import { describe, expect, it } from 'vitest'
import {
  pillView,
  recoveryNoticeText,
  stringsFor,
} from '../src/chrome/view-model.ts'
import type { DesktopControlModel } from '../src/control-model.ts'

const zh = stringsFor('zh')
const en = stringsFor('en')

describe('文案字典', () => {
  it('zh 用中文，非 zh fallback 英文', () => {
    // 原先取的是 menu.quit，那条键随 P8-D19 删掉菜单退出项一并移除了。
    // 这条用例要的只是「同一个键在两套字典里各说各的语言」，换任意常驻键即可。
    expect(zh['menu.about']).toBe('关于 DeepSeekGUI')
    expect(en['menu.about']).toBe('About DeepSeekGUI')
  })

  it('两套字典键集合一致（fallback 不缺键）', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })

  // D29：expertRows/profileItemView/recoveryText 及其专属键随 D39 三个面板
  // 移居设置页一并删除（renderer/tray/main 零引用），此处不再断言。
})

describe('状态胶囊七相映射', () => {
  it.each([
    [{ phase: 'idle' }, 'grey', '未运行'],
    [{ phase: 'stopping' }, 'grey', '正在停止'],
    // D2：默认 profile `web` 不进胶囊（它是官方 profile 名，不是"网页版"）；
    // 非默认 profile 才带名字。
    [{ phase: 'starting', profile: 'web' }, 'blue', '正在启动'],
    [{ phase: 'switching', profile: 'p2' }, 'blue', '正在切换 · p2'],
    [{ phase: 'recovering', profile: 'web' }, 'yellow', '正在恢复'],
    [{ phase: 'running', profile: 'web', recovered: false }, 'green', '运行中'],
    [{ phase: 'running', profile: 'lab', recovered: false }, 'green', '运行中 · lab'],
    [{ phase: 'running', profile: 'web', recovered: true }, 'yellow', '已恢复'],
    [{ phase: 'failed', stage: 'spawn' }, 'red', '启动失败'],
  ] as const)('%j → %s %s', (status, tone, text) => {
    expect(pillView(status as DesktopControlModel['status'], zh)).toEqual({ tone, text })
  })

  it('英文 fallback 同样映射', () => {
    expect(pillView({ phase: 'running', profile: 'web', recovered: false }, en))
      .toEqual({ tone: 'green', text: 'Running' })
    expect(pillView({ phase: 'running', profile: 'lab', recovered: false }, en))
      .toEqual({ tone: 'green', text: 'Running · lab' })
  })
})

describe('横幅文案', () => {
  it('恢复提示横幅文案：两种形态各一条文案，替换 profile 占位', () => {
    expect(recoveryNoticeText({ profile: 'good', kind: 'boot-failure' }, zh)).toBe('刚才的配置没有启动成功，DeepSeekGUI 已恢复到 good。')
    expect(recoveryNoticeText({ profile: 'good', kind: 'boot-failure' }, en)).toBe('That configuration failed to launch. DeepSeekGUI has recovered to good.')
    expect(recoveryNoticeText({ profile: 'good', kind: 'interrupted-switch' }, zh)).toBe('上次的 Profile 切换没有完成，DeepSeekGUI 仍在使用 good。')
    expect(recoveryNoticeText({ profile: 'good', kind: 'interrupted-switch' }, en)).toBe('The previous profile switch was interrupted. DeepSeekGUI is still using good.')
  })
})
