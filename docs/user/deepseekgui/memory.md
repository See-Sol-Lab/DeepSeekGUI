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

## When a new session reads memory

| Case | What is read, and when |
| --- | --- |
| New session | On its first real request, the current Home's `memory.md` and the `<folder-name>.memory.md` of the session's workspace are read; the session keeps that copy afterwards. Nothing is read before the first message. |
| A file changes during a session | The running session keeps what it started with; new sessions read the new text. |
| Continuing an old session after an app restart | The files are read once when the session reloads, then kept. Requests already sent are never rewritten. |
| Forking a session | The fork is a new session and reads its own workspace's files on its first request. |
| Switching Home or Profile | The Harness restarts; later sessions read the new Home's global memory. |
| Only switching the window to another session | Nothing is read or injected again. |

Each file is read up to 64 KB (UTF-8 bytes). This is a read cap, not the model's token budget; Chinese text takes 3 bytes per character, a little over twenty thousand characters. Beyond the cap only the beginning is included, and the included text says it was truncated; when the project memory is over the cap, your own part is shortened and the "Archive notes (automatic)" area at its end is included in full. Global memory comes before project memory, and both come after the product guide and your AGENTS.md rules.

The session's **Memory** view shows **Memory this session started with**: for each file whether it was included, missing, empty, truncated or unreadable, and how many characters and bytes went in. Each load of the session adds a record, and the newest one is the current load. It is a record of that moment, not today's file.

## Archive notes for the project memory

When you archive a session, DeepSeekGUI collects a few notes worth keeping from it into the project memory, so new sessions in the same project need less repeated background.

- **How.** Archiving completes immediately as usual. Afterwards, in the background, the session's finished turns (only what you said and the assistant's text, without tool output or reasoning) go to the current model in one separate request; the model can only answer with text, gets no tools, and does not continue the conversation's task. Nothing is added to the session. This calls the model service once and may cost money. Before the first use, read the note in the **Memory** view and click **Got it**; until then archiving does not call the model.
- **Which sessions.** A session with at least 20 of your messages or at least 30,000 characters is collected automatically on archive; shorter ones are skipped and can be collected by clicking **Collect notes from this session** in the **Memory** view. When the model finds nothing worth keeping, nothing is written. Archiving the same session again does not repeat the work; after unarchiving and talking more, the next archive collects only the new part.
- **Where.** Notes go into a marked "Archive notes (automatic)" area at the end of the project memory: at most 8 notes and about 1,500 characters at a time, with unconfirmed ones marked "(to verify)". Text outside the area is never touched, and notes identical to what the file already says are skipped; a difference in case, punctuation or numbers is not a repeat. When the conversation clearly overturned an older decision in the area, that line is struck through and marked as superseded. When the area is full (about 6,000 characters) nothing more is written and the Memory view asks you to tidy it. The latest file is read right before writing; if it changes in between, the write is abandoned rather than overwriting it.
- **Global memory gets suggestions only.** Preferences that may suit every project are listed under **Settings → Global memory**; **Add** writes one into `memory.md`, **Dismiss** drops it.
- **When nothing is written automatically.** Chat-only folders (your home folder, a drive root), system or application folders, DeepSeekGUI's own code, running as administrator, a memory file that is a link, or a folder that cannot be written. The notes are then listed in the Memory view for you to add if you want. Nothing is collected for a deleted project folder, an unknown model, or a session deleted right after archiving.
- **When collecting did not finish.** An answer in the wrong format, a cancellation, or the app quitting midway does not advance progress; collect again from the Memory view, and anything already written is not written twice.
- **Switch.** Turn off "Collect notes automatically on archive" in the **Memory** view.
- Records are kept in `<Harness Home>/deepseekgui/archive-memory/`, and global suggestions in `<Harness Home>/deepseekgui/memory-suggestions.json`.

## Rules and session context

A fresh Managed Home receives a global `AGENTS.md` rules file only when it is missing. Existing rules are preserved.

Harness includes both memory files at the start of each new session, within its context budget. Edits apply to new sessions; they do not replace content already sent in an existing session.

Uninstalling with **Delete data** still preserves the global `memory.md` and `AGENTS.md`. Project memory remains in its workspace. Other application data follows the uninstall choice.

Memory is part of model context. Review project memory before publishing the project or attaching it to a report.

## Related guides

- [Workbench views and Git tools](workbench.md)
- [Workspaces and sessions](workspaces-sessions.md)
- [Data and troubleshooting](data-troubleshooting.md)
