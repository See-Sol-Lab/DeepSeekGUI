# Memory

English | [中文](memory.zh.md)

DeepSeekGUI keeps collaboration context in two layers. Global memory records your cross-project preferences and is edited by you. Project memory records facts about one project and is maintained by the assistant. The two layers are stored and managed separately.

Since B7 there are two ways to keep them: the Markdown files described first (still the default), or entries — small versioned records the assistant recalls per message and you can correct, forget and restore one by one. You choose under **Settings → Global memory**; the two never apply together, and switching back is always available.

## Global memory

Global memory lives in `memory.md` under the active Harness Home and is shared by its projects. Saved changes apply to newly loaded sessions; saving checks the Home and original content to avoid overwriting external edits.

- Edit it in **Settings → Global memory**. The assistant reads this file and follows it; you decide its content.
- Use it for durable preferences: language, coding conventions, review requirements, and collaboration rules you want in every session.

![The global memory editor in Settings](assets/global-memory-1.1.0.png)

## Project memory

Project memory lives inside the selected workspace as `<folder-name>.memory.md`, next to the project files it describes.

- The assistant maintains it during sessions: background, confirmed decisions, and working agreements for that project.
- Open the **Memory** view in a session to read it as rendered Markdown. The view shows the file in a fixed-height reading window.
- Use **Ask the assistant to tidy** when the file grows unwieldy. The reading panel shows up to 20,000 characters and reports truncation; this is a display limit, not a file-size limit.
- The file is ordinary Markdown in your project. You can edit it, review it in version control, and see exactly what the assistant recorded.

![The project memory view in a session](assets/project-memory-1.1.0.png)

## Entry memory (optional)

**Settings → Global memory** is titled after the mode in use: legacy shows "Global memory (legacy)" with one button to enable enhanced memory (experimental); once enabled it shows "Enhanced memory (experimental)" with one button back to legacy. Switching asks for confirmation and says what changes: after enabling, the legacy files are kept but no longer read; after switching back the entries are kept but no longer recalled; the two never apply together and nothing switches on its own. Open sessions follow from their next message; nothing already sent is withdrawn.

With entries on:

- The assistant recalls the entries relevant to each message — your global preferences and this project's facts — and records with its own tools what you confirmed or it verified, with the evidence. Global preferences are written directly when you state one; there is no approval step, because every entry stays visible and reversible.
- The **Memory** view in a session lists this project's and the global entries: search, open one for its source (who, which session, when, on what evidence) and history, edit it, forget it, undo the latest change, or restore a forgotten one. **Memory used in this session** folds out exactly what the model was shown, by id and version, and whether it has changed since.
- Settings → Global memory holds the same list for the global entries, plus **Import** and **Export**.
- **Import** previews a legacy file — `memory.md` in Settings, the project's `<folder-name>.memory.md` in the Memory view — cut into segments you tick before they are written; segments already stored are marked. The preview writes nothing and the file is never modified.
- **Export** produces the entries as Markdown text to copy and save wherever you like; it never writes back to the legacy files.
- A stale edit is refused: if another window changed an entry first, the page shows the current version and asks you to reload before editing. Nothing shows as saved before it is on disk.
- Continuation notes are the assistant's hand-over of a task — goal, confirmed decisions, unfinished items, leads, and what was verified back then. Ask it to save progress when you stop; when you continue later, it recalls the note, re-checks the files and Git, and waits for you before resuming.

Deleting a session keeps the entries it wrote; they say the source session is gone. Forgetting is yours, from the pages or by asking the assistant.

## Rules templates

On the first launch of a fresh Managed Home, DeepSeekGUI seeds a global `AGENTS.md` rules file. A project-level template can be generated on request. Seeding fills missing files only; a file you already have is always preserved as it is.

## How memory reaches the session

With Markdown files, Harness injects both layers into the model context when a session loads, subject to a size budget. With entries, the relevant ones are recalled at each message as a small list that replaces the previous one. Either way the injected content is recorded with the Harness session context, so you can trace what the model actually received.

Because project memory is part of the model context, treat it like any project file you might share: review it before publishing the project or attaching it to a report.

## Related guides

- [Workbench views and Git tools](workbench.md)
- [Workspaces and sessions](workspaces-sessions.md)
- [Data and troubleshooting](data-troubleshooting.md)
