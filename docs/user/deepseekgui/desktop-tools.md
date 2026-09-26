# Desktop tools

English | [中文](desktop-tools.zh.md)

DeepSeekGUI combines Harness with desktop controls for an embedded browser, terminal access, updates, diagnostics, feedback, and resident operation.

## Built-in browser

Inside DeepSeekGUI, the assistant uses the embedded browser panel for pages requiring rendering or interaction. It supports navigation, page snapshots, screenshots, tabs, waiting, clicking, typing, scrolling, and keyboard actions.

The browser applies these limits:

- Local, private, and reserved network addresses are refused before navigation.
- Redirect targets are checked again at every hop.
- Arbitrary page-script evaluation is not exposed.
- Form submission, login, message sending, and other sensitive actions require approval.
- Cookies are not persisted in V1.

Agent navigation expands the browser beside the conversation. It alternates with the right file sidebar, so only one is visible at a time; hiding the panel does not stop browsing. After a renderer crash, the next browser operation recreates the panel.

![A DeepSeekGUI session using the built-in browser to inspect a public webpage](assets/browser-1.1.1.png)

## DSH Terminal

Open **DSH Terminal** from the menu or tray. It uses the active Harness Home and prefers the current session directory when opened from a session; otherwise it uses the Profile directory and explains any unavailable-directory fallback.

The packaged application supplies private `dsh`, `node`, and `pnpm` shims to that terminal process. It does not modify the system PATH, registry, PowerShell profile, or shell configuration.

Bare `dsh` commands default to the active Profile. An explicit `--profile` argument always wins.

## Harness controls

The Harness section in Settings shows the active Home, Profile, status, Profile switcher, Plugin Manager, permission controls, recovery details, diagnostics, and feedback. The top status indicator is read-only; use the Harness section for changes.

## Updates

Use **Check for Updates** from the menu or tray. DeepSeekGUI compares only the DeepSeekGUI application version, not the embedded DSH version. When GitHub cannot be reached (a network without a proxy), the check automatically falls back to the official site’s release manifest and downloads from the site, with identical verification; whenever GitHub answers at all (including “up to date”), its answer stands and no other source is consulted.

When a newer version exists, a small translucent bubble appears beside the top-left menu (**New version `<version>`**, with its own wording while downloading and once the download is ready); click it to open the update panel. The **Check for Updates** row in the hamburger menu also carries a small state icon — ⬇️ while downloading, 🎁 once ready. After the download is verified, the panel offers **🎁 Install Update** — you pick the moment: installing stops Harness and exits the app when done, and the next launch is the new version. To see what changed, **What’s new** opens the matching release page in your system browser; release notes are no longer embedded in the panel.

Manual download asks for confirmation; automatic download can run in the background. DeepSeekGUI checks HTTPS assets, declared size, and SHA256. Windows installation always requires confirmation and a final integrity check. Cancelling installation keeps the verified file; Linux AppImage handoff opens its location for manual handling.

The update panel also has an **Auto-download updates** switch, on by default and stored with the desktop preferences. While it is on, DeepSeekGUI starts at most one background download per discovered version. Turning it off stops future automatic downloads without interrupting one already running, and a running download can always be cancelled explicitly.

When the installed version is already the newest published one, a manual check reports that no update is available. The installed version remains usable.

## Account & balance

After you sign in with a DeepSeek account, **Settings → Account** shows the account, the topped-up and granted balances, and **View usage** and **Top up**. Both open the DeepSeek platform page inside the window, already signed in; its back button returns to Settings. Payment pages open in your system browser.

Below the balances, DeepSeekGUI adds its usage view: the balance and total spend, spend, requests, total tokens and cache-hit rate for today, 7 days or 30 days, and a 60-day token heatmap. The numbers come from the platform itself, not from a local count, so reinstalling or updating DeepSeekGUI changes nothing here. **See more details on the official site** at the bottom opens the platform's usage page in your system browser.

The usage view reads the platform with your account sign-in, so it needs no separate login. It refreshes when you open the page, once shortly after DeepSeekGUI starts, right after you sign in, and when you click 🔄 — never on a timer. If the platform cannot be reached or changes its data format, the page says so and points to the official page instead of showing old numbers. If you only use an API key, sign in to the same DeepSeek account to see this page.

The account card may show "Account details are not available yet" instead of your name and avatar: the platform currently refuses that one request from DeepSeekGUI. Balances, usage and top-up are not affected.

## Skill

**Settings → Skills** manages the skill packages installed in DeepSeekGUI's own library under your DSH home. Each installed entry shows its name, description, where it came from (a directory, a ZIP, or a Markdown document, with the path) and where it now lives. Skills under the official user folders (`~/.dsh/skills`, `~/.agents/skills`) and the bundled ones are listed read-only for orientation; they cannot be imported or uninstalled here.

**Import skill directory…** and **Import ZIP / Markdown…** open the system dialog (outside the DeepSeekGUI window you can type a path instead). Nothing is written yet: the page first shows what it found — one candidate for a package with a root `SKILL.md` (scripts, references and assets travel with it), several candidates when the source holds more than one skill or wraps it in folders, and plain Markdown files as candidates when there is no `SKILL.md`. Each candidate shows the name and description it declares; when a plain document lacks them the page proposes a name from the file name and a description from its first line, which you can edit — the proposal is written only into the library copy, the original file is never modified. Problems that cannot be repaired (a retired frontmatter field, an unreadable archive, a path that would escape the library) are listed and block that candidate. When a candidate has the same name as an installed skill, the page names the exact install it would replace and its source; installing then keeps that install's identity.

**Uninstall** asks for confirmation, names the projects that currently select the skill, and removes only what this page installed; the file or folder you imported from stays where it was. Installing a skill here does not make it available to conversations by itself — which projects may use it is chosen under **Project management** at the top of a session.

## Project management

The **Project management** tab at the top of a session (beside Changes, Git and Memory) lists every skill in the library and lets you tick the ones this project may use. The selection belongs to the project folder shown at the top: every session opened in that folder — now or later, in this window or another — shares it, and other folders have their own. A new install is ticked nowhere until you tick it; skills that were already available from the official folders are unaffected. Each ticked row says what the tick does in this session: **Active**, **Shadowed by an official skill of the same name** (an official skill wins and this one is not invoked), **Invalid** (the installed copy cannot load), or **Uninstalled** (the skill was removed from the library; untick and save to clear the reference — nothing switches to another skill of the same name). Unticking only changes the selection: the package stays installed and other projects keep it.

**Save selection** writes the whole list at once. If another window saved this folder's selection in the meantime, the page shows the latest content instead of overwriting it; tick again and save. After saving, sessions of this folder that are already open use the new catalog from their next message — the model's skill list is replaced, the `skill` tool and `/name` no longer load unticked skills, and the `/` picker refreshes. Skill instructions that were already sent into a session stay in its history; start a new session to exclude them completely. A session without a project folder, or whose folder no longer exists, cannot save a selection.

## Diagnostics Center

The Diagnostics Center shows allowlisted product facts and offers two actions:

- **Open Log Folder** opens the local service-log directory.
- **Export Diagnostics Bundle** creates a local bundle under the DeepSeekGUI data directory. DeepSeekGUI does not upload it.

The bundle can include redacted service logs, build information, last-exit facts, and bounded crash dumps. Credentials, `.env` files, and session content are structurally excluded. Crash dumps can still contain local paths or memory fragments, so review every exported file before sharing it publicly.

If the GUI cannot start, run the installed executable from a terminal:

```powershell
DeepSeekGUI.exe --export-diagnostics
```

The command starts no Harness, Profile, window, tray, or local server. It prints the exported bundle path and exits.

## Feedback

**Settings → Bug Report & Diagnostics** provides an editable, redacted summary. Send it for assistant-aided triage and a GitHub issue draft, then review the content before submission. The official message-feedback control reports to DeepSeek Harness; use this section for desktop-product issues.

## Desktop notifications

DeepSeekGUI raises a desktop notification when a session needs you: a pending approval, a question waiting for an answer, or a background task that finished or failed. Selecting the notification opens the matching session.

Notifications follow the Windows notification settings for the application.

## Tray and lifecycle

DeepSeekGUI is a resident desktop application. Closing the window hides it; opening the shortcut again focuses the existing instance. **Quit DeepSeekGUI** is the action that stops Harness, destroys the tray and views, and exits.

## Related guides

- [Workbench views and Git tools](workbench.md)
- [Profiles and plugins](profiles-plugins.md)
- [Permissions and approvals](permissions.md)
- [Data and troubleshooting](data-troubleshooting.md)
