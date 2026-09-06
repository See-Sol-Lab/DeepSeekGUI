# Agent Note: B3-P1 Direct Composition Spike — the Workbench product plugin

Status: implemented

English | [中文](2026-08-31-b3-p1-direct-composition-spike.zh.md)

## Problem

DeepSeekGUI V1 is a desktop wrapper around the official DSH Web UI. Its own identity stops at build-time brand injection (`DSH_CLIENT_BRAND_NAME`, see `scripts/build-web-branded.ts`) and the four launcher overlays (theme, picker, settings, browser). None of these proves that a DeepSeekGUI-authored product plugin can ride the official client-runtime and UI state machines to complete a real Session path. The B3 Workbench requires that proof before any own interface work: without it, B3-P2+ would risk building a second client framework, which the B3 foundation explicitly forbids.

## Decision

`apps/desktop/workbench-plugin/` ships as the first DeepSeekGUI Workbench product plugin (`@see-sol-lab/deepseekgui-workbench`), keeping TypeScript/React sources and a normal build. It enters the composition through a launcher `--patch` overlay (`deepseekgui-workbench.patch.yml`, the fifth overlay in `resolveDshLaunch`), exactly like the theme and settings plugins: resolvable from the profiles module fallback via `ensurePluginResolvable`, never written into any Profile manifest, invisible to a plain `dsh web` run, zero residue on uninstall.

The plugin registers exactly two things, both through the official slot system (`ctx.slots.inject` on slots declared by `ui-sidebar` / `ui-conversation`):

- the DeepSeekGUI brand: `sidebar.brand.mark`, `sidebar.brand.name`, `conversation.hero.brand.mark`;
- one visible Workbench marker: `conversation.session.header.actions` id `deepseekgui-workbench` (order `-10`, static identity preceding interactive actions).

It registers no services, routes, RPC, or state. Workspace selection, Session create, prompt, streaming, Tool cards, and resume all stay on the official `ui-layout` / `ui-sidebar` / `ui-workspace` / `ui-conversation` / `ui-tool` stack over the one Harness runtime. The client bundle is built from `lib/types/client/index.js` by a package-local tsdown config (same artifact contract as the official `clientBundle` preset: `window.__ModuleLoader__.load({ id, factory })`, module-table externals through the loader require) because the preset's workspace-manifest scan only covers `packages/*/*`. `build:desktop` compiles the plugin (`tsc -b` adds `apps/desktop/workbench-plugin`) and emits the bundle; `build-desktop-dist.ts` ships it through `shipWorkbenchPlugin` and asserts the non-empty `lib/client.js` at packaging time.

## Alternatives considered

**Hand-written `lib/client.js` like theme/settings.** The existing plugins prove the shape, but the B3 code-ownership rule requires TypeScript/React sources and a normal build for product plugins; a large hand-written bundle is not a long-term source.

**Living in `packages/client/`.** That would satisfy the official preset's workspace scan, but the B3 foundation assigns DeepSeekGUI product code to `apps/desktop/workbench-plugin` under `@see-sol-lab/*`; generic DSH capabilities are what belong in `packages/`.

**Reusing `clientBundle` from `packages/client/tsdown.client.ts`.** Its `workspaceManifest()` globs `packages/*/*/package.json` and throws for any other location, so a plugin under `apps/desktop/` cannot use it without widening the preset for one caller.

**Registering through the control bridge or the chrome.** The brand slots are the official additive extension point for exactly this; the session-header marker is the additive per-session seat. No new host RPC is needed, and none was added.

## Consequences

The generic brand slots are now occupied in DeepSeekGUI compositions (the official occupants only register under the `official` build profile, so there is no conflict). A missing or unbuildable workbench plugin degrades to the plain official UI rather than failing boot — the same "解析不了就不带 overlay" rule as the other four overlays. The client settle gate in `main.ts` still treats a failed DeepSeekGUI client plugin as a boot failure, so a hollow ship fails loud instead of silently losing the brand. Development now has one more build step before `dev:desktop` picks up plugin changes (`pnpm run build:desktop`); the plugin's own tests and the `dsh-service` overlay tests pin the launcher wiring.
