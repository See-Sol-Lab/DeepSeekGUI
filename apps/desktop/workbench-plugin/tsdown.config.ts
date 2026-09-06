/**
 * tsdown config for the DeepSeekGUI Workbench client bundle.
 *
 * The official `clientBundle` preset (packages/client/tsdown.client.ts) scans
 * every package manifest under packages for its workspace manifest, so it
 * cannot build a plugin that lives under apps/desktop. This config reproduces
 * the same artifact contract: a closure-factory bundle that self-registers
 * through `window.__ModuleLoader__.load({ id, factory })`, resolving the
 * shared module-table rows (React, Cordis, runtime) through the injected
 * require.
 *
 * The bundle is emitted from the tsc output (`lib/types/client/index.js`), so
 * `tsc -b apps/desktop/workbench-plugin` must run first. Build it with:
 *   pnpm exec tsdown --config apps/desktop/workbench-plugin/tsdown.config.ts
 */

import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { UserConfig } from 'tsdown'
import {
  PLATFORM_MODULES,
  PRELOADED_CLIENT_EXTERNALS,
} from '../../../packages/client/web/src/platform.ts'
import { clientBuildEnvironmentDefines } from '../../../scripts/client-build-environment.ts'

/** Plugin id stamped into the __ModuleLoader__.load handoff. */
const ID = '@see-sol-lab/deepseekgui-workbench'
/** Directory of this config file (entry and output resolve against it). */
const PLUGIN_DIR = fileURLToPath(new URL('.', import.meta.url))
/** Module-table specifiers this bundle requests instead of inlining. */
const EXTERNALS = new Set<string>([...PLATFORM_MODULES, ...PRELOADED_CLIENT_EXTERNALS])

export default [
  // Node half: the loader entry the Harness process imports. Emitted from the
  // tsc output; the host side carries no runtime dependencies to keep.
  {
    name: ID,
    entry: [join(PLUGIN_DIR, 'lib/types/index.js')],
    outDir: join(PLUGIN_DIR, 'lib'),
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  } satisfies UserConfig,
  // Browser half: the closure-factory bundle served through the client
  // module table (see the header comment).
  {
    name: `${ID}/client`,
    entry: { client: join(PLUGIN_DIR, 'lib/types/client/index.js') },
    outDir: join(PLUGIN_DIR, 'lib'),
    format: ['cjs'],
    platform: 'browser',
    dts: false,
    sourcemap: true,
    clean: false,
    deps: {
      // Requested module-table rows stay imports; everything else inlines.
      // The bundle only imports React (baseline) and erased type-only edges,
      // so the rule is the request list, exactly like the official preset.
      neverBundle: (specifier: string) => EXTERNALS.has(specifier),
      alwaysBundle: (specifier: string) => !EXTERNALS.has(specifier),
    },
    define: {
      ...clientBuildEnvironmentDefines(process.env),
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  } satisfies UserConfig,
]
