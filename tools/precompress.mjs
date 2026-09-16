// Writes a gzipped twin (foo.js -> foo.js.gz) next to every large compressible file in dist/.
// The .htaccess that ships in dist/ hands the twin to any phone that accepts gzip, so the server
// never has to compress anything itself: shared hosting cannot afford to gzip ~20 MB per visitor
// on the fly, and this way the bytes are prepared once, at the best compression level.
//   node tools/precompress.mjs [dist-dir]
import {gzipSync} from 'node:zlib'
import {readFileSync, writeFileSync, readdirSync, statSync, rmSync} from 'node:fs'
import {join, extname} from 'node:path'
import {fileURLToPath} from 'node:url'

const dist = process.argv[2] || fileURLToPath(new URL('../dist', import.meta.url))
// Types that actually gain from gzip. Measured on this project: js 74%, wasm 71%, mind 56%,
// glb 30%, task 26%. The already-compressed media (mp3, m4a, jpg) gain ~3% and are left alone.
const COMPRESS = new Set(['.js', '.css', '.html', '.wasm', '.mind', '.glb', '.task', '.svg', '.json'])
const MIN_BYTES = 1024        // below this the request overhead outweighs the saving
const MIN_GAIN = 0.05         // and a file that barely shrinks is not worth a second copy

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) yield* walk(path)
    else yield path
  }
}

let files = 0, from = 0, to = 0
for (const path of walk(dist)) {
  if (path.endsWith('.gz')) { rmSync(path); continue }   // a twin from an earlier build
  if (!COMPRESS.has(extname(path))) continue
  const raw = readFileSync(path)
  if (raw.length < MIN_BYTES) continue
  const gz = gzipSync(raw, {level: 9})
  if (gz.length > raw.length * (1 - MIN_GAIN)) continue
  writeFileSync(path + '.gz', gz)
  files++
  from += raw.length
  to += gz.length
}

const mb = n => (n / 1048576).toFixed(1)
console.log(`precompress: ${files} files, ${mb(from)} MB -> ${mb(to)} MB (${Math.round(100 - 100 * to / from)}% saved)`)
