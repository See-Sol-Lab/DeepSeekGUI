# Agent Note: 更新面板里可读的更新说明与悬停预览

Status: implemented

[English](2026-09-13-update-release-notes-panel.md) | 中文

## 问题

更新面板把 manifest 的 `releaseNotes` 用 `textContent` 塞进一个文本块，位于版本行之下、下载 / 关闭按钮之上。发布的说明是发布页正文：中英双语、几千字符，带语言切换行、`<a id>` 锚点、`## 中文` / `## English` 标题和围栏代码。在 300px 的面板里，Markdown 记号原样裸露，文本块不能滚动，按钮被顶出窗口，用户点开检查更新既看不完说明也点不到下载。解析器还把说明截在 4,000 字符——中文一半被截掉，英文整段丢失。不打开面板也没有任何途径看到这一版改了什么。

## 决策

`apps/deepseekgui/src/release-notes.ts` 是 Chrome renderer 与测试共用的一个纯模块：`splitReleaseNotesByLanguage` 识别整行为 `中文` / `English` 的 ATX 标题，分区到下一个语言标题或顶层 `---` 为止，从共享头尾里去掉纯导航行（锚点链接切换行、纯 HTML 行、注释），围栏代码内的内容一律不参与判定。`selectReleaseNotes` 返回当前界面语言那一段连同共享头尾，缺本语言时退到另一种语言，没有语言标题时返回全文。`parseReleaseNotes` 生成块树：标题、段落、带深度的扁平列表、围栏代码、分隔线，以及行内文本 / 加粗 / 行内代码 / 链接；只有不带凭据的 `https:` 目标成为链接（`safeReleaseLink`），图片降级为替代文本，原始 HTML 只能成为文本。`previewReleaseNotes` 保留前 N 条内容并报告藏起的条数。`apps/deepseekgui/src/chrome/release-notes-dom.ts` 只用 `createElement` 与 `textContent` 投影块树；链接点击回调而不导航。

renderer 重排更新面板：`#update-status` 容纳版本行、说明区（默认折叠为六条，展开 / 收起控件绑定到版本，`role="region"` 且可聚焦）和 SmartScreen 之类的短提示，独立滚动；`#update-actions` 容纳下载 / 安装 / 取消 / 关闭提示、「查看完整 Release」与自动下载开关。面板是纵向 flex 容器，高度受 overlay 约束，宽 `min(440px, 100vw - 20px)`。有可用、已验证或下载中的更新时，`#update-hint` 出现在状态胶囊旁；悬停或键盘聚焦会扩展 Chrome view 并显示 `#update-preview`（同一棵块树的前五条，pointer-events none），离开或失焦收起，Escape 关闭，点击打开更新面板。`closeMenu` 程序性归还焦点时抑制一次，Escape 不会把预览重新弹出。

`UpdateView.releasePageUrl` 在 `buildModel` 里由 `releasePageUrlFor(feedUrl, latestVersion)` 算出：只有内置公开通道得到 `RELEASE_PAGE_URL_PREFIX` + 版本（`scripts/generate-update-manifest.ts` 遵循的 `v<version>` tag 规则）；私有 feed 为 null、无入口。说明里的链接与该入口发送封闭命令 `open-external-link`，`parseControlCommand` 用同一条 `safeReleaseLink` 规则校验，main 用 `shell.openExternal` 处理；Chrome view 保持无条件的 `will-navigate` 拦截。`UPDATE_RELEASE_NOTES_MAX` 为 32,000 字符，按双语全文而非摘要定。

## 考虑过的替代方案

**用原生 `title` 提示做悬停预览。** 它能在不扩展 47px Chrome view 的情况下显示在视图之外，但只承载纯文本且会截断；预览就无法与面板共用同一套渲染规则。

**引入完整 Markdown 库。** 其 HTML 输出需要消毒，并会把原始 HTML、图片和内嵌内容带进受信任的本地 renderer；上述受限语法小到可以自己拥有，而 DOM 投影让一切未识别内容在构造上只能是文本。

**没有标题时猜测语言。** 不采用：没有分区的说明整体显示，不按启发式截断。

**经 Compatibility View 的链接处理器打开链接。** Chrome view 是另一个 renderer，其导航被彻底拦截；经现有控制路径的一条校验命令保持一个出口、一条规则。

## 后果

用户以可读文本看到本语言的说明，可展开或滚动，并始终能点到动作按钮；悬停预览在任何下载决定之前展示变更清单，且悬停从不启动下载。长说明不再被解析器上限截掉。renderer 新增一条命令与两个 DOM 容器；jsdom renderer 套件覆盖语言选择、折叠 / 展开、链接与发布页命令、提示预览的打开 / 关闭 / 聚焦 / Escape 以及「不发下载」不变量，`release-notes.spec.ts` 用真实的 v1.1.1 说明（`tests/fixtures/release-notes-v1.1.1.md`）跑完切段与解析。真实窗口检查（窄窗口、键盘、双语）仍属人工验收。
