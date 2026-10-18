# Data and troubleshooting

English | [中文](data-troubleshooting.zh.md)

DeepSeekGUI keeps its application state and Managed Harness Home under the Windows user profile. Model requests still go to the provider you configure; local storage does not make a remote model local.

## Where DeepSeekGUI stores data

| Data | Default location | Notes |
| --- | --- | --- |
| Managed Harness Home | `%APPDATA%\DeepSeekGUI\dsh` | Credentials, settings, sessions, Profiles, and plugins managed by Harness. You can move it from **Data location**; see below. |
| Launcher selection | `%APPDATA%\DeepSeekGUI\launcher-state.json` | Active Home and Profile, last known good selection, and redacted boot failure. |
| Desktop preferences | `%APPDATA%\DeepSeekGUI\desktop-ui-state.json` | Window bounds, update preferences, and local UI acknowledgements; Harness settings store the theme. |
| Service logs | `%APPDATA%\DeepSeekGUI\dsh-service.log` | Redacted and rotated; current file plus bounded history. |
| Diagnostics exports | `%APPDATA%\DeepSeekGUI\diagnostics` | Local bundles created only when you request an export. |
| Update cache | `%APPDATA%\DeepSeekGUI\updates` | At most one verified installer record and its file. |
| Kept installer | `%LOCALAPPDATA%\DeepSeekGUI\installer` | The current version's installer, kept by each install (about 190 MB) so that moving the program needs no download; removed on uninstall. |
| Global memory and rules | `memory.md` and `AGENTS.md` inside the Managed Harness Home | Cross-project preferences edited in Settings, and your global rules. |
| Project memory and rules | `<folder-name>.memory.md` and `AGENTS.md` in the selected workspace | Project facts and rules; part of your project files. |
| Old memory entries | `storages/deepseekgui_memory` inside the Managed Harness Home | Only on Homes that used the Enhanced Memory of earlier versions: a backup of its entries, kept after they were moved into the Markdown files ([Memory](memory.md)). |
| Skill library | `deepseekgui/skills` and `storages/deepseekgui_skills` inside the Managed Harness Home | Installed skill packages with their manifests, and each project folder's selection. |

Windows resolves the real application-data directory through its Known Folder API. The table uses `%APPDATA%` as the familiar default notation.

## Move the Managed Harness Home

Choose **Data location…** from the menu to see the current data folder; click **Move data only…** and pick a destination folder: DeepSeekGUI copies every item, verifies each file by size and SHA-256, points the launcher at the new folder, and restarts Harness. The restart checks the new location item by item, and only after that check passes does DeepSeekGUI offer to delete the old copy. Until then the old files stay exactly as they were; a failed check keeps them and stops.

This path moves the Managed Harness Home only. It does not move the program installation, an Existing Home you selected, your project folders, or the other files under `%APPDATA%\DeepSeekGUI`. To move the program and data together, see the next section.

## Move the program and data together

When drive C is short of space and you want all of DeepSeekGUI on drive D, use this instead of **Move data only** above.

**Choose the location when you install.** A fresh install first asks whether to use the default location. Choose **No** and pick a parent folder (for example `D:\Apps`): the program goes into `D:\Apps\DeepSeekGUI\app`, and on first launch the data goes into `D:\Apps\DeepSeekGUI\dsh`. Upgrades and reinstalls do not ask again and keep the existing location; when the default location already has data, that data stays in use and is not moved.

**For an existing install, move it from the app.** Choose **Data location…** from the menu, click **Move everything to another location…**, pick a parent folder, and confirm the plan. DeepSeekGUI then:

1. Gets the installer for exactly the current version and keeps a copy under `%APPDATA%\DeepSeekGUI\relocation`. It first uses the one the installer kept on this computer (`%LOCALAPPDATA%\DeepSeekGUI\installer`, product name and version checked), so nothing needs downloading or finding; without it, it downloads the installer and checks its size, SHA-256, product name and version against the release manifest. You can keep working meanwhile. If neither works, you can pick a local installer: it is copied and its product name and version are checked the same way, but it cannot be checked against the release manifest, so use only a file whose origin you trust.
2. Stops the Harness, copies the managed data to `<parent>\DeepSeekGUI\dsh`, verifies each item, and switches to it. This is the same flow as **Move data only**, and a failure returns to the previous location.
3. Quits in order and hands over to a short-lived helper (the PowerShell that ships with Windows). The helper waits until every app process has exited, checks the installer copy once more, and runs the installer: it puts the same version into `<parent>\DeepSeekGUI\app`, removes the old program folder, and once the program is confirmed in the new location, opens it from there. Installing takes a few minutes; the desktop and Start menu shortcuts stay visible meanwhile and then point to the new location. If the app cannot quit cleanly, the handover is cancelled and nothing changes.

Afterwards the desktop and Start menu shortcuts and the uninstall entry point to the new location, and future updates install there. Once the new location passes its startup check, return to **Data location…** to confirm deleting the old data. **A taskbar pin is not updated**: unpin the old icon after the move and pin DeepSeekGUI again from the Start menu.

**What moves.** The program, and the data DeepSeekGUI manages (sessions, attachments, credentials, each Profile with its `cordis.patch.yml`, plugins, skills, global memory and rules). Not moved: project folders (project memory travels with the project) and an Existing Home you chose yourself (it stays where it is; only the program moves). The shortcuts and registry entries Windows needs, and small files in `%APPDATA%\DeepSeekGUI` such as the launch selection, window state and logs, stay on drive C. Credentials keep working for the same Windows user.

**Locations you cannot pick.** System folders (Windows, Program Files, ProgramData), anything inside a Git project, inside or directly around the current program or data folder, a `DeepSeekGUI` folder that already has content, a link, and paths whose install folder would exceed 85 characters. An unfinished **Move data only** (awaiting the restart check, or old data not yet deleted) has to be finished first.

**If the program did not move.** When the new location could not be installed, the helper first reopens the old program if it is still there; if the old program was already removed, it uses the same installer copy to put the program back in its old location. When you open DeepSeekGUI again, **Data location…** explains why the move did not finish: data that was already moved stays at the new location and works as usual, and you can **Retry moving the program** (the target is checked again as it is now) or **Give up** and keep the program where it is. If neither location could be installed, a message names the installer copy and where your data is: double-click that installer to reinstall; no data is deleted. The installer copy is kept until the move is confirmed or you give it up.

**Upgrades and uninstalling.** Moving does not change the version. Later updates install into the new location. Uninstalling still asks whether to delete the data: **No** keeps `<parent>\DeepSeekGUI\dsh`, and **Yes** still keeps the global `memory.md` and `AGENTS.md`.

On Linux the AppImage is a single file; move the file itself, and use **Move data only** for the data.

## Uninstall and reinstall

The uninstaller asks whether to remove the DeepSeekGUI data directory. Choose **No** to keep credentials, settings, sessions, and Profiles for a later reinstall. Choose **Yes** only when you intend to remove that data; even then, the global `memory.md` and `AGENTS.md` are kept and put back in `%APPDATA%\DeepSeekGUI\dsh`, so a reinstall still has them. Clear them in the app if you want them gone. Project memory and rules stay in your project folders.

Silent uninstall during an upgrade keeps the data and does not show the prompt.

<a id="keep-your-data"></a>

## Keep your data

Your history sits in two places: the Managed Harness Home and your project folders. This section lists what to copy and what each export contains. It was checked with DeepSeekGUI 1.2.x only: restoring means putting the files back into the same DeepSeekGUI version. Whether another product can open these files has not been verified, and nothing here promises it.

| What to keep | Where it is | Notes |
| --- | --- | --- |
| Sessions | `sessions\--<workspace path>--\session-<id>\` inside the Managed Harness Home | One folder per workspace and one per session; the log inside is a compressed file such as `session.v4.jsonl.zstd`. |
| Attachments | `attachments\v1` inside the Managed Harness Home | Created when you first attach a file or image. Sessions reference these files; keep the folder together with `sessions`. |
| Workspace list | `storages\workspace.json` inside the Managed Harness Home | The workspaces and sessions the sidebar shows. Copying the whole Home keeps it with the sessions. |
| Global memory and rules | `memory.md` and `AGENTS.md` inside the Managed Harness Home | Plain text; copy them as they are. |
| Project memory and rules | `<folder-name>.memory.md` and `AGENTS.md` in each project folder | They travel with the project. |
| Settings and plugins | The active Profile's folder `profiles\<Profile>\` inside the Managed Harness Home (the default Profile is `web`): `cordis.yml`, `cordis.patch.yml`, and `package.json` | `cordis.yml` is the base configuration; the changes you save on the settings page are written to `cordis.patch.yml`; `package.json` is the plugin list. Keeping only `cordis.yml` loses your settings-page changes. The plugins DeepSeekGUI ships are provided again by the installed version. |
| Skills | `deepseekgui\skills` and `storages\deepseekgui_skills` inside the Managed Harness Home | Your installed skill packages and each project's selection. |
| API keys | `.credentials.yaml` inside the Managed Harness Home | Contains your keys. Keep a copy only somewhere private, or enter the keys again later. Never attach it to a report. |

To keep everything:

1. In **Settings → Harness**, note the current Harness Home path, whether it is managed or an existing folder, and the current Profile. These choices are stored outside the Home (`launcher-state.json`; a moved Managed Home also has `%LOCALAPPDATA%\DeepSeekGUI\managed-home.txt`), so copying the Home does not carry them.
2. Quit DeepSeekGUI completely. Closing the window only hides it: use the tray icon and choose **Quit DeepSeekGUI**. Copying while Harness runs can capture a half-written file.
3. Copy the whole Harness Home folder to your backup location: by default `%APPDATA%\DeepSeekGUI\dsh`; if you moved it, the folder shown under **Data location…**; if you use an existing folder, the folder you noted in step 1.
4. Copy your project folders as usual; they carry their own memory and rules files.

To restore into the same DeepSeekGUI version, install it and quit it completely, then follow the Home type you noted:

- **Default Managed Home** (never moved): put the saved folder back at `%APPDATA%\DeepSeekGUI\dsh` and start DeepSeekGUI.
- **Moved Managed Home**: while the stored choice is still there, put the folder back at the path **Data location…** showed. On a new machine, or once the stored choice is cleared, DeepSeekGUI does not know the old external path and reads only `%APPDATA%\DeepSeekGUI\dsh`. Put the saved folder there and start the app; to keep it elsewhere, move it again with **Data location…** after it starts.
- **Existing Home**: put the folder anywhere, start DeepSeekGUI, choose **Choose existing Harness Home…** in **Settings → Harness**, select the folder, and pick the Profile you noted.

If the Profile you noted is not `web`, switch to it under **Settings → Harness → Profiles** after the app starts. Then check one session, **Settings → Global memory**, and a project's **Memory** view. These steps follow the app's existing controls; a full desktop restore on a fresh machine has not been verified.

Two exports are available for reading history outside the app:

| Export | How | Contains | Attachments |
| --- | --- | --- | --- |
| Session log (ZIP) | The session's more-actions menu → **Download session log**, or type `/export` | `dsh-session-<id>.zip` with the log as `session.v<format version>.jsonl` (for example `session.v4.jsonl`), sub-sessions under `subagents\<id>\`, and the referenced files | Included: images under `media\`, other files under `files\` |
| Markdown | The session's menu in the sidebar → **Export as Markdown** | Your messages and the assistant's replies as readable text; tool calls and reasoning only when you tick them | Not included: an attachment shows as a placeholder line |

Image names inside the ZIP contain `sha256:`, and the colon is not allowed in Windows file names. PowerShell's `Expand-Archive` refuses such an archive; Windows' built-in `tar -xf <file>.zip -C <folder>` extracts it and writes `sha256_` instead. If another unzip tool refuses it too, use `tar` as shown.

The ZIP is the complete record of one session; the Markdown file is for reading and sharing. Neither export contains memory, rules, settings, or keys, so copy those as described above. Review exports before you share them: logs quote what the assistant read and ran.

## Privacy boundaries

- DeepSeekGUI sends prompts, selected context, and attachments to the configured model provider through Harness.
- Session data and credentials stay in the active Harness Home unless a configured provider or tool transmits requested content.
- Service logs redact credential-shaped text before writing.
- Diagnostics exports are local and are never uploaded automatically.
- Project memory lives in the workspace as an ordinary Markdown file. Review it before publishing the project.
- Existing Homes are used in place; DeepSeekGUI does not copy them into Managed Home.

Review tool approvals and exported diagnostics before sharing anything outside your computer.

<a id="windows-smartscreen-blocks-the-installer"></a>

## Windows SmartScreen blocks the installer

DeepSeekGUI V1 is unsigned. Download the installer and `SHA256SUMS.txt` from the same GitHub release, verify the SHA-256 hash, then use **More info → Run anyway** only when they match.

## DeepSeekGUI reports a missing API key

Open **Settings → Models** and store a key for the exact provider route selected by the session. See [Models and vision](models.md).

## Harness does not start

1. Open the Harness section and read the failure stage.
2. Check whether another process is using port `3080`.
3. If you recently changed Profile or installed a plugin, inspect Recovery Details and the Plugin Manager recovery entry.
4. Open the log folder or export diagnostics.
5. Restart Harness after correcting the cause.

DeepSeekGUI may return to the last known good Profile after a failed switch. A recovery notice means the fallback succeeded; it does not mean the attempted Profile loaded.

## DeepSeekGUI opens but the window is missing

Check the system tray. Closing the window hides the resident application. Opening the DeepSeekGUI shortcut again should focus the existing instance.

DeepSeekGUI also clamps saved window bounds to the visible work area after monitor, DPI, or resolution changes.

## A plugin operation failed

Read the operation output and the recovery state before retrying. Do not edit protected Profile files while a recovery confirmation is open. If DeepSeekGUI reports file drift, inspect the files manually; automatic restoration stops to avoid overwriting newer changes.

## The browser does not open

DeepSeekGUI starts its embedded browser panel on the first browser operation. Confirm that Harness is running and the target is a public HTTP or HTTPS address; local, private-network, and unsupported URLs are refused. Screenshot analysis also requires image input in the current model.

## Check for Updates reports no update

The installed version is already the newest published one. This does not alter the installed application. You can also download a release manually from GitHub.

## Programs you run yourself fail in a project used with Sandbox

On Windows, an older DeepSeekGUI version can leave a Sandbox write grant and Low integrity label on a project folder. Programs started from that folder may then fail to access your profile or cache. An Electron app may exit with `0x80000003`; Python or `uv` may report "Access is denied".

DeepSeekGUI 1.2.0 takes back its grant when the project has been idle for 30 seconds and no Sandbox command is still running. To clean a folder marked by an older version, open **Settings → General → Clean sandbox marks** and choose the folder. The app refuses to change a folder while its Sandbox command is running. If the selected folder inherits the marks from a parent, the control identifies and cleans the marked level.

You can check the folder with `icacls "D:\my-project"`. After cleanup, the output should show neither `Mandatory Label\Low` nor a `S-1-4-…` Sandbox grant. If cleanup fails, keep the error message and export diagnostics for review.

## Export diagnostics without the GUI

Run:

```powershell
DeepSeekGUI.exe --export-diagnostics
```

The command prints the output directory. Review the bundle before attaching it to a public issue.

## Get help

Search existing [DeepSeekGUI issues](https://github.com/See-Sol-Lab/DeepSeekGUI/issues) before opening a new one. Include the DeepSeekGUI version, Windows version, the action you attempted, the visible error, and only the diagnostics files you have reviewed.
