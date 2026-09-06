# Agent Note: B5-P2 — launcher overlay relocation and one-shot token alignment

Status: implemented

English | [中文](2026-09-03-b5-p2-overlay-relocation-and-token-alignment.zh.md)

## Problem

DeepSeekGUI launches Harness with five launcher overlays passed as `--patch` layers (theme, picker, settings, browser, workbench — never written into a user profile). dsh 0.1.2 replaced the 0.1.1 client runtime, reshaped client module/slot contracts, and introduced one-shot launch-token authentication for the entry page, the HTTP API, and the WebSocket channel. Each overlay had to re-land on the 0.1.2 modules and the desktop had to carry the token through its own launch path.

## Decision

- **workbench-plugin** re-lands on the 0.1.2 client modules: `@deepseek-ai/dsh-client-runtime` imports (removed upstream) move to the split 0.1.2 type merges — `Context` from `@deepseek-ai/cordis`, `ctx.slots` from `ui-renderer`, `ctx.locale` from `client-locale`, `ctx.sessions` from `api-session-controller`, `SessionId` from `dsh-session/types`; the tsconfig references and the `tsconfig.client.json` aggregate entry return, and the `dsh.client.inject` metadata names the 0.1.2 provider packages. Its registered slots (`sidebar.brand.mark/name`, `conversation.hero.brand.mark`, `conversation.session.header.actions`, `sidebar.footer.action`) all exist under the same names in 0.1.2.
- **theme-plugin** (hand-written `__ModuleLoader__` artifact, product source): the 20 `--dsh-*` typography hooks of the 0.1.1 CSS no longer exist in 0.1.2 (the official reworked its type scale — which migration requirement 7 adopts as authoritative), so those overrides are removed; the 0.1.2-present `--dsw-*` alias-token overrides (transparent base, glass sidebar, approval blues, light user-bubble) stay. `inject ['theme']` / `ctx.theme.overrideTokens` are unchanged in 0.1.2.
- **settings-plugin** (hand-written artifact) needs no change: its `settings.section` and `conversation.session.header.utilities` registrations, register options (id/order/label/locale), and `props.t` locale seat match the 0.1.2 contracts verbatim.
- **browser-plugin** joins `pnpm-workspace.yaml` as a member: under pnpm's non-hoisted layout its runtime imports (`@deepseek-ai/dsh-tools` et al.) cannot resolve from a profile-side junction alone; the launcher `--patch` host row then loads cleanly in 0.1.2.
- **picker-plugin** stays packaged-only (its defect is packaged-state specific): the overlay's `disabled: true` target row id `directory-picker` still exists in the 0.1.2 web-app bundle, and the artifact's seam (`DirectoryPicker` subclass, native capability) matches the 0.1.2 `@deepseek-ai/dsh-host-directory-picker` API. Whether the official Windows picker fix makes the patch removable is a packaged-state acceptance item handed to B5-P9 (dev mode cannot reproduce the koffi/Electron realm crash).
- **Launch authentication (desktop)**: stdout is decoded as complete lines, the launch token stays in memory, and logs/console receive redacted text. Before navigation the desktop exchanges the token for the official cookie and installs it in the Electron session; the page URL carries only the desktop bridge parameter. The Node API client uses the same cookie. Each service spawn clears both credentials. This avoids losing the bridge during the official token redirect.

## Alternatives considered

- Keep the B4 self-drawn overlays on the official page and migrate the APIProxy surface in place (prolonged double-tracking of one feature across two planes); rejected in favor of relocating the overlays into the launcher patch layer in one move.
- Give the desktop page a persistent session by injecting credentials directly instead of exchanging a one-time token over the service stdout (wider credential surface); rejected in favor of the one-shot stdout token plus cookie exchange.
- Write the overlays into the user profile manifest (pollutes user assets, needs uninstall cleanup); rejected in favor of the launcher `--patch` layer that leaves no profile trace.

## Verification

- Electron smoke (`DSH_DESKTOP_SMOKE=1`, isolated `--user-data-dir`): the window loads the token URL, the official UI mounts, and the theme overlay's client settle marker applies — one composition round proves the theme/settings/workbench client rows load and their slot registrations resolve. Exit 0.
- A live 0.1.2 service launched with the theme/settings/browser/workbench `--patch` layers boots with no loader errors; the authenticated `settings/describe` and `session/list` RPCs return `ok:true` through the token→cookie flow.
- Desktop specs: 37 files / 841 tests pass (including the new `harness-auth.spec` and the updated `dsh-service.spec`); `tsc -b apps/desktop` and `tsc -b apps/desktop/workbench-plugin` are clean; the workbench apply/bridge specs pass.

## Consequences

- The five overlays carry no 0.1.1-runtime imports; the only packaged-state gate left is the picker decision, owned by B5-P9 with an exact acceptance step in the P2 delivery report.
- jsdom component specs (workbench brand/desktop-actions, official client packages alike) still fail repo-wide on a React production-build resolution issue in this environment; it predates B5-P2 and is not part of this phase's diff.
