// Compiles every animal's portrait into a MindAR .mind target file (public/targets/<id>.mind)
// by driving tools/compile.html in a headless copy of the locally installed Google Chrome.
//
//   npm run compile-targets              all animals, plus targets/all.mind (every portrait, for the tour)
//   npm run compile-targets -- gecko     just one (all.mind is rebuilt too, it must stay in sync)
//
// Source images live in target-sources/: <id>.jpg (a crop of the printed portrait, preferred)
// or <id>-card.jpg (the whole card). Re-run whenever a portrait print changes.
import http from 'node:http'
import {createReadStream, existsSync, statSync, writeFileSync, mkdirSync} from 'node:fs'
import {extname, join, normalize} from 'node:path'
import {fileURLToPath} from 'node:url'
import {chromium} from 'playwright-core'
import {ORDERED} from '../src/animals.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const ANIMALS = ORDERED.map(a => a.id)   // the tour file's target order must match ORDERED
const wanted = process.argv.slice(2).filter(a => !a.startsWith('-'))
const ids = wanted.length ? wanted : ANIMALS
const MIME = {'.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.wasm': 'application/wasm', '.json': 'application/json'}

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname))
      const file = join(root, path)
      if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) {
        res.writeHead(404).end()
        return
      }
      res.writeHead(200, {'Content-Type': MIME[extname(file)] || 'application/octet-stream'})
      createReadStream(file).pipe(res)
    })
    server.listen(0, '127.0.0.1', () => resolve({server, port: server.address().port}))
  })
}

function sourceFor(id) {
  for (const name of [`${id}.jpg`, `${id}.jpeg`, `${id}.png`, `${id}-card.jpg`]) {
    if (existsSync(join(root, 'target-sources', name))) return name
  }
  return null
}

const {server, port} = await serve()
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-webgl'],
})
try {
  const page = await browser.newPage()
  page.on('pageerror', err => console.error('  [page error]', err.message))
  await page.goto(`http://127.0.0.1:${port}/tools/compile.html`)
  await page.waitForFunction(() => window.MINDAR && window.MINDAR.IMAGE && window.compileTargetBase64)
  const backend = await page.evaluate(() => window.MINDAR?.IMAGE?.tf?.getBackend?.() || 'n/a')
  console.log(`compiler ready (tf backend: ${backend})`)
  mkdirSync(join(root, 'public/targets'), {recursive: true})

  for (const id of ids) {
    const src = sourceFor(id)
    if (!src) {
      console.warn(`${id}: no source image in target-sources/ (skipped)`)
      continue
    }
    process.stdout.write(`${id}: compiling ${src} … `)
    const t0 = Date.now()
    const result = await page.evaluate(async (url) => window.compileTargetBase64(url), `/target-sources/${src}`)
    const out = join(root, 'public/targets', `${id}.mind`)
    writeFileSync(out, Buffer.from(result.base64, 'base64'))
    const s = result.stats[0]
    console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s, ${result.size}, ${s.featurePoints} feature points, ${s.matchingKeyframes} match / ${s.trackingKeyframes} track keyframes -> public/targets/${id}.mind (${(statSync(out).size / 1024).toFixed(0)} KB)`)
  }

  // The tour file: all portraits in ORDERED order (target index = position in ORDERED)
  const sources = ANIMALS.map(id => sourceFor(id))
  if (sources.every(Boolean)) {
    process.stdout.write(`all: compiling ${sources.length} portraits into one file … `)
    const t0 = Date.now()
    const result = await page.evaluate(async (urls) => window.compileTargetBase64(urls), sources.map(s => `/target-sources/${s}`))
    const out = join(root, 'public/targets', 'all.mind')
    writeFileSync(out, Buffer.from(result.base64, 'base64'))
    console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s -> public/targets/all.mind (${(statSync(out).size / 1024).toFixed(0)} KB), ${result.stats.length} targets`)
  } else {
    console.warn('all.mind skipped: a source image is missing')
  }
} finally {
  await browser.close()
  server.close()
}
