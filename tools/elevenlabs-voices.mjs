// Generates the Awichas' voices with ElevenLabs, from the texts in voice-scripts/<animal>.<lang>.txt.
//
//   node tools/elevenlabs-voices.mjs --list-voices                        # see the voices on your account, pick an id
//   node tools/elevenlabs-voices.mjs --voice <id> --dry-run               # what would be generated, and how many characters
//   node tools/elevenlabs-voices.mjs --voice <id>                         # all eight, English and Spanish
//   node tools/elevenlabs-voices.mjs --voice <id> --lang es --only gecko,jaguar
//
// The API key comes from ELEVENLABS_API_KEY, or from a file named .env in this folder (see .env.example; never share
// or commit it). ELEVENLABS_VOICE_ID and ELEVENLABS_MODEL can be set there too. Existing files are kept unless --force.
// Output: public/audio/<animal>-<lang>.mp3, loudness-matched to the other voices (needs ffmpeg).
// Then point `voice` in src/animals.js at them: voice: {en: 'audio/gecko-en.mp3', es: 'audio/gecko-es.mp3'}
import {execFileSync} from 'node:child_process'
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {ORDERED} from '../src/animals.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const API = 'https://api.elevenlabs.io'

function loadDotEnv() {
  const file = join(root, '.env')
  if (!existsSync(file)) return
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

function parseArgs(argv) {
  const args = {lang: 'en,es', only: null, force: false, dryRun: false, listVoices: false}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--list-voices') args.listVoices = true
    else if (a === '--force') args.force = true
    else if (a === '--dry-run') args.dryRun = true
    else if (['--voice', '--lang', '--only', '--model', '--speed', '--stability'].includes(a)) args[a.slice(2)] = argv[++i]
    else throw new Error(`unknown option ${a}`)
  }
  return args
}

async function api(path, key, init = {}) {
  const res = await fetch(`${API}${path}`, {...init, headers: {'xi-api-key': key, ...(init.headers || {})}})
  if (!res.ok) {
    let detail = ''
    try { detail = JSON.stringify((await res.json()).detail || '') } catch { /* not json */ }
    const hint = res.status === 401 ? ' (the API key is missing, wrong, or lacks text-to-speech permission)' : ''
    throw new Error(`ElevenLabs ${res.status} on ${path}${hint} ${detail}`)
  }
  return res
}

async function listVoices(key) {
  const res = await api('/v2/voices?page_size=100', key)
  const {voices} = await res.json()
  for (const v of voices) {
    const labels = Object.values(v.labels || {}).filter(Boolean).join(', ')
    console.log(`${v.voice_id}  ${v.name}${labels ? `  (${labels})` : ''}`)
  }
}

const loudnessMatch = (input, output) => execFileSync('ffmpeg', ['-nostdin', '-loglevel', 'error', '-y', '-i', input,
  '-af', 'loudnorm=I=-19.5:TP=-2:LRA=11,aresample=44100', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '128k', output])

async function main() {
  loadDotEnv()
  const args = parseArgs(process.argv.slice(2))
  const key = process.env.ELEVENLABS_API_KEY
  if (!key && !args.dryRun) throw new Error('No API key: set ELEVENLABS_API_KEY or put it in .env (see .env.example)')
  if (args.listVoices) return listVoices(key)

  const voice = args.voice || process.env.ELEVENLABS_VOICE_ID
  if (!voice && !args.dryRun) throw new Error('Choose a voice: --voice <id> (run --list-voices to see them)')
  const model = args.model || process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2'   // speaks English and Spanish
  const langs = args.lang.split(',').map(s => s.trim()).filter(Boolean)
  const animals = ORDERED.filter(a => !args.only || args.only.split(',').includes(a.id))

  const jobs = []
  for (const a of animals) {
    for (const lang of langs) {
      const script = join(root, 'voice-scripts', `${a.id}.${lang}.txt`)
      if (!existsSync(script)) throw new Error(`missing ${script}`)
      const out = join(root, 'public', 'audio', `${a.id}-${lang}.mp3`)
      if (existsSync(out) && !args.force) { console.log(`keep  ${a.id}-${lang}.mp3 (exists; --force to redo)`); continue }
      jobs.push({a, lang, text: readFileSync(script, 'utf8').trim(), out})
    }
  }
  const chars = jobs.reduce((n, j) => n + j.text.length, 0)
  console.log(`${jobs.length} recordings, ${chars} characters, model ${model}, voice ${voice || '(not chosen)'}`)
  if (args.dryRun) { for (const j of jobs) console.log(`would make ${j.a.id}-${j.lang}.mp3 (${j.text.length} characters)`); return }

  const tmp = mkdtempSync(join(tmpdir(), 'awichas-voices-'))
  try {
    for (const j of jobs) {
      const body = {
        text: j.text,
        model_id: model,
        voice_settings: {stability: parseFloat(args.stability || '0.5'), similarity_boost: 0.75, style: 0, use_speaker_boost: true, speed: parseFloat(args.speed || '1')},
      }
      if (/_v2_5$/.test(model)) body.language_code = j.lang   // only the v2.5 models accept a forced language
      const res = await api(`/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`, key, {
        method: 'POST', headers: {'Content-Type': 'application/json', Accept: 'audio/mpeg'}, body: JSON.stringify(body),
      })
      const raw = join(tmp, `${j.a.id}-${j.lang}.mp3`)
      writeFileSync(raw, Buffer.from(await res.arrayBuffer()))
      loudnessMatch(raw, j.out)
      console.log(`made  public/audio/${j.a.id}-${j.lang}.mp3`)
    }
  } finally {
    rmSync(tmp, {recursive: true, force: true})
  }
  console.log('\nIn src/animals.js, for each animal that now has both files:')
  for (const a of animals) console.log(`  ${a.id}: voice: {en: 'audio/${a.id}-en.mp3', es: 'audio/${a.id}-es.mp3'},`)
}

main().catch((err) => { console.error(err.message); process.exitCode = 1 })
