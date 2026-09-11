# Agent Note: Session deletion waits for its owner and retains minimal records

Status: implemented

English | [中文](2026-09-11-desktop-session-deletion.zh.md)

## Problem

Removing a Session log while its Agent is still active can recreate deleted content. Removing only the list entry also leaves derived search content behind.

## Decision

The desktop signs a deletion request for one Harness Home and Session ID. Its ephemeral private key stays in the desktop process; the Harness receives the public key. SessionController and the JSONL backend both require the composed authorization policy. The controller rejects new user submissions, waits for the current Agent activity, and disposes the AgentHandle it owns. It refuses independently owned child Agents instead of stopping unrelated sessions.

JSONL records deletion intent before removing content. The record contains ID, title, deletion time, workspace directory for access checks, and incomplete/completed state. Projection checkpoints and SQLite search documents are removed through their owning services. Session log generations and local attachment references are removed without following directory links. Shared content-addressed attachment files remain; unreferenced-attachment collection is separate work. The POSIX lease inode stays in place while the deletion lease is held.

An incomplete deletion remains visible for retry. Deleted IDs cannot be created, reopened, or written through JSONL. Exact Session queries report deleted or incomplete status after checking workspace access. An unfiltered title/ID search can return deletion metadata; erased message text is never searchable. Existing observation cuts already delivered to callers are not retroactively revoked, but reusable cache entries are discarded and new queries consult the deletion record.

## Rationale

Deleting a log while its Agent remains active permits later writes to recreate content. Announcing removal alone changes the UI without releasing that writer. The Agent owner can drain and detach precisely one conversation; restarting the whole Harness would unnecessarily interrupt unrelated work. Minimal records distinguish a known deletion from a search miss without retaining a second transcript.

## Consequences

This implementation has source review and non-emitting type-check evidence. Runtime tests, recorded snapshots, generated Remote artifacts, and packaged acceptance require the subsequent validation pass. No runtime test or package build was executed during this review.

## Alternatives considered

Restarting the whole Harness interrupts unrelated conversations. Keeping a hidden transcript for search retains the content the user deleted. The implementation instead releases the owned Agent and keeps metadata only.
