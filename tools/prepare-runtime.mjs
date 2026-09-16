// Copies runtime binaries that must be served as plain files (not bundled) into public/:
//   - Draco decoder (for the draco-compressed GLBs) from the three package
//   - MediaPipe Tasks Vision WASM runtime (hand tracking)
// Runs automatically after `npm install`.
import {cpSync, existsSync, mkdirSync, writeFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const copies = [
  ['node_modules/three/examples/jsm/libs/draco/gltf', 'public/decoders/draco'],
  ['node_modules/@mediapipe/tasks-vision/wasm', 'public/mediapipe/wasm'],
]
for (const [from, to] of copies) {
  const src = root + from
  if (!existsSync(src)) {
    console.warn(`prepare-runtime: missing ${from} (run npm install first)`)
    continue
  }
  mkdirSync(root + to, {recursive: true})
  cpSync(src, root + to, {recursive: true})
  console.log(`prepare-runtime: copied ${from} -> ${to}`)
}

// The hand-tracking model itself is not in the npm package, so fetch it once. It is Google's, Apache-2.0,
// and it is not kept in the repository: 7.5 MB of binary that anyone can download from the source.
const MODEL = 'public/mediapipe/hand_landmarker.task'
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'
if (existsSync(root + MODEL)) {
  console.log(`prepare-runtime: ${MODEL} already here`)
} else {
  process.stdout.write(`prepare-runtime: downloading ${MODEL} … `)
  try {
    const res = await fetch(MODEL_URL)
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
    const bytes = Buffer.from(await res.arrayBuffer())
    mkdirSync(root + 'public/mediapipe', {recursive: true})
    writeFileSync(root + MODEL, bytes)
    console.log(`${(bytes.length / 1048576).toFixed(1)} MB`)
  } catch (err) {
    console.log('failed')
    console.warn(`prepare-runtime: could not fetch the hand model (${err.message}).`)
    console.warn(`  Hand tracking will not work until it is there. Download it by hand from:`)
    console.warn(`  ${MODEL_URL}`)
    console.warn(`  and save it as ${MODEL}`)
  }
}
