# Agent Note: Desktop operations retain their approved target and report completion accurately

Status: implemented

English | [中文](2026-09-11-desktop-state-and-operation-consistency.zh.md)

## Problem

Dialogs, polling, subprocesses, and filesystem operations settle asynchronously. Reusing an old target or interpreting an attempted operation as completed can overwrite newer data or present an incorrect state.

## Decision

Home migration validates manifest paths, real directory relationships, and the source hashes before old-copy cleanup. Failures after stopping Harness restore service where possible and preserve errors. The Home pointer is written atomically. Session imports stage complete copies, reject unreadable discovery, and avoid importing deleted IDs.

Launcher state is persisted before reporting a successful boot. Shutdown releases its in-flight markers even after failure. Delayed callbacks retain their process or Home identity. Plugin and permission confirmations cannot authorize a different Home, and incompatible desktop operations are blocked while plugin writes or migration are in progress. Async command failures reach the initiating control channel. Failed subprocess cancellation retains the active process and its occupied slot until real exit.

Git paths use literal pathspecs. Revert checks the approved patch; push uses an opaque proof of the real destination while displayed URLs and diagnostics redact credentials. Deadlines remain failures even when a subprocess later exits successfully. PR bodies travel through stdin. Workbench views distinguish unavailable worktree status from a clean tree, show both sides of partially staged files, and reset project-local display state when changing sessions.

Updates verify cache location, platform, version, length, and digest. Release-manifest generation accepts same-version Windows and Linux x64 installers and rechecks their recorded hashes. A cancelled installation retains the verified download; confirmation is followed by another integrity check. Browser actions recheck cancellation and their target after approval; inaccessible or ambiguous references fail explicitly. Failed browser launches release their resources. Terminal input and resize commands use JSON lines so pipe chunk boundaries cannot alter commands; shim arguments preserve paths with spaces and shell metacharacters.

Global-memory saves compare the opened Home and original content before replacing the file. Memory injection reads a bounded UTF-8 prefix and distinguishes unreadable files from absent files. File seeding uses exclusive creation. Settings reject stale polling responses, and streaming display retains the new text when its authority replaces a block.

## Consequences

Each check protects a concrete asynchronous handoff, filesystem write, or subprocess result. It does not introduce automatic retries or a second runtime. Source review and non-emitting type checks do not validate packaged behavior; focused runtime and installation acceptance remain necessary before release.

## Alternatives considered

Checking only at button click leaves the approval-to-write interval unprotected. Treating a zero exit code as success misses elapsed deadlines. Automatic retries can repeat mutations; explicit target checks and truthful failures keep one operation under its owner.
