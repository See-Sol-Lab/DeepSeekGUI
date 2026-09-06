# Agent Note: B4-P7 Task Actions, Services & Terminal —— 任务根目录进程、唯一 owner 与脱敏输出

Status: implemented

[English](2026-09-02-b4-p7-task-actions-services-terminal.md) | 中文

## Problem

B4-P5 能跑一次性验证命令，但任务的日常编码闭环还缺三块：可锚定到任务工作目录的终端、带诚实进程事实的长驻项目进程，以及只打开任务所声明地址的浏览器。两个 worktree Task 绝不能串 cwd；一个服务只能有一个 owner（stop、app quit 与 Task archive 都走同一条 kill → await exit 清理）；stop/crash/quit/archive/cancel 任何路径都不留孤儿进程；项目输出过线前必须脱敏，项目进程的环境里绝不能出现 Harness 凭据。

## Decision

### Task Terminal：锚定任务工作目录的桌面终端

新增封闭控制命令 `show-task-terminal { taskId }`，在任务工作目录打开既有 DSH Terminal。浏览器只送 taskId；main 从权威 `task.get` 解析 workdir（桌面最小 Harness RPC 客户端新增严格解析的 `taskGet`）——绝不接受浏览器路径，与 Session Terminal 的规则一致。`openDshTerminal` 增加可选的任务 cwd 覆盖：解析出的目录仍存在时，pty host 的 `DEEPSEEKGUI_TERMINAL_CWD` 指向它，welcome 如实说明 cwd 跟随任务；任务缺失/不可解析时与托盘入口同语义回退 Profile/Home 链——绝不猜路径。Session Terminal 不受影响：`show-terminal { sessionId }` 仍经 `session.list` 解析。

### Project Services：受控定义 + 进程 owner 的运行态

`TaskRecord` 增加 `services`——用户的显式服务配置，每条是 exact `{ name, executable, argv, cwd?, port?, url? }`（wire 校验：port 1–65535；`url` 必须是绝对 loopback http(s) URL，`isLoopbackHttpUrl` 在 wire 边界把关）。`setServices` 整体替换并持久化；记录里绝不存放运行态。

运行态在网关的运行表里（`serviceRuns`：runId → subprocess handle + task/service 身份 + startedAt + 声明的 port/url + 结算事实），与任务记录无关。`task.startService` 明确拒绝 `service-not-found`、`service-already-running`、`service-port-conflict`（网关内另一运行中服务声明了同一端口）、`service-port-busy`（对单个声明端口做一次性 loopback 探测——不是扫描——发现端口已被本机占用）；同步 spawn 失败解析为带错误事实的 `exited` run（pid −1 的 handle 会等到结算事实再应答），绝不假装成功。`task.stopService` 先终止进程树、再 await 退出才应答——kill → await exit。`task.serviceRuns` 按服务名投影最新 run，运行中在前。`task.serviceStream` 是 SSE 路由，流式输出并以一条 done 帧携带退出事实收尾。

与验证运行的决定性差异：**关闭服务流只 detach**——面板关掉后 dev server 继续跑（验证流关闭即取消）。服务只通过四条路径结束：用户 stop、Task archive（archive 处理器在翻转记录前先跑 `stopServicesOfTask`——kill → await exit）、Harness stop（subprocess seam 的 dispose 终止全部托管树并 await 退出）、app quit（桌面本就 await Harness 进程树退出）。没有 supervisor、没有自愈重启、没有通用进程编排层。

### Browser：只打开已声明服务 URL

新增封闭命令 `open-service-url { taskId, url }` 导航内置浏览器面板。main 先核对 URL 确实是该任务的已声明服务 URL（出现在某条服务定义的 `url` 字段里，读取自权威 `task.get`），再过第二道 loopback 检查（`isLoopbackServiceUrl`），然后才 `loadURL`。不扫描端口、不猜服务、不推断任意后台进程；失败经控制桥 500 拒绝，Tasks 面板内联显示原因。面板导航仍走既有 SSRF proxy 规则。

### 进程 owner 处的脱敏与环境

项目进程经 subprocess seam 拉起，其 `scrubbedParentEnv` 本就剔除凭据形态的环境名（`KEY`/`PASSWORD`/`SECRET`/`TOKEN`）与全部 `DSH_*` 变量——Harness 凭据不会进入任何项目命令的环境。输出在网关内、过线前脱敏：新增流式脱敏器（`task-stream-redact.ts`，每流一个实例，chunk 边界按流隔离）替换敏感父环境条目的字面值 + 凭据形态 token（`sk-`、`gh*_`、`xox*`、`AKIA`、`Bearer`、URL userinfo、`KEY=value`）。token 模式刻意带词边界与长度下限：`task-service-…` 里的 `sk-`、短的 `key=undefined` 绝不能被打码误伤。验证流与服务流都应用同一脱敏，且都在 done 帧前 flush 扣留尾巴——短运行的输出一行不丢。

## Verification

- `packages/host/apiproxy/tests/api-proxy-task.spec.ts`（B4-P7 块，真实网关 + 真实仓库 + 真实进程）：setServices 跨重启持久（只有配置、绝无运行态）；启动返回完整进程 owner 事实（pid/command/cwd/startedAt/port/url），stop 先答 `stopped`、对已结算 run 答 `false`；真实服务流式输出 stdout/stderr 与 done 退出事实；**关闭流后服务仍在运行**（runs 列表仍显示 `running`）；端口冲突——另一运行中服务（`service-port-conflict`）与外部监听者（`service-port-busy`）；缺失可执行文件解析为带错误事实的 exited run；凭据剔除（子进程打印 `key=undefined`）+ 字面量与形态 token 脱敏（绝不出现 `sk-…`，恒为 `<redacted>`）；两个 worktree Task 的服务进程各自打印自己的 cwd、绝不打印对方的；archive 杀掉并等待运行中服务。
- `packages/host/apiproxy/tests/task-stream-redact.spec.ts`（5 条）：token 脱敏；无误伤用例（`task-service-cwd-a-9Ns44I`、`desk-scan`、`key=undefined`、`PORT=8080`）；凭据字面值脱敏；`collectSensitiveEnvSecrets` 只收集凭据形态条目；单字符切块永不吐出半个未脱敏 secret。
- `apps/desktop/tests/control-model.spec.ts`：两条新封闭命令严格解析（缺字段/空串/多余字段整条拒绝）与 `isLoopbackServiceUrl`（只认 loopback http(s)）。
- `apps/desktop/tests/harness-api.spec.ts`：`taskGet` 信封、workdir 与已声明服务 url 的严格解析、坏形状 fail closed。
- `apps/desktop/tests/control-dispatch.spec.ts`：路由到注入出口；`open-service-url` 错误向上传播（桥 500 路径）。
- `apps/desktop/workbench-plugin/tests/task-client.spec.ts`（7 条新增）：五个 RPC 动词与 SSE 服务流解析。
- `apps/desktop/workbench-plugin/tests/tasks-view.client.spec.tsx`（8 条新增）：带端口/URL 保存服务定义；渲染进程 owner 事实与运行态按钮；stop；start；端口冲突错误内联；Task Terminal 桥命令只带 taskId；浏览器桥命令带已声明 URL；桥失败内联显示。

## Alternatives considered

**服务由桌面进程持有。** Harness 网关本就持有 subprocess seam 与任务记录；桌面侧注册表需要第二条跨进程协议才能做 archive 时清理。运行表放在验证运行表旁边，archive、流、脱敏同处一屋；app quit 继承桌面本就 await 的 Harness 进程树清理。

**端口冲突交给"服务自己失败、用户读输出"。** 服务会打印自己的 bind 错误，但用户先看到一张困惑的"运行中"卡片。spawn 前的一次性 loopback 探测把拒绝变成显式、带类型的 `service-port-busy`；探测只针对单个声明端口、不是扫描，探测→spawn 的竞态窗口已写入文档——服务自己的 bind 失败仍会从其真实输出浮现。

**只做形态脱敏。** 字面环境值（形状不寻常的自定义 `DEEPSEEK_*` 或用户 key）会漏过模式匹配；从 scrub 拒绝转发的同一批环境名做字面量替换补上这个洞，8 字符下限保证短环境值不被过度打码。

## Consequences

每个任务现在都有锚定自己 workdir 的终端、带 pid/port/command/cwd/startedAt 并流式输出（已脱敏）的显式服务定义，以及只打开已声明 loopback URL 的浏览器。每条清理路径（stop、archive、Harness stop、app quit）都 kill 并 await；流 detach 永不杀进程；没有任何东西自愈重启。任务记录只多一个配置字段、零运行态；wire 多五个 task 方法、两条 SSE 路由、四个错误码与两条封闭控制命令；桌面 Harness 客户端多一个严格读取器。
