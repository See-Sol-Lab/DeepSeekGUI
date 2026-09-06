# Agent Note: B3-P3 Session Interaction Completion — the single permission-label owner

Status: implemented

English | [中文](2026-08-31-b3-p3-session-interaction-completion.zh.md)

## Problem

The Workbench surface is the official DSH web client under the DeepSeekGUI brand, so the complete Session interaction set (list, search, create, history, prompt, queue, steer, cancel, rename, fork, archive; model, reasoning, permission, preset, attachments, Skills, Commands, Plan, Todo, Goal, Jobs, Subagents, Deliverables and user questions) already rides the official client-runtime object layer — pagination, reconnect, pending interaction, queue and title state machines included. B3-P3's job is to close the one durable duplication the B3 backlog names (B3-12③): the permission preset labels existed in two locale namespaces with identical values — `settings.permission` in `ui-permission-presets` (the Permission UI's own owner) and `access.option.*` in `ui-conversation` (the composer chip's private copy) — plus a third hard-coded English `Full access` in the picker's display transform. Three homes for one fact, already drifting in the official composition itself (picker `Full access` vs row `Full access (High risk)`).

## Decision

One owner for the design-set preset labels: the official `settings.permission` namespace, whose `option.*` keys `ui-permission-presets` already registers. Every surface consumes it directly; misses fall back to the conventional title-case display transform:

- **ui-permission-presets picker** (`optionsOf`): resolves `option.<value>` through the namespace (bound untyped so arbitrary host preset names stay legal), falling back to `displayPermissionPreset` for names the namespace does not carry. The picker and the General-settings row now render the same localized labels.
- **ui-conversation composer chip** (`PermissionSelect`): the bar's inject face carries a `permissionT` translator bound to the official namespace; the chip resolves `option.<value>` through it and falls back to its display transform. The `access.option.*` keys are deleted from the conversation namespace — the design-set labels no longer live there. The risk descriptions (`access.optionDesc.*`) and the Full access confirmation gate (`access.confirm.*`) stay in the conversation namespace; the official picker's confirmation copy stays in its own `permission.access` namespace (an existing deliberate independent copy, per the plugin's own note).
- **Miss semantics**: the locale translate falls back to the bare key for unknown keys (namespace lookup, then the common namespace, then the key), so a returned key means "no owner label" — both consumers treat that as a miss and fall back to title-case, which keeps a composition without `ui-permission-presets` (an optional bundle) rendering readable labels.

No DeepSeekGUI Session facade, private DTO, plugin allowlist, second running state, or polling replacement for events was added; the Session interaction set itself was verified as already present and functional in the composed application rather than reimplemented.

## Alternatives considered

**Keeping the composer chip's private `access.option.*` copy.** That is the status quo the backlog names; two identical dictionaries with independent edit histories is exactly the drift B3-12③ exists to remove.

**Making `ui-conversation` the owner and having the picker consume its namespace.** The Permission UI's own package is the natural home of permission labels; the settings row already read it, and the optional-bundle independence rule cuts both ways (either owner can be absent from a custom composition).

**Rendering through `displayPermissionPreset` everywhere (no namespace).** That is a hard-coded English `Full access` with title-case for the rest — it fixes the duplication by deleting localization, which the product explicitly did not want.

## Consequences

The design-set preset labels now have exactly one home, and the composer chip, the `/permission` picker and the General-settings row render the same localized text (previously the picker showed hard-coded English while the chip and row showed localized copy). A composition without `ui-permission-presets` still renders readable title-case labels in the chip because the key-fallback is treated as a miss. The conversation namespace loses six keys; the picker's label assertions in its spec now expect the namespace values.
