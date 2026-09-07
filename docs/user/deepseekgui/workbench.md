# Workbench views and Git tools

English | [中文](workbench.zh.md)

The workbench sits beside the conversation and shows the state of your project: file changes, repository status, parallel worktrees, and memory. The views read local state on demand, so checking your project costs no model request.

This guide covers the Changes, Git, and Worktrees views and the dedicated Git / PR tools. The Memory view has [its own guide](memory.md).

## Changes view

The Changes view lists the files the current workspace has touched, grouped as staged, modified, new, and conflicted.

For each file you can:

- Open a single-file diff and read it beside the conversation.
- Copy the file path.
- Locate the file in the file manager.

Use the Changes view to review the agent's edits before you commit them. The diff shows the working tree as it is on disk, so it also reflects edits you made yourself.

![The Changes view beside a conversation](assets/workbench-light-1.1.0.png)

## Git view

The Git view shows the repository behind the workspace:

- Current branch and remote synchronization state.
- Recent commits.
- Commit, push, and pull-request results recorded in the loaded session.

The history section reads the session record, including Git actions the agent performed inside composite tool calls. Reopening a session restores its recorded Git history.

![The Git view showing branch, remotes, and session commits](assets/git-1.1.0.png)

## Worktrees view

The Worktrees view lists the registered Git worktrees of the repository with their branches and change summaries. When several worktrees modify the same path, the view marks the overlap so you can resolve it before it becomes a conflict.

The view is read-only in this release. Create and remove worktrees with your normal Git tooling.

## Git / PR tools

The agent completes repository work through dedicated Git tools rather than raw shell commands. Through a session you can ask it to:

- Inspect diffs.
- Stage and unstage files.
- Discard unstaged changes in tracked files.
- Commit.
- Preview a push, push, and create a pull request.

Every state-changing Git and PR action goes through the standard Harness approval. The request names the exact operation and target, and the result appears in the conversation as a dedicated card with a summary you can expand.

Read the approval before accepting it, exactly as you would for a file edit or a command. [Permissions and approvals](permissions.md) describes the approval model.

## Working with the views

- Views refresh from the local working tree when you open them. They observe the repository; they hold no separate copy of it.
- Workspace file paths in the conversation are clickable and open the file location.
- The built-in DSH Terminal can follow the current session directory, so a manual Git command runs in the same place the views describe.

## Related guides

- [Memory](memory.md)
- [Workspaces and sessions](workspaces-sessions.md)
- [Permissions and approvals](permissions.md)
