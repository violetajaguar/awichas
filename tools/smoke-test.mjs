// End-to-end smoke test: serves dist/, opens the pages in headless Chrome with a FAKE camera that
// plays a video file (a portrait image), and checks the experience reaches the states we expect.
//   node tools/smoke-test.mjs <animal> <video.y4m|mjpeg> [out-dir]
import http from 'node:http'
import {createReadStream, existsSync, mkdirSync, statSync} from 'node:fs'
import {extname, join, normalize, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {chromium} from 'playwright-core'

const root = fileURLToPath(new URL('..', import.meta.url))
const [animal = 'gecko', videoFile, outDir = join(root, 'smoke-out')] = process.argv.slice(2)
if (!videoFile) throw new Error('usage: node tools/smoke-test.mjs <animal> <video.y4m> [out-dir]')
mkdirSync(outDir, {recursive: true})
const MIME = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png', '.wasm': 'application/wasm', '.glb': 'model/gltf-binary', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.mind': 'application/octet-stream', '.task': 'application/octet-stream'}

const dist = join(root, 'dist')
const server = http.createServer((req, res) => {
  let path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname))
  if (path === '/') path = '/index.html'
  const file = join(dist, path)
  if (!file.startsWith(dist) || !existsSync(file) || statSync(file).isDirectory()) return void res.writeHead(404).end()
  res.writeHead(200, {'Content-Type': MIME[extname(file)] || 'application/octet-stream'})
  createReadStream(file).pipe(res)
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}`

const browser = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${resolve(videoFile)}`,
    '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
})
const problems = []
const t0 = Date.now()
const stamp = () => `[${((Date.now() - t0) / 1000).toFixed(1)}s]`
try {
  const context = await browser.newContext({viewport: {width: 390, height: 844}, deviceScaleFactor: 1, isMobile: true, hasTouch: true, permissions: ['camera']})
  const page = await context.newPage()
  page.on('console', (m) => {
    const line = `${stamp()} console.${m.type()}: ${m.text()}`
    const where = m.location && m.location().url ? ` (${m.location().url})` : ''
    if (m.type() === 'error' || m.type() === 'warning') { problems.push(line + where); console.log(line + where) } else if (process.env.VERBOSE) console.log(line)
  })
  page.on('pageerror', (e) => { problems.push(`pageerror: ${e.message}`); console.log(stamp(), 'PAGE ERROR', e.message) })
  page.on('requestfailed', (r) => { problems.push(`request failed: ${r.url()} ${r.failure()?.errorText}`); console.log(stamp(), 'REQUEST FAILED', r.url(), r.failure()?.errorText) })
  page.on('response', (r) => { if (r.status() >= 400) { problems.push(`HTTP ${r.status()} ${r.url()}`); console.log(stamp(), 'HTTP', r.status(), r.url()) } })

  console.log(stamp(), 'welcome screen (the tour)')
  await page.goto(`${base}/index.html`)
  await page.waitForSelector('#intro #start')
  console.log(stamp(), 'start button:', await page.$eval('#start', e => e.textContent))
  await page.screenshot({path: join(outDir, 'home.png'), fullPage: true})

  console.log(stamp(), `experience: ${animal}`)
  await page.goto(`${base}/index.html?animal=${animal}&debug=1`)
  await page.waitForSelector('#start')
  await page.addStyleTag({content: '#debug { opacity: 0; pointer-events: none; }'})   // the tuning panel must not cover buttons
  await page.screenshot({path: join(outDir, 'intro.png')})
  await page.click('#start')
  const waitState = async (states, timeout) => {
    await page.waitForFunction((s) => s.includes(document.body.dataset.state), states, {timeout})
    const st = await page.evaluate(() => document.body.dataset.state)
    console.log(stamp(), 'state =', st)
    return st
  }
  await waitState(['scanning'], 90_000)
  await page.screenshot({path: join(outDir, 'scanning.png')})
  await waitState(['onTarget'], 90_000)
  await page.waitForTimeout(2500)
  await page.screenshot({path: join(outDir, 'on-target.png')})
  console.log(stamp(), 'debug info:', (await page.textContent('#debug .info'))?.replace(/\n/g, ' | '))
  await page.click('#summon')
  await waitState(['summoning', 'onHand'], 120_000)
  await page.waitForTimeout(3000)
  console.log(stamp(), 'debug info:', (await page.textContent('#debug .info'))?.replace(/\n/g, ' | '))
  await page.screenshot({path: join(outDir, 'summoning.png')})
  await page.click('#back-to-portrait')
  // the portrait is still in view, so "scanning" may flip back to "onTarget" within a frame
  await waitState(['scanning', 'onTarget'], 10_000)
  await waitState(['onTarget'], 90_000)
  await page.screenshot({path: join(outDir, 'on-target-again.png')})
  console.log(stamp(), 'DONE. problems:', problems.length)
} catch (err) {
  console.log(stamp(), 'FAILED:', err.message)
  try { console.log(stamp(), 'last state =', await (await browser.contexts()[0].pages())[0].evaluate(() => document.body.dataset.state)) } catch {}
  process.exitCode = 1
} finally {
  await browser.close()
  server.close()
}
