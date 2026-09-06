# Agent Note: B5-P4 — coding actions as DSH tools, task retirement

Status: implemented

English | [中文](2026-09-03-b5-p4-coding-tools-and-task-retirement.zh.md)

## Problem

The B4 coding actions lived behind GUI panels and an APIProxy RPC surface (retired in B5-P1); dsh 0.1.2 models coding actions as tools inside the same agent loop, with parameters/results in the session log and approvals at the action boundary. B5-P4 registers the minimal real-coding toolset over the existing git and pull-request capabilities and retires the task machinery that has no remaining caller.

## Decision

- New plugin `apps/desktop/coding-tools-plugin` (`@see-sol-lab/deepseekgui-coding-tools`) ships in the web-app bundle layer (replacing the retired task row): eleven tools — `git_status`, `git_diff`, `git_stage`, `git_unstage`, `git_revert`, `git_commit`, `git_push_preview`, `git_push`, `pr_availability`, `pr_existing`, `pr_create`.
- Every tool calls an existing capability (`ctx.git` / `ctx.pullRequest`); no git/process/provider logic is re-implemented. Results are the capability's canonical machine values; `output.render` produces model-facing text and generic presenters keep display replay-safe (args only).
- Writes resolve the session policy and canonical repository root. Read-only refuses; workspace-write accepts only roots granted by the official sandbox policy. Destructive/external actions also use the official approval service. Commit captures its staged tree before approval; push previews the selected branch, source commit and effective push URL, then refuses source/destination drift. Ref names cannot supply force/delete syntax; missing approval or cancellation refuses execution.
- Task retirement: `packages/task`, its web-app bundle row and dependency, the subsystem docs (`task.md`/`task.zh.md`), and the generator graph node are deleted in the same change; the git/pull-request capabilities and their provider rows stay (the tools consume them).

## Alternatives considered

- Rebuild the coding-action panels in the GUI and call the capabilities directly (a second execution bus beside the agent loop); rejected — actions stay DSH tools with logged results.
- Keep the task table as an accounting layer for the new tools (no remaining caller, second source of truth); rejected — the task machinery is deleted with the same change.
- Allow read-only tools to skip the approval gate (cheap reads, weaker boundary); rejected — write actions keep the official approval boundary and fail closed.

## Verification

- `tsc -b apps/desktop/coding-tools-plugin` clean; 12 focused unit tests pass (registration surface, capability calls, session-cwd fallback, read-only refusal, approval rejection before any git write, PR guards).
- A real dsh 0.1.2 service booting the web bundle with the coding-tools row loads with no loader errors.

## Consequences

- The B4 task record/worktree-accounting path is gone; worktree lifecycle primitives remain on the git seam for explicit user- or agent-chosen actions. Model-driven end-to-end verification (model → tool → result → next turn) needs an API key and lands in the acceptance environment, like B5-P3.
