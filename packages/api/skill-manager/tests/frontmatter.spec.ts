import { describe, expect, it } from 'vitest'
import { hasBlockingIssue, proposeMetadata, renderSkillDocument, reviewSkillDocument, toSkillName } from '../src/frontmatter.ts'

const codes = (raw: string): string[] => reviewSkillDocument(raw).issues.map(issue => issue.code)

describe('reviewSkillDocument', () => {
  it('accepts the official shape and keeps whenToUse', () => {
    const document = reviewSkillDocument('---\nname: my-skill\ndescription: Does things\nwhenToUse: when asked\n---\n# Body\n')
    expect(document).toMatchObject({ name: 'my-skill', description: 'Does things', whenToUse: 'when asked', issues: [], body: '# Body\n' })
    expect(document.data).toMatchObject({ name: 'my-skill' })
    expect(hasBlockingIssue(document)).toBe(false)
  })

  it('reports a missing frontmatter as fixable and keeps the whole text as body', () => {
    expect(reviewSkillDocument('# Title\n\nJust a doc\n')).toMatchObject({
      data: null,
      body: '# Title\n\nJust a doc\n',
      name: null,
      description: null,
      issues: [{ code: 'missing-frontmatter', fixable: true }],
    })
    expect(codes('single line without newline')).toEqual(['missing-frontmatter'])
    expect(codes('---\nname: x\nno closing delimiter\n')).toEqual(['missing-frontmatter'])
    expect(codes('---\nname: x')).toEqual(['missing-frontmatter'])
  })

  it('accepts CRLF delimiters and a closing delimiter on the last line', () => {
    const crlf = reviewSkillDocument('---\r\nname: crlf-skill\r\ndescription: d\r\n---\r\nbody\r\n')
    expect(crlf).toMatchObject({ name: 'crlf-skill', description: 'd', issues: [] })
    const last = reviewSkillDocument('---\nname: last-line\ndescription: d\n---')
    expect(last).toMatchObject({ name: 'last-line', body: '', issues: [] })
  })

  it('reports unparsable and non-mapping frontmatter as blocking', () => {
    const broken = reviewSkillDocument('---\nname: [unclosed\n---\nbody\n')
    expect(broken.issues).toHaveLength(1)
    expect(broken.issues[0]!.code).toBe('invalid-frontmatter')
    expect(broken.issues[0]!.message).toContain('does not parse')
    expect(hasBlockingIssue(broken)).toBe(true)
    expect(codes('---\n- a\n- b\n---\nbody\n')).toEqual(['invalid-frontmatter'])
    expect(codes('---\n---\nbody\n')).toEqual(['invalid-frontmatter'])
    expect(reviewSkillDocument('---\n- a\n---\nbody\n').body).toBe('body\n')
  })

  it('reports each metadata rule the official provider enforces', () => {
    expect(codes('---\ndescription: d\n---\n')).toEqual(['missing-name'])
    expect(codes('---\nname: Not Kebab\ndescription: d\n---\n')).toEqual(['invalid-name'])
    expect(codes('---\nname: ""\ndescription: d\n---\n')).toEqual(['missing-name'])
    expect(codes('---\nname: ok-name\n---\n')).toEqual(['missing-description'])
    expect(codes('---\nname: ok-name\ndescription: d\ndisableModelInvocation: true\n---\n')).toEqual(['legacy-key'])
    expect(codes('---\nname: ok-name\ndescription: d\nmodelInvocable: true\nuserInvocable: false\n---\n')).toEqual(['legacy-key', 'legacy-key'])
    expect(codes('---\nname: ok-name\ndescription: d\ndisable-model-invocation: maybe\n---\n')).toEqual(['invalid-boolean'])
    expect(codes('---\nname: ok-name\ndescription: d\nuser-invocable: {}\n---\n')).toEqual(['invalid-boolean'])
    const fixable = reviewSkillDocument('---\nname: Bad Name\n---\n')
    expect(fixable.issues.every(issue => issue.fixable === true)).toBe(true)
    expect(hasBlockingIssue(fixable)).toBe(false)
  })

  it('accepts every boolean spelling the official provider accepts', () => {
    for (const value of ['true', 'false', '1', '0', 'yes', 'no', 'on', 'off', '"1"', '"0"', '"YES"', '"Off"']) {
      expect(codes(`---\nname: ok-name\ndescription: d\ndisable-model-invocation: ${value}\nuser-invocable: ${value}\n---\n`)).toEqual([])
    }
    expect(codes('---\nname: ok-name\ndescription: d\nwhenToUse: 3\n---\n')).toEqual([])
    expect(reviewSkillDocument('---\nname: ok-name\ndescription: d\nwhenToUse: 3\n---\n').whenToUse).toBeUndefined()
  })
})

describe('proposeMetadata', () => {
  it('derives a name from the file name and a description from the first plain line', () => {
    const document = reviewSkillDocument('# Heading\n\n```\ncode\n```\n<div>html</div>\n- **Bold** intro line\nsecond line\n')
    expect(proposeMetadata(document, 'My Skill Doc.md')).toEqual({ name: 'my-skill-doc', description: 'Bold intro line' })
  })

  it('proposes only what is missing', () => {
    const named = reviewSkillDocument('---\nname: has-name\n---\nA description line\n')
    expect(proposeMetadata(named, 'ignored.md')).toEqual({ description: 'A description line' })
    const described = reviewSkillDocument('---\ndescription: present\n---\nbody\n')
    expect(proposeMetadata(described, 'from-file')).toEqual({ name: 'from-file' })
    const complete = reviewSkillDocument('---\nname: a\ndescription: b\n---\n')
    expect(proposeMetadata(complete, 'x')).toEqual({})
  })

  it('leaves fields out when nothing usable exists', () => {
    const document = reviewSkillDocument('# Only headings\n\n## And more\n\n***\n')
    expect(proposeMetadata(document, '___.md')).toEqual({})
  })

  it('truncates a long first line', () => {
    const document = reviewSkillDocument(`${'x'.repeat(300)}\n`)
    const proposal = proposeMetadata(document, 'long')
    expect(proposal.description).toHaveLength(200)
    expect(proposal.description?.endsWith('…')).toBe(true)
  })
})

describe('toSkillName', () => {
  it('kebab-cases file and directory names', () => {
    expect(toSkillName('PdfTools.md')).toBe('pdf-tools')
    expect(toSkillName('data_analysis v2')).toBe('data-analysis-v2')
    expect(toSkillName('--already-kebab--')).toBe('already-kebab')
    expect(toSkillName('文档.md')).toBeUndefined()
    expect(toSkillName('.md')).toBeUndefined()
  })
})

describe('renderSkillDocument', () => {
  it('writes frontmatter with the final metadata and keeps other keys and the body', () => {
    const document = reviewSkillDocument('---\nname: Old Name\ndescription: old\nuser-invocable: false\nmetadata:\n  tag: x\n---\nBody stays\n')
    const rendered = renderSkillDocument(document, 'new-name', 'new description')
    const again = reviewSkillDocument(rendered)
    expect(again).toMatchObject({ name: 'new-name', description: 'new description', issues: [], body: 'Body stays\n' })
    expect(again.data).toMatchObject({ 'user-invocable': false, metadata: { tag: 'x' } })
  })

  it('creates frontmatter for a plain document', () => {
    const document = reviewSkillDocument('# Plain\n\nFirst line\n')
    const rendered = renderSkillDocument(document, 'plain', 'First line')
    expect(rendered).toBe('---\nname: plain\ndescription: First line\n---\n# Plain\n\nFirst line\n')
  })
})
