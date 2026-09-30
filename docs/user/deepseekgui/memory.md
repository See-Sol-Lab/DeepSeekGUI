# Memory

English | [中文](memory.zh.md)

DeepSeekGUI stores memory in two ordinary Markdown files. Global memory records your cross-project preferences and is edited by you. Project memory records facts about one project and can be maintained by the assistant or edited in the app.

## Global memory

Global memory lives in `memory.md` under the active Harness Home and is shared by its projects.

- Edit it in **Settings → Global memory**. The assistant reads this file; you decide its content.
- Use it for durable preferences such as language, coding conventions and review requirements.
- Saving checks the active Home and original text. If another window or editor changed the file, reload it before saving.

## Project memory

Project memory lives in the workspace as `<folder-name>.memory.md`.

- The assistant can maintain it with ordinary file tools, recording project background and confirmed decisions.
- Open the session's **Memory** view to read or edit the file. Saving refuses to overwrite changes made elsewhere during editing.
- Use **Ask the assistant to tidy** when the file becomes difficult to read.
- The reading panel shows up to 20,000 characters and reports truncation. This display limit does not limit the file stored on disk.

## Upgrading from Enhanced Memory

DeepSeekGUI 1.2.0 removes experimental Enhanced Memory and its entry-mode controls. It returns to the original Markdown memory workflow.

On the first launch, active ordinary entries are appended to global or project memory, omitting only complete text matches. Existing Markdown content is kept. Forgotten entries, continuation notes, unreadable records and entries whose project folder no longer exists remain in the old backup rather than being injected automatically.

The old storage remains at `<Harness Home>/storages/deepseekgui_memory`. `MIGRATED-TO-MARKDOWN.txt` records the conversion. Review the Markdown files after upgrading; keep the backup if you need to recover material that was not converted.

## Rules and session context

A fresh Managed Home receives a global `AGENTS.md` rules file only when it is missing. Existing rules are preserved.

Harness includes both memory files at the start of each new session, within its context budget. Edits apply to new sessions; they do not replace content already sent in an existing session.

Uninstalling with **Delete data** still preserves the global `memory.md` and `AGENTS.md`. Project memory remains in its workspace. Other application data follows the uninstall choice.

Memory is part of model context. Review project memory before publishing the project or attaching it to a report.

## Related guides

- [Workbench views and Git tools](workbench.md)
- [Workspaces and sessions](workspaces-sessions.md)
- [Data and troubleshooting](data-troubleshooting.md)
