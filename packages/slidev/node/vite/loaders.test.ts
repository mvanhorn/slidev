import type { ResolvedSlidevOptions } from '@slidev/types'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import { build, createServer, normalizePath } from 'vite'
import { expect, it } from 'vitest'
import { toAtFS } from '../resolver'
import { createSlidesLoader } from './loaders'

it.each(['global', 'override'])('uses the resolved %s cache for glob proxies in dev and build', async (location) => {
  const root = normalizePath(realpathSync(mkdtempSync(join(tmpdir(), 'slidev-loader-'))))
  const deck = join(root, 'deck')
  const otherDeck = join(root, 'other-deck')
  const cliRoot = join(root, 'cli')
  const globalCache = join(cliRoot, 'node_modules/.vite')
  const cacheDir = location === 'global' ? globalCache : join(root, 'external-cache')
  const proxyDir = join(cacheDir, 'slidev/virtual')
  for (const dir of [deck, otherDeck]) {
    mkdirSync(join(dir, 'setup'), { recursive: true })
    writeFileSync(join(dir, 'setup/main.ts'), `export default () => ${JSON.stringify(dir)}`)
    writeFileSync(join(dir, 'style.css'), 'body { color: red }')
  }
  const options = {
    userRoot: deck,
    cliRoot,
    roots: [deck, otherDeck],
    mode: 'dev',
    data: { features: {}, slides: [], watchFiles: {}, markdownFiles: {} },
    utils: {},
  } as unknown as ResolvedSlidevOptions
  const config = {
    root: deck,
    configFile: false as const,
    cacheDir: globalCache,
    plugins: [
      createSlidesLoader(options, {}),
      { name: 'cache-override', config: () => ({ cacheDir }) },
    ],
    server: { fs: { strict: true, allow: [deck, otherDeck] }, port: 0 },
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'silent' as const,
  }
  const server = await createServer(config)
  try {
    expect(server.config.cacheDir).toBe(cacheDir)
    expect(server.config.server.fs.allow).toContain(proxyDir)
    expect(server.config.server.fs.allow).not.toContain(cacheDir)
    expect(server.config.server.fs.allow).not.toContain(root)
    expect(existsSync(proxyDir)).toBe(false)
    await server.listen()
    const origin = server.resolvedUrls!.local[0]
    for (const id of ['/@slidev/setups/main', '/@slidev/conditional-styles']) {
      const virtual = await server.transformRequest(id)
      const urls = [...virtual!.code.matchAll(/"(\/@fs\/[^"?]+import-glob\.[^"?]+\.ts)"/g)].map(match => match[1])
      expect(urls).toHaveLength(2)
      expect(new Set(urls).size).toBe(2)
      for (const [index, url] of urls.entries()) {
        expect(url).toMatch(`${toAtFS(proxyDir)}/import-glob.`)
        expect(readFileSync(join(proxyDir, url.split('/').pop()!), 'utf-8')).toContain('import.meta.glob')
        const response = await fetch(new URL(url, origin))
        const transformed = await response.text()
        expect(response.status, transformed).toBe(200)
        expect(transformed).not.toContain('import.meta.glob(')
        const file = id.endsWith('/main') ? '/setup/main.ts' : '/style.css'
        expect(transformed).toContain(JSON.stringify(index === 0 ? file : `${toAtFS(otherDeck)}${file}`))
      }
    }
    expect(readdirSync(proxyDir)).toHaveLength(4)
    expect(existsSync(join(deck, 'node_modules'))).toBe(false)
    expect(existsSync(join(otherDeck, 'node_modules'))).toBe(false)

    const result = await build({
      ...config,
      plugins: [createSlidesLoader({ ...options, mode: 'build' }, {})],
      cacheDir,
      build: {
        write: false,
        minify: false,
        rolldownOptions: { input: '/@slidev/setups/main', output: { format: 'es' } },
      },
    })
    expect(result).toHaveProperty('output')
    if (!('output' in result))
      throw new Error('Expected build output')
    const code = result.output.filter(chunk => chunk.type === 'chunk').map(chunk => chunk.code).join('\n')
    expect(code).toContain(deck)
    expect(code).toContain(otherDeck)
    expect(code).not.toContain('import.meta.glob(')
    expect(existsSync(join(deck, 'node_modules'))).toBe(false)
  }
  finally {
    await server.close()
    rmSync(root, { recursive: true, force: true })
  }
})
