/**
 * ZIP reading for skill imports: every entry path is checked before it can
 * name a file on disk, and sizes are bounded before inflation. Symbolic links
 * inside an archive are not preserved — the reader has no link attributes, so
 * a link entry becomes a plain file holding its target text.
 */
import { unzipSync } from 'fflate'
import type { SkillIssue } from './types.ts'

/** Bounds applied while reading an archive. */
export interface ZipLimits {
  /** Inclusive cap on the inflated size of one entry. */
  maxFileBytes: number
  /** Inclusive cap on the inflated bytes of all accepted entries. */
  maxTotalBytes: number
  /** Inclusive cap on the number of accepted entries. */
  maxFiles: number
}

/** One accepted archive entry. */
export interface ZipEntry {
  /** Normalized posix-relative path. */
  path: string
  data: Uint8Array
}

/** Accepted entries plus the problems that excluded others or the whole archive. */
export interface ZipContents {
  entries: ZipEntry[]
  problems: SkillIssue[]
}

/** Windows drive prefix (`C:`) or UNC-ish start that must never appear in an archive path. */
const DRIVE_PREFIX = /^[A-Za-z]:/u

/** ASCII control characters, built from code points so the source stays printable. */
const CONTROL_CHARS = new RegExp(`[${String.fromCodePoint(0)}-${String.fromCodePoint(0x1f)}${String.fromCodePoint(0x7f)}]`, 'u')

/**
 * Normalize one archive entry path, refusing anything that could escape or
 * confuse the install directory.
 * @param raw - entry name as stored in the archive.
 * @returns the posix-relative path, or undefined when the entry is unsafe or a directory.
 */
export function safeArchivePath(raw: string): string | undefined {
  if (raw === '' || raw.endsWith('/')) return undefined
  if (raw.includes('\\') || raw.startsWith('/') || DRIVE_PREFIX.test(raw)) return undefined
  if (CONTROL_CHARS.test(raw)) return undefined
  const segments = raw.split('/')
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..') return undefined
    if (segment.endsWith('.') || segment.endsWith(' ') || segment.includes(':')) return undefined
    // Windows-invalid name characters: rejecting them here keeps an archive
    // portable instead of failing mid-write with io-error on one platform
    // (Fable acceptance ruling, 2026-09-13).
    if (/[<>"|?*]/u.test(segment)) return undefined
  }
  return segments.join('/')
}

/**
 * Read an archive into memory within limits.
 * @param bytes - archive bytes.
 * @param limits - size and count bounds.
 * @returns accepted entries and the problems found; an unreadable archive yields no entries and one `zip-unreadable`.
 */
export function readZip(bytes: Uint8Array, limits: ZipLimits): ZipContents {
  const problems: SkillIssue[] = []
  const seen = new Set<string>()
  let total = 0
  let count = 0
  let full = false
  let unzipped: Record<string, Uint8Array>
  try {
    unzipped = unzipSync(bytes, {
      filter: (file) => {
        if (full || file.name.endsWith('/')) return false
        const path = safeArchivePath(file.name)
        if (path === undefined) {
          problems.push({ code: 'unsafe-path', message: 'entry path is not a safe relative path', path: file.name })
          return false
        }
        const folded = path.toLowerCase()
        if (seen.has(folded)) {
          problems.push({ code: 'unsafe-path', message: 'entry path collides with another entry', path: file.name })
          return false
        }
        seen.add(folded)
        if (file.originalSize > limits.maxFileBytes) {
          problems.push({ code: 'too-large', message: `entry exceeds ${limits.maxFileBytes} bytes`, path: file.name })
          return false
        }
        if (count >= limits.maxFiles || total + file.originalSize > limits.maxTotalBytes) {
          full = true
          problems.push(count >= limits.maxFiles
            ? { code: 'too-many-files', message: `the archive holds more than ${limits.maxFiles} files`, path: file.name }
            : { code: 'too-large', message: `the archive inflates beyond ${limits.maxTotalBytes} bytes`, path: file.name })
          return false
        }
        count += 1
        total += file.originalSize
        return true
      },
    })
  } catch (error) {
    return { entries: [], problems: [{ code: 'zip-unreadable', message: `the archive cannot be read: ${String(error)}` }] }
  }
  const entries: ZipEntry[] = []
  for (const [name, data] of Object.entries(unzipped)) {
    entries.push({ path: name, data })
  }
  return { entries, problems }
}
