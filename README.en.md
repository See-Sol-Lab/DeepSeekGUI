<div align="center">

# <img src="./apps/desktop/src/chrome/icon.png" width="38" alt="" align="absmiddle" /> DeepSeekGUI

</div>

<div align="right">

English | [中文](README.md)

</div>

<p align="center">
  <em>Work with DeepSeek on your projects in a local workbench.</em>
</p>

<p align="center">
  A local desktop workbench for Windows and Linux, built on <a href="https://github.com/deepseek-ai/deepseek-harness">DeepSeek Harness</a>.
</p>

<p align="center">
  <a href="https://github.com/See-Sol-Lab/DeepSeekGUI/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/See-Sol-Lab/DeepSeekGUI?style=flat-square&label=release" /></a>
  <a href="https://github.com/See-Sol-Lab/DeepSeekGUI/releases"><img alt="Downloads" src="https://img.shields.io/github/downloads/See-Sol-Lab/DeepSeekGUI/total?style=flat-square" /></a>
  <img alt="Windows 10 and 11 x64" src="https://img.shields.io/badge/Windows-10%20%7C%2011%20x64-0078D4?style=flat-square&logo=windows" />
  <a href="https://github.com/See-Sol-Lab/DeepSeekGUI/releases/tag/v1.1.0-linux.1"><img alt="Linux x64 AppImage" src="https://img.shields.io/badge/Linux-x64%20AppImage-FCC624?style=flat-square&logo=linux&logoColor=black" /></a>
  <a href="DEEPSEEKGUI-LICENSE.md"><img alt="Source available" src="https://img.shields.io/badge/source-available-6f42c1?style=flat-square" /></a>
  <a href="https://doi.org/10.5281/zenodo.22205160"><img alt="DOI" src="https://zenodo.org/badge/DOI/10.5281/zenodo.22205160.svg" /></a>
</p>

<p align="center">
  <a href="https://dshfind.com/en/plugins/See-Sol-Lab/DeepSeekGUI?ref=badge"><img alt="DeepSeekGUI on dshfind" src="https://dshfind.com/api/card/See-Sol-Lab/DeepSeekGUI?lang=en" width="440" /></a>
</p>

<p align="center">
  <img alt="DeepSeekGUI — a harness-first desktop workspace for agentic coding" src="docs/media/readme-hero.png" width="920" />
</p>

<!-- PRODUCT HUNT BADGE SLOT — restore once the launch has a ranking (the badge shows "???" until then):
<p align="center">
  <a href="https://www.producthunt.com/products/deepseekgui?embed=true&amp;utm_source=badge-featured&amp;utm_medium=badge&amp;utm_campaign=badge-deepseekgui" target="_blank" rel="noopener noreferrer">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1235736&amp;theme=dark" />
      <img alt="DeepSeekGUI - DeepSeek's coding agent, on your desktop. | Product Hunt" src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1235736&amp;theme=light" width="250" height="54" />
    </picture>
  </a>
</p>
-->

DeepSeekGUI is a local AI workbench built on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). Choose a project folder and ask the assistant to read code, edit files, run commands, and browse the web. Inspect the project through Changes, Git, Worktrees, and Memory views, use dedicated tools for commits, pushes, and Pull Requests, and carry collaboration forward with global and project memory.

The distribution bundles its runtime. Configure a model API key to get started.

**Not an official DeepSeek product.** Built on DeepSeek Harness and independently developed, with no affiliation with or endorsement by DeepSeek. The upstream runtime and official Web UI are DeepSeek's work.

**Current release: [v1.1.0](https://github.com/See-Sol-Lab/DeepSeekGUI/releases/tag/v1.1.0).** The local Workbench, Git / PR tools, global and project memory, and desktop notifications are available. The Workbench extends the official Harness client through plugins and uses Harness sessions, tools, and permissions.

## Download

| Platform | Download | Requirements |
| --- | --- | --- |
| Windows | [Download installer](https://github.com/See-Sol-Lab/DeepSeekGUI/releases/download/v1.1.0/DeepSeekGUI-Setup-1.1.0.exe) | Windows 10/11, x64 |
| Linux | [Download AppImage](https://github.com/See-Sol-Lab/DeepSeekGUI/releases/download/v1.1.0-linux.1/DeepSeekGUI-1.1.0-x86_64.AppImage) | x64, AppImage; experimental support |

The Windows installer installs to your user account and bundles its runtime. Linux uses a separate AppImage distribution; download and verification details are on the [v1.1.0-linux.1](https://github.com/See-Sol-Lab/DeepSeekGUI/releases/tag/v1.1.0-linux.1) release page.

> **Windows installation:** The installer is not code-signed, so SmartScreen may report an unknown publisher. After checking the download source and SHA256, choose **“More info” → “Run anyway”** to continue.

<details>
<summary>Verify the Windows installer</summary>

After downloading the installer, calculate its SHA256 in PowerShell:

```powershell
Get-FileHash .\DeepSeekGUI-Setup-1.1.0.exe -Algorithm SHA256
```

Compare it with [`SHA256SUMS.txt`](https://github.com/See-Sol-Lab/DeepSeekGUI/releases/download/v1.1.0/SHA256SUMS.txt) before installing. See the [troubleshooting guide](docs/user/deepseekgui/data-troubleshooting.md#windows-smartscreen-blocks-the-installer) if needed.

</details>

## Quick start

1. Install DeepSeekGUI and open it.
2. Go to **Settings → Models** and enter your DeepSeek API key.
3. Choose a model; select one with vision support if you need image input.
4. Return to the home screen and choose a workspace folder.
5. Start a session and describe the task. Review file diffs in Changes and repository status and operation results in Git.
6. Optionally save collaboration preferences in **Settings → Global Memory** and inspect or organize project memory in the conversation's **Memory** view.

See the [quick-start guide](docs/user/deepseekgui/quickstart.md) for a full walkthrough.

## Screenshots

| Dark theme | Light theme |
| --- | --- |
| [![Dark Workbench theme](docs/user/deepseekgui/assets/workbench-dark-1.1.0.png)](docs/user/deepseekgui/assets/workbench-dark-1.1.0.png) | [![Light Workbench theme](docs/user/deepseekgui/assets/workbench-light-1.1.0.png)](docs/user/deepseekgui/assets/workbench-light-1.1.0.png) |

*One local workbench, two themes. Click an image to view it at full size.*

![Built-in browser beside the conversation](docs/user/deepseekgui/assets/browser-1.1.0.png)

*Open a webpage beside the conversation and inspect the assistant's browsing actions and results, with both the conversation and page in view.*

![Model configuration and desktop management](docs/user/deepseekgui/assets/settings-1.1.0.png)

*Configure models and access Harness desktop controls, local plugin management, diagnostics and feedback, and global memory from the same settings window.*

![Git status and session commit history](docs/user/deepseekgui/assets/git-1.1.0.png)

*Inspect the current branch, remote configuration, recent commits, and Git operations recorded in this session.*

![Project memory](docs/user/deepseekgui/assets/project-memory-1.1.0.png)

*Keep project background, confirmed decisions, and collaboration conventions together. Read them as Markdown or ask the assistant to organize them.*

![Global memory](docs/user/deepseekgui/assets/global-memory-1.1.0.png)

*Users edit and save cross-project preferences for the assistant to read; project facts are managed separately in project memory.*

## Workbench features

### Local projects and Git collaboration

- **Changes view** — Inspect staged, modified, new, and conflicted files, open per-file diffs, copy paths, or reveal files in the file manager.
- **Git view** — Inspect branches, remote sync status, recent commits, and commit, push, and PR results from loaded conversation history.
- **Worktrees** — Inspect registered worktree branches and changes, including paths modified in multiple worktrees.
- **Git / PR tools** — Request diffs, staging, unstaging, discarding unstaged changes to tracked files, commits, push previews, pushes, and PR creation through the conversation, with dedicated result cards.
- **Local inspection** — Views read workspace state on demand without model requests. Workspace paths support click-to-reveal, and the built-in terminal can follow the current session directory.

### Memory and collaboration rules

- **Global memory** — Edit cross-project preferences and collaboration instructions in settings; the assistant has read-only access.
- **Project memory** — The assistant maintains project facts in `<folder name>.memory.md` in the workspace. The Memory view supports Markdown reading and requests to organize its contents.
- **Rule templates** — Initialize a global `AGENTS.md` on the managed home's first launch and generate project templates on request, preserving existing files.
- **Recorded context** — Read both memory layers when a session loads and record the content used with the Harness session context.

### Models and desktop tools

- **Models and image input** — Configure DeepSeek or custom model providers and send screenshots and images to vision-capable models.
- **Sessions and permissions** — Start and resume conversations in project folders, inspect tool execution, and control operations through Harness permission modes and approvals.
- **Browser and terminal** — Inspect pages in a visible browser and use the current Harness environment through the built-in DSH Terminal.
- **Desktop notifications** — Receive pending approval and question notices, plus background-job completion or failure notices; click to open the corresponding conversation.
- **Profiles and plugins** — Switch Harness Homes and Profiles, manage compatible plugins, and inspect configuration and runtime status.
- **Desktop integration** — Chinese and English interfaces, system tray, update checks, and local diagnostics.

See the [v1.1.0 release notes](https://github.com/See-Sol-Lab/DeepSeekGUI/releases/tag/v1.1.0) for the complete version changes.

## Why DeepSeekGUI

**Visible project state.** Inspect file changes, branches, commits, and worktrees beside the conversation without requesting the model for each status check.

**Lasting project knowledge.** Global memory stores cross-project preferences; project memory records decisions, conventions, and corrections. Each is managed separately.

**Reviewable operations.** Git, PR, and browser result cards show summaries and details. Commits and pushes use Harness approvals, and you choose the permission mode.

**Visible browsing.** The built-in browser shows the pages the assistant visits, with sensitive interactions subject to Harness approvals.

**Local storage, network access as needed.** Sessions, credentials, settings, and memory are stored locally. Model requests go to your configured provider.

**Built on Harness.** Use native profiles, plugins, hooks, and the CLI, with one runtime shared by the Workbench and conversations.

## Documentation

| Guide | |
| --- | --- |
| [Quick start](docs/user/deepseekgui/quickstart.md) | First session walkthrough |
| [Models and vision](docs/user/deepseekgui/models.md) | API keys, model setup, image input |
| [Workspaces and sessions](docs/user/deepseekgui/workspaces-sessions.md) | Working with folders and sessions |
| [Workbench views and Git tools](docs/user/deepseekgui/workbench.md) | Changes, Git, worktrees, Git / PR tools |
| [Memory](docs/user/deepseekgui/memory.md) | Global memory, project memory, rules templates |
| [Profiles and plugins](docs/user/deepseekgui/profiles-plugins.md) | Harness profiles and plugin management |
| [Permissions](docs/user/deepseekgui/permissions.md) | Sandbox, approvals, and access levels |
| [Desktop tools](docs/user/deepseekgui/desktop-tools.md) | Browser, terminal, updates, diagnostics |
| [Data and troubleshooting](docs/user/deepseekgui/data-troubleshooting.md) | Data locations, privacy, common issues |

The docs also include upstream Harness tutorials and plugin-authoring reference.

## Data and privacy

Managed credentials, settings, sessions, and global memory are stored in the local application data directory, which defaults to `%APPDATA%\DeepSeekGUI\dsh` on Windows. Project memory lives in `<folder name>.memory.md` in the selected workspace. Model requests send task context to your configured provider; browsing, Git / PR operations, plugin management, and update checks also contact their respective network services.

Logs redact credential-like content, and diagnostics stay local. The Windows uninstaller asks whether to delete application data; upgrades preserve it. Check diagnostics and project memory for private content before sharing or committing them.

## Build from source

<a id="run-deepseekgui-from-source"></a>

### Run DeepSeekGUI from source

Requires the Node.js version declared by the repository and pnpm:

```sh
git clone https://github.com/See-Sol-Lab/DeepSeekGUI.git
cd DeepSeekGUI
pnpm install
pnpm run build
pnpm run dev:desktop
```

Build the Windows distribution:

```sh
pnpm run build:desktop-dist
```

See [DeepSeekGUI Desktop](apps/desktop/README.md) for packaging details.

<a id="run"></a>

### Run Harness from npm

Install Node.js, then start the upstream Web UI:

```sh
npx @deepseek-ai/dsh web
```

Opens `http://127.0.0.1:3080` in your browser.

<a id="run-deepseek-harness-from-source"></a>

### Run Harness from source

The public tree contains the upstream Harness source used by the desktop build:

```sh
pnpm install
pnpm run build
pnpm dsh web
```

## Contributing and support

- Report bugs and feedback through [DeepSeekGUI Issues](https://github.com/See-Sol-Lab/DeepSeekGUI/issues).
- Read [CONTRIBUTING.md](CONTRIBUTING.md) before sending a pull request.
- For upstream Harness questions, use [DeepSeek Harness Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions).

## License

Two scopes:

- **Upstream Harness** code stays under DeepSeek's [MIT License](LICENSE-MIT-UPSTREAM).
- **DeepSeekGUI** original work is source-available under the [PolyForm Perimeter License 1.0.1](apps/desktop/LICENSE). Personal, educational, research, hobby, and internal business use are fine. Building a competing product requires a separate license from See-Sol-Lab.

The root [`LICENSE`](LICENSE) explains how the scopes apply. Read [DeepSeekGUI licensing](DEEPSEEKGUI-LICENSE.md) and [third-party notices](THIRD_PARTY_NOTICES.md) before redistributing.

---

DeepSeekGUI is the public release repository. Day-to-day development happens in a private repo; releases publish the product tree.
