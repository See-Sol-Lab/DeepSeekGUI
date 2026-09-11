# Agent Note：把 reveal 的包含判定放宽到会话所属仓库根

Status: implemented

[English](2026-09-09-reveal-containment-repository-root.md) | 中文

## 问题

改动视图列的是 Git status 条目，路径相对仓库根；而 `reveal-path` 无论解析还是包含判定都只以会话 cwd 为根。于是开在仓库子目录的会话无法定位该视图列出的仓库其余部分——拼出的绝对路径必然落在 cwd 之外，一律被拒。渲染进程改用 `repository.root` 拼接只修好了拼写，没有修判定，失败因此只是从静默无响应变成了明确拒绝。

同一处比较还会拒绝拼写大小写与 cwd 不一致的目标。Windows 的 `realpathSync` 逐段返回调用方的拼写而非磁盘上的拼写，所以来自会话头的 cwd 与来自 Git 的根可以不一致，而两者都没有错。

## 决定

`reveal-target.ts` 保持会话 cwd 为唯一解析基，只放宽包含判定的根。`revealTargetOf` 先按 cwd 判一次；只有判为 `outside` 才按会话所属仓库根再判一次。两次判定各自经 `containedTargetOf` 走完自己的词法与 `realpath` 两段，因此绝不会拿一个根的拼写去比另一个根的规范身份；而常规情形——目标就在 cwd 之内——完全不会为了找仓库去探测文件系统。

`repositoryRootOf` 只探存在性，找出 cwd 向上最近的、带 `.git` 条目的严格祖先。linked worktree 与 submodule 带的是 `gitdir:` 指针文件而非目录，而 `git rev-parse --show-toplevel` 返回的正是持有该条目的那个目录，所以探存在性与 Git 的答案一致，判目录则不然。不可读的祖先读作「此处无标记」，只会让结果更窄。cwd 自身带标记、或没有任何祖先带标记时返回 null，行为与改动前逐字一致。这是文件系统标记探测，不是 `git rev-parse`：在 `GIT_DIR`、`GIT_WORK_TREE`、`core.worktree`、`GIT_CEILING_DIRECTORIES` 或陈旧 `.git` 之下，它给出的目录可能与 Git 不同。就近取胜限制了这种分歧——在 cwd 与真实仓库根之间植入标记只会收窄允许根，永远不会扩宽。

比较只在 Windows 上折叠大小写，写法对齐 `packages/fs/fs-sandbox/src/containment.ts`。折叠后的拼写仅用于比较；返回的目标保留 `realpath` 的原始拼写，因为它要交给 `statSync` 与 `shell.showItemInFolder`。

wire 契约未变：`parseControlCommand` 仍严格只接受 `{type, sessionId, path}`，渲染进程一个文件都没改。允许根由 main 从它本就从官方会话事实解析出的 cwd 自行推出，因此不存在需要被信任的调用方输入。

## 考虑过的其他方案

**让渲染进程传 `repository.root`，由 main 验证。** 否决。验证退化成「与 main 自己能算出的根是否一致」这一个布尔值，没有带来任何权威性。被攻破的渲染进程同样能从 `inspector.status` 读到那个根，可达文件集完全相同；而诚实的渲染进程反而多出一个失败模式：首帧 `root === ''`，且第四个字段会被严格三键解析器判非法，命令被静默拒绝。

**经既有 loopback RPC（`workbenchInspector/status`）问 harness。** 否决。该调用会在 host 侧跑一次完整的 `git status --porcelain=v2` 且关闭 fsmonitor，实测 110–160 毫秒，大仓库可达数秒。reveal 接受对话里任何形似路径的片段，于是一次无上限、按设计不缓存的只读校验会变成 host 的 CPU 与 IO 放大器。它还会把信任上界抬到「harness 报什么就是什么」，并让 `HarnessApi` 超出它自述的 settings 与 session 范围。

**用 `statSync(...).isDirectory()` 或读 `.git/HEAD` 判标记。** 否决。两者都会拒绝指针文件形态，使所有 worktree 与 submodule 会话保留原缺陷。

**在放宽后的根里排除 `.git`、`.env` 之类路径。** 否决。这种名单不可能完整，只会给出虚假的边界感；该动作打开的是文件管理器选中项而非内容，而既有的「打开资源管理器」按钮加几次点击本就能到达同一目录。固定的安全不变量优于一份会长成可调项的名单。

**为拒绝文案新增 locale 键。** 否决。reveal 刻意不弹对话框，两个调用方都吞掉拒绝，文案永远到不了用户面前；新增字典键会暗示一个并不存在的界面。

## 影响

cwd 位于仓库子目录的会话可以定位该仓库内的任何路径，而这正是改动视图已有的披露范围——同一个 inspector 今天已经在为仓库内每个改动文件提供完整的 `status`、`diff` 与 `text`，每一行还都带「复制路径」。相对改动前真正新增可达的，是该视图并不列出的路径，主要是 `<repo>/.git/**` 与仓库根的点文件，因为 reveal 同时也接受对话里的任意形似路径文本。该动作的爆炸半径是一个资源管理器窗口：目录被打开、文件被选中，内容不会读回页面，也不会执行任何东西。

不属于任何仓库的工作区行为不变，仍只限 cwd 之内；已经开在仓库根的会话同样不变。失败方向保持关闭：`existsSync` 从不抛出，权限故障读作「无标记」；`realpath` 失败则得到 `missing` 或 `outside`。POSIX 上的比较仍逐字节进行，文件系统提供的大小写敏感性得以保留。

## 验证

`vitest run apps/desktop/tests/reveal-target.spec.ts apps/desktop/tests/control-model.spec.ts` —— 原有六条用例一字未改，现在充当「仅 cwd」行为的回归锚；新增用例覆盖就近标记查找、指针文件形态、就近取胜的收窄性质、放宽根之下解析基仍为 cwd、子目录会话定位仓库根文件、仓库之外仍拒绝，以及两个平台族各自的大小写行为。
