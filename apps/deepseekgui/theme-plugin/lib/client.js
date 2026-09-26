// DeepSeekGUI 皮肤的客户端产物（B5-P2：对齐 dsh 0.1.2 的官方 token 面）。
//
// **形状是官方 client 运行时的契约，不是随便一种打包格式。** 官方的
// __ModuleLoader__ 负责加载并解析包间依赖，产物必须自注册进它；直接输出
// 原生 ESM 会在浏览器里报 "Cannot use import statement outside a module"，
// 插件加载失败并把整个页面卡在 boot（实机抓获）。
//
// 官方包用 tsdown 打出这个形状。本插件只有一个 apply 与一张常量表，
// 手写产物比为它接一套打包更简单——也让「产物形状是官方契约」这件事
// 直接可见，而不是藏在构建配置里。刻意不保留 TS 源码：一份逻辑两处维护
// 迟早漂移，而这点代码不值得为类型检查付那个代价。
//
// 改动前请对照 packages/client/ui-theme/lib/types/client/index.d.ts：
// overrideTokens 的签名与「每个 token 必须同时给出 light/dark」都在那里。
//
// B5-P2：0.1.1 时代的 --dsh-* 宿主字号钩子（assistant 正文、气泡、思维链、
// 统计条等）在官方 0.1.2 的 CSS 重构中已不存在——官方新版版式（含字号）是
// 迁移要求 7 的目标，DeepSeekGUI 不再供值覆盖。这里保留的是官方 0.1.2
// 仍然存在的 --dsw-* alias token 覆盖（玻璃化底图/侧栏、品牌蓝审批、浅色
// 用户气泡），值域沿 0.1.1 实机验收结论。
window.__ModuleLoader__.load({
  id: '@see-sol-lab/deepseekgui-theme',
  factory: () => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    /** 覆盖层身份：一个来源一层，重复调用替换本层而非叠加。 */
    var OVERRIDE_SOURCE = '@see-sol-lab/deepseekgui-theme'

    /**
     * 表面 token 覆盖 + DeepSeekGUI 宿主变量。文字**色**与边框语义仍然不碰
     * （官方的可读性契约），但正文版式自官方 0.1.2 起由官方新版值持有。
     * 宿主变量走 var(--dsh-*, 官方原值) 回退：原版 dsh web 不受任何影响。
     */
    var DEEPSEEKGUI_TOKEN_OVERRIDES = {
      // 页面底透明，DeepSeekGUI 宿主层的深海/海雾底图才透得上来。整套的地基。
      '--dsw-alias-bg-base': { light: 'transparent', dark: 'transparent' },
      // 模块面板（侧栏、工作区）：浅底要更实，否则云会把文字吃掉。
      '--dsw-alias-bg-module-platform': {
        light: 'rgba(255, 255, 255, 0.42)',
        dark: 'rgba(255, 255, 255, 0.10)',
      },
      // 跟着 platform 等比例提，保住「选中态比底色亮一档」这个层次关系。
      '--dsw-alias-bg-multi-select': {
        light: 'rgba(255, 255, 255, 0.55)',
        dark: 'rgba(255, 255, 255, 0.13)',
      },
      // 浮层常叠在面板上，两层半透明会把下面的字透上来糊成一片。
      '--dsw-alias-bg-overlay': {
        light: 'rgba(255, 255, 255, 0.94)',
        dark: 'rgba(28, 30, 34, 0.92)',
      },
      '--dsw-alias-bg-skeleton': {
        light: 'rgba(0, 0, 0, 0.04)',
        dark: 'rgba(255, 255, 255, 0.05)',
      },
      // 设置弹窗等二级表面（P8-D41，住户定）：layer-2 半透后天然毛玻璃。
      // D20（2026-09-06）：0.86 时底图文字透上来干扰阅读，提到 0.95——玻璃感
      // 留给侧栏，读字的面板要实。
      '--dsw-alias-bg-layer-2': {
        light: 'rgba(252, 252, 252, 0.90)',
        dark: 'rgba(24, 27, 33, 0.92)',
      },
      // 侧栏自己的 --dsw-specific-sidebar-fill：半透深色让底图透上来——
      // 这是「玻璃感」的正确开关。深色 0.42 与浅色 0.38 均住户实机定稿。
      '--dsw-specific-sidebar-fill': {
        light: 'rgba(249, 248, 248, 0.38)',
        dark: 'rgba(16, 20, 26, 0.42)',
      },
      // 审批卡片配色（住户 2026-08-23 深夜定）：官方 warn 黄与整体蓝色视觉
      // 不和谐，改品牌蓝系。只经 ApprovalPanel 的 --dsh-approval-* 钩子生效，
      // 其余 warn 黄（状态点/轨迹/ANSI）不受影响。
      '--dsh-approval-accent': { light: '#4d6bfe', dark: '#6799fe' },
      '--dsh-approval-accent-soft': { light: 'rgba(77, 107, 254, 0.08)', dark: 'rgba(103, 153, 254, 0.12)' },
      '--dsh-approval-border': { light: 'rgba(77, 107, 254, 0.28)', dark: 'rgba(103, 153, 254, 0.35)' },
      // 玻璃化第一批（2026-09-16，住户定：质感/克制/呼吸感）。下面三个表面
      // 从实色改半透：token 只管「透多少」，模糊、高光棱线与阴影在 workbench
      // 插件的 skin 层用官方属性钩子加（气泡数量多、刻意不模糊）。
      // P8-D46 的浅色气泡纯白改为半透白，深色沿官方 850 的色相取半透。
      // 浅色 alpha 曾试过再降一档（气泡 0.58/输入卡 0.68），住户实机否决：
      // 没有模糊撑着的半透只是"漏字"。alpha 维持，玻璃感靠模糊与高光。
      '--dsw-specific-bubble': {
        light: 'rgba(255, 255, 255, 0.70)',
        dark: 'rgba(44, 44, 46, 0.70)',
      },
      // 输入卡片与审批卡的底：与设置弹窗同一档实度（住户 2026-09-16 定：
      // "对话框不能这么透"）。它在官方 sticky 座里，Chromium 的 backdrop 模糊
      // 在那里采样错位、用不了，所以正文滚到卡片下面时只能靠实度不漏字；
      // 玻璃感由 skin 层的高光棱线与散影承担。
      '--dsw-specific-input-major': {
        light: 'rgba(255, 255, 255, 0.86)',
        dark: 'rgba(30, 34, 41, 0.84)',
      },
      // 「新会话」等悬浮按钮：从实白改半透，与半透侧栏同一材质。
      '--dsw-alias-button-elevated-fill': {
        light: 'rgba(255, 255, 255, 0.62)',
        dark: 'rgba(255, 255, 255, 0.07)',
      },
      // 一级表面（设置分区卡、轨迹表、输入框、JSON 树等 15 处）：官方实白/实深，
      // 改半透——浅色下这些是最后一批"死白"。深色取与侧栏同系的白 6%。
      '--dsw-alias-bg-layer-1': {
        light: 'rgba(255, 255, 255, 0.72)',
        dark: 'rgba(255, 255, 255, 0.06)',
      },
      // 滚动条（住户 2026-09-16 实机：官方浅色 neutral-200 压在浅底图上
      // 几乎不可见）：滑块改半透并提一档对比，skin 层再加 1px 内高光成玻璃块。
      '--dsw-alias-scrollbar-bg-l1': { light: 'rgba(38, 49, 72, 0.30)', dark: 'rgba(255, 255, 255, 0.30)' },
      '--dsw-alias-scrollbar-bg-l2': { light: 'rgba(38, 49, 72, 0.30)', dark: 'rgba(255, 255, 255, 0.30)' },
      '--dsw-alias-scrollbar-hover-l1': { light: 'rgba(38, 49, 72, 0.46)', dark: 'rgba(255, 255, 255, 0.46)' },
      '--dsw-alias-scrollbar-hover-l2': { light: 'rgba(38, 49, 72, 0.46)', dark: 'rgba(255, 255, 255, 0.46)' },
      // 线条（玻璃化第二批）：官方四档边线是纯黑/纯白的 4/10/12/16%，压在
      // 底图上显硬。统一换成冷灰蓝（与 interactive-bg-hover 同色相）并各降
      // 一小档——线条退成"透出来的棱"，层次仍靠四档档差保住。
      '--dsw-alias-border-l1': { light: 'rgba(38, 49, 72, 0.05)', dark: 'rgba(255, 255, 255, 0.05)' },
      '--dsw-alias-border-l2': { light: 'rgba(38, 49, 72, 0.08)', dark: 'rgba(255, 255, 255, 0.09)' },
      '--dsw-alias-border-l2-darkmode-thin': { light: 'rgba(38, 49, 72, 0.08)', dark: 'rgba(255, 255, 255, 0.05)' },
      '--dsw-alias-border-l3': { light: 'rgba(38, 49, 72, 0.10)', dark: 'rgba(255, 255, 255, 0.12)' },
      '--dsw-alias-border-l4': { light: 'rgba(38, 49, 72, 0.14)', dark: 'rgba(255, 255, 255, 0.16)' },
      // 弹出层（玻璃化第三批）：官方 tooltip 是反色深底（浅色模式也黑），
      // 菜单/下拉是实色——都退成半透玻璃，与整体材质一致；文字色与模糊在
      // skin 层按 role 钩子补。对话框 layer-2 从 0.95 退到 0.90：遮罩已把
      // 底下页面模糊过，面板再加模糊后更透也仍可读。
      // tooltip / HoverCard 跟随明暗（上游文字色已改为跟随主题的 label
      // token，HoverCard 底改读本 token）。近实而非半透：它们是从 overflow
      // 容器里伸出去的 fixed 弹层，Chromium 会把 backdrop 采样裁在容器内，
      // 伸出去的部分模糊不到、只剩透字，所以玻璃感靠高光与阴影承担。
      '--dsw-alias-tooltip-bg': { light: 'rgb(255, 255, 255)', dark: 'rgb(40, 42, 48)' },
      // 玻璃棱线宿主钩子：上游气泡与 toast 读 var(--dsh-glass-edge, transparent)，
      // 原版 dsh 不受影响；我们给顶部 1px 高光，深浅各自的强度。
      '--dsh-glass-edge': { light: 'rgba(255, 255, 255, 0.85)', dark: 'rgba(255, 255, 255, 0.10)' },
      '--dsw-specific-menu': { light: 'rgba(255, 255, 255, 0.84)', dark: 'rgba(46, 48, 52, 0.88)' },
    }

    /** 注入官方主题服务；与 package.json 的 dsh.client.inject 对应。 */
    var inject = ['theme']

    /**
     * 装载皮肤：叠一层 token 覆盖，别的什么都不做。
     * 不注册 root、不接管 layout、不写 data-ds-dark-theme、不与官方 React
     * 抢状态。明暗仍由官方 ui-theme preference 决定——Harness 管「现在是明
     * 是暗」，DeepSeekGUI 管「明和暗长什么样」。
     * 生命周期交给 ctx.effect：插件卸载时官方自动移除该层，界面回到原样。
     *
     * 顺带承担 DeepSeekGUI 的 client settle 标记（P6 下一代健康证据）：
     * 本插件是 --patch 层进入 composition 的 DeepSeekGUI client 插件之一，
     * apply 成功 = 官方 loader 接受了这一轮 composition 里的 DeepSeekGUI 层。
     * 只报告 { healthy / failed + reason } 级别事实，不送任何会话内容。
     */
    function apply(ctx) {
      try {
        ctx.effect(function () {
          return ctx.theme.overrideTokens(OVERRIDE_SOURCE, DEEPSEEKGUI_TOKEN_OVERRIDES)
        })
        window.__deepseekguiClientSettled = true
      } catch (error) {
        window.__deepseekguiClientSettled = false
        window.__deepseekguiClientSettleReason = String((error && error.message) || error)
      }
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
