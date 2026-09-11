/** Real local WebSocket coverage for the packaged permission observer. */
import { once } from 'node:events'
import { afterEach, expect, it } from 'vitest'
import { WebSocketServer } from 'ws'
import { followOpeningRecords, rawDataText } from './support/session-follow.ts'

let server: WebSocketServer | undefined
afterEach(async () => {
  if (server === undefined) return
  for (const client of server.clients) client.terminate()
  await new Promise<void>((resolve, reject) => {
    server!.close((error) => {
      if (error) reject(error)
      else resolve()
    })
  })
  server = undefined
})

async function listen(): Promise<string> {
  server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await once(server, 'listening')
  const address = server.address()
  if (typeof address === 'string' || address === null) throw new Error('expected TCP address')
  return `http://127.0.0.1:${address.port}`
}

it('sends the product cookie and decodes the official opening snapshot envelope', async () => {
  const origin = await listen()
  let cookie: string | undefined
  let request: unknown
  server!.on('connection', (socket, upgrade) => {
    cookie = upgrade.headers.cookie
    socket.on('message', (data) => {
      const frame = JSON.parse(rawDataText(data)) as { streamId: string }
      request = frame
      socket.send(JSON.stringify({ type: 'item', streamId: frame.streamId,
        value: { type: 'snapshot', records: [{ event: { type: 'tool/call' } }, { event: { type: 'turn/end' } }] },
      }))
    })
  })
  expect(await followOpeningRecords(origin, 'product=test-only', 'session-one')).toEqual([
    { event: { type: 'tool/call' } }, { event: { type: 'turn/end' } },
  ])
  expect(cookie).toBe('product=test-only')
  expect(request).toMatchObject({ type: 'open', endpoint: 'session/follow', payload: {
    args: { request: { address: { kind: 'session', sessionId: 'session-one' }, maxMessages: 500 } },
  } })
})

it('reports authentication rejection instead of waiting for a turn', async () => {
  server = new WebSocketServer({ host: '127.0.0.1', port: 0, verifyClient: () => false })
  await once(server, 'listening')
  const address = server.address()
  if (typeof address === 'string' || address === null) throw new Error('expected TCP address')
  await expect(followOpeningRecords(`http://127.0.0.1:${address.port}`, 'bad=cookie', 'one')).rejects.toThrow('401')
})

it.each(['close', 'error', 'end'])('rejects %s before the snapshot', async (mode) => {
  const origin = await listen()
  server!.on('connection', (socket) => {
    socket.on('message', (data) => {
      if (mode === 'close') { socket.close(); return }
      const { streamId } = JSON.parse(rawDataText(data)) as { streamId: string }
      socket.send(JSON.stringify({ streamId, type: mode, error: 'synthetic failure' }))
    })
  })
  await expect(followOpeningRecords(origin, 'product=test-only', 'one')).rejects.toThrow(/closed|failed|ended/)
})

it('closes a silent connection on its observation deadline', async () => {
  const origin = await listen()
  await expect(followOpeningRecords(origin, 'product=test-only', 'one', 100)).rejects.toThrow('timed out')
})
