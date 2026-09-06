# @see-sol-lab/deepseekgui-workbench

English | [中文](README.zh.md)

DeepSeekGUI's Workbench product plugin (B3-P1 Direct Composition Spike; B3-P2 Workbench Shell; B5-P1 remounted on the official 0.1.2 client modules after the B4 conversation-view tabs and their APIProxy RPC surface were retired; B5-P5 added the tool-result cards; the 2026-09-06 acceptance rework replaced the header inspector popover with four conversation views). It registers the DeepSeekGUI brand into the official browser-brand slots, one visible Workbench marker into the session header, an invisible desktop poll into the sidebar footer seat, keyed tool-result cards for the DeepSeekGUI coding tools and browser tools, and four views — Changes, Git, Worktrees, Memory — beside the official Chat and Trajectory tabs. Everything else — the conversation, tool cards, Workspace and Session navigation, streaming — is the official DSH web client, unchanged.

The browser half renders official Harness facts without a second runtime. The views query the read-only workbenchInspector Remote on opening or refresh; leaving a view cancels the read. They display only: the sole desktop actions are revealing a file, copying its path, and opening the workspace in the system file manager. Commit, push, branch, and work-tree writes are conversation requests, where the assistant asks first and the official approval gate applies. Card forms send plain text through the official Session queue without changing the composer draft or attachments. The host contributes the DeepSeekGUI guide (a shipped asset: where the model runs, how the desktop tools are meant to be used, how to write paths, and the memory rules; no user-facing entry) together with two flat memory files — `memory.md` under the DSH home and `<folder name>.memory.md` in the project — captured once per loaded Session and recorded through official context events; the global file is edited on the Settings page (settings-plugin), the project file is shown in the Memory view. The user-editable rules live in the AGENTS.md files the official agent-instructions plugin loads; the desktop seeds the managed home with a template on first run and writes a project template only on request, never overwriting either. On Windows the host half also anchors a hidden console for the Harness process when it has none (the Electron host is a GUI-subsystem process): the official sandbox lets tool children share the host console rather than create their own, so without an anchor every sandboxed pwsh opened a visible window and stole focus. The console is allocated once at plugin load, hidden immediately, never persisted, and left alone when a console already exists (a developer terminal).

## Loading

DeepSeekGUI's launcher passes `deepseekgui-workbench.patch.yml` through `dsh --patch` when it starts Harness (see `resolveDshLaunch` in `apps/desktop/src/dsh-service.ts`). The overlay inserts one loader row; the package is resolved from the profiles module fallback (the launcher's `ensurePluginResolvable`), never from a Profile manifest. A user's own `dsh web` run does not see this layer, and uninstalling DeepSeekGUI leaves no trace in any Profile. In Compatibility View mode the launcher skips this overlay, so the page is the official DSH Web UI without the Workbench plugin (the tray offers the way back).

The browser half registers through the official client loader:

- `sidebar.brand.name` — the DeepSeekGUI name in the sidebar brand row. The marks (sidebar and blank-session page) stay the official whale: DeepSeekGUI is a non-commercial open-source set of DSH plugins, not a separate brand (2026-09-06 ruling).
- A `<style>` element (`deepseekgui-skin`) carries visual patches over official components that expose no token hook — currently the session stats line under the composer, restored to the v1.0.0 centered pill on the overlay surface after 0.1.2 dropped the `--dsh-statsline-*` hooks.
- `conversation.session.header.actions` (id `deepseekgui-workbench`) — the read-only Workbench pill in the session header.
- `sidebar.footer.action` (id `deepseekgui-desktop`) — the desktop-model poll (`/control/model`, revision-gated, only while mounted) that consumes notification-click navigation; it paints nothing since the sidebar status light duplicated the shell's status pill. Without the control-bridge parameter in the page URL (an external browser tab), the action renders nothing.
- `sidebar.footer.action` (id `deepseekgui-notifier`, B5-P6) — the invisible notification consumer: it watches the official pending interactions (approvals/questions) and job transitions from the official connection (which owns heartbeat and reconnect — no local compensation) and pushes one-shot `notify` commands over the control bridge, deduplicated per session + official event id. The desktop stays stateless: it shows the system notification and navigates on click.
- `tool.call.toolview` — keyed rows (B5-P5) for the 23 DeepSeekGUI wire keys (git status/diff/index verbs, commit, push preview/push, the three `pr_*` tools, and the `browser_*` toolset) replacing the generic fallback for those calls: a collapsed one-line conclusion with a failure line on errors, expansion with folded full output and arguments, and — on settled status, push-preview, and no-PR-lookup cards — small forms for commit message, push remote/ref, and PR title/body/base dispatched through the official input actions. Row summaries are pure functions of the frozen call slice (parsers target the deterministic coding-tools render texts and degrade gracefully).
- `conversation.view` (ids `deepseekgui-changes`, `deepseekgui-git`, `deepseekgui-worktree`, `deepseekgui-memory`) — the four DeepSeekGUI tabs beside the official Chat and Trajectory tabs. Changes lists what changed in the workspace by group (will be committed / changed / new / conflicts) and opens each file's patch; every row can be revealed in the file manager or have its path copied. Git shows the current branch, the remote branch with ahead/behind, the configured remotes, the newest commits, and this session's commit/push/PR outcomes read from the tool cards already in the window, including calls nested under `run_code` (the official PTC mode drives the git tools from there). Worktrees lists every registered work tree with its branch, its changed paths, which one this session lives in, and paths changed in more than one tree. Memory shows the project `<folder name>.memory.md` read from disk and rendered as Markdown in its own reading area (an empty state when the file does not exist yet), with open-in-file-manager and ask-the-assistant actions, a pointer to the global memory in Settings, and a collapsed "about" block holding the file location, the AGENTS.md distinction, the Git note, and the generate-AGENTS.md button (the closed `create-project-agents` desktop command; an existing file is opened instead). All four read through the mounted `workbenchInspector` namespace, refresh on demand, offer no write, and sit in the official chat content column (`--dsh-chat-content-width`) so the official width handles rest outside them and resize them together with the chat. Changes, Git, and Worktrees carry an open-workspace toolbar button (the closed `open-workspace` desktop command); Memory offers its own open-in-file-manager instead.
- Path clicks — a `<code>` span in the conversation whose text looks like a path reveals the file through the `reveal-path` desktop command; the desktop resolves it against the session workspace and refuses anything outside, so the page never guesses containment.

All these slots are declared by the official client packages; this plugin only fills them via `ctx.slots.inject`.

## Development

The plugin keeps TypeScript/React sources and a normal build. First compile the sources, then emit the client bundle:

```sh
pnpm exec tsc -b apps/desktop/workbench-plugin
pnpm exec tsdown --config apps/desktop/workbench-plugin/tsdown.config.ts
```

The bundle self-registers through `window.__ModuleLoader__.load({ id, factory })` and resolves React and the shared module-table rows through the loader require — the same artifact contract the official client packages build with `clientBundle` (the preset itself cannot build this package because its workspace scan only covers `packages/*/*`).

Unit tests live under `tests/` and run through the repository vitest (component specs need `NODE_ENV=test`; this sandbox exports `NODE_ENV=production`, which resolves React's production build and breaks `act()` — the known repo-wide jsdom baseline):

```sh
pnpm exec vitest run apps/desktop/workbench-plugin/tests
```

## Model Experience

None, as the plugin renders brand chrome, tool-result cards, and read-only views over official projections; nothing here assembles a provider request. The card forms and the Memory view's ask action compose user instruction text that rides the official composer submission like any typed message.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.
