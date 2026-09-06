# Agent Note: B3-P2 Workbench Shell — desktop actions and the built-in plugin source

Status: implemented

English | [中文](2026-08-31-b3-p2-workbench-shell.zh.md)

## Problem

B3-P1 proved a DeepSeekGUI product plugin can ride the official client stack. The Workbench still lacks its daily shell: an ordinary user has no in-page entry to the desktop tools (Terminal, Browser Panel, Compatibility View) and no visible Harness status inside the official UI — those live only in the tray and chrome. At the same time, the plugin manager shows only the three inventory classes (profile bundles, installed dependencies, loader facts); the five launcher-overlay plugins DeepSeekGUI ships are invisible to it, so a user can try to install one again — a duplicate entry for something already built in.

## Decision

Two additions, both on existing seams.

**Workbench desktop actions** (`apps/desktop/workbench-plugin`): the plugin registers the official `sidebar.footer.action` list slot (id `deepseekgui-desktop`) with a `DesktopActions` cluster — DSH Terminal (`show-terminal`), Browser Panel (`browser-pane-toggle`), Compatibility View (`open-compatibility-view`) and the live Harness status. The status keeps the existing 2s request cadence but sends the last control-model revision through `/control/model?since=`; an unchanged tick carries only `{ revision, changed: false }` and does not update React state. The Terminal action carries the official current Session id, never a browser-supplied path. All commands go through the existing loopback control bridge, the same closed union as the Chrome menus and tray; no second command bus. The component reads the bridge from the page URL (`deepseekgui-control`), so an external browser tab renders nothing. The cluster carries zh/en copy through the plugin's own `deepseekgui.workbench` locale namespace and renders a rail icon set when the sidebar is collapsed.

**Compatibility View** is a real switch, not a second runtime: `open-compatibility-view` / `open-workbench` commands (added to the closed command union) flip the in-memory `workbenchViewMode` and restart Harness through the existing controller path, with the existing disrupt confirmation while running. `resolveDshLaunch` skips the workbench overlay in compatibility mode, so the same profile boots as the official DSH Web UI; the tray menu shows the way back (and the way over). The mode is deliberately not persisted — the app reopens into Workbench.

**Built-in plugin source (B3-13)**: `plugin-service.ts` declares `BUILTIN_PLUGIN_NAMES` (the five `@see-sol-lab/deepseekgui-*` packages), marks same-named bundles/dependencies `builtin` in the inventory, and rejects `add`/`update` of a built-in name (`remove` stays allowed — a manually installed copy can be removed; the overlay is unaffected). The control model carries the built-in list, and the settings plugin renders it as a read-only "Built into DeepSeekGUI" block with a "built-in" tag, plus an explicit hint (and disabled run button) when the add spec names a built-in package.

## Alternatives considered

**New global header slot for the actions.** The official `ui-layout` declares no global header hole, and B3-P2 forbids a DeepSeekGUI-private UI registration system; the sidebar footer list is the existing root-scoped additive seat, and it degrades to the 56px rail in narrow windows.

**Compatibility View as an external browser tab.** It would not be the official interface: the overlay is part of the server composition, so the same URL in a system browser still shows the Workbench plugin. Only a restart without the overlay gives the real official UI, and the spec explicitly permits restarting through the existing controller and confirmation paths.

**Persisting the view mode in launcher state.** The B3 spec says v1 need not persist the choice and the app reopens into Workbench; a memory flag keeps launcher-state schema untouched.

**Making the built-in list a separate model section.** The built-in plugins are not profile facts (the three inventory classes stay untouched); the read-only block and the builtin flags on same-named entries show the true source without inventing a fourth class.

## Consequences

The sidebar footer now carries three desktop entries plus status; a closed sidebar keeps them as rail icons. Switching views interrupts running work exactly like a restart — hence the same confirmation gate. Compatibility mode is a plain official UI: no brand, no actions, no settings sections (those are also overlay plugins); the tray is the return path. The plugin manager can no longer install a built-in package by name, and the read-only block names all five. `main.ts` gains one memory flag and two command cases; no launcher-state, profile, or vendor change.
