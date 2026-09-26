import { describe, expect, it } from 'vitest'
import { bundledPackageManager } from '../src/bundled-package-manager.ts'

describe('bundledPackageManager (DeepSeekGUI)', () => {
  it('runs the desktop-supplied pnpm entry through the current executable, like the official desktop host', () => {
    expect(bundledPackageManager({ DSH_PNPM_ENTRY: 'C:/app/resources/dsh/node_modules/pnpm/bin/pnpm.cjs' }, 'C:/app/DeepSeekGUI.exe')).toEqual({
      command: 'C:/app/DeepSeekGUI.exe',
      args: ['--expose-internals', 'C:/app/resources/dsh/node_modules/pnpm/bin/pnpm.cjs'],
      env: { ELECTRON_RUN_AS_NODE: '1' },
    })
  })

  it('keeps the PATH pnpm when no entry is supplied', () => {
    expect(bundledPackageManager({}, 'node')).toBeUndefined()
    expect(bundledPackageManager({ DSH_PNPM_ENTRY: '' }, 'node')).toBeUndefined()
  })
})
