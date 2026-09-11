/** Authenticated Session-follow observation used by packaged permission checks. */
import { randomUUID } from 'node:crypto'
import WebSocket, { type RawData } from 'ws'

/** Durable event identity from the Session-follow snapshot. */
export interface HistoryRecord { event: { type: string } }

/**
 * Decode one ws frame payload as UTF-8 text.
 * @param data - Raw frame data in any of the shapes `ws` delivers.
 * @returns The frame text.
 */
export function rawDataText(data: RawData): string {
  if (Buffer.isBuffer(data)) return data.toString('utf8')
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8')
  return Buffer.from(data).toString('utf8')
}

/**
 * Read the opening snapshot through the product's cookie-authenticated mux.
 * @param origin - Harness HTTP origin.
 * @param cookie - Cookie captured from the Electron product Session.
 * @param sessionId - Session to observe.
 * @param timeoutMs - Maximum time for connection and first snapshot together.
 * @returns The opening snapshot's records; transport failure always rejects.
 */
export async function followOpeningRecords(
  origin: string, cookie: string, sessionId: string, timeoutMs = 20_000,
): Promise<HistoryRecord[]> {
  if (cookie === '') throw new Error('session/follow requires the product authentication cookie')
  const socket = new WebSocket(`${origin.replace(/^http/u, 'ws')}/api/remote.mux`, { headers: { cookie } })
  const closed = new Promise<void>((resolve) => { socket.once('close', () => { resolve() }) })
  const streamId = `permission-execution-${randomUUID()}`
  try {
    return await new Promise<HistoryRecord[]>((resolve, reject) => {
      const timer = setTimeout(() => { reject(new Error('session/follow opening snapshot timed out')) }, timeoutMs)
      socket.once('close', () => { clearTimeout(timer); reject(new Error('session/follow connection closed before snapshot')) })
      socket.on('error', (error) => { clearTimeout(timer); reject(error) })
      socket.once('open', () => {
        socket.send(JSON.stringify({ type: 'open', streamId, endpoint: 'session/follow',
          payload: { args: { request: { address: { kind: 'session', sessionId }, maxMessages: 500 } } },
        }))
      })
      socket.on('message', (data) => {
        try {
          const frame = JSON.parse(rawDataText(data)) as {
            streamId?: string
            type?: string
            value?: { type?: string; records?: HistoryRecord[] }
            error?: unknown
          }
          if (frame.streamId !== streamId) return
          if (frame.type === 'error') throw new Error(`session/follow failed: ${JSON.stringify(frame.error)}`)
          if (frame.type === 'end') throw new Error('session/follow ended before snapshot')
          if (frame.type === 'item' && frame.value?.type === 'snapshot' && Array.isArray(frame.value.records)) {
            clearTimeout(timer)
            resolve(frame.value.records)
          }
        } catch (error) {
          clearTimeout(timer)
          reject(error instanceof Error ? error : new Error(String(error)))
        }
      })
    })
  } finally {
    socket.terminate()
    await closed
  }
}
