---
description: "Read current workspace files and Git patches without asking a model; configure bounds and inspect the read-only Workbench Remote API."
kind: "package-reference"
---

# @deepseek-ai/dsh-workbench-inspector

English | [中文](README.zh.md)

## Summary

Browse workspace directories, open text files, and inspect current Git status and patches without a model request. DeepSeekGUI maintains this adapter over the composed filesystem, Git, and SessionQuery providers. Reads are bounded and cancellation-aware; this package has no write endpoint or durable state.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

The DeepSeekGUI Web composition mounts this plugin as a Loader row. Custom compositions need fs, git, sessionQuery, and typert providers; it is not an installable bundle by itself.

| Field | Default | Meaning |
| --- | --- | --- |
| logLimit | 30 | Newest commits the overview returns |
| maxTextBytes | 524288 | Maximum file-text or diff response size; oversized content fails instead of silently clipping |

WorkbenchFileText contains path and complete bounded text. WorkbenchMemory describes the project memory: the Session cwd, the file name `<folder name>.memory.md` (the folder prefix keeps it distinct from the global memory.md under the DSH home), its text or null when the file does not exist yet, and whether the project has an AGENTS.md. WorkbenchRepository contains the Git root and the provider's RepoStatus. WorkbenchOverview carries the root, the RepoStatus, the configured remotes, the newest commits (sha, subject, author, time), and every registered work tree as a WorkbenchWorktree: the provider's WorktreeInfo plus `current` (the Session's repository root) and `changedPaths` (that tree's own changed paths; empty when clean, unreadable, or bare). Text queries distinguish the Session workspace from its Git root, so untracked repository files use the correct base. Directory browsing is deliberately absent: the desktop opens the system file manager for that.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Read ownership and bounds</summary>

SessionQuery lends the recorded cwd for live or cold Sessions without creating an agent. The filesystem provider resolves canonical targets and tests containment, including symlinks; it owns text decoding and binary rejection. Git queries use the Session's actual repository. The frontend reads on opening, navigation, completed tools, or manual refresh, and cancels requests on close. There is no polling, transcript copy, or model tool registration.

No invariant companion is published: this adapter owns no mutable replica whose state could diverge. Request checks and provider tests cover containment and bounds.

Git inspection disables optional index locks, external diff/textconv programs, and fsmonitor hooks. These reads do not opt into repository-configured command execution.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Filesystem provider API](../../fs/fs/README.md)
- [Git provider API](../../git/git/README.md)
- [SessionQuery](../../session-query/session-query/README.md)

<a id="model-experience"></a>
## Model Experience

None, as these user-requested reads register no prompt or tool and append no Session events.

#### KV Cache effect

No direct effect; opening a file or patch does not alter a model request.

## Known Limitations and Deferred Work

- Text-only viewing; binary files are rejected by the provider and oversized text requires another viewer.
- Filesystem and Git providers must describe the same execution world.
- External filesystem edits are observed on refresh; no filesystem watcher is installed.

### Dev Note

None.
