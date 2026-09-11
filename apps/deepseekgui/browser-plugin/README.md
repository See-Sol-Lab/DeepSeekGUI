# @see-sol-lab/deepseekgui-browser

English | [中文](README.zh.md)

DeepSeekGUI's browser plugin exposes a visible Microsoft Edge browser to the agent through the official Harness tool-calling loop. It combines read-only browsing, interaction tools, SSRF protection, permission levels, and approval for sensitive actions.

## Tools

### Read-only (L0)

- `browser_navigate` opens a URL after the SSRF policy accepts it. Local, private, and reserved addresses are refused, including DeepSeekGUI's own loopback control service. Inside DeepSeekGUI every navigation also slides the embedded browser panel out, whether or not the user collapsed it earlier; the user may collapse it again, and nothing but the next navigation reopens it.
- `browser_snapshot` returns the accessibility tree and visible text, with stable `ref` values for later interaction.
- `browser_screenshot` saves a page screenshot locally. The note that comes back with the path is decided from the model that made the call: a model whose catalog entry declares no image input is told plainly that it cannot read the file and should not retry; a model that accepts images is told it can read it. The capture itself is never withheld.
- Reads against the shell's own empty placeholder page (the pane was reopened or rebuilt) fail with a plain instruction to navigate again instead of returning the placeholder copy; a collapsed pane (no bitmap to capture) reports itself the same way instead of a raw "0 width" error, asking the model to have the user open the panel rather than popping it open by itself.
- `browser_wait` waits for load, network idle, a selector, or a bounded delay.
- `browser_tabs` lists, creates, switches, and closes tabs; inside DeepSeekGUI the panel is single-tab, and `new`/`close` say so instead of pretending. Closing an index that does not exist is an error, not a silent no-op.

### Interactive (L1)

- `browser_click` and `browser_hover` target a stable `ref`, text, CSS selector, or role and name. Every interaction acts on the first *visible* match in document order: a page that keeps hidden duplicates in the DOM (cards of other pagination pages, collapsed sections) no longer pins the tool to a hidden element until the timeout, and a selector matching many elements is not a strict-mode error. A locator that matches nothing fails within a few seconds with a pointer to `browser_snapshot`; one that matches only hidden elements says how many and why.
- `browser_type` enters text with optional clearing and Enter.
- `browser_scroll` scrolls the page or brings an element into view.
- `browser_keyboard` sends supported keys to the browser.

### Sensitive (L2)

- `browser_submit` submits a form, sends a message, or completes a login action only after the official Harness ApprovalService authorizes it. A missing approval service fails closed.

The interaction tools inject input inside the browser process through CDP. They never move the user's physical mouse, type through the physical keyboard, or take desktop focus.

Read-only sessions reject every L1 interaction. L2 actions pass the read-only check and then require approval.

## Installation

The DeepSeekGUI Managed Profile includes the browser overlay. A compatible custom Profile can install the package through the official plugin path:

```sh
dsh plugin add @see-sol-lab/deepseekgui-browser

# Development tarball
dsh plugin add ./see-sol-lab-deepseekgui-browser-0.1.0.tgz
```

The package declares `dsh.bundle.patch`, so `dsh plugin add` inserts its bundle into the Profile composition without a manual patch edit.

Use a registry package or tarball for a plugin with runtime dependencies. pnpm does not link the transitive dependencies of a local directory specification into an isolated Profile's `node_modules`.

## Runtime dependencies

`playwright-core` belongs to the plugin's runtime closure under the Profile `node_modules`; it is not added to the DeepSeekGUI private runtime or Electron payload. The plugin reuses the installed Microsoft Edge channel and downloads no browser engine.

## Security

- **SSRF enforcement:** URL validation checks the protocol, length, credentials, DNS result, and every resolved address. The browser context uses a local proxy that connects to the checked IP and revalidates every redirect.
- **Permission levels:** L0 is read-only, L1 is refused in read-only sessions, and L2 requires the official ApprovalService.
- **No arbitrary evaluation:** V1 exposes no page-script evaluation tool.
- **Ephemeral cookies:** browser cookies are not persisted in V1. A user can complete an approved login in the visible browser, but a later browser run starts without that cookie state.

## Development

```sh
pnpm --dir apps/deepseekgui/browser-plugin install
node node_modules/typescript/bin/tsc -b apps/deepseekgui/browser-plugin
pnpm exec vitest run apps/deepseekgui/tests/browser-plugin
```

Unit tests live under `apps/deepseekgui/tests/browser-plugin/`. Real-browser smoke testing needs Microsoft Edge and outbound network access.

Approval is followed by target and cancellation checks. Snapshot references belong to the captured page and URL; ambiguous or stale references fail. Failed launches close their browser and proxy resources. Typed text is summarized by length rather than echoed in results.
