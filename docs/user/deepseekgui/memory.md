# Memory

English | [中文](memory.zh.md)

DeepSeekGUI keeps collaboration context in two layers. Global memory records your cross-project preferences and is edited by you. Project memory records facts about one project and is maintained by the assistant. The two layers are stored and managed separately.

## Global memory

Global memory lives in the Managed Harness Home and applies to every project.

- Edit it in **Settings → Global memory**. The assistant reads this file and follows it; you decide its content.
- Use it for durable preferences: language, coding conventions, review requirements, and collaboration rules you want in every session.

![The global memory editor in Settings](assets/global-memory-1.1.0.png)

## Project memory

Project memory lives inside the selected workspace as `<folder-name>.memory.md`, next to the project files it describes.

- The assistant maintains it during sessions: background, confirmed decisions, and working agreements for that project.
- Open the **Memory** view in a session to read it as rendered Markdown. The view shows the file in a fixed-height reading window.
- Use **Ask the assistant to tidy** when the file grows unwieldy. Project memory holds up to 20,000 characters; the tidy action condenses older content while keeping confirmed facts.
- The file is ordinary Markdown in your project. You can edit it, review it in version control, and see exactly what the assistant recorded.

![The project memory view in a session](assets/project-memory-1.1.0.png)

## Rules templates

On the first launch of a fresh Managed Home, DeepSeekGUI seeds a global `AGENTS.md` rules file. A project-level template can be generated on request. Seeding fills missing files only; a file you already have is always preserved as it is.

## How memory reaches the session

When a session loads, Harness injects both layers into the model context, subject to a size budget. The injected content is recorded with the Harness session context, so you can trace what the model actually received.

Because project memory is part of the model context, treat it like any project file you might share: review it before publishing the project or attaching it to a report.

## Related guides

- [Workbench views and Git tools](workbench.md)
- [Workspaces and sessions](workspaces-sessions.md)
- [Data and troubleshooting](data-troubleshooting.md)
