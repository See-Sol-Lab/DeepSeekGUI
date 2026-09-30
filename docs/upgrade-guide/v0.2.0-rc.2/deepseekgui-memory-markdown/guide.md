---
kind: upgrade-guide
description: "DeepSeekGUI 1.2.0 removes experimental entry memory and converts active entries to Markdown files."
---

# DeepSeekGUI memory returns to Markdown

English | [中文](guide.zh.md)

## Change

DeepSeekGUI 1.2.0 removes experimental Enhanced Memory, its entry tools and mode switch. Global memory is stored in `<Harness Home>/memory.md`; project memory is stored in `<workspace>/<folder-name>.memory.md`. The files provide context at the start of new sessions.

## Migration

1. Start DeepSeekGUI after upgrading. It automatically appends active ordinary entries to the corresponding Markdown files and omits complete text matches.
2. Review **Settings → Global memory** and the session's **Memory** view. Existing Markdown text remains in place.
3. Keep `<Harness Home>/storages/deepseekgui_memory` if you need the original records. Forgotten entries, continuation notes, unreadable records and entries for missing project folders remain there rather than being injected automatically.
4. Check `MIGRATED-TO-MARKDOWN.txt` in that storage directory for the conversion result. Once it exists, later starts do not repeat the migration.

See the [memory guide](../../../user/deepseekgui/memory.md) for editing and session behavior.
