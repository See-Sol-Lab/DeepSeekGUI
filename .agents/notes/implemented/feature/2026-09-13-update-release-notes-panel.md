# Agent Note: Readable release notes in the update panel and a hover preview

Status: implemented

English | [中文](2026-09-13-update-release-notes-panel.zh.md)

## Problem

The update panel placed the manifest's `releaseNotes` into one text block with `textContent`, below the version line and above the Download / Dismiss buttons. Published notes are the release page body: bilingual, several thousand characters, with a language switcher line, `<a id>` anchors, `## 中文` / `## English` headings and fenced code. In the 300px panel the raw Markdown markup was visible, the block could not scroll, and the buttons were pushed below the window edge, so a user who opened Check for Updates could neither read the notes nor reach Download. The parser also capped notes at 4,000 characters, which truncated the Chinese half and dropped the English half entirely. There was no way to see what changed without opening the panel.

## Decision

`apps/deepseekgui/src/release-notes.ts` is one pure module shared by the Chrome renderer and tests: `splitReleaseNotesByLanguage` recognises whole-line `中文` / `English` ATX headings, ends a section at the next language heading or a top-level `---`, drops navigation-only lines (anchor-link switchers, HTML-only lines, comments) from the shared head and tail, and ignores anything inside fenced code. `selectReleaseNotes` returns the current UI language's section with the shared head and tail, falls back to the other language when the current one is absent, and returns the whole text when there are no language headings. `parseReleaseNotes` builds a block tree of headings, paragraphs, flattened lists with a depth, fenced code, thematic breaks and inline text / bold / inline code / links; only `https:` targets without credentials become links (`safeReleaseLink`), images become their alt text, and raw HTML can only become text. `previewReleaseNotes` keeps the first N content items and reports the hidden count. `apps/deepseekgui/src/chrome/release-notes-dom.ts` projects the tree with `createElement` and `textContent` only; link clicks call back instead of navigating.

The renderer restructures the update panel: `#update-status` holds the version line, the notes region (collapsed to six items with an expand / collapse control bound to the version, `role="region"` and focusable) and short notes such as the SmartScreen line, and scrolls independently; `#update-actions` holds Download / Install / Cancel / Dismiss, "View full release" and the auto-download switch. The panel is a column flex container bounded by the overlay height and `min(440px, 100vw - 20px)` wide. `#update-hint` appears beside the status pill while an update is available, verified or downloading; hover or keyboard focus expands the Chrome view and shows `#update-preview` (the same block tree, first five items, pointer-events none), leaving or blurring collapses it, Escape closes it, and clicking opens the update panel. A programmatic focus return from `closeMenu` is suppressed once so Escape does not re-open the preview.

`UpdateView.releasePageUrl` is computed in `buildModel` by `releasePageUrlFor(feedUrl, latestVersion)`: only the built-in public channel yields `RELEASE_PAGE_URL_PREFIX` + version (the `v<version>` tag rule that `scripts/generate-update-manifest.ts` follows); a private feed yields null and no entry. Note links and that entry send the closed command `open-external-link`, validated in `parseControlCommand` with the same `safeReleaseLink` rule and handled in main by `shell.openExternal`; the Chrome view keeps its unconditional `will-navigate` block. `UPDATE_RELEASE_NOTES_MAX` is 32,000 characters, sized for a bilingual full text rather than a summary.

## Alternatives considered

**Native `title` tooltips for the hover preview.** They render outside the 47px Chrome view without expanding it, but only carry plain text and truncate; the preview would not share the panel's rendering rules.

**A full Markdown library.** Its HTML output would need sanitising and would bring raw HTML, images and embedded content into a trusted local renderer; the restricted grammar above is small enough to own, and the DOM projection makes anything unrecognised text by construction.

**Guessing the language when headings are absent.** Rejected: notes without sections show in full rather than being cut on a heuristic.

**Opening links through the Compatibility View's link handler.** The Chrome view is a separate renderer whose navigation is blocked outright; a validated command through the existing control path keeps one exit and one rule.

## Consequences

Users see their language's notes as readable text, can expand or scroll, and always reach the action buttons; the hover preview shows the change list before any download decision, and hovering never starts one. Long notes now survive the parser cap. The renderer gained one command and two DOM containers; the jsdom renderer suite covers language selection, collapse / expand, link and release-page commands, hint preview open / close / focus / Escape and the no-download invariant, and `release-notes.spec.ts` runs the real v1.1.1 notes (`tests/fixtures/release-notes-v1.1.1.md`) through the split and parser. Real-window checks (narrow window, keyboard, both languages) remain manual acceptance.
