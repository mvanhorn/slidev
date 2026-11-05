import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'pathe'
import { describe, expect, it } from 'vitest'
import { toAtFS } from './resolver'
import { applyNotesAutoRuby, createMakeAbsoluteImportGlob, isPathInsideRoots } from './utils'

describe('createMakeAbsoluteImportGlob', () => {
  it('lazily writes and reuses content-addressed proxies in the supplied directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'slidev-glob-'))
    try {
      const proxyDir = join(root, 'cache/slidev/virtual')
      const makeGlob = createMakeAbsoluteImportGlob(proxyDir)
      expect(existsSync(proxyDir)).toBe(false)
      const pattern = join(root, 'deck/setup/!(*.test).{ts,js}')
      const url = makeGlob([pattern])
      expect(url).toMatch(`${toAtFS(proxyDir)}/import-glob.`)
      const file = join(proxyDir, url.split('/').pop()!)
      expect(readFileSync(file, 'utf-8')).toBe(`export default import.meta.glob(${JSON.stringify([relative(proxyDir, pattern)])}, {"eager":true,"exhaustive":true})\n`)
      utimesSync(file, 1, 1)
      const mtime = statSync(file).mtimeMs
      expect(makeGlob([pattern])).toBe(url)
      expect(statSync(file).mtimeMs).toBe(mtime)
      expect(makeGlob([pattern.replaceAll('/', '\\')])).toBe(url)
      expect(createMakeAbsoluteImportGlob(proxyDir)([join(root, 'other-deck/setup/!(*.test).{ts,js}')])).not.toBe(url)
      const custom = makeGlob([pattern], { eager: false, import: 'default' })
      expect(custom).not.toBe(url)
      expect(readFileSync(join(proxyDir, custom.split('/').pop()!), 'utf-8')).toContain('"eager":false,"exhaustive":true,"import":"default"')
      expect(readdirSync(proxyDir)).toHaveLength(3)
    }
    finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('surfaces an unwritable proxy location without falling back', () => {
    const root = mkdtempSync(join(tmpdir(), 'slidev-glob-'))
    try {
      const blocked = join(root, 'cache')
      writeFileSync(blocked, '')
      const makeGlob = createMakeAbsoluteImportGlob(join(blocked, 'slidev/virtual'))
      expect(() => makeGlob([join(root, '*.ts')])).toThrow()
      expect(existsSync(join(root, 'node_modules'))).toBe(false)
    }
    finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('isPathInsideRoots', () => {
  it('accepts a path nested inside a root', () => {
    expect(isPathInsideRoots('/a/b/c', ['/a'])).toBe(true)
  })

  it('accepts a path that equals the root itself', () => {
    expect(isPathInsideRoots('/a', ['/a'])).toBe(true)
  })

  it('rejects a path outside every root', () => {
    expect(isPathInsideRoots('/x', ['/a'])).toBe(false)
  })

  it('rejects a `..`-escaping relative resolution', () => {
    expect(isPathInsideRoots('/a/../x', ['/a'])).toBe(false)
  })

  it('accepts when any of several roots contains the path', () => {
    expect(isPathInsideRoots('/b/c', ['/a', '/b'])).toBe(true)
  })
})

describe('applyNotesAutoRuby', () => {
  it('wraps a matched key in a ruby tag', () => {
    expect(applyNotesAutoRuby('私は勉強しています。', { 勉強: 'べんきょう' }))
      .toBe('私は<ruby>勉強<rt>べんきょう</rt></ruby>しています。')
  })

  it('prefers the longest key when one key starts with another', () => {
    expect(applyNotesAutoRuby('私は日本語を話す', { 日本: 'ni hon', 日本語: 'ni hon go' }))
      .toBe('私は<ruby>日本語<rt>ni hon go</rt></ruby>を話す')
  })

  it('matches keys containing regular expression characters literally', () => {
    expect(applyNotesAutoRuby('I write C++ code', { 'C++': 'see plus plus' }))
      .toBe('I write <ruby>C++<rt>see plus plus</rt></ruby> code')
    expect(applyNotesAutoRuby('the (foo) case', { '(foo)': 'ふー' }))
      .toBe('the <ruby>(foo)<rt>ふー</rt></ruby> case')
  })

  it('only matches whole words for alphanumeric keys', () => {
    expect(applyNotesAutoRuby('slidev slidevjs', { slidev: 'slide dev' }))
      .toBe('<ruby>slidev<rt>slide dev</rt></ruby> slidevjs')
  })

  it('returns the input untouched when there is no key', () => {
    expect(applyNotesAutoRuby('unchanged', {})).toBe('unchanged')
  })
})
