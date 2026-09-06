---
description: "The git package group: the ctx.git capability contract and its local git-command backend, owned by the repository-change toolset."
kind: "package-group"
---

# packages/git

English | [中文](README.zh.md)

## Summary

The `git/` group gives agents read and write access to a repository: `git/` defines the `ctx.git` capability contract (identity, HEAD/upstream, work trees, status, diff, index writes, guarded commits, push preview/push), and `git-local/` serves it on the host through the `git` command line with bounded output capture. Consumers such as the DeepSeekGUI coding tools register model-facing tools over this seam; nothing in the group formats model text or prompts. This page maps the group; each package README owns its contract and configuration.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`git/`](git/README.md) | Defines the git capability: repository identity, status/diff reads, index writes, guarded commit, and push preview/push | `ctx.git` |
| [`git-local/`](git-local/README.md) | Host backend over the `git` executable: exact-argv calls, bounded output, and whole-tree safety for writes | registers on `ctx.git` |

The seam is deliberately free of model-facing text and process ownership decisions; the DeepSeekGUI coding-tools plugin (B5-P4) is the current consumer that adds tools, presentation, and approval gates.

-----

<a id="related-documentation"></a>
## Related documentation

- [Git subsystem](../../docs/subsystems/git.md) — the capability contract, the porcelain-v2 status vocabulary, diff scopes, and the commit/push guards.
- [Capability seams decision](../../.agents/notes/implemented/architecture/2026-06-13-capability-seams.md) — why a capability is Service Definition / provider / consumer.
- [B5-P4 coding tools note](../../.agents/notes/implemented/architecture/2026-09-03-b5-p4-coding-tools-and-task-retirement.md) — the tools that consume this seam and retire the task-era git RPC surface.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
