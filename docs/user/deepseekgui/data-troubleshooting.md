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
| Global memory | Inside the Managed Harness Home | Cross-project preferences edited in Settings. |
| Project memory | `<folder-name>.memory.md` in the selected workspace | Project facts maintained by the assistant; part of your project files. |
| Memory entries | `storages/deepseekgui_memory` inside the Managed Harness Home | One JSON file per entry (and per forgotten entry) plus the memory path setting, when entry memory is on ([Memory](memory.md)). |
| Skill library | `deepseekgui/skills` and `storages/deepseekgui_skills` inside the Managed Harness Home | Installed skill packages with their manifests, and each project folder's selection. |

Windows resolves the real application-data directory through its Known Folder API. The table uses `%APPDATA%` as the familiar default notation.

## Move the Managed Harness Home

Choose **Data location…** from the menu to see the current data folder and move it. Pick a destination folder: DeepSeekGUI copies every item, verifies each file by size and SHA-256, points the launcher at the new folder, and restarts Harness. The restart checks the new location item by item, and only after that check passes does DeepSeekGUI offer to delete the old copy. Until then the old files stay exactly as they were; a failed check keeps them and stops.

This path moves the Managed Harness Home only. It never moves the program installation — the installer, shortcuts, uninstall entry, and updater own that — nor an Existing Home you selected, your project folders, or the other files under `%APPDATA%\DeepSeekGUI`.

## Uninstall and reinstall

The uninstaller asks whether to remove the DeepSeekGUI data directory. Choose **No** to keep credentials, settings, sessions, and Profiles for a later reinstall. Choose **Yes** only when you intend to remove that data.

Silent uninstall during an upgrade keeps the data and does not show the prompt.

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

## Programs you run yourself fail in a project used with Sandbox (known issue)

In Sandbox mode, the first time the Windows sandbox grants write access to a project folder it leaves three settings on that folder permanently: a write grant for the sandbox, a "deny delete child" entry, and a **Low integrity label**. This is the design of upstream DSH 0.1.7; closing DeepSeekGUI does not remove them.

A side effect of the label is that programs **you** later start from that folder also run at Low integrity, even from an ordinary terminal. Typical signs:

- an Electron app in the project exits at once with `0x80000003` and no output;
- a Python virtual environment, `uv`, or a program built in the project gets "Access is denied" when writing to your profile or a cache.

If the same program runs fine after copying it to another folder, this is almost certainly the cause. To check (use your project's path):

```powershell
icacls "D:\my-project" | Select-String "Mandatory"
```

`Low Mandatory Level` in the output means the folder is labeled. Once no DeepSeekGUI task is running in that project, run these lines in your own PowerShell to restore it (replace `S-1-4-…` with the identifier the previous command shows):

```powershell
$root = "D:\my-project"
$acl = (Get-Item $root).GetAccessControl('Access')
$acl.PurgeAccessRules([Security.Principal.SecurityIdentifier]'S-1-4-…')
$everyone = [Security.Principal.SecurityIdentifier]'S-1-1-0'
foreach ($r in @($acl.GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier]))) {
  if ($r.AccessControlType -eq 'Deny' -and $r.IdentityReference -eq $everyone) { [void]$acl.RemoveAccessRuleSpecific($r) }
}
(Get-Item $root).SetAccessControl($acl)
icacls $root /setintegritylevel '(OI)(CI)M'
```

The settings come back the next time a Sandbox command runs in that project. If you often run programs from the project yourself, use Full Access for it. Upstream tracking: [deepseek-harness#7709](https://github.com/deepseek-ai/deepseek-harness/discussions/7709).

## Export diagnostics without the GUI

Run:

```powershell
DeepSeekGUI.exe --export-diagnostics
```

The command prints the output directory. Review the bundle before attaching it to a public issue.

## Get help

Search existing [DeepSeekGUI issues](https://github.com/See-Sol-Lab/DeepSeekGUI/issues) before opening a new one. Include the DeepSeekGUI version, Windows version, the action you attempted, the visible error, and only the diagnostics files you have reviewed.
