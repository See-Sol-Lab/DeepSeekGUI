# DeepSeekGUI quick start

English | [中文](quickstart.zh.md)

This tutorial takes a new Windows user from download to a working DeepSeek coding session. DeepSeekGUI includes its own Harness runtime, Node.js, and pnpm, so the installed application does not need a development toolchain.

## Before you begin

- A Windows 10 or Windows 11 x64 computer.
- A DeepSeek API key.
- A folder you are comfortable letting the agent inspect and edit.

## 1. Download DeepSeekGUI

Download the Windows installer, `DeepSeekGUI-Setup-<version>.exe`, from the [latest release](https://github.com/See-Sol-Lab/DeepSeekGUI/releases/latest). Linux AppImage is provided through a separate experimental release; see the repository homepage for the available download.

DeepSeekGUI is currently distributed without a code signature, so Windows SmartScreen may show an unknown-publisher warning. Verify the installer against the `SHA256SUMS.txt` file from the same release before running it:

```powershell
Get-FileHash .\DeepSeekGUI-Setup-<version>.exe -Algorithm SHA256
```

Continue only when the printed hash matches the release manifest exactly. In SmartScreen, select **More info**, then **Run anyway**.

## 2. Install and launch

Run the installer. It installs for the current Windows user without administrator rights, creates Start menu and desktop shortcuts, and launches DeepSeekGUI when installation finishes.

Closing the main window hides DeepSeekGUI in the system tray while Harness continues running. Use **Quit DeepSeekGUI** from the menu or tray when you want to stop Harness and exit completely.

## 3. Connect DeepSeek

1. Open **Settings** from the lower-left corner.
2. Open **Models**.
3. Choose the DeepSeek provider and enter your API key.
4. Select a model, then return to the home page.

DeepSeekGUI stores the key through the Harness credential service in the application data directory. It does not put the key in the installer, command line, or diagnostics log.

![DeepSeekGUI Models settings with a redacted API key and available DeepSeek models](assets/settings-1.1.1.png)

See [Models and vision](models.md) for model selection, image input, and custom providers.

## 4. Choose a workspace

Choose the folder for your task. In the recommended Sandbox mode, this workspace is the agent's writable file area. Start with a project copy or a folder under version control when you are evaluating unfamiliar automation.

## 5. Start your first session

Create a new session and give the agent one concrete outcome, for example:

> Read this project, explain how it starts, and identify the three files I should understand first. Do not edit anything yet.

Once you are comfortable with the result, ask for a bounded change. DeepSeekGUI streams the reply and keeps the session in the selected Harness Home so you can resume it later.

A fresh installation guides you through choosing a workspace, configuring a model, and sending your first message, with prompts while waiting for a reply or approval. You can skip it; existing users with session data are not treated as new.

![A completed DeepSeekGUI coding task that creates and runs a JavaScript file](assets/workbench-overview.png)

## 6. Review approvals and changes

Tool approvals come from Harness. Read the requested action before approving it. DeepSeekGUI never auto-approves an action and never maintains a separate trust cache.

Open the **Changes** view beside the conversation to read file diffs, and the **Git** view to see branch state and the session's commit results. The views read local state, so checking your project costs no model request. See [Workbench views and Git tools](workbench.md).

## 7. Keep what you learned

Store durable collaboration preferences in **Settings → Global memory**; the assistant follows them in every project. Facts about this project accumulate in the session's **Memory** view. See [Memory](memory.md).

Keep **Sandbox** enabled for ordinary work. Turn on **Full Access** only when the task genuinely needs Windows-account-level access and you understand the displayed risk.

## Next steps

- [Models and vision](models.md)
- [Workbench views and Git tools](workbench.md)
- [Memory](memory.md)
- [Workspaces and sessions](workspaces-sessions.md)
- [Profiles and plugins](profiles-plugins.md)
- [Permissions and approvals](permissions.md)
- [Desktop tools](desktop-tools.md)
- [Data and troubleshooting](data-troubleshooting.md)
