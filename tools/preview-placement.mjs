// Screenshot an animal on its portrait (and, optionally, on a fake hand) without a phone, to tune
// src/animals.js. Uses the dev server if BASE is set, otherwise serves dist/.
//   node tools/preview-placement.mjs monkey                        # on the portrait
//   node tools/preview-placement.mjs monkey --hand                 # + summon onto a synthetic hand
//   node tools/preview-placement.mjs monkey --set '{"onTarget":{"rotation":[0,180,0]}}'   # try values live
//   BASE=https://localhost:5173 node tools/preview-placement.mjs monkey   # against `npm run dev`
import http from 'node:http'
import {execFileSync} from 'node:child_process'
import {createReadStream, existsSync, mkdirSync, statSync} from 'node:fs'
import {extname, join, normalize} from 'node:path'
import {fileURLToPath} from 'node:url'
import {chromium} from 'playwright-core'

const root = fileURLToPath(new URL('..', import.meta.url))
const args = process.argv.slice(2)
const animal = args.find(a => !a.startsWith('--')) || 'gecko'
const withHand = args.includes('--hand')
const withReturn = args.includes('--return')
const setIdx = args.indexOf('--set')
const override = setIdx >= 0 ? JSON.parse(args[setIdx + 1]) : null
const outDir = process.env.OUT || join(root, 'smoke-out')
const tag = process.env.TAG ? `-${process.env.TAG}` : ''
mkdirSync(outDir, {recursive: true})

// fake camera feed: the portrait, 600x800, looping
const src = ['jpg', 'jpeg', 'png'].map(e => join(root, 'target-sources', `${animal}.${e}`)).find(existsSync) || join(root, 'target-sources', `${animal}-card.jpg`)
const y4m = join(outDir, `${animal}.y4m`)
if (!existsSync(y4m)) {
  execFileSync('ffmpeg', ['-nostdin', '-loglevel', 'error', '-y', '-loop', '1', '-i', src, '-t', '2', '-r', '15', '-vf', 'scale=600:800:force_original_aspect_ratio=decrease,pad=600:800:(ow-iw)/2:(oh-ih)/2:color=0x202020', '-pix_fmt', 'yuv420p', y4m])
}

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

const browser = await chromium.launch({channel: 'chrome', headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${y4m}`, '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required']})
try {
  const context = await browser.newContext({viewport: {width: 600, height: 800}, permissions: ['camera'], ignoreHTTPSErrors: true})
  const page = await context.newPage()
  page.on('pageerror', e => console.log('PAGE ERROR', e.message))
  page.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) console.log('console.error:', m.text()) })
  await page.goto(`${base}/index.html?animal=${animal}&debug=1${withHand ? '&fakehand=1' : ''}`)
  await page.addStyleTag({content: '#debug, #hint, #actions, a.home, #language { display: none !important }'})
  await page.click('#start')
  await page.waitForFunction(() => document.body.dataset.state === 'onTarget', null, {timeout: 90_000})
  if (override) {
    await page.evaluate((o) => {
      const a = window.__awichas.animal
      Object.assign(a.onTarget, o.onTarget || {})
      Object.assign(a.onHand, o.onHand || {})
      window.__awichas.apply()
    }, override)
  }
  await page.waitForTimeout(2000)
  const cam = await page.evaluate(() => {
    const {mindar, anchor, rig, animal} = window.__awichas
    const e = anchor.group.matrix.elements
    return {near: mindar.camera.near, far: mindar.camera.far, fov: +mindar.camera.fov.toFixed(1), portraitDistance: +(-e[14]).toFixed(0), portraitScale: +e[0].toFixed(0), video: `${mindar.video.videoWidth}x${mindar.video.videoHeight}`, onTarget: animal.onTarget, onHand: animal.onHand, longest: +rig.longest.toFixed(2)}
  })
  console.log(JSON.stringify(cam))
  const shot = join(outDir, `${animal}-portrait${tag}.png`)
  await page.screenshot({path: shot})
  console.log('screenshot:', shot)
  if (withHand) {
    await page.evaluate(() => document.getElementById('summon').click())   // the button is hidden by the style tag above
    await page.waitForFunction(() => document.body.dataset.state === 'onHand', null, {timeout: 60_000})
    await page.waitForTimeout(2500)
    const pos = await page.evaluate(() => ({state: window.__awichas.state, pivot: window.__awichas.rig.pivot.position.toArray().map(n => +n.toFixed(1)), scale: +window.__awichas.rig.pivot.scale.x.toFixed(2)}))
    console.log(JSON.stringify(pos))
    const shot2 = join(outDir, `${animal}-hand${tag}.png`)
    await page.screenshot({path: shot2})
    console.log('screenshot:', shot2)
    if (withReturn) {
      const states = []
      await page.exposeFunction('noteState', s => states.push(s))
      await page.evaluate(() => new MutationObserver(() => window.noteState(document.body.dataset.state)).observe(document.body, {attributes: true, attributeFilter: ['data-state']}))
      await page.evaluate(() => document.getElementById('back-to-portrait').click())
      await page.waitForTimeout(700)
      const mid = join(outDir, `${animal}-returning${tag}.png`)
      await page.screenshot({path: mid})
      await page.waitForFunction(() => document.body.dataset.state === 'onTarget', null, {timeout: 60_000})
      await page.waitForTimeout(800)
      const shot3 = join(outDir, `${animal}-returned${tag}.png`)
      await page.screenshot({path: shot3})
      console.log('return path:', ['onHand', ...states].join(' -> '), '| screenshots:', mid, shot3)
    }
  }
} finally {
  await browser.close()
  if (server) server.close()
}
