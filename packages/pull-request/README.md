---
description: "The pull-request package group: the ctx.pullRequest capability contract and its GitHub provider, feeding the DeepSeekGUI PR tools."
kind: "package-group"
---

# packages/pull-request

English | [中文](README.zh.md)

## Summary

The `pull-request/` group gives agents provider-neutral pull-request facts and creation: `pull-request/` defines the `ctx.pullRequest` capability contract (availability, duplicate guard, creation), and `pull-request-gh/` serves it on the host through the user's logged-in GitHub CLI — never a token. Consumers such as the DeepSeekGUI coding tools register model-facing tools over this seam and own approvals; nothing in the group touches model text or tokens. This page maps the group; each package README owns its contract and configuration.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`pull-request/`](pull-request/README.md) | Defines the pull-request capability: provider availability facts, duplicate guard, and creation | `ctx.pullRequest` |
| [`pull-request-gh/`](pull-request-gh/README.md) | GitHub provider over the user's logged-in `gh` — never a token | registers on `ctx.pullRequest` |

The seam deliberately stays free of model-facing text; the DeepSeekGUI coding-tools plugin (B5-P4) is the current consumer that adds tools, presentation, and approval gates.

-----

<a id="related-documentation"></a>
## Related documentation

- [Pull-request subsystem](../../docs/subsystems/pull-request.md) — the capability contract and the provider login facts.
- [Capability seams decision](../../.agents/notes/implemented/architecture/2026-06-13-capability-seams.md) — why a capability is Service Definition / provider / consumer.
- [B5-P4 coding tools note](../../.agents/notes/implemented/architecture/2026-09-03-b5-p4-coding-tools-and-task-retirement.md) — the tools that consume this seam and retire the task-era PR RPC surface.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
