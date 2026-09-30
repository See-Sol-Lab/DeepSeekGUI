/**
 * DeepSeekGUI (2026-09-29): process entry for workspace grant changes made
 * out of the Harness — see `./helper.ts`.
 *
 *   node acl-helper.js grant  --workspace <dir> [--read-only <dir>]...
 *   node acl-helper.js revoke --workspace <dir>
 *   node acl-helper.js purge  --workspace <dir> [--read-only <dir>]...
 *
 * Success prints one JSON line `{"ok":true,"changed":…,"ms":…}` and exits 0;
 * failure prints `acl-helper: <detail>` to stderr and exits 1.
 * @module @deepseek-ai/dsh-sandbox-windows-acl/acl-helper
 */

import { parseHelperArgs, runHelper } from './helper.ts'

const started = performance.now()
try {
  const changed = runHelper(parseHelperArgs(process.argv.slice(2)))
  process.stdout.write(`${JSON.stringify({ ok: true, changed, ms: Math.round(performance.now() - started) })}\n`)
} catch (error) {
  process.stderr.write(`acl-helper: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
