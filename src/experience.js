// The whole site is this one page (index.html): a welcome screen over the camera, and the AR experience.
// Two modes:
//   index.html?animal=gecko        one Awicha (her own .mind target)
//   index.html                     the tour: all eight portraits in one target file; whichever print the camera
//                                  sees brings out its animal, so the app is started once and then carried
//                                  from portrait to portrait.
// Flow per animal: scan the print -> she emerges and speaks -> hold out a hand -> she travels onto the palm
// (flying in an arc, or walking/crawling in a straight line facing where she goes) -> show the print again
// (or press "Back") -> she travels back. Only one tracker runs at a time except during hand-overs.
import * as THREE from 'three'
import {MindARThree} from 'mind-ar/dist/mindar-image-three.prod.js'
import {getAnimal, ORDERED, SOUNDTRACK, ALL_TARGETS, voiceSources, voiceLanguage} from './animals.js'
import {loadAnimalModel} from './model-loader.js'
import {HandTracker, syntheticHand} from './hand-tracker.js'
import {coverLayout, palmPose, PoseSmoother, easeInOut} from './hand-pose.js'
import {Sound, Mixer} from './audio.js'
import {getLanguage, setLanguage, mountLanguageSwitch} from './language.js'
import {mountDebugPanel} from './debug-panel.js'
import {makeStudioEnvironment} from './studio-env.js'

const params = new URLSearchParams(location.search)
const wanted = params.get('animal')
const single = wanted ? getAnimal(wanted) : null
if (wanted && !single) {
  location.replace(location.pathname)   // unknown animal: fall back to the tour
  throw new Error('unknown animal')
}
const TOUR = !single
const animals = single ? [single] : ORDERED        // index = MindAR target index
const DEBUG = params.has('debug')
const FAKE_HAND = DEBUG && params.has('fakehand')  // test the hand phase without a real hand

// A link or QR code can go straight into the camera: index.html?camera=1 skips the welcome screen and asks
// for the camera as the page opens. There is then no Start tap to let the phone play sound, so the first
// touch anywhere does that instead (armAudioOnFirstTouch). ?camera=0 (false / no / off) is the normal way in.
const DIRECT = params.has('camera') &&
  !['0', 'false', 'no', 'off'].includes((params.get('camera') || '').trim().toLowerCase())

let lang = getLanguage()   // English / Español: the recordings each Awicha plays, and the words on screen
const T = () => TEXT[lang] || TEXT.en
const titleOf = cfg => (lang === 'es' && cfg.titleEs) || cfg.title
const TEXT = {
  en: {
    introTour: 'Point your camera at any of the eight printed portraits. Each Awicha steps out of her picture; hold out your open hand and she comes to you. Then walk on to the next portrait.',
    introSingle: 'Point your camera at this printed portrait. When she appears, hold out your open hand and she will come to you.',
    start: 'Start the camera', replay: 'Hear her again', summon: 'Call her to my hand', back: 'Back to the portrait',
    retry: 'Try again', errorTitle: 'Something went wrong', home: 'Back to Las Awichas', preparing: 'Preparing…',
    startingCamera: 'Starting the camera…', loadingHands: 'Loading hand tracking…',
    cameraError: 'The camera could not be started. Allow camera access for this site and try again.',
    scanTour: 'Point the camera at a portrait', scanSingle: 'Point the camera at the portrait',
    lost: 'Find the portrait again', waking: name => `${name} is waking up…`,
    couldNotLoad: (name, why) => `Could not load ${name}: ${why}`,
    noHands: 'Hand tracking is not available on this device', showHand: 'Hold out your open hand',
    handLost: 'Show your open palm again, or point at the portrait to send her back',
  },
  es: {
    introTour: 'Apunta tu cámara a cualquiera de los ocho retratos impresos. Cada Awicha sale de su foto; extiende la mano abierta y vendrá hacia ti. Después sigue camino al siguiente retrato.',
    introSingle: 'Apunta tu cámara a este retrato impreso. Cuando aparezca, extiende la mano abierta y vendrá hacia ti.',
    start: 'Iniciar la cámara', replay: 'Escúchala otra vez', summon: 'Llámala a mi mano', back: 'Volver al retrato',
    retry: 'Reintentar', errorTitle: 'Algo salió mal', home: 'Volver a Las Awichas', preparing: 'Preparando…',
    startingCamera: 'Iniciando la cámara…', loadingHands: 'Cargando el seguimiento de manos…',
    cameraError: 'No se pudo iniciar la cámara. Permite el acceso a la cámara para este sitio e inténtalo de nuevo.',
    scanTour: 'Apunta la cámara a un retrato', scanSingle: 'Apunta la cámara al retrato',
    lost: 'Busca el retrato otra vez', waking: name => `${name} está despertando…`,
    couldNotLoad: (name, why) => `No se pudo cargar a ${name}: ${why}`,
    noHands: 'El seguimiento de manos no está disponible en este dispositivo', showHand: 'Extiende la mano abierta',
    handLost: 'Muestra la palma otra vez, o apunta al retrato para enviarla de vuelta',
  },
}

// Timing, in seconds
const EMERGE = 1.0                                  // the animal grows out of the print
const TRAVEL_SECONDS = {fly: 1.4, walk: 2.4, crawl: 3.0}
const HAND_LOST = 0.8                               // before asking for the palm again
const AFTER_VOICE = 0.8                             // pause after her voice before she comes by herself
const DISMISS = 0.5                                 // an animal on the hand shrinks away when another print is scanned

// MindAR's camera works in "target image pixel" units (a print is ~1000 units away, near plane 10).
// Palm poses are computed in metres and scaled by this factor; on-screen size is unchanged
// because position and size scale together.
const HAND_UNITS = 1000

// ---------------------------------------------------------------- DOM
const $ = id => document.getElementById(id)
const el = {
  container: $('ar'), intro: $('intro'), introTitle: $('intro-title'), introCard: $('intro-card'), introText: $('intro-text'), start: $('start'),
  hint: $('hint'), summon: $('summon'), back: $('back-to-portrait'), replay: $('replay'),
  loading: $('loading'), loadingText: $('loading-text'), error: $('error'), errorTitle: $('error-title'),
  errorText: $('error-text'), retry: $('retry'), home: document.querySelector('a.home'), language: $('language'),
}
document.body.classList.toggle('tour', TOUR)   // the tour has its own look: the whole picture in a green border
if (DIRECT) el.intro.hidden = true   // straight to the camera: the welcome screen is not shown at all
else el.introCard.src = TOUR ? 'cards/all.jpg' : single.card   // and its picture is not fetched either

// Everything written on screen, in the chosen language. The switch is only offered before the camera starts.
function applyUiLanguage() {
  document.documentElement.lang = lang
  document.title = TOUR ? 'Las Awichas' : `${titleOf(single)} · Las Awichas`
  el.introTitle.textContent = TOUR ? 'Las Awichas' : titleOf(single)
  el.introTitle.hidden = TOUR                                   // in the tour the green bar already says it
  for (const p of document.querySelectorAll('.lede[lang]')) p.hidden = !TOUR || p.lang !== lang
  el.introText.textContent = TOUR ? T().introTour : T().introSingle
  el.start.textContent = T().start
  el.replay.textContent = T().replay
  el.summon.textContent = T().summon
  el.back.textContent = T().back
  el.retry.textContent = T().retry
  el.errorTitle.textContent = T().errorTitle
  el.home.setAttribute('aria-label', T().home)
  if (state === 'intro') el.loadingText.textContent = T().preparing
  if (state === 'scanning' || state === 'returning') scanHint()
  else if (state === 'targetLost') hint(T().lost)
}

let debug = null
let state = 'intro'
function setState(next) {
  state = next
  document.body.dataset.state = next
  if (debug) debug.setInfo(`state: ${next}\nhands: ${hands.delegate || 'loading'}`)
}
const hint = text => { el.hint.textContent = text || ''; el.hint.hidden = !text }
const showLoading = text => { el.loadingText.textContent = text; el.loading.hidden = false }
const hideLoading = () => { el.loading.hidden = true }
const showError = text => { el.errorText.textContent = text; el.error.hidden = false }
const scanHint = () => hint(TOUR ? T().scanTour : T().scanSingle)

// ---------------------------------------------------------------- AR scene
// MindAR resizes on every window resize, and its own resize() reads this.controller, which start() only
// creates once the camera is up. A resize that arrives before then throws and leaves the picture the wrong
// size (opening straight into the camera, or turning the phone while it starts). Its listener is bound in
// the constructor, so the guard goes on the prototype, before the instance is made.
const mindarResize = MindARThree.prototype.resize
MindARThree.prototype.resize = function () { if (this.controller) mindarResize.call(this) }

const mindar = new MindARThree({
  container: el.container,
  imageTargetSrc: TOUR ? ALL_TARGETS : single.target,
  maxTrack: 1,
  uiLoading: 'no', uiScanning: 'no', uiError: 'no',
  filterMinCF: 0.001, filterBeta: 10,   // One-Euro filter on the portrait pose: steadier, still responsive
})
const {renderer, scene, camera} = mindar
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = parseFloat(params.get('exposure')) || 1.1
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
// The animals are chrome (metalness 1): what they reflect is what makes them bright.
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(makeStudioEnvironment(), 0.03).texture
const ENV_INTENSITY = parseFloat(params.get('env')) || 1.1
scene.add(new THREE.HemisphereLight(0xffffff, 0x404040, 1.0))
const keyLight = new THREE.DirectionalLight(0xffffff, 2.5)
keyLight.position.set(0.5, 1, 1)
scene.add(keyLight)
const rimLight = new THREE.DirectionalLight(0xffffff, 1.2)
rimLight.position.set(-1, 0.5, -0.5)
scene.add(rimLight)

const soundtrack = new Sound(SOUNDTRACK, {loop: true})   // its quiet level is baked into the file (iOS ignores volume)
const hands = new HandTracker()
let handsUnavailable = false

// One "slot" per portrait: its anchor, model (loaded on demand), voice and placement maths.
const slots = animals.map((cfg, i) => ({
  i, cfg,
  anchor: mindar.addAnchor(i),
  rig: null, rigPromise: null,
  // One <audio> per Awicha: changing language swaps its file, so two languages can never play at the same time.
  voice: new Sound(voiceSrc(cfg, lang)), voiceDone: false,
  targetQuat: new THREE.Quaternion(), handOffsetQuat: new THREE.Quaternion(),
  forwardInv: forwardBasisInverse(cfg.forward),
}))
// One voice at a time, and the soundtrack steps aside while she speaks (see src/audio.js).
const mixer = new Mixer(soundtrack, slots.map(s => s.voice))
let cur = null            // the active slot
let detached = false      // the active animal has left its print (lives in camera space)

for (const slot of slots) {
  slot.anchor.onTargetFound = () => onFound(slot)
  slot.anchor.onTargetLost = () => onLost(slot)
  slot.voice.onEnded(() => onVoiceEnded(slot))
}

function ensureRig(slot) {
  if (!slot.rigPromise) {
    slot.rigPromise = loadAnimalModel(slot.cfg.model, {hide: slot.cfg.hide}).then((rig) => {
      const tint = new Set()
      rig.model.traverse((o) => {
        if (!o.isMesh) return
        for (const m of [].concat(o.material)) {
          m.envMapIntensity = ENV_INTENSITY
          m.needsUpdate = true
          if (slot.cfg.colourCycle && m.color) tint.add(m)   // she changes colour: see updateColour()
        }
      })
      slot.tint = [...tint]
      rig.pivot.visible = false
      slot.anchor.group.add(rig.pivot)
      slot.rig = rig
      applyTargetTransform(slot)
      if (DEBUG) console.log(`${slot.cfg.id}: clips = ${rig.clips.join(', ')}; bbox = ${rig.size.toArray().map(n => n.toFixed(2))}`)
      return rig
    })
  }
  return slot.rigPromise
}

// ---------------------------------------------------------------- placement from config
const deg = THREE.MathUtils.degToRad
const _euler = new THREE.Euler()
const _spin = new THREE.Quaternion()
const _zAxis = new THREE.Vector3(0, 0, 1)
function refreshConfig(slot) {
  const t = slot.cfg.onTarget.rotation
  const h = slot.cfg.onHand.rotation
  slot.targetQuat.setFromEuler(_euler.set(deg(t[0]), deg(t[1]), deg(t[2])))
  slot.targetQuat.premultiply(_spin.setFromAxisAngle(_zAxis, deg(slot.cfg.onTarget.spin || 0)))   // turn on the print
  slot.handOffsetQuat.setFromEuler(_euler.set(deg(h[0]), deg(h[1]), deg(h[2])))
}
const targetScale = slot => slot.cfg.onTarget.size / slot.rig.longest                  // portrait width = 1 unit
const handScale = slot => (slot.cfg.onHand.size * HAND_UNITS) / slot.rig.longest      // metres -> scene units
function applyTargetTransform(slot) {
  if (!slot.rig) return
  refreshConfig(slot)
  const p = slot.cfg.onTarget.position
  slot.rig.pivot.position.set(p[0], p[1], p[2])
  slot.rig.pivot.quaternion.copy(slot.targetQuat)
  slot.rig.pivot.scale.setScalar(targetScale(slot))
}

// Rotation that makes a model's own head direction (cfg.forward) point along `dir` with its +Y along `up`.
function forwardBasisInverse(forward = [0, 0, 1]) {
  const f = new THREE.Vector3(...forward).normalize()
  const u = new THREE.Vector3(0, 1, 0)
  const r = new THREE.Vector3().crossVectors(u, f).normalize()
  return new THREE.Matrix4().makeBasis(r, u, f).transpose()
}
const _W = new THREE.Matrix4(), _R = new THREE.Vector3(), _U = new THREE.Vector3(), _F = new THREE.Vector3()
function faceQuaternion(slot, dir, up, out) {
  _F.copy(dir)
  _U.copy(up).addScaledVector(_F, -up.dot(_F))
  if (_U.lengthSq() < 1e-6) _U.set(0, 1, 0).addScaledVector(_F, -_F.y)
  _U.normalize()
  _R.crossVectors(_U, _F).normalize()
  _W.makeBasis(_R, _U, _F).multiply(slot.forwardInv)
  return out.setFromRotationMatrix(_W)
}

if (DEBUG) {
  window.__awichas = {
    mindar, hands, THREE, slots, fakeHand: FAKE_HAND,
    get animal() { return cur && cur.cfg }, get rig() { return cur && cur.rig }, get anchor() { return cur && cur.anchor },
    get state() { return state }, apply: () => cur && applyTargetTransform(cur),
  }
}
function remountDebug(slot) {
  if (!DEBUG) return
  if (debug) debug.destroy()
  debug = mountDebugPanel(slot.cfg, () => {
    if (state === 'onTarget' || state === 'targetLost' || state === 'scanning') applyTargetTransform(slot)
    else refreshConfig(slot)
  })
  setState(state)
}

// ---------------------------------------------------------------- start
// The back arrow returns to the welcome screen, so it drops ?camera: with it, it would open the camera again.
const homeParams = new URLSearchParams(location.search)
homeParams.delete('camera')
el.home.href = location.pathname + (homeParams.toString() ? `?${homeParams}` : '')
el.start.addEventListener('click', () => start())
el.retry.addEventListener('click', () => location.reload())
el.summon.addEventListener('click', summon)
el.back.addEventListener('click', backToPortrait)
el.replay.addEventListener('click', () => cur && cur.voice.restart())
mountLanguageSwitch(el.language, lang, changeLanguage)
el.language.hidden = slots.every(s => Object.keys(voiceSources(s.cfg)).length < 2)   // only when a Spanish voice exists
applyUiLanguage()

if (DIRECT) start({gesture: false})   // ?camera=1 : no welcome screen, the camera opens by itself

function voiceSrc(cfg, id) {
  return voiceSources(cfg)[voiceLanguage(cfg, id)]
}

// Switching language while she speaks starts her again, from the beginning, in the new language.
function changeLanguage(next) {
  lang = next
  setLanguage(next)
  applyUiLanguage()
  for (const slot of slots) {
    const src = voiceSrc(slot.cfg, next)
    if (src === slot.voice.src) continue    // she has no recording in that language
    const speaking = slot.voice.wanted
    slot.voice.setSrc(src)                  // stops the other language
    if (speaking) slot.voice.play()
  }
}

async function start({gesture = true} = {}) {
  mixer.start()   // inside the tap: starts the soundtrack and unlocks the voices on iOS/Android
  if (!gesture) armAudioOnFirstTouch()   // opened with no tap: the first touch has to do the unlocking
  el.language.hidden = true   // the language is chosen before the camera starts, not during the experience
  el.intro.hidden = true
  showLoading(T().startingCamera)
  setState('loading')
  hands.init().catch((err) => {
    handsUnavailable = true
    console.warn('hand tracking unavailable:', err)
  })
  try {
    await mindar.start()   // only the camera is waited for; her model loads behind the live picture
  } catch (err) {
    hideLoading()
    showError((err && err.message) || T().cameraError)
    return
  }
  hideLoading()
  if (!TOUR) {
    cur = slots[0]
    remountDebug(cur)
    // Not awaited: if the portrait is found first, switchTo() waits on this same promise and says she is waking up.
    ensureRig(cur).catch(err => console.warn(`could not load ${cur.cfg.id}:`, err))
  }
  enterScanning()
  renderer.setAnimationLoop(loop)
  if (TOUR) preloadAll()
}

// Sound needs a gesture on iOS/Android. Opened straight from the link there was none, so the first touch
// anywhere starts the soundtrack and unlocks the voices, and only if they were really blocked.
function armAudioOnFirstTouch() {
  const events = ['pointerdown', 'touchend', 'click']
  const arm = () => {
    for (const type of events) document.removeEventListener(type, arm)
    if (mixer.music.wanted && !mixer.music.el.paused) return   // never blocked: leave the mix alone
    mixer.start()
    // An Awicha who was already out and refused her voice says it again, from the beginning, rather than
    // standing there silent. (mixer.start() unlocked her element first, so this one plays.)
    if (cur && cur.voice.blocked) cur.voice.restart()
  }
  for (const type of events) document.addEventListener(type, arm)
}

async function preloadAll() {   // in the background, so the first portrait is quick to answer
  for (const slot of slots) {
    try { await ensureRig(slot) } catch (err) { console.warn(`could not load ${slot.cfg.id}:`, err) }
  }
}

// ---------------------------------------------------------------- portrait phase
let emerge = null
let pendingSummon = false
let summonTimer = 0
let dismissing = null

function enterScanning() {
  setState('scanning')
  scanHint()
  el.summon.hidden = true
  el.back.hidden = true
  el.replay.hidden = true
}

function enterOnTarget() {
  const slot = cur
  setState('onTarget')
  hint('')
  detached = false
  slot.rig.pivot.visible = true
  slot.rig.play(slot.cfg.clip)
  applyTargetTransform(slot)
  emerge = {t: 0}
  el.summon.hidden = false
  el.replay.hidden = !slot.voiceDone
  if (!slot.voiceDone) slot.voice.playFromStart()   // already speaking: carry on. Interrupted earlier: from the top.
}

// Make `slot` the active animal (a new portrait was found, or the first one).
async function switchTo(slot) {
  clearTimeout(summonTimer)
  pendingSummon = false
  const prev = cur
  cur = slot
  if (prev && prev !== slot) {
    prev.voice.pause()
    if (prev.rig && !(dismissing && dismissing.slot === prev)) {
      prev.rig.pivot.visible = false
      prev.anchor.group.add(prev.rig.pivot)
      applyTargetTransform(prev)
    }
  }
  detached = false
  travel = null
  emerge = null
  el.back.hidden = true
  el.summon.hidden = true
  el.replay.hidden = true
  remountDebug(slot)
  if (!slot.rig) {
    setState('loadingModel')
    hint(T().waking(titleOf(slot.cfg)))
    try {
      await ensureRig(slot)
    } catch (err) {
      showError(T().couldNotLoad(titleOf(slot.cfg), err.message || err))
      return
    }
    if (cur !== slot) return             // the camera moved on meanwhile
    if (!slot.anchor.visible) { enterScanning(); return }
  }
  enterOnTarget()
}

function onFound(slot) {
  switch (state) {
    case 'scanning':
    case 'loadingModel':
      if (slot !== cur || state === 'scanning') switchTo(slot)
      break
    case 'targetLost':
      if (slot === cur) {
        setState('onTarget')
        hint('')
        el.summon.hidden = false
        if (pendingSummon) summon()
      } else {
        switchTo(slot)
      }
      break
    case 'summoning':
      if (!detached && slot !== cur) switchTo(slot)   // she never left her print: just change animal
      break
    case 'returning':
    case 'handLost':
      if (!detached) break
      if (slot === cur) { if (!travel) startReturn() }
      else dismissAndSwitch(slot)                     // tour: she goes away, the next one comes out
      break
  }
}

function onLost(slot) {
  if (slot !== cur) return
  if (state === 'onTarget') {
    setState('targetLost')
    hint(T().lost)
    el.summon.hidden = true
  }
}

function onVoiceEnded(slot) {
  slot.voiceDone = true
  if (slot !== cur) return
  el.replay.hidden = false
  summonTimer = setTimeout(() => {
    if (cur !== slot) return
    if (state === 'onTarget') summon()
    else if (state === 'targetLost') pendingSummon = true
  }, AFTER_VOICE * 1000)
}

// An animal that is on the hand shrinks away when the visitor has moved to another portrait.
function dismissAndSwitch(slot) {
  const prev = cur
  dismissing = {slot: prev, t: 0, fromScale: prev.rig.pivot.scale.x}
  detached = false
  travel = null
  switchTo(slot)
}

function updateDismiss(dt) {
  dismissing.t = Math.min(1, dismissing.t + dt / DISMISS)
  const pivot = dismissing.slot.rig.pivot
  pivot.scale.setScalar(dismissing.fromScale * (1 - easeInOut(dismissing.t)))
  if (dismissing.t >= 1) {
    pivot.visible = false
    dismissing.slot.anchor.group.add(pivot)
    applyTargetTransform(dismissing.slot)
    dismissing = null
  }
}

// ---------------------------------------------------------------- travelling (print <-> hand)
let travel = null
const _dir = new THREE.Vector3(), _upA = new THREE.Vector3(), _upB = new THREE.Vector3(), _face = new THREE.Quaternion()

function startTravel(slot, goalFn, onDone) {
  const pivot = slot.rig.pivot
  const mode = slot.cfg.travel || 'fly'
  travel = {
    slot, goalFn, onDone, mode, duration: TRAVEL_SECONDS[mode] || TRAVEL_SECONDS.fly, t: 0,
    from: pivot.position.clone(), fromQ: pivot.quaternion.clone(), fromScale: pivot.scale.x,
    goal: {position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), scale: 1, ready: false},
  }
  slot.rig.play(slot.cfg.travelClip || slot.cfg.clip)
}

function updateTravel(dt) {
  const {slot, goal} = travel
  const pivot = slot.rig.pivot
  if (travel.goalFn(goal)) goal.ready = true      // the goal moves with the hand / the print
  if (!goal.ready) return
  travel.t = Math.min(1, travel.t + dt / travel.duration)
  const k = easeInOut(travel.t)
  pivot.position.lerpVectors(travel.from, goal.position, k)
  if (travel.mode === 'fly') {
    pivot.position.y += Math.sin(k * Math.PI) * 0.2 * travel.from.distanceTo(goal.position)   // a little arc
    pivot.quaternion.slerpQuaternions(travel.fromQ, goal.quaternion, k)
  } else {
    // walk / crawl: turn toward the destination, go there facing it, then settle into the final pose
    _dir.subVectors(goal.position, travel.from)
    if (_dir.lengthSq() > 1e-6) {
      _dir.normalize()
      _upA.set(0, 1, 0).applyQuaternion(travel.fromQ)
      _upB.set(0, 1, 0).applyQuaternion(goal.quaternion)
      _upA.lerp(_upB, k).normalize()
      faceQuaternion(slot, _dir, _upA, _face)
      if (k < 0.15) pivot.quaternion.slerpQuaternions(travel.fromQ, _face, k / 0.15)
      else if (k < 0.7) pivot.quaternion.copy(_face)
      else pivot.quaternion.slerpQuaternions(_face, goal.quaternion, (k - 0.7) / 0.3)
    } else {
      pivot.quaternion.slerpQuaternions(travel.fromQ, goal.quaternion, k)
    }
  }
  pivot.scale.setScalar(THREE.MathUtils.lerp(travel.fromScale, goal.scale, k))
  if (travel.t >= 1) {
    const done = travel.onDone
    travel = null
    done()
  }
}

// ---------------------------------------------------------------- hand phase
const smoother = new PoseSmoother()
const palm = {position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), depth: 0.45}
const view = {layout: null, containerW: 1, containerH: 1, fovDeg: 50, aspect: 1}
const handPose = {position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), scale: 1}
let lastHandSeen = 0

async function summon() {
  if (state !== 'onTarget' && state !== 'targetLost') return
  const slot = cur
  clearTimeout(summonTimer)
  pendingSummon = false
  emerge = null
  el.summon.hidden = true
  el.replay.hidden = true
  el.back.hidden = false
  smoother.reset()
  travel = null
  detached = false
  setState('summoning')
  if (!handsUnavailable && !hands.landmarker) {
    showLoading(T().loadingHands)
    try {
      await hands.init()
    } catch (err) {
      handsUnavailable = true
    }
    hideLoading()
    if (state !== 'summoning' || cur !== slot) return
  }
  hint(handsUnavailable ? T().noHands : T().showHand)
}

// Where she should be on the palm (camera space, scene units). False until a hand has been seen.
const _up = new THREE.Vector3()
const _toFingers = new THREE.Vector3()
function handGoal(goal) {
  if (!smoother.primed) return false
  const slot = cur
  const s = handScale(slot)
  _up.set(0, 1, 0).applyQuaternion(smoother.quaternion)
  goal.position.copy(smoother.position).multiplyScalar(HAND_UNITS).addScaledVector(_up, slot.rig.size.y * s * 0.5)
  // onHand.toFingers slides her up the palm towards the fingertips (the palm's -Z), as a fraction of
  // her own length, so it means the same thing whatever size she is rendered at.
  const reach = slot.cfg.onHand.toFingers || 0
  if (reach) {
    _toFingers.set(0, 0, -1).applyQuaternion(smoother.quaternion)
    goal.position.addScaledVector(_toFingers, reach * slot.rig.longest * s)
  }   // on the palm, not in it
  goal.quaternion.copy(smoother.quaternion).multiply(slot.handOffsetQuat)
  goal.scale = s
  return true
}

// Where she should be on her print (camera space). False while the print is not tracked.
const _goalM = new THREE.Matrix4(), _localM = new THREE.Matrix4(), _gp = new THREE.Vector3(), _gs = new THREE.Vector3()
function portraitGoal(goal) {
  const slot = cur
  if (!slot.anchor.visible) return false
  slot.anchor.group.updateMatrixWorld(true)
  refreshConfig(slot)
  const p = slot.cfg.onTarget.position
  _localM.compose(_gp.set(p[0], p[1], p[2]), slot.targetQuat, _gs.setScalar(targetScale(slot)))
  _goalM.multiplyMatrices(slot.anchor.group.matrixWorld, _localM).decompose(goal.position, goal.quaternion, _gs)
  goal.scale = _gs.x
  return true
}

// First sighting of the hand: freeze image tracking and let the animal live in camera space.
function detachFromPortrait() {
  const slot = cur
  mindar.controller.stopProcessVideo()
  detached = true
  if (slot.anchor.visible) {
    slot.anchor.group.updateMatrixWorld(true)
    scene.attach(slot.rig.pivot)            // keeps the world pose it had on the print
    startTravel(slot, handGoal, () => {
      slot.rig.play(slot.cfg.handClip || slot.cfg.clip)
      setState('onHand')
      hint('')
    })
  } else {
    scene.add(slot.rig.pivot)               // the print is out of view: appear on the hand directly
    slot.rig.pivot.visible = true
    slot.rig.play(slot.cfg.handClip || slot.cfg.clip)
    setState('onHand')
    hint('')
  }
}

// Resume image tracking so prints can be found again (MindAR must re-fire onTargetFound).
function resumeImageTracking() {
  for (const s of slots) {
    s.anchor.visible = false
    s.anchor.group.visible = false
  }
  mindar.controller.processVideo(mindar.video)
}

function startReturn() {
  const slot = cur
  hint('')
  startTravel(slot, portraitGoal, () => {
    detached = false
    slot.anchor.group.add(slot.rig.pivot)   // back under the print's anchor, exact configured pose
    applyTargetTransform(slot)
    slot.rig.pivot.visible = true
    slot.rig.play(slot.cfg.clip)
    if (slot.anchor.visible) {
      setState('onTarget')
      hint('')
      el.summon.hidden = false
    } else {
      setState('targetLost')
      hint(T().lost)
    }
    if (slot.voiceDone) el.replay.hidden = false
  })
}

// "Back to the portrait": she stays on the hand until the print is seen, then travels back.
function backToPortrait() {
  const slot = cur
  clearTimeout(summonTimer)
  pendingSummon = false
  el.back.hidden = true
  if (!detached) {                          // no hand was ever seen: she is still on the print
    travel = null
    if (slot.anchor.visible) {
      setState('onTarget')
      hint('')
      el.summon.hidden = false
    } else {
      setState('targetLost')
      hint(T().lost)
    }
    if (slot.voiceDone) el.replay.hidden = false
    return
  }
  if (travel) return                        // already travelling
  setState('returning')
  scanHint()
  resumeImageTracking()
}

function updateView() {
  const v = mindar.video
  view.containerW = el.container.clientWidth
  view.containerH = el.container.clientHeight
  view.layout = coverLayout(v.videoWidth, v.videoHeight, view.containerW, view.containerH)
  view.fovDeg = camera.fov
  view.aspect = camera.aspect
}

let debugFrames = 0
function updateHandPhase(dt) {
  const slot = cur
  if (!slot || !slot.rig) return
  const now = performance.now()
  const result = FAKE_HAND && window.__awichas.fakeHand ? syntheticHand(now) : hands.detect(mindar.video, now)
  if (DEBUG && (debugFrames++ % 15 === 0)) {
    debug.setInfo(`state: ${state}\nhands: ${hands.delegate || (handsUnavailable ? 'unavailable' : 'loading')}\nhand: ${result ? `seen, ${palm.depth.toFixed(2)} m` : 'none'}`)
  }
  if (result) {
    updateView()
    palmPose(result, view, palm)
    smoother.update(palm, dt)
    lastHandSeen = now
    if (!detached) detachFromPortrait()
    if (state === 'handLost') {
      setState('onHand')
      hint('')
      mindar.controller.stopProcessVideo()   // hand is back: image tracking off again
    }
  } else if (state === 'onHand' && now - lastHandSeen > HAND_LOST * 1000) {
    setState('handLost')                     // she waits; showing a print brings her back / the next one out
    hint(T().handLost)
    resumeImageTracking()
  }
  if (!detached || travel) return            // while travelling, updateTravel drives the pivot
  if (!handGoal(handPose)) return
  slot.rig.pivot.position.copy(handPose.position)
  slot.rig.pivot.quaternion.copy(handPose.quaternion)
  slot.rig.pivot.scale.setScalar(handPose.scale)
}

// ---------------------------------------------------------------- frame loop
const clock = new THREE.Clock()
// An animal with a colourCycle drifts round the colour wheel while she is out: the gecko changes colour
// as a gecko does. Her own base-colour texture is still there underneath; this tints it.
function updateColour(slot, dt) {
  const c = slot && slot.cfg.colourCycle
  if (!c || !slot.tint || !slot.tint.length) return
  slot.hue = ((slot.hue || 0) + dt / c.seconds) % 1
  for (const m of slot.tint) m.color.setHSL(slot.hue, c.saturation, c.lightness)
}

// An animal with onTarget.wander walks a small circle on her own print rather than on the spot, turned
// to face the way she is going. The recorded clip moves her legs but never her origin, so without this
// she moonwalks. Radius is in print widths; the print is 1 unit across.
function updateWander(slot, dt) {
  const w = slot && slot.cfg.onTarget.wander
  if (!w || !slot.rig || detached || travel || emerge) return
  if (state !== 'onTarget' && state !== 'targetLost') return
  slot.wander = ((slot.wander || 0) + dt / w.seconds) % 1
  const a = slot.wander * Math.PI * 2
  const t = slot.cfg.onTarget.rotation
  const p = slot.cfg.onTarget.position
  slot.rig.pivot.position.set(p[0] + Math.cos(a) * w.radius, p[1] + Math.sin(a) * w.radius, p[2])
  slot.rig.pivot.quaternion.setFromEuler(_euler.set(deg(t[0]), deg(t[1]), deg(t[2])))
  // the way she is going is a quarter turn round the circle from where she is standing
  slot.rig.pivot.quaternion.premultiply(
    _spin.setFromAxisAngle(_zAxis, deg(slot.cfg.onTarget.spin || 0) + a + Math.PI / 2))
}

function loop() {
  const dt = Math.min(clock.getDelta(), 0.1)
  updateWander(cur, dt)
  for (const s of slots) if (s.rig && s.rig.pivot.visible) s.rig.mixer.update(dt)
  updateColour(cur, dt)
  if (emerge && cur && cur.rig) {
    emerge.t = Math.min(1, emerge.t + dt / EMERGE)
    const k = easeInOut(emerge.t)
    cur.rig.pivot.scale.setScalar(targetScale(cur) * (0.15 + 0.85 * k))
    cur.rig.pivot.position.z = cur.cfg.onTarget.position[2] - 0.12 * (1 - k)
    if (emerge.t >= 1) emerge = null
  }
  if (state === 'summoning' || state === 'onHand' || state === 'handLost' || state === 'returning') updateHandPhase(dt)
  if (travel) updateTravel(dt)
  if (dismissing) updateDismiss(dt)
  renderer.render(scene, camera)
}

