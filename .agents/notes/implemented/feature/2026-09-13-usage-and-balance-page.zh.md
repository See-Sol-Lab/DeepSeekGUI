# Agent Note: 从开放平台登录态读取的「用量与余额」页

Status: implemented

[English](2026-09-13-usage-and-balance-page.md) | 中文

## 问题

用户在应用内看不到自己的 DeepSeek 账户花了多少、还剩多少。开放平台自己的数字是唯一可信的来源——本地统计会与账单漂移、重装即丢、还要维护——但它的用量接口（`users/get_user_summary`、`usage/by_api_key/amount`、`usage/by_api_key/cost`）需要该站的登录 cookie、存在该 origin `localStorage.userToken` 里的 Bearer 令牌和 WAF 令牌，这些主进程既没有也不该持有。社区有一个余额插件，但会把取数和凭据放到我们控制之外。

## 决策

官方设置页里第五个 DeepSeekGUI 分区「**用量与余额**」，由设置插件与现有四个分区一起注册、走同一条回环控制桥。`apps/deepseekgui/src/usage-service.ts` 拥有数据规则：`planUsageFetch` 按当前时刻与本机 UTC 偏移算出三个窗口（含今天的 30 天、再往前的 30 天给热力图、今天单独一窗——同一天的窗口平台按小时分桶）；`buildUsageFetchScript` 生成页内脚本：读 `localStorage.userToken`，以 `credentials: 'include'` 加 Bearer 头发五个同源请求，只返回状态码与以 `USAGE_BODY_MAX` 截断的正文；`judgeUsageResponse` 只在 HTTP 200、`code` 为 0 且 `data.biz_data` 存在时认成功，HTTP 401 或 `code` 40002 视为未登录，其余——包括平台的 HTTP 200 + `code: 0` + `INVALID_PARAM`——一律算格式失败；`interpretUsageResult` 聚合成 `UsageData`（余额、大于零的赠金钱包、累计消费、今天 / 7 天 / 30 天切片、固定 60 项按本地日期归并的热力图，重叠日以 30 天页为准）。金额全程是十进制字符串：相加用 BigInt 的 `addDecimalStrings` 并保留最长小数位，零是真实值，页面展示时截断到两位。

`apps/deepseekgui/src/usage-pane.ts` 是唯一依赖 Electron 的部分：先查浏览器 pane 的 partition 有没有任何 `deepseek.com` cookie（没有 → 未登录、不联网），再在该 partition 上开一扇不显示的 `BrowserWindow`，加载同源探针 `/api/v0/`（22 字节的 JSON 404；一切非 API 路径都被 SPA fallback 接管，`robots.txt`、`favicon.ico` 都会拉起整个应用），执行脚本，所有退出路径都销毁窗口，总时限 45 秒。`apps/deepseekgui/src/usage-control.ts` 持有唯一的 `UsageView` 状态：`refresh(trigger)` 在冷却期内忽略触发，只允许手动触发接管跑了超过一个冷却期的进行中轮次，中止被接管的轮次并按代次丢弃其结果，刷新中保留上一次数据（标注 `fetchedAt`），未登录或失败时整体清空，绝不把旧值当实时值。分区挂载、main 的启动定时器与🔄按钮是仅有的三个触发点，没有轮询。分区读 `model.usage`，发送 `usage-refresh { trigger }`、`usage-open-sign-in`（在浏览器 pane 里加载平台登录页并弹出）以及既有的 `open-external-link` 打开官方用量页；界面文案在插件的 zh/en 字典里。

## 考虑过的替代方案

**主进程拷一份 token 自己请求。** 不采用：WAF 与 cookie 要求让它脆弱，把 token 拷出浏览器 session 也会造出第二个凭据持有者。

**社区余额插件。** 不采用：凭据流程与维护都会归它所有；账户这几个数字小到可以直接取。

**从会话日志做本地用量统计。** 按产品裁决不采用：平台自己的数字就是账单，零维护，重装不丢。

**轮询或常驻隐藏页面。** 不采用：每次刷新一扇短命隐藏窗口有界且可观察；三个触发点已覆盖用户想知道的时刻。

**让浏览器 pane 的 partition 持久化以便登录跨重启。** 本次不改：pane 的内存态 partition 是「cookie 不落盘」的既定决策；冷启动触发在用户另作决定前降级为未登录。

## 后果

用户每次运行登录一次就能看到真实的余额、消费与活动；token 与 cookie 留在浏览器 pane 的 session 里，设置页从不接触，api key 名称也不出 main。每次刷新花五个请求和一扇短命隐藏窗口；失败降级为一句说明加官方页入口。单元覆盖（`usage-service.spec.ts`、`usage-control.spec.ts`）驱动了计划窗口、脚本、包裹判定、十进制相加、按真实响应形状的聚合、未登录 / 超时 / 格式 / 网络分支、陈旧响应丢弃与冷却；隐藏窗口路径与真实登录态只能在运行中的应用里验证，在用户授权该项检查之前一直列为待验。
