/** Real web-profile reads without a model or personal Harness home. Requires built Typert contributors. */
import { expect, it } from 'vitest'
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'

it('serves existing files and current Git patches without adding Session events', async () => {
  const repo = resolve(import.meta.dirname, '../../..')
  const temp = mkdtempSync(join(tmpdir(), 'dsh-workbench-remote-'))
  const workspace = join(temp, '中文 workspace'); mkdirSync(workspace)
  writeFileSync(join(workspace, 'existing.txt'), 'before model\n')
  execFileSync('git', ['init', '-q'], { cwd: workspace })
  execFileSync('git', ['add', 'existing.txt'], { cwd: workspace })
  const env: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(process.env)
    .filter(([key]) => !/key|token|secret|password|credential/i.test(key)))
  delete env.NODE_OPTIONS
  for (const key of ['DSH_HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'DSH_AGENTS_HOME']) {
    env[key] = join(temp, key); mkdirSync(env[key])
  }
  env.DSH_TELEMETRY_DISABLED = '1'
  env.TSX_TSCONFIG_PATH = join(repo, 'apps/cli/tsconfig.json')
  const child = spawn(process.execPath, ['--import', import.meta.resolve('tsx/esm'),
    join(repo, 'apps/cli/src/bin.ts'), '--profile', 'web', '--host', '127.0.0.1', '--port', '0', '--no-open'],
  { cwd: workspace, env, stdio: 'pipe', windowsHide: true })
  const closed = once(child, 'close')
  const lines = createInterface({ input: child.stdout })
  let stderr = ''
  child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
  try {
    const launch = await new Promise<URL>((accept, reject) => {
      const timer = setTimeout(() => { reject(new Error('web profile did not publish its ready URL')) }, 60_000)
      child.once('error', (error) => { clearTimeout(timer); reject(error) })
      child.once('exit', () => { clearTimeout(timer); reject(new Error(`web profile exited before readiness: ${stderr}`)) })
      lines.on('line', (line) => {
        const found = /^dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=\S+)/u.exec(line)
        if (found?.[1] !== undefined) { clearTimeout(timer); accept(new URL(found[1])) }
      })
    })
    const auth = await fetch(launch, { redirect: 'manual' })
    expect(auth.status).toBe(303)
    const cookie = auth.headers.get('set-cookie')?.split(';')[0]
    if (cookie === undefined) throw new Error('missing test session cookie')
    const rpc = async <T>(method: string, args: Record<string, unknown>): Promise<T> => {
      const response = await fetch(`${launch.origin}/api/${method}`, { method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method, payload: { args } }),
      })
      const body = await response.json() as { result: { ok: boolean; value: T; error?: { message: string } } }
      if (!body.result.ok) throw new Error(body.result.error?.message ?? 'Remote failed')
      return body.result.value
    }
    const session = await rpc<{ sessionId: string }>('session/create', { request: { cwd: workspace } })
    const args = { sessionId: session.sessionId }
    type Listing = { items: { sessionId: string; projections?: { asOfSeq: number } }[] }
    const before = await rpc<Listing>('session/list', { _request: {} })
    const overview = await rpc<{ status: { entries: { path: string }[] }; worktrees: { current: boolean }[] }>('workbenchInspector/overview', args)
    expect(overview.status.entries.some(entry => entry.path === 'existing.txt')).toBe(true)
    expect(overview.worktrees.filter(tree => tree.current)).toHaveLength(1)
    expect(await rpc('workbenchInspector/text', { ...args, path: 'existing.txt', repository: false }))
      .toEqual({ path: 'existing.txt', text: 'before model\n' })
    const diff = await rpc<{ patch: string }>('workbenchInspector/diff', { ...args, scope: 'staged', path: 'existing.txt' })
    expect(diff.patch).toContain('+before model')
    writeFileSync(join(workspace, 'existing.txt'), 'after external edit\n')
    expect(await rpc('workbenchInspector/text', { ...args, path: 'existing.txt', repository: false }))
      .toEqual({ path: 'existing.txt', text: 'after external edit\n' })
    const after = await rpc<Listing>('session/list', { _request: {} })
    expect(before.items.find(row => row.sessionId === session.sessionId)?.projections?.asOfSeq).toBeTypeOf('number')
    expect(after.items.find(row => row.sessionId === session.sessionId)?.projections?.asOfSeq)
      .toBe(before.items.find(row => row.sessionId === session.sessionId)?.projections?.asOfSeq)
  } finally {
    lines.close()
    if (child.exitCode === null && child.pid !== undefined) {
      if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
      else child.kill('SIGTERM')
    }
    await closed
    rmSync(temp, { recursive: true, force: true })
  }
})
