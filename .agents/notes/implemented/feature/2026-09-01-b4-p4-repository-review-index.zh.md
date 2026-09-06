# Agent Note：B4-P4 Repository Review & Index——基于 git-diff 事实的 file/hunk stage、unstage 与受控受跟踪 revert

Status: implemented

[English](2026-09-01-b4-p4-repository-review-index.md) | 中文

## 问题

B4-P2 只读投影工作树；B4-P3 增加 worktree 生命周期写入。日常编码需要在 GUI 中管理 index——整体与逐块 stage/unstage 文件，以及还原受跟踪的工作树修改——Git 仍是仓库状态的唯一 owner，没有第二个 Git 数据库，也没有破坏性捷径。每次写入都必须重新读取权威 status，每次 revert 都必须在执行前展示精确目标与将丢失内容，B4 的边界保持不变：绝不删除未跟踪文件、绝不运行 `clean`/`reset --hard`、绝不自动解冲突，Session Changes 面板保持自身事件来源，同时获得进入 Repository Review 的定位入口。

## 决策

### git seam 的 index/revert 写面

`GitCapability`/`LocalGitCapability` 增加四个方法——worktree 生命周期之外 seam 仅有的写入：

- `applyIndexPatch(cwd, patch, reverse)`——`git apply --cached [--reverse] -`，patch 经 subprocess stdin（`{ data: string }`）投递，绝不用 shell 字符串或临时文件。这是 hunk stage/unstage 原语：stage 正向应用 unstaged diff 的 hunk，unstage 反向应用 staged diff 的 hunk，都只动 index。git 自己对照当前 index 验证上下文，因此 stale hunk 或外部变更的 index 以 `GitCommandFailedError` 携带原始 stderr 失败——UI 绝不让失败的 apply 显示为成功。
- `stageFile(cwd, path)`——`git add -- <path>`：整体一个路径，包括未跟踪文件（B4 只拒绝删除未跟踪文件，绝不拒绝跟踪它们）、binary 文件与 rename 两侧（status 的 rename 对指名新旧路径；只 stage 新侧会留下未暂存的删除）。
- `unstageFile(cwd, path)`——自己生成 staged diff（`git diff --cached --binary`，覆盖 rename 两侧）并反向应用到 index：index 回退向 HEAD，工作树不受影响。该机制对文本、binary、rename 与未出生 HEAD 条目一致（无提交的仓库中 staged 的新文件会再次离开 index）。无 staged 变更的路径是 no-op。
- `revertFile(cwd, path)`——`git checkout -- <path>`：从 index 恢复受跟踪的工作树文件，丢弃其未暂存修改，staged 变更保持 staged。未跟踪路径与未合并冲突条目以 `GitRevertRefusedError` 预先拒绝（对照权威 status 检查）；git 自己的拒绝是兜底。

`diff` 请求的 patch 现在带 `--binary`，binary 文件因此产出 index 操作可再应用的字面 patch；文本 patch 与普通 `git diff` 输出逐字节一致。

### wire 域：每次写入都以新鲜权威 status 应答

`git.applyPatch`、`git.stageFile`、`git.unstageFile` 与 `git.revertFile` 各自经能力执行写入，然后重新读取 `git.status` 并返回它——「每次写入后重新读取 Git authoritative state」在宿主侧强制实现，面板渲染写入自身的响应而非过期快照。失败的写入返回原始错误（带 stderr 的 `git-command-failed`，或带 `{ path, reason }` 的新码 `git-revert-refused`）。connection fixture 与两个测试 fake-API 客户端以小型可变 index 镜像复刻该域。

### Repository Review UI：按类别的操作、hunk patch、revert 确认

Repository Changes 面板按条目类别提供操作：未跟踪 → 仅 Stage；纯未暂存 → Stage + Revert；纯已暂存 → Unstage；部分暂存（`MM`，porcelain v2 单条记录）→ Stage（补全）+ Unstage；冲突 → 无任何操作。

逐文件 diff 由纯函数（`splitDiffHunks`）切成 header 加 hunks，保留 patch 的行字节；每个 hunk 带 Stage/Unstage-hunk 按钮，点击重组 `header + hunk` 并发送给 `git.applyPatch`——应用的字节就是 git-diff 事实本身，绝不是重建文本。`--binary` patch（无 `@@` hunk）渲染时不带 hunk 按钮。

Revert 打开确认对话框，展示精确目标路径与当前 unstaged diff（将丢失的内容）；取消绝不调用 wire，确认执行受控 revert。每次成功写入后面板采用返回的 status 并重载选中文件的 diff。

### Session Changes 定位入口

Changes 面板（会话事件来源，不变）的每个分组新增「定位」按钮，向小型共享 store（`createRepoLocateStore`，apply 内 changes 与 repo 两个注册共享一个 handle）写入 `{ path, seq }`。Repository Changes 面板在挂载时（用户切到 Repository 标签）消费请求：按 git 风格拼写把路径与 `repoRoot + entry.path` 匹配，打开该条目的 diff 并清除确认。事件绝不重新归属；请求是同一会话内的导航辅助，刻意不持久化。

## 验证

- `packages/git/git-local/tests/index-ops.spec.ts`（10 个，真实临时仓库）：部分 stage（双 hunk 修改暂存一个 hunk 使 index 走一半；权威 status 显示单条 `MM` 记录，staged/unstaged diff 各自只携带自己的 hunk）；staged hunk 的反向 unstage；stale hunk（patch 基于旧快照计算期间 index 前进 → `GitCommandFailedError`，无半应用）；unstage 期间的外部并发（重读 status 反映外部编辑）；rename（工作树移动读作 deleted + untracked，暂存两侧后产生 staged rename，unstage 撤销两侧 index）；binary stage/unstage；untracked stage 与未出生 HEAD unstage；垃圾与 stale 上下文 patch 拒绝；受跟踪 revert（丢弃 unstaged、保留 staged）；未跟踪与冲突 revert 拒绝且冲突标记原样保留；no-op unstage。所有 patch 字节来自真实 `git diff` 捕获（B4-P2 评审纪律）。
- `packages/host/apiproxy/tests/api-proxy-git.spec.ts`（8 个，真实 gateway + 真实仓库，含 B4-P4 块）：经 wire 的 hunk stage 与新鲜 status 响应、整体文件 stage/unstage（含未跟踪）、失败/stale apply 错误码、revert 拒绝/确认路径。
- `apps/desktop/workbench-plugin/tests/diff-hunks.spec.ts`（4 个）：保行切分、hunk 重组、无 hunk 的 header、`+@@` 内容行、越界安全。
- `apps/desktop/workbench-plugin/tests/git-client.spec.ts`（扩展）：四个写方法的信封、新鲜 status 返回与失败错误码。
- `apps/desktop/workbench-plugin/tests/repo-changes-view.client.spec.tsx`（jsdom，扩展）：按类别操作按钮（冲突行无任何按钮）、文件 stage/unstage 调用、发送 `header + hunk` 的 hunk stage、展示目标与将丢失内容的 revert 确认（取消绝不写入、确认执行 revert）、失败 apply 错误显示、定位请求消费。
- `apps/desktop/workbench-plugin/tests/changes-view.client.spec.tsx`（jsdom，适配）：定位按钮把精确路径交给 store；面板事件来源不变。
- 机器说明：上一阶段的发现仍然成立——开发机主目录含误入的 `.git`，测试继续用 `GIT_CEILING_DIRECTORIES` 覆盖「仓库之外」场景。

## 备选方案

**交互式 `git add -p` / `git reset -p`。** 这些是终端交互式工具，会解析进程 TTY；GUI 需要非交互、基于事实的机制。基于 git-diff 字节的 `git apply --cached` 就是该机制，git 自己的上下文验证取代任何手写 staleness 检查。

**用 `git reset -q HEAD -- <path>` unstage。** 简单，但在未出生 HEAD 上失败（没有 HEAD 可重置），且对 rename 对处理不完整；反向应用自生成的 staged diff 以单一机制覆盖文本、binary、rename 与未出生 HEAD。

**用 `git checkout -f` / `git reset --hard` 做 revert。** 这些会同时丢弃 staged 与 unstaged 修改，且可能波及目标路径之外；受控 revert 只从 index 恢复，并在询问 git 之前就拒绝未跟踪与冲突路径。

**自动解冲突或删除未跟踪文件。** 两者都是对用户意图的破坏性猜测；B4 保留冲突标记原样，绝不提供未跟踪文件删除。

## 后果

Repository Changes 面板现在端到端管理 index：file/hunk stage/unstage、带显式确认的受控受跟踪 revert，以及每次写入后的新鲜权威 status。git seam 的写入词汇封闭且有界——任何地方都没有 commit、push、`clean` 或 `reset --hard`——其读模型失败分类原样延续。Session Changes 面板获得定位入口而不改变事件来源。B4-P5 的 commit 流程建立在同一 staged-review 界面上。
