# Agent Note: Workbench current inspection and independent form messages

Status: implemented

English | [中文](2026-09-05-workbench-current-inspection.zh.md)

## Problem

Tool history cannot show a file before the agent reads it or show edits made outside the conversation. Form submission through setDraft discards unrelated text, and presentation prose is an unstable source for push form defaults. Reusable question-item ids also merge distinct notification requests.

## Decision

The [Workbench inspector](../../../../packages/api/workbench-inspector/README.md) exposes only list, text, status, and diff through the official Remote transport. SessionQuery lends cwd without creating an agent; existing fs and Git providers own reads. Files and Changes query on opening, navigation, tool completion, and refresh. Closing cancels the request. Changes keeps explicitly labeled commit/push/PR history beneath the current inspection.

Forms call the official Session prompt with queue mode and their own text, leaving draft text and attachments untouched. Push defaults use tool presentation metadata. Notifications use correlated call ids or the official pending-request identity, and only the Session-aware Web consumer suppresses the currently viewed fact.

This partially supersedes the history-only scope in [B5-P5](../architecture/2026-09-04-b5-p5-tool-cards-and-on-demand-inspectors.md). That note remains active for card presentation and provenance; no note is fully superseded or archived.

## Alternatives considered

**Ask the model to browse for the user.** This spends a model turn and does not satisfy independent current-state inspection.

**Run a second Git implementation in Electron.** This duplicates the existing provider and its behavior; a read-only Remote adapter is sufficient.

**Parse presentation sentences as form data.** A wording change breaks defaults. The tool's structured presentation metadata carries those fields directly.

## Consequences

The product gains one stateless read adapter, not another agent, queue, transcript store, or memory engine. Binary and oversized files report explicit read failures. Tests cover real provider reads, containment, paging, cancellation, draft preservation, and request identity. Live isolated UI checks demonstrate file content and actual Git patches without a model call.
