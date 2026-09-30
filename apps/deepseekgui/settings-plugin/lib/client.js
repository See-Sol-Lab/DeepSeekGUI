// DeepSeekGUI 设置分区的客户端产物（P8-D39）。
//
// **形状是官方 client 运行时的契约**（与 theme-plugin 同则）：产物必须经
// window.__ModuleLoader__ 自注册，factory 收到 loader 的 require，从中取
// react 与官方服务。手写产物，不接打包器；改动前对照
// packages/client/ui-settings 的 slot 契约（settings.section）。
//
// 职责：在官方设置页注册 DeepSeekGUI 的分区（Harness（桌面）、BUG 诊断与
// 反馈、用量与余额）。「插件管理（本地）」已于 2026-09-23 撤掉（住户定）：官方
// 插件页够用，我们随包的插件改在那里的「DeepSeekGUI 内置」组里显示。分区内一切动作经本机回环控制桥（main 的
// /control/model、/control/command）回到与 Chrome 菜单同一个命令出口，
// 没有第二事实源。页面 URL 没有控制桥参数（外部浏览器打开 3080）时，
// 插件什么都不注册——那里没有桌面可控。
//
// 文案字典集中在 STRINGS（zh/en 同键；D29 双语化时英文由 DS 重审）。
window.__ModuleLoader__.load({
  id: '@see-sol-lab/deepseekgui-settings',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    var React = require('react')
    var h = React.createElement

    /** 本插件的 locale namespace（官方 locale 服务按 NS 分发字典）。 */
    var NS = 'deepseekgui.desktop'

    var STRINGS = {
      zh: {
        'nav.harness': 'Harness（桌面）',
        'browser.toggle': '浏览器面板',
        'bridge.error': '无法连接 DeepSeekGUI 桌面控制通道：',
        'bridge.loading': '正在读取桌面状态…',
        'busy': '执行中…',
        'harness.status': '运行状态',
        'harness.pending': '待确认',
        'harness.location': '位置',
        'harness.home.managed': '托管模式',
        'harness.home.existing': '已有目录',
        'harness.permission': '权限模式',
        'permission.sandbox': '沙盒模式（推荐）',
        'permission.full-access': '完全访问（高风险）',
        'permission.unavailable': '（权限服务不可用）',
        'permission.not-recommended': '当前不是推荐预设：沙盒模式之外，智能体可以直接改动更多东西。',
        'term.ps7.note': '未检测到 PowerShell 7：DSH 终端会退回 Windows PowerShell 5。装上 PowerShell 7 体验更好——它只影响你自己的终端，不影响智能体的沙盒。',
        'status.idle': '未运行',
        'status.starting': '正在启动',
        'status.switching': '正在切换',
        'status.recovering': '正在恢复',
        'status.stopping': '正在停止',
        'status.running': '运行中',
        'status.recovered': '已恢复',
        'status.failed': '启动失败',
        'sessions.warn': '你的对话数量已经超过 5 万个，程序内存可能会被撑爆，建议清理一些不再需要的对话。',
        'profiles.title': 'Profiles',
        'profiles.none': '（该 Home 下没有 profile）',
        'profiles.not-discovered': '（尚未发现，点击「刷新 Profiles」）',
        'profiles.discovery-failed': '发现失败：',
        'profile.active': '当前',
        'profile.switch': '切换',
        'profile.headless': '无桌面界面',
        'profile.malformed': '配置有问题',
        'profile.boot-failing': '上次启动失败',
        'action.refresh': '刷新 Profiles',
        'action.restart': '重启 Harness',
        'action.choose-existing': '选择已有 Harness Home…',
        'action.use-managed': '使用托管 Harness Home',
        'candidate.title': '选择该 Home 下的 profile',
        'candidate.none': '该目录下没有可启动的 profile',
        'candidate.cancel': '取消',
        'recovery.title': '上次启动失败详情',
        'recovery.stage': '失败阶段',
        'recovery.message': '失败消息',
        'recovery.recovered-to': '恢复目标',
        // B3-13：随包内置插件的只读来源投影（launcher overlay 层真实事实）。
        'nav.feedback': 'BUG 诊断与反馈',
        // D5-c（莉莉丝 2026-09-06）：全局记忆从会话头部搬进设置页。
        // D20 文案（莉莉丝 2026-09-06）：先讲用途，文件名与位置收进次要信息。
        // B7-P3「用量与余额」：账户口径（开放平台登录态取官方数据），不做本地统计。
        'usage.balance': '余额',
        'usage.total-cost': '累计消费',
        'usage.bonus': '赠金',
        'usage.period.today': '今天',
        'usage.period.7d': '7 天',
        'usage.period.30d': '30 天',
        'usage.stat.cost': '消费金额',
        'usage.stat.requests': '请求数',
        'usage.stat.tokens': 'Token 总数',
        'usage.stat.cache': '缓存命中率',
        'usage.heatmap.title': '最近 60 天',
        'usage.heatmap.tokens': 'Token',
        'usage.heatmap.less': '少',
        'usage.heatmap.more': '多',
        'usage.refresh': '刷新',
        'usage.refreshing': '刷新中…',
        'usage.fetched-at': '上次刷新',
        'usage.loading': '正在读取账户数据…',
        'usage.signed-out': '账号登录信息已失效，重新登录后即可展示用量。',
        'usage.unavailable.network': '暂时连不上开放平台，稍后再试。',
        'usage.unavailable.timeout': '读取账户数据超时，稍后再试。',
        'usage.unavailable.format': '开放平台的数据格式变了，本页暂时读不出来；官网页面照常可看。',
        'usage.unavailable.blocked': '开放平台暂时拦下了请求（短时间内请求太多时会这样），过几分钟再点刷新。',
        'usage.unavailable.no-session': '暂时拿不到账号登录信息，稍后再试。',
        'usage.open-official': '打开官方用量页',
        'usage.more': '更多详情跳转官网查看',
        'usage.no-data': '—',
        // 住户 2026-09-23：三项官方上报默认关，在这里写明。2026-09-29 起三项统一由
        // 「设置 → 通用 → 开发者模式」开关，这里指过去。
        'fb.privacy': '对话记录保存在本机。DeepSeekGUI 默认关闭了官方的三项数据上报：随请求附带会话日志、点赞点踩时上传整段会话、随请求附带插件清单。需要与官方默认一致时，可在「设置 → 通用 → 开发者模式」中打开。',
        'fb.prompt': '遇到了什么问题？',
        'fb.placeholder': '描述你遇到的问题（保存没反应、启动失败、界面卡住……）。先说出来，发送之后 AI 会帮你排查和整理。',
        'fb.send': '发送给 AI 排查',
        'fb.sending': 'AI 正在排查…（最多约 60 秒；结果会回到这里，不用重复点）',
        'fb.degraded': 'AI 排查这次没有完成，已改用静态 issue 模板预填——发送功能不受影响。原因：',
        'fb.diagnostics': '诊断包（已自动脱敏，可编辑）',
        'fb.diagnostics.note': '诊断包在生成时已自动脱敏（用户名、路径、密钥）。发送给 AI 和提交前可以在这里查看和编辑。',
        'fb.reply': 'AI 排查回复',
        'fb.issue-title': 'issue 预览',
        'fb.copy-open': '复制并打开 GitHub',
        'fb.gateway.submit': '没有 GitHub？直接提交给我们',
        'fb.gateway.export': '没有 GitHub？导出反馈文件',
        'diag.build-info': '构建信息',
        // 构建信息的行标签（住户 2026-08-24：这一区原本是英文硬编码，D29
        // 双语化漏了它，界面上一堆英文夹着两行中文）。导出文本仍走英文
        // 标签，不受这份字典影响——贴进 issue 的东西谁都读得懂更要紧。
        'diag.build.app': '版本',
        'diag.build.dsh': '内嵌 Harness',
        'diag.build.runtime': '运行环境',
        'diag.build.home': 'Harness 目录',
        'diag.build.profile': '当前 Profile',
        'diag.build.status': '运行状态',
        'diag.build.log': '日志文件',
        'diag.build.updated': '上次更新',
        'diag.last-exit.clean': '上次退出：正常',
        'diag.last-exit.unclean': '上次退出：未正常退出（本次启动已收集证据）',
        'diag.last-exit.unknown': '上次退出：无历史证据',
        'diag.open-log': '打开日志文件夹',
        'diag.export': '导出诊断包',
        'diag.last-export': '最近导出：',
        'diag.copy-path': '复制完整路径',
        // D29 授权改动：line() 的「标签：值」分隔符从硬编码全角冒号改为字典取值，
        // zh 保持全角，en 用半角加空格（官方 en 风格）。
        'format.colon': '：',
      },
      en: {
        'nav.harness': 'Harness (Desktop)',
        'browser.toggle': 'Browser Panel',
        'bridge.error': 'Could not reach the DeepSeekGUI desktop control channel: ',
        'bridge.loading': 'Loading desktop state…',
        'busy': 'Working…',
        'harness.status': 'Status',
        'harness.pending': 'Pending',
        'harness.location': 'Location',
        'harness.home.managed': 'Managed',
        'harness.home.existing': 'Existing directory',
        'harness.permission': 'Permission mode',
        'permission.sandbox': 'Sandbox (recommended)',
        'permission.full-access': 'Full Access (high risk)',
        'permission.unavailable': '(permission service unavailable)',
        'permission.not-recommended': 'Not the recommended preset: outside Sandbox mode the agent can change more on its own.',
        'term.ps7.note': 'PowerShell 7 not found: the DSH Terminal falls back to Windows PowerShell 5. Installing PowerShell 7 gives a better terminal \u2014 it only affects your own terminal, never the agent sandbox.',
        'status.idle': 'Not running',
        'status.starting': 'Starting',
        'status.switching': 'Switching',
        'status.recovering': 'Recovering',
        'status.stopping': 'Stopping',
        'status.running': 'Running',
        'status.recovered': 'Recovered',
        'status.failed': 'Boot failed',
        'sessions.warn': 'You have more than 50,000 conversations. This can grow large enough to exhaust the app memory. Consider clearing out ones you no longer need.',
        'profiles.title': 'Profiles',
        'profiles.none': '(no profiles under this home)',
        'profiles.not-discovered': '(not discovered yet — click "Refresh Profiles")',
        'profiles.discovery-failed': 'Discovery failed: ',
        'profile.active': 'active',
        'profile.switch': 'Switch',
        'profile.headless': 'headless',
        'profile.malformed': 'malformed',
        'profile.boot-failing': 'last boot failed',
        'action.refresh': 'Refresh Profiles',
        'action.restart': 'Restart Harness',
        'action.choose-existing': 'Choose existing Harness Home…',
        'action.use-managed': 'Use managed Harness Home',
        'candidate.title': 'Choose a profile in this home',
        'candidate.none': 'No bootable profile in this directory',
        'candidate.cancel': 'Cancel',
        'recovery.title': 'Last boot failure',
        'recovery.stage': 'Stage',
        'recovery.message': 'Message',
        'recovery.recovered-to': 'Recovered to',
        // B3-13：随包内置插件的只读来源投影（launcher overlay 层真实事实）。
        'nav.feedback': 'Bug Report & Diagnostics',
        'usage.balance': 'Balance',
        'usage.total-cost': 'Total spent',
        'usage.bonus': 'Bonus',
        'usage.period.today': 'Today',
        'usage.period.7d': '7 days',
        'usage.period.30d': '30 days',
        'usage.stat.cost': 'Spent',
        'usage.stat.requests': 'Requests',
        'usage.stat.tokens': 'Total tokens',
        'usage.stat.cache': 'Cache hit rate',
        'usage.heatmap.title': 'Last 60 days',
        'usage.heatmap.tokens': 'tokens',
        'usage.heatmap.less': 'Less',
        'usage.heatmap.more': 'More',
        'usage.refresh': 'Refresh',
        'usage.refreshing': 'Refreshing…',
        'usage.fetched-at': 'Last refreshed',
        'usage.loading': 'Reading account data…',
        'usage.signed-out': 'The account sign-in is no longer valid. Sign in again to see usage.',
        'usage.unavailable.network': 'The open platform is unreachable right now. Try again later.',
        'usage.unavailable.timeout': 'Reading account data timed out. Try again later.',
        'usage.unavailable.format': 'The open platform changed its data format, so this page cannot read it for now. The official page still works.',
        'usage.unavailable.blocked': 'The open platform is refusing requests for now (this happens when too many arrive at once). Refresh again in a few minutes.',
        'usage.unavailable.no-session': 'The account sign-in is not available right now. Try again later.',
        'usage.open-official': 'Open the official usage page',
        'usage.more': 'See more details on the official site',
        'usage.no-data': '—',
        'fb.privacy': 'Conversations are stored on this computer. DeepSeekGUI turns off three official data uploads by default: the session log attached to requests, whole-session upload on thumbs up or down, and the plugin list attached to requests. To match the official defaults, turn them on under Settings → General → Developer mode.',
        'fb.prompt': 'What went wrong?',
        'fb.placeholder': 'Describe the problem you hit (save did nothing, launch failed, UI froze…). Say it first — after you send, the AI will triage and draft it for you.',
        'fb.send': 'Send to AI triage',
        'fb.sending': 'AI is triaging… (about 60 seconds at most; the result returns here, no need to click again)',
        'fb.degraded': 'AI triage did not complete this time; a static issue template is pre-filled instead — sending still works. Reason: ',
        'fb.diagnostics': 'Diagnostics bundle (auto-redacted, editable)',
        'fb.diagnostics.note': 'The bundle is auto-redacted at collection (usernames, paths, keys). Review and edit it here before sending or submitting.',
        'fb.reply': 'AI triage reply',
        'fb.issue-title': 'Issue preview',
        'fb.copy-open': 'Copy & open GitHub',
        'fb.gateway.submit': 'No GitHub? Send it to us directly',
        'fb.gateway.export': 'No GitHub? Export a feedback file',
        'diag.build-info': 'Build info',
        'diag.build.app': 'Version',
        'diag.build.dsh': 'Embedded Harness',
        'diag.build.runtime': 'Runtime',
        'diag.build.home': 'Harness home',
        'diag.build.profile': 'Active profile',
        'diag.build.status': 'Status',
        'diag.build.log': 'Log file',
        'diag.build.updated': 'Last update',
        'diag.last-exit.clean': 'Last exit: clean',
        'diag.last-exit.unclean': 'Last exit: unclean (evidence collected on this launch)',
        'diag.last-exit.unknown': 'Last exit: no history',
        'diag.open-log': 'Open log folder',
        'diag.export': 'Export diagnostics bundle',
        'diag.last-export': 'Last export: ',
        'diag.copy-path': 'Copy full path',
        'format.colon': ': ',
      },
    }

    // ---- 控制桥（main 的回环 HTTP；参数经页面 URL 下发，见 main.ts D39 段） ----

    function readBridge() {
      var match = /[?&]deepseekgui-control=([^&#]+)/.exec(window.location.search)
      if (match === null) return null
      var value = decodeURIComponent(match[1])
      var dot = value.indexOf('.')
      if (dot <= 0) return null
      var port = value.slice(0, dot)
      var token = value.slice(dot + 1)
      var base = 'http://127.0.0.1:' + port
      return {
        // since：上次拿到的 revision；内容没变时 main 只回
        // `{ revision, changed: false }` 小包，不传全量模型（P7）。
        async model(since) {
          var query = since === null || since === undefined ? '' : '?since=' + String(since)
          var r = await fetch(base + '/control/model' + query, { headers: { 'x-deepseekgui-control-token': token } })
          if (!r.ok) throw new Error('HTTP ' + String(r.status))
          return await r.json()
        },
        async run(command) {
          var r = await fetch(base + '/control/command', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-deepseekgui-control-token': token },
            body: JSON.stringify({ command: command }),
          })
          var body = await r.json().catch(function () { return {} })
          if (!r.ok) throw new Error(typeof body.error === 'string' ? body.error : 'HTTP ' + String(r.status))
          return body.model
        },
      }
    }

    // ---- 共享样式（官方 token；分区自绘内部，官方只给列容器） ----

    var S = {
      section: { display: 'flex', flexDirection: 'column', gap: '20px', fontSize: '14px', lineHeight: '22px', color: 'var(--dsw-alias-label-primary)' },
      title: { fontSize: '13px', lineHeight: '20px', color: 'var(--dsw-alias-label-tertiary)' },
      row: { display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 },
      value: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      group: { display: 'flex', flexDirection: 'column', gap: '8px' },
      button: {
        padding: '5px 12px', borderRadius: '8px', cursor: 'pointer',
        border: '1px solid var(--dsw-alias-border-l1)', background: 'transparent',
        color: 'var(--dsw-alias-label-primary)', fontSize: '13px', lineHeight: '20px',
      },
      buttonActive: { background: 'var(--dsw-alias-bg-multi-select)' },
      buttonDisabled: { opacity: 0.45, cursor: 'default' },
      input: {
        flex: '1 1 auto', minWidth: 0, padding: '5px 10px', borderRadius: '8px',
        border: '1px solid var(--dsw-alias-border-l1)', background: 'transparent',
        color: 'var(--dsw-alias-label-primary)', fontSize: '13px', lineHeight: '20px',
      },
      note: { fontSize: '12px', lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)' },
      warnBox: {
        display: 'flex', flexDirection: 'column', gap: '6px',
        padding: '10px 12px', borderRadius: '10px',
        border: '1px solid var(--dsw-alias-state-error-primary)',
        color: 'var(--dsw-alias-state-error-primary)',
        fontSize: '13px', lineHeight: '20px',
      },
      error: { fontSize: '13px', lineHeight: '20px', color: 'var(--dsw-alias-state-error-primary)', overflowWrap: 'anywhere' },
      output: {
        maxHeight: '220px', overflow: 'auto', margin: 0, padding: '10px 12px',
        borderRadius: '10px', border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-markdown-code-block)', font: 'var(--dsw-font-markdown-code-block-small)',
        whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
      },
    }

    /**
     * 分区里的按钮。`props.testId` 会落成 `data-deepseekgui` 属性——打包 e2e
     * 的唯一稳定抓手：文案随 locale 变、样式是内联对象、类名没有，只有这个
     * 属性是契约。加新按钮时请一并给 testId（tests-e2e/chrome-driver.ts 的
     * clickDeepSeekGUIButton 按它定位）。
     */
    function btn(props, label) {
      var disabled = props.disabled === true
      var style = Object.assign({}, S.button, props.active === true ? S.buttonActive : null, disabled ? S.buttonDisabled : null)
      return h('button', {
        type: 'button', style: style, disabled: disabled, key: props.key,
        'data-deepseekgui': props.testId,
        'data-deepseekgui-active': props.active === true ? 'true' : undefined,
        onClick: disabled ? undefined : props.onClick,
      }, label)
    }

    function labeled(t, key, node) {
      return h('div', { style: S.group }, h('div', { style: S.title }, t(key)), node)
    }

    /** 单行「标签：值」（住户 2026-08-23 验收定的紧凑格式；D29：冒号从字典取）。 */
    /**
     * 字典取值，缺键回退给定文本。
     *
     * 构建信息的行是 main 组装的，字典在插件这边——两侧版本万一不同步
     * （旧插件遇到新行），官方 locale 对未知键会把键名原样吐出来，界面上
     * 就会出现 `diag.build.xxx` 这种裸键。回退到那一行自带的英文 label：
     * 露一行英文比露一个内部键名强。
     * @param {(key: string) => string} t - 官方 locale 取值函数。
     * @param {string|undefined} key - 字典键。
     * @param {string} fallback - 回退文本。
     * @returns {string} 显示文本。
     */
    function dictText(t, key, fallback) {
      if (key === undefined || key === null || key === '') return fallback
      var text = t(key)
      return text === undefined || text === null || text === '' || text === key ? fallback : text
    }

    function line(label, value, title, colon, testId) {
      return h('div', { style: S.row, 'data-deepseekgui': testId },
        h('span', { style: S.title }, label + colon),
        h('span', { style: Object.assign({}, S.value), title: title }, value))
    }

    /** 模型轮询 + 命令执行的公共 hook（分区激活时才挂载 → 才轮询）。
     *  轮询是**条件**的：每次带上次的 revision 拉取，main 只在内容变化时
     *  回全量模型（`changed: false` 的小包不触发重渲染）。 */
    function useDesktopModel(bridge) {
      var state = React.useState(null)
      var model = state[0]; var setModel = state[1]
      var errorState = React.useState(null)
      var error = errorState[0]; var setError = errorState[1]
      var busyState = React.useState(false)
      var busy = busyState[0]; var setBusy = busyState[1]
      var revisionRef = React.useRef(null)
      var refreshing = React.useRef(false)
      var refresh = React.useCallback(function () {
        if (refreshing.current) return
        refreshing.current = true
        bridge.model(revisionRef.current).then(
          function (envelope) {
            if (envelope.changed === false) return
            if (revisionRef.current !== null && envelope.revision < revisionRef.current) return
            revisionRef.current = envelope.revision
            setModel(envelope.model)
            setError(null)
          },
          function (cause) { setError(String(cause && cause.message || cause)) },
        ).finally(function () { refreshing.current = false })
      }, [])
      React.useEffect(function () {
        refresh()
        var id = setInterval(refresh, 2000)
        return function () { clearInterval(id) }
      }, [])
      var run = React.useCallback(function (command) {
        setBusy(true)
        return bridge.run(command).then(
          function (next) { if (next && (revisionRef.current === null || next.revision >= revisionRef.current)) { revisionRef.current = next.revision; setModel(next) } setError(null); setBusy(false); return true },
          function (cause) { setError(String(cause && cause.message || cause)); setBusy(false); return false },
        )
      }, [])
      return { model: model, error: error, busy: busy, run: run }
    }

    /**
     * 模型未就绪时四个分区共用的占位：桥还在加载就说加载中，桥报错就把错误
     * 摆出来。就绪返回 null，调用方接着渲染自己的内容。
     */
    function notReady(d, t) {
      if (d.model !== null) return null
      return h('div', { style: S.section },
        d.error === null ? h('div', { style: S.note }, t('bridge.loading')) : h('div', { style: S.error }, t('bridge.error'), d.error))
    }

    // ---- 分区一：Harness（桌面） ----

    function makeHarnessSection(bridge) {
      return function HarnessSection(props) {
        var t = props.t
        var d = useDesktopModel(bridge)
        var pending = notReady(d, t)
        if (pending !== null) return pending
        var m = d.model
        var busy = d.busy
        // status 是 {phase,...} 判别联合，不是字符串（首验收「status.[object
        // Object]」的教训）；running+recovered 拆成独立文案相。
        var phase = m.status.phase === 'running' && m.status.recovered === true ? 'recovered' : m.status.phase
        var statusText = t('status.' + phase) + (m.pending === null ? '' : '（' + t('harness.pending') + '：' + m.pending + '）')
        var homeLabel = m.homeKind === 'managed' ? t('harness.home.managed') : t('harness.home.existing')

        var profileRows
        if (m.profiles === null) {
          profileRows = [h('div', { style: S.note, key: 'none' }, t('profiles.not-discovered'))]
        } else if (m.profiles.length === 0) {
          profileRows = [h('div', { style: S.note, key: 'none' }, t('profiles.none'))]
        } else {
          profileRows = m.profiles.map(function (profile) {
            var marks = []
            if (profile.staticStatus === 'headless') marks.push(t('profile.headless'))
            if (profile.staticStatus === 'malformed') marks.push(t('profile.malformed'))
            if (profile.bootFailingStage !== undefined) marks.push(t('profile.boot-failing'))
            var switchable = profile.staticStatus !== 'headless' && profile.staticStatus !== 'malformed' && !profile.active
            return h('div', { style: S.row, key: profile.name },
              h('span', { style: S.value }, profile.name),
              profile.active ? h('span', { style: S.note }, '✓ ' + t('profile.active') + '（' + homeLabel + '）') : null,
              marks.length > 0 ? h('span', { style: S.note }, marks.join(' · ')) : null,
              switchable ? btn({ testId: 'profile-switch-' + profile.name, disabled: busy, onClick: function () { d.run({ type: 'switch-profile', profile: profile.name }) } }, t('profile.switch')) : null)
          })
        }

        var candidate = null
        if (m.existingHomeCandidate !== null) {
          var candidateRows = m.existingHomeCandidate.profiles
            .filter(function (profile) { return profile.staticStatus === 'web-capable' || profile.staticStatus === 'candidate' })
            .map(function (profile) {
              return h('div', { style: S.row, key: profile.name },
                h('span', { style: S.value }, profile.name),
                btn({ testId: 'candidate-profile-' + profile.name, disabled: busy, onClick: function () { d.run({ type: 'choose-existing-profile', profile: profile.name }) } }, t('profile.switch')))
            })
          candidate = labeled(t, 'candidate.title', h('div', { style: S.group },
            h('div', { style: S.note }, m.existingHomeCandidate.path),
            candidateRows.length > 0 ? candidateRows : h('div', { style: S.note }, t('candidate.none')),
            h('div', { style: S.row }, btn({ testId: 'candidate-cancel', disabled: busy, onClick: function () { d.run({ type: 'cancel-existing-home' }) } }, t('candidate.cancel')))))
        }

        var recovery = null
        if (m.recovery !== null) {
          recovery = labeled(t, 'recovery.title', h('div', { style: S.group, 'data-deepseekgui': 'harness-recovery' },
            h('div', { style: S.note }, t('recovery.stage') + '：' + m.recovery.stage),
            h('div', { style: S.note }, t('recovery.message') + '：' + m.recovery.message),
            h('div', { style: S.note }, t('recovery.recovered-to') + '：' + m.recovery.recoveredTo)))
        }

        var permission
        if (m.permissions.mode === 'unavailable') {
          permission = h('div', { style: S.note }, t('permission.unavailable'))
        } else {
          // read-only / custom 两种模式没有切换按钮语义，先如实展示 preset。
          permission = h('div', { style: S.group },
            h('div', { style: Object.assign({}, S.row, { flexWrap: 'wrap' }) },
              btn({ testId: 'permission-sandbox', active: m.permissions.mode === 'sandbox', disabled: busy || m.permissions.mode === 'sandbox', onClick: function () { d.run({ type: 'set-permission-mode', mode: 'sandbox' }) } }, t('permission.sandbox')),
              btn({ testId: 'permission-full-access', active: m.permissions.mode === 'full-access', disabled: busy || m.permissions.mode === 'full-access', onClick: function () { d.run({ type: 'set-permission-mode', mode: 'full-access' }) } }, t('permission.full-access')),
              m.permissions.mode !== 'sandbox' && m.permissions.mode !== 'full-access' && m.permissions.preset !== null
                ? h('span', { style: S.note }, m.permissions.mode + ' · ' + m.permissions.preset)
                : null),
            // 「你当前没在用推荐预设」——这句是 DeepSeekGUI 独有的提醒（官方那边
            // 不会说），面板迁进设置页时跟着旧 renderer 一起丢了，补回来。
            m.permissions.mode !== 'sandbox' && m.permissions.mode !== 'unavailable'
              ? h('div', { style: S.error, 'data-deepseekgui': 'permission-not-recommended' }, t('permission.not-recommended'))
              : null)
        }

        return h('div', { style: S.section },
          // 越线才出现，出现就在最上面：这是打开设置第一眼要看到的东西。
          // 只陈述事实与后果，不提供"一键清理"——删的是用户自己的对话，
          // 该由他在官方界面里逐个决定，而不是我们代劳。
          m.sessionPressure !== null
            ? h('div', { style: S.warnBox, 'data-deepseekgui': 'session-pressure' }, t('sessions.warn'))
            : null,
          d.error !== null ? h('div', { style: S.error }, t('bridge.error'), d.error) : null,
          busy ? h('div', { style: S.note }, t('busy')) : null,
          line(t('harness.status'), statusText, undefined, t('format.colon'), 'harness-status'),
          line(t('harness.location'), m.dshHome, m.dshHome, t('format.colon'), 'harness-location'),
          labeled(t, 'profiles.title', h('div', { style: S.group },
            m.discoveryError !== null ? h('div', { style: S.error }, t('profiles.discovery-failed'), m.discoveryError) : null,
            profileRows)),
          labeled(t, 'harness.permission', permission),
          // PS7 只影响用户自己的终端，绝不影响 Agent sandbox（P6-E）——提示
          // 随面板迁移丢过一次，补回来并让 powerShell7Available 重新有消费者。
          m.powerShell7Available === false ? h('div', { style: S.note, 'data-deepseekgui': 'term-ps7-note' }, t('term.ps7.note')) : null,
          candidate,
          recovery,
          // 终端入口刻意不在这里（住户定）：DSH 终端留在左上角 DeepSeekGUI 菜单。
          h('div', { style: Object.assign({}, S.row, { flexWrap: 'wrap' }) },
            btn({ testId: 'harness-refresh', disabled: busy, onClick: function () { d.run({ type: 'refresh-profiles' }) } }, t('action.refresh')),
            btn({ testId: 'harness-restart', disabled: busy, onClick: function () { d.run({ type: 'restart-harness' }) } }, t('action.restart')),
            btn({ testId: 'harness-choose-existing', disabled: busy, onClick: function () { d.run({ type: 'choose-existing-home' }) } }, t('action.choose-existing')),
            m.homeKind === 'existing' ? btn({ testId: 'harness-use-managed', disabled: busy, onClick: function () { d.run({ type: 'use-managed-home' }) } }, t('action.use-managed')) : null))
      }
    }

    // ---- 分区三：BUG 诊断与反馈（chrome 面板移植；命令与 main 同一出口） ----

    function makeFeedbackSection(bridge) {
      return function FeedbackSection(props) {
        var t = props.t
        var d = useDesktopModel(bridge)
        var textState = React.useState('')
        var text = textState[0]; var setText = textState[1]
        var diagState = React.useState(null)
        var diagDraft = diagState[0]; var setDiagDraft = diagState[1]
        // 进入分区 = 打开反馈（main 借此收集脱敏诊断包）；离开 = 关闭。
        React.useEffect(function () {
          d.run({ type: 'open-feedback' })
          return function () { d.run({ type: 'close-feedback' }) }
        }, [])
        var pending = notReady(d, t)
        if (pending !== null) return pending
        var m = d.model
        var view = m.feedback
        var busy = d.busy
        var sending = view.phase === 'sending'
        var settled = view.phase === 'replied' || view.phase === 'degraded'
        var diagValue = diagDraft === null ? view.diagnostics : diagDraft

        var result = null
        if (settled) {
          result = h('div', { style: S.group },
            view.phase === 'degraded' ? h('div', { style: S.note }, t('fb.degraded'), view.degradedReason || '') : null,
            view.phase === 'replied' && view.reply !== null
              ? h('div', { style: S.group }, h('div', { style: S.title }, t('fb.reply')), h('div', { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, view.reply))
              : null,
            h('div', { style: S.title }, t('fb.issue-title')),
            h('div', null, view.issueTitle),
            h('div', { style: Object.assign({}, S.row, { flexWrap: 'wrap' }) },
              btn({ testId: 'feedback-copy-open', disabled: busy, onClick: function () { d.run({ type: 'feedback-copy-open' }) } }, t('fb.copy-open')),
              btn({ testId: 'feedback-submit-gateway', disabled: busy, onClick: function () { d.run({ type: 'feedback-submit-gateway' }) } }, t(view.gatewayConfigured ? 'fb.gateway.submit' : 'fb.gateway.export'))),
            view.notice !== null ? h('div', { style: S.note }, view.notice) : null)
        }

        var lastExitKey = m.diagnostics.uncleanExit === true ? 'diag.last-exit.unclean'
          : m.diagnostics.uncleanExit === false ? 'diag.last-exit.clean' : 'diag.last-exit.unknown'

        return h('div', { style: S.section },
          d.error !== null ? h('div', { style: S.error }, t('bridge.error'), d.error) : null,
          h('div', { style: S.note, 'data-deepseekgui': 'feedback-privacy' }, t('fb.privacy')),
          h('div', { style: S.group },
            h('div', { style: S.title }, t('fb.prompt')),
            h('textarea', {
              'data-deepseekgui': 'feedback-text',
              style: Object.assign({}, S.input, { minHeight: '72px', resize: 'vertical', fontFamily: 'inherit' }),
              value: text, placeholder: t('fb.placeholder'),
              onChange: function (event) { setText(event.target.value) },
            }),
            h('div', { style: S.row },
              btn({ testId: 'feedback-send', disabled: sending || busy || text.trim() === '', onClick: function () {
                d.run({ type: 'feedback-send', text: text.trim(), diagnostics: diagValue })
              } }, t(sending ? 'fb.sending' : 'fb.send')))),
          h('details', null,
            h('summary', { style: S.title }, t('fb.diagnostics')),
            h('div', { style: S.note }, t('fb.diagnostics.note')),
            h('textarea', {
              'data-deepseekgui': 'feedback-diagnostics',
              style: Object.assign({}, S.input, { minHeight: '120px', resize: 'vertical', fontFamily: 'var(--dsw-font-family-mono, monospace)' }),
              value: diagValue,
              onChange: function (event) { setDiagDraft(event.target.value) },
            })),
          result,
          h('div', { style: S.group },
            h('div', { style: S.title, 'data-deepseekgui': 'diag-build-info' }, t('diag.build-info')),
            // exportOnly 的行只进导出文本，不上界面（更新通道那种「我们的
            // 发行事实」对用户没有可操作性）。标签与部分值走字典；字典缺
            // 键时回退英文 label，宁可露一行英文也不显示一个裸键。
            m.diagnostics.buildInfo.filter(function (row) {
              return row.exportOnly !== true
            }).map(function (row) {
              var label = dictText(t, row.key, row.label)
              var value = row.valueKey === undefined ? row.value : dictText(t, row.valueKey, row.value)
              // 显示打码值，title（悬停）给原值：截图截不到悬停内容。
              return line(label, value, row.exportValue === undefined ? row.value : row.exportValue, t('format.colon'))
            }),
            h('div', { style: S.note }, t(lastExitKey)),
            line(t('harness.location'), m.diagnostics.homeDisplay, m.dshHome, t('format.colon'))),
          h('div', { style: Object.assign({}, S.row, { flexWrap: 'wrap' }) },
            btn({ testId: 'diag-copy-path', disabled: busy, onClick: function () { d.run({ type: 'copy-full-path' }) } }, t('diag.copy-path')),
            btn({ testId: 'diag-open-log', disabled: busy, onClick: function () { d.run({ type: 'open-log-folder' }) } }, t('diag.open-log')),
            btn({ testId: 'diag-export', disabled: busy, onClick: function () { d.run({ type: 'export-diagnostics' }) } }, t('diag.export'))),
          m.diagnostics.lastExport !== null ? h('div', { style: S.note }, t('diag.last-export') + m.diagnostics.lastExport) : null)
      }
    }

    /** 装载：控制桥参数在场才注册分区（外部浏览器打开 3080 时不在场）。 */
    var inject = ['slots', 'locale']
    function apply(ctx) {
      // 整体兜底：本插件坏了只能表现为「设置页少了 DeepSeekGUI 分区」，绝不许
      // 把整轮 composition 拖死在 boot（D31 的失败形状）。Chrome 菜单是同一
      // 命令出口的另一入口，功能不因此丢失。
      try {
        applyInner(ctx)
      } catch (error) {
        console.error('[deepseekgui-settings] apply failed: ' + String(error && error.message || error))
      }
    }
    /**
     * 会话头部 utilities 区的浏览器面板开关（B3-11 返工：住户定——产品内
     * 功能按钮住在产品内容区，与 Session log 并排，不占应用整体顶栏）。
     * 无状态：点击即 toggle，开合事实由壳持有（与菜单项同一命令出口）。
     */
    function makeBrowserPaneButton(bridge, t) {
      return function BrowserPaneButton() {
        var busyState = React.useState(false)
        var busy = busyState[0]
        var setBusy = busyState[1]
        return h('button', {
          type: 'button',
          title: t('browser.toggle'),
          'aria-label': t('browser.toggle'),
          disabled: busy,
          onClick: function () {
            setBusy(true)
            bridge.run({ type: 'browser-pane-toggle' })
              .catch(function () { /* 壳不在或桥断：按钮静默失败，无第二事实源可撒谎 */ })
              .then(function () { setBusy(false) })
          },
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '36px',
            height: '36px',
            padding: '0',
            border: '1px solid var(--dsw-alias-border-l2)',
            borderRadius: '999px',
            background: 'var(--dsw-alias-bg-base)',
            color: 'var(--dsw-alias-label-secondary)',
            cursor: busy ? 'default' : 'pointer',
          },
        }, h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
          h('circle', { cx: 8, cy: 8, r: 6.4, stroke: 'currentColor', strokeWidth: 1.3 }),
          h('ellipse', { cx: 8, cy: 8, rx: 2.9, ry: 6.4, stroke: 'currentColor', strokeWidth: 1.1 }),
          h('path', { d: 'M1.9 5.7h12.2M1.9 10.3h12.2', stroke: 'currentColor', strokeWidth: 1.1 })))
      }
    }

    // ---- 分区四：记忆（全局） ----
    //
    // B7-P9 起由 workbench 插件的 TS 客户端注册同 id（deepseekgui-memory，
    // order 43）的分区：条目记忆、模式切换、旧文件编辑与导入都在那边。
    // 这里不再注册，避免同一 id 两份。

    // ---- 分区五：用量与余额（B7-P3） ----
    //
    // 账户口径：数据来自开放平台在内置浏览器里的登录态（main 在那个
    // session 的隐藏页面里取、聚合后放进模型），本页只画聚合值，不做本地
    // 统计。刷新只有三个触发点：挂载本页（这里）、GUI 冷启动（main）、
    // 手动🔄；限频与陈旧结果丢弃在 main。金额是十进制字符串，只截不算。

    /** 十进制字符串按小数位截断（不四舍五入——余额宁可少显示一分，不多显示）。 */
    function truncateDecimal(text, places) {
      var dot = text.indexOf('.')
      if (dot === -1) return places > 0 ? text + '.' + '0'.repeat(places) : text
      var fraction = text.slice(dot + 1, dot + 1 + places)
      while (fraction.length < places) fraction += '0'
      return text.slice(0, dot) + (places > 0 ? '.' + fraction : '')
    }

    var CURRENCY_SYMBOL = { CNY: '¥', USD: '$' }

    /** 一笔金额的显示：符号 + 两位小数（截断）；未知币种前置代码。 */
    function moneyText(money) {
      var symbol = CURRENCY_SYMBOL[money.currency]
      var amount = truncateDecimal(money.amount, 2)
      return symbol === undefined ? money.currency + ' ' + amount : symbol + amount
    }

    function moneyList(list, empty) {
      if (list.length === 0) return empty
      return list.map(moneyText).join(' · ')
    }

    function integerText(value) {
      return value.toLocaleString()
    }

    function rateText(rate, empty) {
      if (rate === null || rate === undefined) return empty
      return (Math.round(rate * 1000) / 10).toFixed(1) + '%'
    }

    /** 热力图色阶：0 为底色，其余按与最大值的比例落进四档。 */
    var HEAT_LEVELS = ['transparent', 'rgba(77,107,254,0.22)', 'rgba(77,107,254,0.45)', 'rgba(77,107,254,0.7)', 'rgba(77,107,254,1)']
    function heatLevel(tokens, max) {
      if (tokens <= 0 || max <= 0) return 0
      return Math.max(1, Math.min(4, Math.ceil((tokens / max) * 4)))
    }

    function makeUsageSection(bridge) {
      return function UsageSection(props) {
        var t = props.t
        var d = useDesktopModel(bridge)
        var periodState = React.useState('30d')
        var period = periodState[0]; var setPeriod = periodState[1]
        // 挂载即刷新（三个触发点之一）；main 会限频，这里不判断。
        React.useEffect(function () { d.run({ type: 'usage-refresh', trigger: 'open' }) }, [])
        var pending = notReady(d, t)
        if (pending !== null) return pending
        var u = d.model.usage
        var data = u.data
        var loading = u.status === 'loading'
        var refreshDisabled = loading || u.cooling || d.busy
        var bigNumber = { fontSize: '26px', lineHeight: '34px', fontWeight: 600, fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' }
        var card = {
          flex: '1 1 0', minWidth: 0, padding: '12px 14px', borderRadius: '12px',
          border: '1px solid var(--dsw-alias-border-l1)', display: 'flex', flexDirection: 'column', gap: '4px',
        }
        var statCard = Object.assign({}, card, { padding: '10px 12px' })
        var statNumber = { fontSize: '18px', lineHeight: '26px', fontWeight: 600, fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' }

        var header = h('div', { style: Object.assign({}, S.row, { justifyContent: 'space-between', flexWrap: 'wrap' }) },
          h('span', { style: S.note, 'data-deepseekgui': 'usage-fetched-at' },
            loading ? t('usage.refreshing')
              : u.fetchedAt !== null ? t('usage.fetched-at') + t('format.colon') + new Date(u.fetchedAt).toLocaleString() : ''),
          // 顺带让上面官方的余额卡也重读一次：它自己没有刷新入口、失败不重试（住户 2026-09-26，
          // 上游 deepseek-harness#7931）。refreshAccount 由官方账号页经 settings.account.footer 传进来。
          btn({ testId: 'usage-refresh', disabled: refreshDisabled, onClick: function () {
            d.run({ type: 'usage-refresh', trigger: 'manual' })
            if (typeof props.refreshAccount === 'function') props.refreshAccount().catch(function () { /* 余额卡自己显示失败 */ })
          } },
            loading ? t('usage.refreshing') : '🔄 ' + t('usage.refresh')))

        var footer = h('div', { style: Object.assign({}, S.row, { justifyContent: 'flex-end' }) },
          h('button', {
            type: 'button',
            style: Object.assign({}, S.button, { border: 'none', padding: '2px 4px', fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)' }),
            'data-deepseekgui': 'usage-more',
            onClick: function () { d.run({ type: 'open-external-link', url: u.usagePageUrl }) },
          }, t('usage.more') + ' ↗'))

        if (u.status === 'signed-out') {
          // 2026-09-25 起登录走官方账号：这块只在官方账号页（已登录）下面出现，
          // 这里还收到 signed-out 只可能是平台拒了令牌——请用户在上方重新登录。
          return h('div', { style: S.section },
            header,
            h('div', { style: S.group, 'data-deepseekgui': 'usage-signed-out' }, t('usage.signed-out')),
            footer)
        }
        if (u.status === 'unavailable') {
          var reasonKey = 'usage.unavailable.' + (u.reason === null ? 'network' : u.reason)
          return h('div', { style: S.section },
            header,
            h('div', { style: S.group, 'data-deepseekgui': 'usage-unavailable' },
              h('div', {}, t(reasonKey)),
              h('div', { style: S.row },
                btn({ testId: 'usage-open-official', onClick: function () { d.run({ type: 'open-external-link', url: u.usagePageUrl }) } }, t('usage.open-official')))),
            footer)
        }
        if (data === null) {
          return h('div', { style: S.section }, header, h('div', { style: S.note, 'data-deepseekgui': 'usage-loading' }, t('usage.loading')), footer)
        }

        var slice = period === 'today' ? data.today : period === '7d' ? data.days7 : data.days30
        var empty = t('usage.no-data')
        var max = 0
        data.heatmap.forEach(function (day) { if (day.tokens > max) max = day.tokens })
        var periods = [['today', 'usage.period.today'], ['7d', 'usage.period.7d'], ['30d', 'usage.period.30d']]

        return h('div', { style: Object.assign({}, S.section, loading ? { opacity: 0.7 } : null), 'data-deepseekgui': 'usage-ready' },
          header,
          // 第一行：余额 | 累计消费。
          h('div', { style: Object.assign({}, S.row, { alignItems: 'stretch' }) },
            h('div', { style: card, 'data-deepseekgui': 'usage-balance' },
              h('div', { style: S.title }, t('usage.balance')),
              h('div', { style: bigNumber }, moneyList(data.balances, empty)),
              data.bonus.length > 0
                ? h('div', { style: S.note, 'data-deepseekgui': 'usage-bonus' }, t('usage.bonus') + t('format.colon') + moneyList(data.bonus, empty))
                : null),
            h('div', { style: card, 'data-deepseekgui': 'usage-total-cost' },
              h('div', { style: S.title }, t('usage.total-cost')),
              h('div', { style: bigNumber }, moneyList(data.totalCosts, empty)))),
          // 时段切换：本地切片，不重复请求。
          h('div', { style: S.group },
            h('div', { style: S.row },
              periods.map(function (entry) {
                return btn({
                  key: entry[0], testId: 'usage-period-' + entry[0], active: period === entry[0],
                  onClick: function () { setPeriod(entry[0]) },
                }, t(entry[1]))
              })),
            h('div', { style: Object.assign({}, S.row, { alignItems: 'stretch' }), 'data-deepseekgui': 'usage-stats' },
              h('div', { style: statCard }, h('div', { style: S.title }, t('usage.stat.cost')), h('div', { style: statNumber, 'data-deepseekgui': 'usage-stat-cost' }, moneyList(slice.costs, empty))),
              h('div', { style: statCard }, h('div', { style: S.title }, t('usage.stat.requests')), h('div', { style: statNumber, 'data-deepseekgui': 'usage-stat-requests' }, integerText(slice.requests))),
              h('div', { style: statCard }, h('div', { style: S.title }, t('usage.stat.tokens')), h('div', { style: statNumber, 'data-deepseekgui': 'usage-stat-tokens' }, integerText(slice.tokens))),
              h('div', { style: statCard }, h('div', { style: S.title }, t('usage.stat.cache')), h('div', { style: statNumber, 'data-deepseekgui': 'usage-stat-cache' }, rateText(slice.cacheHitRate, empty))))),
          // 60 天热力图：12 × 5，每格一天，最早在左上。
          h('div', { style: S.group },
            h('div', { style: S.title }, t('usage.heatmap.title')),
            h('div', {
              style: { display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: '5px', maxWidth: '420px' },
              'data-deepseekgui': 'usage-heatmap',
            }, data.heatmap.map(function (day) {
              var level = heatLevel(day.tokens, max)
              return h('div', {
                key: day.date,
                title: day.date + ' · ' + integerText(day.tokens) + ' ' + t('usage.heatmap.tokens'),
                'data-level': String(level),
                style: {
                  aspectRatio: '1 / 1', borderRadius: '5px',
                  border: '1px solid var(--dsw-alias-border-l1)',
                  background: HEAT_LEVELS[level],
                },
              })
            })),
            h('div', { style: Object.assign({}, S.row, { justifyContent: 'flex-end', gap: '4px' }) },
              h('span', { style: S.note }, t('usage.heatmap.less')),
              HEAT_LEVELS.map(function (color, index) {
                return h('span', { key: index, style: { width: '12px', height: '12px', borderRadius: '3px', border: '1px solid var(--dsw-alias-border-l1)', background: color } })
              }),
              h('span', { style: S.note }, t('usage.heatmap.more')))),
          footer)
      }
    }

    function applyInner(ctx) {
      var bridge = readBridge()
      if (bridge === null) return
      ctx.effect(function () { return ctx.locale.register(NS, STRINGS) }, 'deepseekgui-settings: dictionaries')
      var t = ctx.locale.bind(NS)
      var HarnessSection = makeHarnessSection(bridge)
      var FeedbackSection = makeFeedbackSection(bridge)
      var UsageSection = makeUsageSection(bridge)
      // 两个分区只差 id / order / 文案键 / 组件；显示顺序由 order 定（记忆分区归 workbench 插件）。
      var sections = [
        ['deepseekgui-harness', 40, 'nav.harness', HarnessSection],
        ['deepseekgui-feedback', 42, 'nav.feedback', FeedbackSection],
      ]
      sections.forEach(function (entry) {
        ctx.slots.inject('settings.section', function () {
          return ctx.slots.register({
            name: 'settings.section',
            id: entry[0],
            order: entry[1],
            label: function () { return t(entry[2]) },
            locale: NS,
          }, entry[3])
        })
      })
      // 用量与余额（住户 2026-09-25）：登录改走官方账号后，用量格子并进官方「账号与余额」页，
      // 挂在余额卡片下面（ui-settings-account 的 settings.account.footer），不再单独占一个分区。
      ctx.slots.inject('settings.account.footer', function () {
        return ctx.slots.register({
          name: 'settings.account.footer',
          id: 'deepseekgui-usage',
          locale: NS,
        }, UsageSection)
      })
      // 浏览器面板开关：会话头部 utilities（Session log 同排，B3-11 返工）。
      var BrowserPaneButton = makeBrowserPaneButton(bridge, t)
      ctx.slots.inject('conversation.session.header.utilities', function () {
        return ctx.slots.register({
          name: 'conversation.session.header.utilities',
          id: 'deepseekgui-browser-pane',
          order: 110,
          label: function () { return t('browser.toggle') },
          locale: NS,
        }, BrowserPaneButton)
      })
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
