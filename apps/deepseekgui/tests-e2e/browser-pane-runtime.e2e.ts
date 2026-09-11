/** Source-policy verification inside a real isolated Electron runtime. */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

it('blocks a loopback redirect and releases a crashed renderer before recreating the pane', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsgui-pane-runtime-'))
  const executable = createRequire(import.meta.url)('electron') as string
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(executable, [fileURLToPath(new URL('../tests/fixtures/browser-pane-runtime.cjs', import.meta.url)), root], {
    env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', (chunk) => { output += String(chunk) })
  child.stderr.on('data', (chunk) => { output += String(chunk) })
  const timer = setTimeout(() => { child.kill() }, 25_000)
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.on('error', reject)
      child.on('close', resolve)
    })
    expect(code, output).toBe(0)
    const result = output.split(/\r?\n/).find(line => line.startsWith('P12_RESULT='))
    expect(result, output).toBeDefined()
    expect(JSON.parse(result!.slice('P12_RESULT='.length))).toMatchObject({
      localHits: 0, body: 'Navigation blocked', destroyedAtCrash: false, released: true, freshText: 'fresh pane',
    })
  } finally {
    clearTimeout(timer)
    rmSync(root, { recursive: true, force: true })
  }
}, 30_000)
