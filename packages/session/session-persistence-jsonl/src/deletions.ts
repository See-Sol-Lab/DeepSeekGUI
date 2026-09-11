/** Durable content-deletion records and link-safe cleanup for the JSONL backend. */
import { lstat, mkdir, readFile, readdir, rename, rmdir, unlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { isAbsolute, join, relative, sep } from 'node:path'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionDeletionRecord } from '@deepseek-ai/dsh-session-persistence'
import { encodeSegment } from './format.ts'
import { LEASE_FILENAME } from './lease.ts'

/** Read validated deletion metadata; only a missing file means no record.
 * @param root - JSONL storage root.
 * @param id - Exact Session identity.
 * @returns Validated metadata, or undefined for a missing record.
 */
export async function readDeletion(root: string, id: SessionId): Promise<SessionDeletionRecord | undefined> {
  let text: string
  try { text = await readFile(join(root, '.deleted', `${encodeSegment(id)}.json`), 'utf8') }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  const value: unknown = JSON.parse(text)
  if (typeof value !== 'object' || value === null) throw new Error('invalid session deletion record')
  const record = value as Record<string, unknown>
  if (record.sessionId !== id || (record.title !== null && typeof record.title !== 'string')
    || (record.cwd !== undefined && typeof record.cwd !== 'string')
    || !Number.isSafeInteger(record.deletedAt) || (record.deletedAt as number) < 0 || (record.deletedAt as number) > 8_640_000_000_000_000
    || (record.state !== 'deleting' && record.state !== 'deleted')) throw new Error(`invalid deletion record for session "${id}"`)
  return { sessionId: id, title: record.title,
    ...(typeof record.cwd === 'string' ? { cwd: record.cwd } : {}),
    deletedAt: record.deletedAt as number, state: record.state }
}

/** List deletion metadata without reading deleted content.
 * @param root - JSONL storage root.
 * @returns Stored deletion records.
 */
export async function listDeletions(root: string): Promise<SessionDeletionRecord[]> {
  let names: string[]
  try { names = await readdir(join(root, '.deleted')) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const records: SessionDeletionRecord[] = []
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    // Stored filenames encode UTF-16 code units, matching the Session layout.
    const id = name.slice(0, -5).replace(/~([0-9A-F]{4})/gu,
      (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16))) as SessionId
    const record = await readDeletion(root, id)
    if (record !== undefined) records.push(record)
  }
  return records
}

/** Atomically publish metadata; partial cleanup remains explicitly incomplete.
 * @param root - JSONL storage root.
 * @param record - Exact Session deletion metadata.
 * @returns Completion of the atomic replacement.
 */
export async function writeDeletion(root: string, record: SessionDeletionRecord): Promise<void> {
  const dir = join(root, '.deleted')
  await assertDeletionPath(root, dir)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const target = join(dir, `${encodeSegment(record.sessionId)}.json`)
  const temporary = `${target}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, JSON.stringify(record) + '\n', { flag: 'wx', mode: 0o600 })
    await rename(temporary, target)
  } finally {
    try { await unlink(temporary) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
}

/** Reject linked parent directories below the configured storage root.
 * @param root - Configured JSONL storage root.
 * @param target - Session-owned directory or deletion-record directory.
 * @returns Completion after checking every existing component below root.
 */
export async function assertDeletionPath(root: string, target: string): Promise<void> {
  const rel = relative(root, target)
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('deletion path is outside Session storage')
  let current = root
  for (const part of rel.split(sep)) {
    current = join(current, part)
    let info
    try { info = await lstat(current) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    if (info.isSymbolicLink()) throw new Error('Session deletion refuses a linked parent directory')
  }
}

/** Remove content without following links; retain the POSIX lock inode at the root.
 * @param path - Session-owned directory or entry.
 * @param preserveLock - Retain the outer POSIX lease file and its directory.
 * @returns Completion of removal; errors leave remaining entries for retry.
 */
export async function removeSessionContent(path: string, preserveLock = true): Promise<void> {
  let info
  try { info = await lstat(path) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  if (info.isSymbolicLink()) {
    try { await unlink(path) } catch { await rmdir(path) }
  } else if (info.isDirectory()) {
    for (const name of await readdir(path)) {
      if (preserveLock && process.platform !== 'win32' && name === LEASE_FILENAME) continue
      await removeSessionContent(join(path, name), false)
    }
    if (!preserveLock || process.platform === 'win32') await rmdir(path)
  } else {
    await unlink(path)
  }
}
