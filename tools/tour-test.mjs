// Tour-mode check: a fake camera video that shows one portrait, then another. The app must bring
// out the first animal, then switch to the second when the picture changes.
//   node tools/tour-test.mjs <two-portrait-video.y4m>     (uses dist/, or BASE=https://localhost:5173 for the dev server)
import http from 'node:http'
import {createReadStream, existsSync, statSync} from 'node:fs'
import {extname, join, normalize, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {chromium} from 'playwright-core'

const root = fileURLToPath(new URL('..', import.meta.url))
const video = resolve(process.argv[2])
let server = null
let base = process.env.BASE
if (!base) {
  const dist = join(root, 'dist')
  server = http.createServer((req, res) => {
    const file = join(dist, normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)))
    if (!file.startsWith(dist) || !existsSync(file) || statSync(file).isDirectory()) return void res.writeHead(404).end()
    res.writeHead(200, {'Content-Type': {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm'}[extname(file)] || 'application/octet-stream'})
    createReadStream(file).pipe(res)
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}`
}
const browser = await chromium.launch({channel: 'chrome', headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${video}`, '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required']})
const t0 = Date.now()
try {
  const context = await browser.newContext({viewport: {width: 600, height: 800}, permissions: ['camera'], ignoreHTTPSErrors: true})
  const page = await context.newPage()
  page.on('pageerror', e => console.log('PAGE ERROR', e.message))
  page.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) console.log('console.error:', m.text()) })
  await page.goto(`${base}/index.html?debug=1`)
  await page.addStyleTag({content: '#debug { opacity: 0; pointer-events: none }'})
  await page.click('#start')
  const seen = []
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(500)
    const now = await page.evaluate(() => `${document.body.dataset.state}:${window.__awichas.animal ? window.__awichas.animal.id : '-'}`)
    if (seen[seen.length - 1] !== now) { seen.push(now); console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, now) }
  }
  const ids = seen.filter(s => s.startsWith('onTarget:')).map(s => s.split(':')[1])
  const ok = ids.includes('gecko') && ids.includes('monkey')
  console.log(ok ? 'TOUR OK: both portraits brought out their animal' : 'TOUR FAILED', JSON.stringify(seen))
  process.exitCode = ok ? 0 : 1
} finally {
  await browser.close()
  if (server) server.close()
}
