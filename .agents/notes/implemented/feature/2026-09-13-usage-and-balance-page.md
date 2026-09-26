# Agent Note: Usage and balance page from the open-platform login session

Status: implemented

English | [中文](2026-09-13-usage-and-balance-page.zh.md)

## Problem

Users had no view of what their DeepSeek account had spent or how much balance remained without leaving the app. The open platform's own figures are the only trustworthy source — a local tally would drift from the bill, disappear on reinstall, and need maintenance — but its usage endpoints (`users/get_user_summary`, `usage/by_api_key/amount`, `usage/by_api_key/cost`) require the platform's login cookie, a Bearer token held in that origin's `localStorage.userToken`, and a WAF token, none of which the main process holds or should hold. A community balance plugin exists but would put the fetch and the credential outside our control.

## Decision

A fifth DeepSeekGUI section in the official settings page, **Usage & balance**, registered by the settings plugin beside the existing four and driven through the same loopback control bridge. `apps/deepseekgui/src/usage-service.ts` owns the data rules: `planUsageFetch` derives three windows from the current time and the machine's UTC offset (30 days including today, the 30 days before that for the heatmap, and today alone, whose same-day window the platform buckets hourly); `buildUsageFetchScript` renders the in-page script that reads `localStorage.userToken`, fetches the five same-origin requests with `credentials: 'include'` and the Bearer header, and returns only status codes and bodies capped at `USAGE_BODY_MAX`; `judgeUsageResponse` accepts a response only when HTTP 200, `code` 0 and `data.biz_data` present, treats HTTP 401 or `code` 40002 as signed out, and everything else — including the platform's HTTP 200 + `code: 0` + `INVALID_PARAM` — as a format failure; `interpretUsageResult` aggregates into `UsageData` (balances, positive bonus wallets, total costs, today / 7-day / 30-day slices, a fixed 60-entry heatmap merged by local date with the 30-day page winning overlaps). Money stays a decimal string end to end: sums use `addDecimalStrings` over BigInt with the longest scale, zero is a real value, and the page truncates to two places for display.

`apps/deepseekgui/src/usage-pane.ts` is the only Electron-bound piece: it checks the browser pane partition for any `deepseek.com` cookie (none → signed out with no network), opens a hidden `BrowserWindow` on that partition, loads the same-origin probe `/api/v0/` (a 22-byte JSON 404; every non-API path is served by the SPA fallback, so `robots.txt` or `favicon.ico` would boot the whole app), executes the script, and destroys the window in every exit path with a 45 s ceiling. `apps/deepseekgui/src/usage-control.ts` holds the single `UsageView` state: `refresh(trigger)` ignores triggers during a cooldown, lets only a manual trigger take over an in-flight round older than the cooldown, aborts the superseded round and drops its result by generation, keeps the previous data visible while loading (stamped with `fetchedAt`), and clears everything on sign-out or failure so no stale figure is shown as current. The section's mount, main's startup timer and the 🔄 button are the only three triggers; nothing polls. The section reads `model.usage` and sends `usage-refresh { trigger }`, `usage-open-sign-in` (loads the platform sign-in page in the browser pane and reveals it) and the existing `open-external-link` for the official usage page; UI copy lives in the plugin's zh/en dictionaries.

## Alternatives considered

**Fetching from the main process with a copied token.** Rejected: the WAF and cookie requirements make it fragile, and copying the token out of the browser session would create a second credential holder.

**The community balance plugin.** Rejected: it would own the credential flow and its maintenance; the account figures are small enough to fetch directly.

**Local usage accounting from session logs.** Rejected by the product ruling: the platform's own numbers are the bill, need no upkeep, and survive reinstalls.

**Polling or a resident hidden page.** Rejected: a hidden window per refresh is bounded and observable; the three triggers cover what a user wants to know.

**A persistent browser-pane partition so the login survives restarts.** Not changed here: the pane's in-memory partition is a standing decision about cookies not touching disk; the cold-start trigger degrades to signed out until a user decides otherwise.

## Consequences

Users see their real balance, spend and activity with one sign-in per app run; the token and cookies stay in the browser pane's session, the settings page never sees them, and api-key names never leave main. Each refresh costs five requests and one short-lived hidden window; failures degrade to a message plus the official page. Unit coverage (`usage-service.spec.ts`, `usage-control.spec.ts`) drives the plan windows, the script, the envelope judgement, decimal sums, aggregation with the real response shapes, sign-out / timeout / format / network branches, stale-response discard and cooldown; the hidden-window path and the real signed-in platform are verified only in the running app and stay listed as pending until a user authorises that check.
