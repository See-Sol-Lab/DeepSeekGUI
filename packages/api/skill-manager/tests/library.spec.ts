/* oxlint-disable typescript/no-unsafe-assignment -- Vitest asymmetric matchers are typed as any. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { zipSync } from 'fflate'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  applyImport,
  previewImport,
  publish,
  resolveLibraryPaths,
  scanInventory,
  uninstallSkill,
  validateStaged,
  type LibraryOptions,
} from '../src/library.ts'
import { SKILL_MANIFEST_FILE, type SkillLibraryChange } from '../src/types.ts'

const roots: string[] = []
afterEach(() => {
  vi.unstubAllEnvs()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const limits = { maxZipBytes: 1024 * 1024, maxFileBytes: 64 * 1024, maxTotalBytes: 256 * 1024, maxFiles: 50 }

function temp(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix))
  roots.push(root)
  return root
}

interface Setup {
  home: string
  options: LibraryOptions
  changes: SkillLibraryChange[]
  changed: (change: SkillLibraryChange) => void
}

/** A fresh DSH home with explicit agents home; hex ids are sequential for stable assertions. */
function setup(overrides: Partial<LibraryOptions> = {}): Setup {
  const home = temp('dsh-skill-library-')
  let counter = 0
  const options: LibraryOptions = {
    dshHome: home,
    agentsHome: join(home, 'agents'),
    limits,
    now: () => new Date('2026-09-13T04:00:00.000Z'),
    randomHex: () => (counter += 1).toString(16).padStart(8, '0'),
    ...overrides,
  }
  const changes: SkillLibraryChange[] = []
  return { home, options, changes, changed: (change) => { changes.push(change) } }
}

const skillText = (name: string, description = `${name} description`, extra = ''): string =>
  `---\nname: ${name}\ndescription: ${description}\n${extra}---\n# ${name}\n\nBody of ${name}\n`

describe('complete imports', () => {
  it.each(['directory', 'zip'])('refuses a %s with resources excluded by size limits', async (kind) => {
    const { home, options, changes, changed } = setup({ limits: { ...limits, maxFileBytes: 200 } })
    const directory = join(home, 'source')
    writeSkillDir(directory, 'example', { 'resource.txt': 'x'.repeat(201) })
    const source = kind === 'directory' ? directory : join(home, 'source.zip')
    if (kind === 'zip') writeFileSync(source, zipSync({
      'SKILL.md': new TextEncoder().encode(skillText('example')),
      'resource.txt': new Uint8Array(201),
    }))
    const preview = await previewImport(options, source)
    expect(preview.candidates[0]?.installable).toBe(false)
    const result = await applyImport(options, { path: source, selections: [{ key: 'SKILL.md', replaces: null }] }, changed)
    expect(result.installed).toEqual([])
    expect(result.failures[0]?.issue.code).toBe('too-large')
    expect((await scanInventory(options)).installed).toEqual([])
    expect(changes).toEqual([])
    expect(readFileSync(join(directory, 'resource.txt'), 'utf8')).toHaveLength(201)
  })
})

function writeSkillDir(root: string, name: string, files: Record<string, string> = {}, text = skillText(name)): string {
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, 'SKILL.md'), text)
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, ...path.split('/'))
    mkdirSync(join(target, '..'), { recursive: true })
    writeFileSync(target, content)
  }
  return root
}

const manifestOf = (location: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(location, SKILL_MANIFEST_FILE), 'utf8')) as Record<string, unknown>

describe('resolveLibraryPaths', () => {
  it('follows the DSH home on every call and honours explicit overrides', () => {
    const first = temp('dsh-home-a-')
    const second = temp('dsh-home-b-')
    vi.stubEnv('DSH_HOME', first)
    vi.stubEnv('DSH_AGENTS_HOME', undefined)
    vi.stubEnv('DSH_BUNDLED_SKILL_DIR', undefined)
    const options: LibraryOptions = { limits }
    expect(resolveLibraryPaths(options)).toMatchObject({
      dshHome: first,
      libraryDir: join(first, 'deepseekgui', 'skills'),
      stagingDir: join(first, 'deepseekgui', 'skills-staging'),
      bundledSkillDir: undefined,
    })
    expect(resolveLibraryPaths(options).agentsHome.endsWith('.agents')).toBe(true)
    vi.stubEnv('DSH_HOME', second)
    vi.stubEnv('DSH_AGENTS_HOME', join(second, 'ag'))
    vi.stubEnv('DSH_BUNDLED_SKILL_DIR', join(second, 'bundled'))
    expect(resolveLibraryPaths(options)).toMatchObject({
      dshHome: second,
      agentsHome: join(second, 'ag'),
      bundledSkillDir: join(second, 'bundled'),
      libraryDir: join(second, 'deepseekgui', 'skills'),
    })
    expect(resolveLibraryPaths({ limits, libraryDir: join(first, 'lib'), stagingDir: join(first, 'stage'), bundledSkillDir: join(first, 'b') }))
      .toMatchObject({ libraryDir: join(first, 'lib'), stagingDir: join(first, 'stage'), bundledSkillDir: join(first, 'b') })
  })
})

describe('scanInventory', () => {
  it('lists an empty library without creating anything', async () => {
    const { home, options } = setup()
    const inventory = await scanInventory(options)
    expect(inventory).toEqual({ libraryDir: join(home, 'deepseekgui', 'skills'), installed: [], orphans: [], readOnly: [] })
    expect(existsSync(join(home, 'deepseekgui'))).toBe(false)
  })

  it('separates managed installs, orphans and stray files, and reads the read-only roots', async () => {
    const { home, options } = setup({ bundledSkillDir: join(temp('dsh-bundled-'), 'skills') })
    const library = join(home, 'deepseekgui', 'skills')
    const source = writeSkillDir(join(home, 'source', 'alpha'), 'alpha')
    await applyImport(options, { path: source, selections: [{ key: 'SKILL.md', replaces: null }] }, () => {})
    mkdirSync(join(library, 'orphan-dir'))
    writeFileSync(join(library, 'stray.txt'), 'x')
    mkdirSync(join(library, 'bad-json'))
    writeFileSync(join(library, 'bad-json', SKILL_MANIFEST_FILE), '{not json')
    writeSkillDir(join(home, 'skills', 'user-one'), 'user-one')
    writeSkillDir(join(home, 'skills', '.system'), 'system-skill')
    mkdirSync(join(home, 'skills', 'no-skill-file'))
    writeFileSync(join(home, 'skills', 'flat.md'), skillText('flat'))
    writeFileSync(join(home, 'skills', 'notes.txt'), 'ignored')
    writeFileSync(join(home, 'skills', 'broken.md'), '---\nname: Broken\n---\n')
    writeSkillDir(join(home, 'agents', 'skills', 'agents-one'), 'agents-one')
    writeSkillDir(join(options.bundledSkillDir!, 'bundled-one'), 'bundled-one')
    const inventory = await scanInventory(options)
    expect(inventory.installed.map(item => [item.installId, item.status])).toEqual([['alpha-00000001', 'ok']])
    expect(inventory.orphans).toEqual(['bad-json', 'orphan-dir'])
    expect(inventory.readOnly).toEqual([
      { source: 'user-dsh', name: 'flat', description: 'flat description', location: join(home, 'skills', 'flat.md') },
      { source: 'user-dsh', name: 'user-one', description: 'user-one description', location: join(home, 'skills', 'user-one', 'SKILL.md') },
      { source: 'user-agents', name: 'agents-one', description: 'agents-one description', location: join(home, 'agents', 'skills', 'agents-one', 'SKILL.md') },
      { source: 'bundled', name: 'bundled-one', description: 'bundled-one description', location: join(options.bundledSkillDir!, 'bundled-one', 'SKILL.md') },
    ])
  })

  it('treats every malformed manifest as an orphan and flags broken installed copies', async () => {
    const { home, options } = setup()
    const library = join(home, 'deepseekgui', 'skills')
    const base = {
      schemaVersion: 1,
      installId: 'x',
      name: 'x',
      description: 'd',
      installedAt: 't',
      updatedAt: 't',
      origin: { kind: 'directory', path: '/src', entry: 'SKILL.md' },
      files: 1,
      bytes: 2,
    }
    const cases: Record<string, unknown> = {
      'not-object': '"text"',
      'schema-two': JSON.stringify({ ...base, installId: 'schema-two', schemaVersion: 2 }),
      'id-mismatch': JSON.stringify({ ...base, installId: 'other' }),
      'no-name': JSON.stringify({ ...base, installId: 'no-name', name: '' }),
      'no-desc': JSON.stringify({ ...base, installId: 'no-desc', description: 3 }),
      'no-installed-at': JSON.stringify({ ...base, installId: 'no-installed-at', installedAt: null }),
      'no-updated-at': JSON.stringify({ ...base, installId: 'no-updated-at', updatedAt: 1 }),
      'files-string': JSON.stringify({ ...base, installId: 'files-string', files: '1' }),
      'bytes-string': JSON.stringify({ ...base, installId: 'bytes-string', bytes: '2' }),
      'origin-null': JSON.stringify({ ...base, installId: 'origin-null', origin: null }),
      'origin-kind': JSON.stringify({ ...base, installId: 'origin-kind', origin: { ...base.origin, kind: 'url' } }),
      'origin-path': JSON.stringify({ ...base, installId: 'origin-path', origin: { ...base.origin, path: '' } }),
      'origin-entry': JSON.stringify({ ...base, installId: 'origin-entry', origin: { ...base.origin, entry: 1 } }),
    }
    for (const [name, manifest] of Object.entries(cases)) {
      mkdirSync(join(library, name), { recursive: true })
      writeFileSync(join(library, name, SKILL_MANIFEST_FILE), manifest as string)
    }
    // Valid manifests whose SKILL.md is missing, invalid, or renamed.
    const valid = (installId: string, extra: Record<string, unknown> = {}): string =>
      JSON.stringify({ ...base, installId, name: installId, ...extra })
    mkdirSync(join(library, 'no-file'), { recursive: true })
    writeFileSync(join(library, 'no-file', SKILL_MANIFEST_FILE), valid('no-file', { whenToUse: 'sometimes' }))
    writeSkillDir(join(library, 'bad-doc'), 'bad-doc', {}, '---\nname: bad-doc\n---\n')
    writeFileSync(join(library, 'bad-doc', SKILL_MANIFEST_FILE), valid('bad-doc'))
    writeSkillDir(join(library, 'renamed'), 'something-else')
    writeFileSync(join(library, 'renamed', SKILL_MANIFEST_FILE), valid('renamed'))
    writeSkillDir(join(library, 'same-name-b'), 'same')
    writeFileSync(join(library, 'same-name-b', SKILL_MANIFEST_FILE), valid('same-name-b', { name: 'same' }))
    writeSkillDir(join(library, 'same-name-a'), 'same')
    writeFileSync(join(library, 'same-name-a', SKILL_MANIFEST_FILE), valid('same-name-a', { name: 'same' }))
    const inventory = await scanInventory(options)
    expect(inventory.orphans).toEqual(Object.keys(cases).sort((left, right) => left.localeCompare(right)))
    expect(inventory.installed.map(item => [item.installId, item.status, item.issue?.code])).toEqual([
      ['bad-doc', 'invalid', 'missing-description'],
      ['no-file', 'invalid', 'skill-invalid'],
      ['renamed', 'invalid', 'skill-invalid'],
      ['same-name-a', 'ok', undefined],
      ['same-name-b', 'ok', undefined],
    ])
    expect(inventory.installed[1]).toMatchObject({ whenToUse: 'sometimes', location: join(library, 'no-file') })
    expect(inventory.installed[2]!.issue!.message).toContain('"something-else"')
  })
})

describe('previewImport', () => {
  it('reviews a valid skill directory with its whole package', async () => {
    const { home, options } = setup()
    const source = writeSkillDir(join(home, 'source', 'pdf-tools'), 'pdf-tools', {
      'scripts/run.py': 'print(1)',
      'references/guide.md': '# guide',
      'assets/logo.svg': '<svg/>',
      [SKILL_MANIFEST_FILE]: '{"stale": true}',
    })
    mkdirSync(join(source, '.git'))
    writeFileSync(join(source, '.git', 'HEAD'), 'ref')
    const preview = await previewImport(options, source)
    expect(preview.source).toEqual({ kind: 'directory', path: source })
    expect(preview.problems).toEqual([])
    expect(preview.candidates).toEqual([{
      key: 'SKILL.md',
      entry: 'SKILL.md',
      kind: 'skill',
      name: 'pdf-tools',
      description: 'pdf-tools description',
      proposed: {},
      issues: [],
      files: 4,
      bytes: expect.any(Number),
      replaces: null,
      installable: true,
    }])
  })

  it('lists nested skills up to three levels deep and reports skipped links', async () => {
    const { home, options } = setup()
    const source = join(home, 'pack')
    writeSkillDir(join(source, 'one'), 'one')
    writeSkillDir(join(source, 'group', 'sub', 'two'), 'two', {}, '---\nname: two\ndescription: d\nwhenToUse: w\n---\n')
    writeSkillDir(join(source, 'a', 'b', 'c', 'd', 'too-deep'), 'too-deep')
    writeFileSync(join(source, 'README.md'), '# not a skill')
    try {
      symlinkSync(join(source, 'README.md'), join(source, 'link.md'), 'file')
    } catch {
      // Without symlink rights the walk simply sees one file less.
    }
    const preview = await previewImport(options, source)
    expect(preview.candidates.map(candidate => [candidate.key, candidate.name, candidate.files])).toEqual([
      ['group/sub/two/SKILL.md', 'two', 1],
      ['one/SKILL.md', 'one', 1],
    ])
    expect(preview.candidates[0]).toMatchObject({ whenToUse: 'w' })
    if (existsSync(join(source, 'link.md'))) {
      expect(preview.problems).toEqual([{ code: 'symlink-skipped', message: expect.any(String), path: 'link.md' }])
    } else {
      expect(preview.problems).toEqual([])
    }
  })

  it('falls back to root-level Markdown files and proposes metadata for them', async () => {
    const { home, options } = setup()
    const source = join(home, 'docs')
    mkdirSync(source)
    writeFileSync(join(source, 'Data Cleaning.md'), '# Data cleaning\n\nClean tabular data step by step.\n')
    writeFileSync(join(source, 'Named.md'), '---\nname: named\ndescription: has it all\n---\n')
    writeFileSync(join(source, 'notes.txt'), 'ignored')
    const preview = await previewImport(options, source)
    const summary = preview.candidates.map(candidate =>
      [candidate.key, candidate.kind, candidate.name, candidate.proposed, candidate.installable])
    expect(summary).toEqual([
      ['Data Cleaning.md', 'markdown', null, { name: 'data-cleaning', description: 'Clean tabular data step by step.' }, true],
      ['Named.md', 'markdown', 'named', {}, true],
    ])
    expect(preview.candidates[0]!.issues).toEqual([{ code: 'missing-frontmatter', message: expect.any(String), fixable: true }])
  })

  it('reviews a single Markdown file', async () => {
    const { home, options } = setup()
    const file = join(home, 'Quick Notes.md')
    writeFileSync(file, 'First line becomes the description.\n')
    const preview = await previewImport(options, file)
    expect(preview.source).toEqual({ kind: 'markdown', path: file })
    expect(preview.candidates).toEqual([expect.objectContaining({
      key: 'Quick Notes.md',
      kind: 'markdown',
      proposed: { name: 'quick-notes', description: 'First line becomes the description.' },
      installable: true,
    })])
  })

  it('reviews an archive, skipping unsafe entries', async () => {
    const { home, options } = setup()
    const file = join(home, 'bundle.zip')
    const encode = (value: string): Uint8Array => new TextEncoder().encode(value)
    writeFileSync(file, zipSync({
      'bundle/SKILL.md': encode(skillText('bundle')),
      'bundle/scripts/go.sh': encode('echo'),
      '../escape.txt': encode('x'),
    }))
    const preview = await previewImport(options, file)
    expect(preview.source).toEqual({ kind: 'zip', path: file })
    expect(preview.candidates).toEqual([expect.objectContaining({ key: 'bundle/SKILL.md', name: 'bundle', files: 2 })])
    expect(preview.problems).toEqual([{ code: 'unsafe-path', message: expect.any(String), path: '../escape.txt' }])
  })

  it('reports the problems of unusable sources', async () => {
    const { home, options } = setup()
    const empty = join(home, 'empty')
    mkdirSync(empty)
    expect((await previewImport(options, empty)).problems).toEqual([{ code: 'no-skill-found', message: expect.any(String) }])
    const onlyText = join(home, 'text')
    mkdirSync(onlyText)
    writeFileSync(join(onlyText, 'a.txt'), 'a')
    expect((await previewImport(options, onlyText)).problems).toEqual([{ code: 'no-skill-found', message: expect.any(String) }])
    expect((await previewImport(options, join(home, 'missing'))).problems).toEqual([{ code: 'source-missing', message: expect.any(String) }])
    writeFileSync(join(home, 'thing.exe'), 'x')
    expect((await previewImport(options, join(home, 'thing.exe'))).problems).toEqual([{ code: 'source-unsupported', message: expect.any(String) }])
    writeFileSync(join(home, 'broken.zip'), 'not a zip')
    expect((await previewImport(options, join(home, 'broken.zip'))).problems).toEqual([{ code: 'zip-unreadable', message: expect.any(String) }])
    writeFileSync(join(home, 'huge.zip'), new Uint8Array(limits.maxZipBytes + 1))
    expect((await previewImport(options, join(home, 'huge.zip'))).problems).toEqual([{ code: 'zip-too-large', message: expect.any(String) }])
    writeFileSync(join(home, 'huge.md'), 'x'.repeat(limits.maxFileBytes + 1))
    const huge = await previewImport(options, join(home, 'huge.md'))
    expect(huge.candidates).toEqual([])
    expect(huge.problems).toEqual([{ code: 'too-large', message: expect.any(String) }])
  })

  it('bounds a directory walk by file size, count, total bytes and depth', async () => {
    const { home } = setup()
    const tight: LibraryOptions = { dshHome: home, limits: { ...limits, maxFileBytes: 20, maxFiles: 2, maxTotalBytes: 30 } }
    const tiny = '---\nname: a\n---\n'
    const bySize = writeSkillDir(join(home, 'by-size'), 'by-size', { 'big.bin': 'x'.repeat(21) }, tiny)
    expect((await previewImport(tight, bySize)).problems).toEqual([{ code: 'too-large', message: expect.any(String), path: 'big.bin' }])
    const byCount = writeSkillDir(join(home, 'by-count'), 'by-count', { 'y.txt': '1', 'z.txt': '2' }, tiny)
    expect((await previewImport(tight, byCount)).problems).toEqual([{ code: 'too-many-files', message: expect.any(String), path: 'z.txt' }])
    const byTotal = writeSkillDir(join(home, 'by-total'), 'by-total', { 'y.txt': 'x'.repeat(15) }, tiny)
    expect((await previewImport(tight, byTotal)).problems).toEqual([{ code: 'too-large', message: expect.any(String), path: 'y.txt' }])
    const nestedCount = writeSkillDir(join(home, 'nested-count'), 'nested-count', { 'sub/b.txt': '2', 'sub/c.txt': '3' }, tiny)
    expect((await previewImport(tight, nestedCount)).problems).toEqual([{ code: 'too-many-files', message: expect.any(String), path: 'sub/c.txt' }])
    const deep = join(home, 'deep')
    const segments = Array.from({ length: 26 }, () => 'd')
    writeSkillDir(deep, 'deep')
    mkdirSync(join(deep, ...segments), { recursive: true })
    writeFileSync(join(deep, ...segments, 'leaf.txt'), 'x')
    const preview = await previewImport({ dshHome: home, limits }, deep)
    expect(preview.problems).toEqual([{ code: 'unsafe-path', message: expect.stringContaining('deeper'), path: Array.from({ length: 25 }, () => 'd').join('/') }])
  })

  it('names the install a candidate would replace, by origin first and then by name', async () => {
    const { home, options, changed } = setup()
    const source = writeSkillDir(join(home, 'src', 'alpha'), 'alpha')
    await applyImport(options, { path: source, selections: [{ key: 'SKILL.md', replaces: null }] }, changed)
    writeFileSync(join(source, 'SKILL.md'), skillText('alpha-renamed'))
    expect((await previewImport(options, source)).candidates[0]!.replaces).toEqual({
      installId: 'alpha-00000001',
      name: 'alpha',
      origin: { kind: 'directory', path: source, entry: 'SKILL.md' },
      location: join(home, 'deepseekgui', 'skills', 'alpha-00000001'),
    })
    const elsewhere = writeSkillDir(join(home, 'src', 'other'), 'alpha')
    expect((await previewImport(options, elsewhere)).candidates[0]!.replaces).toMatchObject({ installId: 'alpha-00000001' })
    const unrelated = writeSkillDir(join(home, 'src', 'beta'), 'beta')
    expect((await previewImport(options, unrelated)).candidates[0]!.replaces).toBeNull()
    writeFileSync(join(home, '___.md'), '# only heading\n')
    const nameless = await previewImport(options, join(home, '___.md'))
    expect(nameless.candidates[0]).toMatchObject({ replaces: null, installable: false, proposed: {} })
  })
})

describe('applyImport', () => {
  it('installs the whole package into a fresh directory with a manifest, rewriting nothing that was valid', async () => {
    const { home, options, changes, changed } = setup()
    const source = writeSkillDir(join(home, 'src', 'pdf-tools'), 'pdf-tools', { 'scripts/run.py': 'print(1)', 'assets/deep/logo.svg': '<svg/>' })
    const outcome = await applyImport(options, { path: source, selections: [{ key: 'SKILL.md', replaces: null }] }, changed)
    expect(outcome.failures).toEqual([])
    const location = join(home, 'deepseekgui', 'skills', 'pdf-tools-00000001')
    expect(outcome.installed).toEqual([expect.objectContaining({
      installId: 'pdf-tools-00000001',
      name: 'pdf-tools',
      description: 'pdf-tools description',
      installedAt: '2026-09-13T04:00:00.000Z',
      updatedAt: '2026-09-13T04:00:00.000Z',
      origin: { kind: 'directory', path: source, entry: 'SKILL.md' },
      files: 3,
      location,
      status: 'ok',
    })])
    expect(readFileSync(join(location, 'SKILL.md'), 'utf8')).toBe(skillText('pdf-tools'))
    expect(readFileSync(join(location, 'scripts', 'run.py'), 'utf8')).toBe('print(1)')
    expect(readFileSync(join(location, 'assets', 'deep', 'logo.svg'), 'utf8')).toBe('<svg/>')
    expect(manifestOf(location)).toMatchObject({ schemaVersion: 1, installId: 'pdf-tools-00000001' })
    expect(changes).toEqual([{ kind: 'install', installId: 'pdf-tools-00000001' }])
    expect(readdirSync(join(home, 'deepseekgui', 'skills-staging'))).toEqual([])
    // The source is untouched and outside the library.
    expect(existsSync(join(source, SKILL_MANIFEST_FILE))).toBe(false)
  })

  it('installs a plain Markdown document with reviewed metadata as SKILL.md and leaves the source file alone', async () => {
    const { home, options, changed } = setup()
    const file = join(home, 'Quick Notes.md')
    const original = '# Quick notes\n\nTake notes fast.\n'
    writeFileSync(file, original)
    const outcome = await applyImport(options, {
      path: file,
      selections: [{ key: 'Quick Notes.md', description: 'Edited by the user', replaces: null }],
    }, changed)
    expect(outcome.failures).toEqual([])
    const location = outcome.installed[0]!.location
    expect(outcome.installed[0]).toMatchObject({ installId: 'quick-notes-00000001', name: 'quick-notes', description: 'Edited by the user', files: 1 })
    expect(readFileSync(join(location, 'SKILL.md'), 'utf8')).toBe(`---\nname: quick-notes\ndescription: Edited by the user\n---\n${original}`)
    expect(readFileSync(file, 'utf8')).toBe(original)
    expect(manifestOf(location)).toMatchObject({ origin: { kind: 'markdown', path: file, entry: 'Quick Notes.md' } })
  })

  it('installs selected candidates from an archive and reports the rest independently', async () => {
    const { home, options, changed } = setup()
    const file = join(home, 'pack.zip')
    const encode = (value: string): Uint8Array => new TextEncoder().encode(value)
    writeFileSync(file, zipSync({
      'a/SKILL.md': encode(skillText('a')),
      'a/references/r.md': encode('ref'),
      'b/SKILL.md': encode('---\nname: b\ndescription: d\nuserInvocable: true\n---\n'),
    }))
    const outcome = await applyImport(options, {
      path: file,
      selections: [
        { key: 'a/SKILL.md', replaces: null },
        { key: 'b/SKILL.md', replaces: null },
        { key: 'missing/SKILL.md', replaces: null },
      ],
    }, changed)
    expect(outcome.installed.map(item => item.installId)).toEqual(['a-00000001'])
    expect(readFileSync(join(outcome.installed[0]!.location, 'references', 'r.md'), 'utf8')).toBe('ref')
    expect(outcome.failures).toEqual([
      { key: 'b/SKILL.md', issue: { code: 'skill-invalid', message: expect.stringContaining('userInvocable'), path: 'b/SKILL.md' } },
      { key: 'missing/SKILL.md', issue: { code: 'candidate-missing', message: expect.any(String) } },
    ])
  })

  it('replaces the confirmed target in place, keeping its install id and first install time', async () => {
    const { home, options, changes, changed } = setup()
    const source = writeSkillDir(join(home, 'src', 'alpha'), 'alpha', { 'old.txt': 'old' })
    await applyImport(options, { path: source, selections: [{ key: 'SKILL.md', replaces: null }] }, changed)
    rmSync(join(source, 'old.txt'))
    writeFileSync(join(source, 'new.txt'), 'new')
    writeFileSync(join(source, 'SKILL.md'), skillText('alpha', 'updated'))
    const later: LibraryOptions = { ...options, now: () => new Date('2026-09-14T00:00:00.000Z') }
    const outcome = await applyImport(later, { path: source, selections: [{ key: 'SKILL.md', replaces: 'alpha-00000001' }] }, changed)
    expect(outcome.failures).toEqual([])
    const location = join(home, 'deepseekgui', 'skills', 'alpha-00000001')
    expect(outcome.installed[0]).toMatchObject({
      installId: 'alpha-00000001',
      description: 'updated',
      installedAt: '2026-09-13T04:00:00.000Z',
      updatedAt: '2026-09-14T00:00:00.000Z',
      location,
    })
    expect(existsSync(join(location, 'old.txt'))).toBe(false)
    expect(readFileSync(join(location, 'new.txt'), 'utf8')).toBe('new')
    expect(changes).toEqual([{ kind: 'install', installId: 'alpha-00000001' }, { kind: 'replace', installId: 'alpha-00000001' }])
    expect(readdirSync(join(home, 'deepseekgui', 'skills'))).toEqual(['alpha-00000001'])
    expect(readdirSync(join(home, 'deepseekgui', 'skills-staging'))).toEqual([])
  })

  it('refuses a same-name install that was not confirmed as a replacement, naming the actual target', async () => {
    const { home, options, changed } = setup()
    const first = writeSkillDir(join(home, 'src', 'one'), 'shared')
    await applyImport(options, { path: first, selections: [{ key: 'SKILL.md', replaces: null }] }, changed)
    const second = writeSkillDir(join(home, 'src', 'two'), 'shared')
    const outcome = await applyImport(options, { path: second, selections: [{ key: 'SKILL.md', replaces: null }] }, changed)
    expect(outcome.installed).toEqual([])
    expect(outcome.failures[0]!.issue).toEqual({ code: 'name-conflict', message: expect.stringContaining('shared-00000001') })
    expect(outcome.failures[0]!.issue.message).toContain(first)
    // Renaming the second copy installs it beside the first.
    const renamed = await applyImport(options, { path: second, selections: [{ key: 'SKILL.md', name: 'shared-two', replaces: null }] }, changed)
    expect(renamed.installed[0]).toMatchObject({ installId: 'shared-two-00000002', name: 'shared-two' })
    expect(readFileSync(join(renamed.installed[0]!.location, 'SKILL.md'), 'utf8')).toContain('name: shared-two')
    // A replacement target that is gone, or that carries a different name than a still-installed one, is refused too.
    const gone = await applyImport(options, { path: second, selections: [{ key: 'SKILL.md', replaces: 'shared-deadbeef' }] }, changed)
    expect(gone.failures[0]!.issue.code).toBe('replace-target-missing')
    const crossed = await applyImport(options, { path: second, selections: [{ key: 'SKILL.md', replaces: 'shared-two-00000002' }] }, changed)
    expect(crossed.failures[0]!.issue.code).toBe('name-conflict')
  })

  it('rejects metadata that cannot resolve to a valid skill', async () => {
    const { home, options, changed } = setup()
    writeFileSync(join(home, '___.md'), '# only heading\n')
    const nameless = await applyImport(options, { path: join(home, '___.md'), selections: [{ key: '___.md', replaces: null }] }, changed)
    expect(nameless.failures[0]!.issue.code).toBe('invalid-name')
    const badName = await applyImport(options, { path: join(home, '___.md'), selections: [{ key: '___.md', name: 'Not Kebab', replaces: null }] }, changed)
    expect(badName.failures[0]!.issue).toEqual({ code: 'invalid-name', message: expect.stringContaining('Not Kebab') })
    const noDescription = await applyImport(options, { path: join(home, '___.md'), selections: [{ key: '___.md', name: 'fine', replaces: null }] }, changed)
    expect(noDescription.failures[0]!.issue.code).toBe('missing-description')
    const blank = await applyImport(options, { path: join(home, '___.md'), selections: [{ key: '___.md', name: 'fine', description: '  ', replaces: null }] }, changed)
    expect(blank.failures[0]!.issue.code).toBe('missing-description')
    expect(existsSync(join(home, 'deepseekgui'))).toBe(false)
  })

  it('fails cleanly when the library cannot be created, leaving no partial install', async () => {
    const { home, options, changed } = setup()
    writeFileSync(join(home, 'occupied'), 'a file where the library should be')
    const blocked: LibraryOptions = { ...options, libraryDir: join(home, 'occupied', 'skills') }
    const source = writeSkillDir(join(home, 'src', 'alpha'), 'alpha')
    const outcome = await applyImport(blocked, { path: source, selections: [{ key: 'SKILL.md', replaces: null }] }, changed)
    expect(outcome.installed).toEqual([])
    expect(outcome.failures[0]!.issue.code).toBe('library-unwritable')
  })

  it('removes the stage when a copy fails mid-install and reports an io-error', async () => {
    const { home, options } = setup()
    const source = join(home, 'pack')
    writeSkillDir(join(source, 'one'), 'one', { 'data.txt': '1' })
    writeSkillDir(join(source, 'two'), 'two', { 'data.txt': '2' })
    // The source loses a file after the first selection installed and before the second is staged.
    const changed = (): void => { rmSync(join(source, 'two', 'data.txt')) }
    const outcome = await applyImport(options, {
      path: source,
      selections: [{ key: 'one/SKILL.md', replaces: null }, { key: 'two/SKILL.md', replaces: null }],
    }, changed)
    expect(outcome.installed.map(item => item.installId)).toEqual(['one-00000001'])
    expect(outcome.failures).toEqual([{ key: 'two/SKILL.md', issue: { code: 'io-error', message: expect.stringContaining('install failed') } }])
    expect(readdirSync(join(home, 'deepseekgui', 'skills'))).toEqual(['one-00000001'])
    expect(readdirSync(join(home, 'deepseekgui', 'skills-staging'))).toEqual([])
    const stagingBlocked: LibraryOptions = { ...options, stagingDir: join(home, 'stage-file', 'x') }
    writeFileSync(join(home, 'stage-file'), 'file')
    const staged = await applyImport(stagingBlocked, { path: source, selections: [{ key: 'one/SKILL.md', name: 'again', replaces: null }] }, changed)
    expect(staged.failures[0]!.issue.code).toBe('library-unwritable')
  })

  it('keeps whenToUse in the manifest', async () => {
    const { home, options, changed } = setup()
    const source = writeSkillDir(join(home, 'src', 'alpha'), 'alpha', {}, skillText('alpha', 'd', 'whenToUse: when asked\n'))
    const outcome = await applyImport(options, { path: source, selections: [{ key: 'SKILL.md', replaces: null }] }, changed)
    expect(outcome.installed[0]).toMatchObject({ whenToUse: 'when asked' })
    expect(manifestOf(outcome.installed[0]!.location)).toMatchObject({ whenToUse: 'when asked' })
  })

  it('does not publish a stage whose SKILL.md fails re-validation and leaves nothing behind', async () => {
    const { home, options, changed } = setup()
    const source = writeSkillDir(join(home, 'src', 'alpha'), 'alpha')
    const staging = join(home, 'deepseekgui', 'skills-staging')
    // The clock hook runs after the package is staged and before it is validated:
    // corrupt the staged copy there, as a crashed or concurrent writer could.
    const corrupting: LibraryOptions = {
      ...options,
      now: () => {
        for (const entry of readdirSync(staging)) writeFileSync(join(staging, entry, 'SKILL.md'), '---\nname: alpha\n---\n')
        return new Date('2026-09-13T04:00:00.000Z')
      },
    }
    const outcome = await applyImport(corrupting, { path: source, selections: [{ key: 'SKILL.md', replaces: null }] }, changed)
    expect(outcome.installed).toEqual([])
    expect(outcome.failures).toEqual([{ key: 'SKILL.md', issue: { code: 'skill-invalid', message: expect.stringContaining('fails validation') } }])
    expect(readdirSync(join(home, 'deepseekgui', 'skills'))).toEqual([])
    expect(readdirSync(staging)).toEqual([])
  })

  it('picks a fresh install id when the random suffix is already taken', async () => {
    const { home, options, changed } = setup()
    mkdirSync(join(home, 'deepseekgui', 'skills', 'alpha-cafecafe'), { recursive: true })
    let calls = 0
    const source = writeSkillDir(join(home, 'src', 'alpha'), 'alpha')
    const outcome = await applyImport({ ...options, randomHex: () => (calls += 1) === 1 ? 'cafecafe' : 'feedface' }, {
      path: source,
      selections: [{ key: 'SKILL.md', replaces: null }],
    }, changed)
    expect(outcome.installed[0]!.installId).toBe('alpha-feedface')
  })

  it('uses real time and randomness when none is injected', async () => {
    const { home, changed } = setup()
    const source = writeSkillDir(join(home, 'src', 'alpha'), 'alpha')
    const outcome = await applyImport({ dshHome: home, limits }, { path: source, selections: [{ key: 'SKILL.md', replaces: null }] }, changed)
    expect(outcome.installed[0]!.installId).toMatch(/^alpha-[0-9a-f]{8}$/u)
    expect(Number.isNaN(Date.parse(outcome.installed[0]!.installedAt))).toBe(false)
  })
})

describe('validateStaged and publish', () => {
  it('rejects a staged copy that would be ignored or misnamed', async () => {
    const stage = temp('dsh-stage-')
    writeFileSync(join(stage, 'SKILL.md'), skillText('right'))
    await expect(validateStaged(stage, 'right')).resolves.toBeUndefined()
    await expect(validateStaged(stage, 'other')).rejects.toMatchObject({ name: 'StageError', code: 'skill-invalid' })
    writeFileSync(join(stage, 'SKILL.md'), '---\nname: right\n---\n')
    await expect(validateStaged(stage, 'right')).rejects.toThrow('requires a non-empty "description"')
  })

  it('puts the old install back when the stage cannot take its place', async () => {
    const root = temp('dsh-publish-')
    const location = join(root, 'alpha-00000001')
    mkdirSync(location)
    writeFileSync(join(location, 'keep.txt'), 'old')
    await expect(publish(join(root, 'missing-stage'), location, join(root, 'trash'))).rejects.toThrow()
    expect(readFileSync(join(location, 'keep.txt'), 'utf8')).toBe('old')
    expect(existsSync(join(root, 'trash'))).toBe(false)
  })
})

describe('uninstallSkill', () => {
  it('refuses a directory link even when its target has a matching manifest', async () => {
    const { home, options, changed } = setup()
    const source = writeSkillDir(join(home, 'source'), 'alpha')
    await applyImport(options, { path: source, selections: [{ key: 'SKILL.md', replaces: null }] }, changed)
    const location = join(home, 'deepseekgui', 'skills', 'alpha-00000001')
    const external = join(home, 'external')
    mkdirSync(external)
    writeFileSync(join(external, SKILL_MANIFEST_FILE), readFileSync(join(location, SKILL_MANIFEST_FILE)))
    writeFileSync(join(external, 'sentinel.txt'), 'keep')
    rmSync(location, { recursive: true })
    symlinkSync(external, location, process.platform === 'win32' ? 'junction' : 'dir')
    expect(await uninstallSkill(options, 'alpha-00000001', changed)).toMatchObject({ removed: false, issue: { code: 'not-managed' } })
    expect(readFileSync(join(external, 'sentinel.txt'), 'utf8')).toBe('keep')
  })

  it('removes only directories carrying the manager manifest', async () => {
    const { home, options, changes, changed } = setup()
    const source = writeSkillDir(join(home, 'src', 'alpha'), 'alpha', { 'scripts/run.py': 'x' })
    await applyImport(options, { path: source, selections: [{ key: 'SKILL.md', replaces: null }] }, changed)
    const library = join(home, 'deepseekgui', 'skills')
    writeSkillDir(join(library, 'stray-00000009'), 'stray')
    expect(await uninstallSkill(options, 'stray-00000009', changed)).toMatchObject({ removed: false, issue: { code: 'not-managed' } })
    expect(existsSync(join(library, 'stray-00000009', 'SKILL.md'))).toBe(true)
    expect(await uninstallSkill(options, '../escape', changed)).toMatchObject({ removed: false, issue: { code: 'not-managed' } })
    expect(await uninstallSkill(options, 'alpha-00000001', changed)).toEqual({
      installId: 'alpha-00000001',
      location: join(library, 'alpha-00000001'),
      removed: true,
    })
    expect(existsSync(join(library, 'alpha-00000001'))).toBe(false)
    expect(existsSync(join(source, 'scripts', 'run.py'))).toBe(true)
    expect(changes.at(-1)).toEqual({ kind: 'uninstall', installId: 'alpha-00000001' })
    expect(readdirSync(join(home, 'deepseekgui', 'skills-staging'))).toEqual([])
  })

  it('reports an io-error when the trash cannot be prepared and leaves the install in place', async () => {
    const { home, options, changed } = setup()
    const source = writeSkillDir(join(home, 'src', 'alpha'), 'alpha')
    await applyImport(options, { path: source, selections: [{ key: 'SKILL.md', replaces: null }] }, changed)
    writeFileSync(join(home, 'stage-file'), 'file')
    const outcome = await uninstallSkill({ ...options, stagingDir: join(home, 'stage-file', 'x') }, 'alpha-00000001', changed)
    expect(outcome).toMatchObject({ removed: false, issue: { code: 'io-error' } })
    expect(existsSync(join(home, 'deepseekgui', 'skills', 'alpha-00000001', 'SKILL.md'))).toBe(true)
  })
})
