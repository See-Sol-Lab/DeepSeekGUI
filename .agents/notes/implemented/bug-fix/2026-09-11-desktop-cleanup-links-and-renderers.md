# Agent Note: Desktop cleanup preserves link targets and releases crashed renderers

Status: implemented

English | [中文](2026-09-11-desktop-cleanup-links-and-renderers.zh.md)

## Problem

A live Electron WebContents can outlast its crashed renderer. Reusing that target leaves the embedded browser unusable. Directory cleanup has a separate ownership problem: session trees and moved Harness homes can contain junctions pointing outside the data being removed. NSIS's [recursive deletion implementation](https://github.com/kichik/nsis/blob/master/Source/exehead/util.c) recurses into directory entries without checking their reparse-point flag.

## Decision

The desktop releases a crashed browser pane after event dispatch and only if the window still owns that exact pane. The next requested browser operation creates a fresh pane. The isolated pane Session routes loopback traffic through the SSRF proxy, including redirect hops.

Session cleanup uses filesystem metadata to unlink directory links rather than traverse them. Uninstall cleanup checks Windows reparse-point attributes before enumeration and uses non-recursive removal for links. It normalizes the moved-home path before rejecting drive roots, reports incomplete cleanup, and retains the pointer when data cleanup fails.

## Alternatives considered

**Treat a non-destroyed WebContents as a healthy renderer.** Electron retains the WebContents after a renderer crash, so that check cannot establish whether the pane is usable.

**Use recursive deletion without examining links.** A data-directory name does not constrain a junction's target. The deletion operation must enforce that distinction.

**Restart the browser automatically after a crash.** Releasing the failed target is sufficient; recreation belongs to the next user or tool request, avoiding a crash-restart loop.

## Consequences

The isolated Electron test exercises the production proxy configuration, a loopback redirect, forced renderer failure, release, and a fresh view without starting Harness. Filesystem tests retain unrelated marker files behind nested and root junctions. Installer preprocessing checks macro expansion without compiling an installer; compiled uninstall behavior remains a release-acceptance requirement.
