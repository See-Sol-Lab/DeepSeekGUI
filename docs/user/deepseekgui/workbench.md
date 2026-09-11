# Workbench views and Git tools

English | [中文](workbench.zh.md)

The workbench sits beside the conversation and shows the state of your project: file changes, repository status, parallel worktrees, and memory. The views read local state on demand, so checking your project costs no model request.

This guide covers Changes, Git, the worktree section within Git, and dedicated Git / PR tools. The Memory view has [its own guide](memory.md).

## Changes view

The Changes view lists the files the current workspace has touched, grouped as staged, modified, new, and conflicted.

For each file you can:

- Open a single-file diff and read it beside the conversation.
- Copy the file path.
- Locate the file in the file manager.

Use the Changes view to review the agent's edits before you commit them. The diff shows the working tree as it is on disk, so it also reflects edits you made yourself.

![Light workbench theme (v1.1.0)](assets/workbench-light-1.1.0.png)

## Git view

The Git view shows the repository behind the workspace:

- Current branch and remote synchronization state.
- Recent commits.
- Commit, push, and pull-request results recorded in the loaded session.

The history section reads the session record, including Git actions the agent performed inside composite tool calls. Reopening a session restores its recorded Git history.

![Git view: worktrees and commit history (v1.1.1)](assets/git-1.1.1.png)

## Worktrees within Git

The worktree section at the top of Git lists registered worktrees, branches, and change summaries. Overlapping modified paths highlight potential conflicts; overlap alone does not mean a merge will conflict.

The view is read-only in this release. Create and remove worktrees with your normal Git tooling.

## Git / PR tools

The agent completes repository work through dedicated Git tools rather than raw shell commands. Through a session you can ask it to:

- Inspect diffs.
- Stage and unstage files.
- Discard unstaged changes in tracked files.
- Commit.
- Preview a push, push, and create a pull request.

Commits, pushes, PR creation, and discarding unstaged changes request Harness approval; staging and unstaging follow the active write permissions. Results appear as dedicated cards with expandable details.

Read the approval before accepting it, exactly as you would for a file edit or a command. [Permissions and approvals](permissions.md) describes the approval model.

## Working with the views

- Views refresh from the local working tree when you open them. They observe the repository; they hold no separate copy of it.
- Workspace file paths in the conversation are clickable and open the file location.
- The built-in DSH Terminal can follow the current session directory, so a manual Git command runs in the same place the views describe.

## Related guides

- [Memory](memory.md)
- [Workspaces and sessions](workspaces-sessions.md)
- [Permissions and approvals](permissions.md)
