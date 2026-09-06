# Agent Note: B5-P5 — tool-result cards and on-demand inspectors

Status: implemented

English | [中文](2026-09-04-b5-p5-tool-cards-and-on-demand-inspectors.zh.md)

## Problem

B5-P4 tools log their results into the session like every other tool, so they already arrive in the conversation — but through the generic fallback row (title plus raw text), and the B4-era inspection surfaces (Files / Changes / Git·Review / Runtime detail pages, plus commit/push/PR process pages) were retired in B5-P1/P4 with no product-shaped replacement. Flat top-level navigation is already gone; what remained missing was card presentation for DeepSeekGUI-owned tools, a unified on-demand inspection entry, and small forms for the human inputs (commit message, push remote/ref, PR body) that old process pages used to collect.

## Decision

- All new browser UI lands in the existing `apps/desktop/workbench-plugin` client half (DeepSeekGUI composition only), over official slots, with three owned locale namespaces (`deepseekgui.workbench` existing, plus `deepseekgui.tools` and `deepseekgui.inspector`).
- Keyed `tool.call.toolview` rows own the 23 DeepSeekGUI wire keys (8 git status/diff/index verbs, `git_commit`, `git_push_preview`, `git_push`, `pr_availability`/`pr_existing`/`pr_create`, and the 12 `browser_*` tools) and replace the generic fallback for those calls. A row collapses to state dot + title + one-line conclusion (or the first failure line, in error tone); expansion folds 完整输出 and 调用参数 behind native disclosure sections and lists parsed diff files and staged/unstaged/untracked/conflict counts. Row models are pure functions of the frozen call slice; because the client only sees rendered content, the parsers target the deterministic coding-tools render texts and degrade to a readable first line on malformed input.
- Human input opens on the owning card. The [current-inspection decision](../feature/2026-09-05-workbench-current-inspection.md) owns draft-preserving Session submission and metadata-based push defaults; forms never execute tools or bypass the P4 approval gate.
- A unified header entry opens Files, Changes, Runtime detail, Sessions, and Memory. Current filesystem/Git reads are owned by the [read-only adapter](../../../../packages/api/workbench-inspector/README.md); commit/push/PR history retains tool/time/seq provenance. Runtime detail reads official projections. No inspector polls while closed.
- The accepted Host-plugin/Remote read route is implemented by the current-inspection decision. The alternative of running a parallel Git implementation in Electron remains rejected.

## Alternatives considered

- Recreate the real-time filesystem/Git read channel inside P5 (a desktop git-CLI twin or a second host channel); rejected — the accepted route is the later official gateway/typert read-only domain proposal, and panels show annotated window aggregates with clear empty states instead.
- Bring back standalone process pages and flat top-level tabs for inspection and human input; rejected — inspection stays in the unified entry and human inputs open small forms on the owning card.
- Let cards execute tools directly when a form submits; rejected — forms dispatch user instructions through the official composer queue, and the P4 approval gates stay.

## Verification

- `tsc -b apps/desktop/workbench-plugin` clean; `oxlint` 0 errors on the plugin sources and tests; 49 focused tests pass across 7 files (registration surface incl. all 23 keys, pure card models, pure inspector aggregations, jsdom row/inspector presentation and form dispatch). Component specs run with `NODE_ENV=test` because this sandbox exports `NODE_ENV=production`, which resolves React's production build and breaks `act()` (the known repo-wide jsdom baseline).
- `verify-client-ui-i18n` green (481 client UI files), `verify-client-packages` and `verify-package-dependencies` green; the workbench client bundle rebuilt through its tsdown config (75.6 kB `lib/client.js`).
- Real-path smoke: desktop Electron boot against a real dsh 0.1.2 service prints `[deepseekgui] window loaded` with no loader or console errors from the plugin modules. Visual resolution at normal DPI and model-driven end-to-end evidence are handed to acceptance.

## Consequences

- Labeled conversation history and current owner queries remain separate; the read-only adapter supplies current file/Git facts without a model turn.
- `conversation.session.header.utilities` gained its first occupant; later phases (Memory in P7) can register further inspector panels behind the same entry.
