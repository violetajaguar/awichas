// Loads every animal in headless Chrome (fake camera) and prints how each model measures,
// to sanity-check the size normalisation in src/model-loader.js.
//   node tools/inspect-models.mjs <video.y4m> [animal…]
import http from 'node:http'
import {createReadStream, existsSync, statSync} from 'node:fs'
import {extname, join, normalize, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {chromium} from 'playwright-core'

const root = fileURLToPath(new URL('..', import.meta.url))
const [videoFile, ...only] = process.argv.slice(2)
const ids = only.length ? only : ['jaguar', 'monkey', 'gecko', 'whale', 'condor', 'llama', 'hummingbird', 'spider']
const dist = join(root, 'dist')
const server = http.createServer((req, res) => {
  const file = join(dist, normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)))
  if (!file.startsWith(dist) || !existsSync(file) || statSync(file).isDirectory()) return void res.writeHead(404).end()
  res.writeHead(200, {'Content-Type': {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm'}[extname(file)] || 'application/octet-stream'})
  createReadStream(file).pipe(res)
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({channel: 'chrome', headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${resolve(videoFile)}`, '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required']})
try {
  const context = await browser.newContext({viewport: {width: 390, height: 844}, permissions: ['camera']})
  const page = await context.newPage()
  page.on('pageerror', e => console.log('  PAGE ERROR', e.message))
  for (const id of ids) {
    await page.goto(`${base}/index.html?animal=${id}&debug=1`)
    await page.click('#start')
    await page.waitForFunction(() => ['scanning', 'onTarget'].includes(document.body.dataset.state), null, {timeout: 90_000})
    const info = await page.evaluate(() => {
      const {rig, THREE} = window.__awichas
      const naive = new THREE.Box3()
      const b = new THREE.Box3()
      let skinned = 0, meshes = 0
      const scales = []
      rig.model.updateMatrixWorld(true)
      rig.model.traverse((o) => {
        if (o.scale.x !== 1 || o.scale.y !== 1 || o.scale.z !== 1) scales.push(`${o.name || o.type}:${o.scale.x.toPrecision(3)}`)
        if (!o.isMesh) return
        meshes++
        if (o.isSkinnedMesh) skinned++
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox()
        naive.union(b.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld))
      })
      const f = v => v.toArray().map(n => +n.toPrecision(3))
      const mats = []
      rig.model.traverse((o) => {
        if (!o.isMesh) return
        for (const m of [].concat(o.material)) {
          if (mats.find(x => x.name === m.name)) continue
          mats.push({name: m.name, type: m.type.replace('Mesh', '').replace('Material', ''), color: m.color?.getHexString(), metal: m.metalness, rough: m.roughness, map: !!m.map, mr: !!m.metalnessMap, emissive: m.emissive?.getHexString(), env: m.envMapIntensity})
        }
      })
      return {
        materials: mats.slice(0, 4),
        measured: f(rig.size), longest: +rig.longest.toPrecision(3),
        naiveGeometry: f(naive.getSize(new THREE.Vector3())),
        meshes, skinned, clips: rig.clips, scales: scales.slice(0, 5),
      }
    })
    console.log(id, JSON.stringify(info))
  }
} finally {
  await browser.close()
  server.close()
}
