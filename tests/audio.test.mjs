import {test} from 'node:test'
import assert from 'node:assert/strict'

// A stand-in for HTMLAudioElement: enough behaviour for Sound and Mixer.
class FakeAudio {
  constructor() {
    Object.assign(this, {src: '', loop: false, volume: 1, preload: '', paused: true, muted: false, currentTime: 0, nextPlay: null})
    this.listeners = {}
  }
  setAttribute() {}
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn) }
  play() {
    this.paused = false
    const p = this.nextPlay || Promise.resolve()
    this.nextPlay = null
    this.emit('play')
    return p
  }
  pause() { this.paused = true }
  load() { this.paused = true; this.currentTime = 0 }
  emit(type) { for (const fn of this.listeners[type] || []) fn() }
  finish() { this.paused = true; for (const fn of this.listeners.ended || []) fn() }
}
globalThis.Audio = FakeAudio
const {Sound, Mixer} = await import('../src/audio.js')

const fakeDocument = () => ({hidden: false, fns: [], addEventListener(t, fn) { this.fns.push(fn) }, set(hidden) { this.hidden = hidden; this.fns.forEach(fn => fn()) }})
const wait = ms => new Promise(r => setTimeout(r, ms))
const FAST = {fadeOut: 0.05, fadeIn: 0.05, musicBackAfter: 0.05}
const audible = s => !s.el.paused && !s.el.muted

function setup({canFade = false} = {}) {
  const doc = fakeDocument()
  const music = new Sound('music', {loop: true, volume: 0.35})
  const a = new Sound('a'), b = new Sound('b')
  const mixer = new Mixer(music, [a, b], {...FAST, doc, canFade})
  return {doc, music, a, b, mixer}
}

test('only one voice is heard at a time', async () => {
  const {a, b, mixer} = setup()
  mixer.start()
  await wait(5)
  a.play()
  b.play()
  assert.equal(a.el.paused, true)
  assert.equal(b.el.paused, false)
  a.restart()
  assert.equal(b.el.paused, true)
  assert.equal(a.el.paused, false)
})

test('without volume control (iOS) the soundtrack keeps playing underneath her voice', async () => {
  const {music, a, mixer} = setup({canFade: false})
  mixer.start()
  await wait(5)
  assert.ok(audible(music))
  a.play()
  assert.equal(music.el.paused, false)
  await wait(120)
  assert.ok(audible(music), 'still playing while she speaks')
  a.el.finish()
  await wait(120)
  assert.ok(audible(music))
})

test('with volume control the soundtrack dips under her voice and comes back up after', async () => {
  const {music, a, mixer} = setup({canFade: true})
  mixer.start()
  await wait(5)
  assert.equal(music.el.volume, 0.35)
  a.play()
  await wait(150)
  assert.ok(Math.abs(music.el.volume - 0.35 * 0.55) < 1e-6, `dipped, not gone: ${music.el.volume}`)
  assert.equal(music.el.paused, false)
  a.pause()
  await wait(250)
  assert.equal(music.el.paused, false)
  assert.ok(Math.abs(music.el.volume - 0.35) < 1e-9)
})

test('switching straight from one voice to the next keeps the music down, without a jump', async () => {
  const {music, a, b, mixer} = setup({canFade: true})
  mixer.start()
  await wait(5)
  a.play()
  await wait(150)
  a.pause()
  await wait(10)
  b.play()
  await wait(120)
  assert.ok(Math.abs(music.el.volume - 0.35 * 0.55) < 1e-6, `still dipped: ${music.el.volume}`)
  assert.equal(music.el.paused, false)
})

test('leaving the page pauses her and the music; coming back resumes her, music underneath', async () => {
  const {doc, music, a, mixer} = setup()
  mixer.start()
  await wait(5)
  a.play()
  doc.set(true)
  assert.equal(a.el.paused, true)
  assert.equal(music.el.paused, true)
  doc.set(false)
  await wait(120)
  assert.equal(a.el.paused, false)
  assert.equal(music.el.paused, false, 'the music comes back underneath her')
})

test('leaving and coming back with nobody speaking brings the music back', async () => {
  const {doc, music, mixer} = setup()
  mixer.start()
  await wait(5)
  doc.set(true)
  assert.equal(music.el.paused, true)
  doc.set(false)
  await wait(120)
  assert.equal(music.el.paused, false)
})

test('a play() that arrives while the silent unlock is starting is not cancelled by it', async () => {
  const v = new Sound('v')
  let resolve
  v.el.nextPlay = new Promise(r => { resolve = r })
  v.unlock()
  assert.equal(v.el.muted, true)
  v.el.currentTime = 0.4
  v.play()
  resolve()
  await wait(5)
  assert.equal(v.el.paused, false)
  assert.equal(v.el.muted, false)
  assert.equal(v.el.currentTime, 0, 'she starts from the beginning')
})

test('a plain unlock leaves the voice silent, paused and rewound', async () => {
  const v = new Sound('v')
  v.unlock()
  await wait(5)
  assert.equal(v.el.paused, true)
  assert.equal(v.el.muted, false)
  assert.equal(v.wanted, false)
})

test('a blocked voice does not keep the music down', async () => {
  const {music, a, mixer} = setup()
  mixer.start()
  await wait(5)
  a.el.nextPlay = Promise.reject(Object.assign(new Error('blocked'), {name: 'NotAllowedError'}))
  const warn = console.warn
  console.warn = () => {}
  a.play()
  await wait(120)
  console.warn = warn
  assert.equal(a.wanted, false)
  assert.equal(music.el.paused, false)
})

test('a recording the browser restarts by itself (iOS after the camera starts) is paused straight away', async () => {
  const {music, a, b, mixer} = setup()
  mixer.start()
  await wait(5)
  a.play()
  b.el.play()                        // not through Sound: the browser resuming it
  assert.equal(b.el.paused, true)
  assert.equal(a.el.paused, false, 'the voice that was asked for keeps playing')
  music.pause()
  music.el.play()
  assert.equal(music.el.paused, true, 'the soundtrack too, while it should be quiet')
})

test('the silent unlock is not stopped by the guard', async () => {
  const v = new Sound('v')
  let resolve
  v.el.nextPlay = new Promise(r => { resolve = r })
  v.unlock()
  assert.equal(v.el.paused, false, 'still starting, muted')
  resolve()
  await wait(5)
  assert.equal(v.el.paused, true)
  assert.equal(v.el.muted, false)
})

test('switching the file of a speaking voice stops the old one and starts the new one from the top', async () => {
  const {music, a, mixer} = setup()
  mixer.start()
  await wait(5)
  a.play()
  a.el.currentTime = 12
  const speaking = a.wanted
  a.setSrc('a-es')
  assert.equal(a.el.src, 'a-es')
  assert.equal(a.el.paused, true)
  assert.equal(a.el.currentTime, 0)
  if (speaking) a.play()
  assert.equal(a.el.paused, false)
  await wait(120)
  assert.equal(music.el.paused, false, 'the soundtrack plays on underneath, without a jump')
  a.setSrc('a-es')
  assert.equal(a.el.paused, false, 'the same file again changes nothing')
})

test('starting a voice also stops another voice element that was playing without being asked', async () => {
  const {a, b, mixer} = setup()
  mixer.start()
  await wait(5)
  b.el.paused = false                // playing, but its guard never ran (e.g. no play event)
  a.play()
  assert.equal(b.el.paused, true)
})

// Walking to another portrait pauses the Awicha you were listening to. Coming back must begin her story
// again, not carry on from the middle of a sentence.
test('a voice interrupted by another portrait starts again from the beginning', async () => {
  const {a, b, mixer} = setup()
  mixer.start()
  await wait(5)
  a.playFromStart()
  a.el.currentTime = 4.2                      // she is part way through her story
  b.playFromStart()                           // another portrait is found: the Mixer pauses her
  assert.equal(a.el.paused, true, 'she stops when the next Awicha speaks')
  assert.equal(a.wanted, false)
  a.playFromStart()                           // back to her portrait
  assert.equal(a.el.currentTime, 0, 'her opening words are not skipped')
  assert.equal(a.el.paused, false)
})

test('playFromStart does not interrupt her while she is already speaking', async () => {
  const {a, mixer} = setup()
  mixer.start()
  await wait(5)
  a.playFromStart()
  a.el.currentTime = 4.2
  a.playFromStart()                           // her print was simply re-found while she talks
  assert.equal(a.el.currentTime, 4.2, 'she carries on rather than starting over')
  assert.equal(a.el.paused, false)
})

// The page being hidden keeps `wanted` true on purpose, so coming back to the app resumes her.
test('coming back to the app resumes her where she stopped, not from the top', async () => {
  const {a, doc, mixer} = setup()
  mixer.start()
  await wait(5)
  a.playFromStart()
  a.el.currentTime = 4.2
  doc.set(true)                               // page hidden: paused, but still wanted
  assert.equal(a.el.paused, true)
  doc.set(false)
  assert.equal(a.el.currentTime, 4.2, 'she picks up where she was')
  assert.equal(a.el.paused, false)
})

// Two voices could both end up audible: mixer.start() unlocks every voice with a silent play, and a
// voice asked to speak during her own unlock kept `wanted`, so when the unlock settled she unmuted and
// carried on underneath whoever started after her. That is the garble.
test('a voice asked to play during its own unlock does not keep speaking under the next one', async () => {
  const {a, b, mixer} = setup()
  let settleA
  a.el.nextPlay = new Promise(r => { settleA = r })   // her unlock hangs, as a slow decode would
  mixer.start()
  a.play()                                           // she is asked to speak while still unlocking
  b.play()                                           // the next portrait is found straight away
  settleA()                                          // now her unlock finally settles
  await wait(20)
  assert.equal(audible(b), true, 'the Awicha who was asked last is the one speaking')
  assert.equal(audible(a), false, 'the earlier one does not come back up underneath her')
  assert.equal(mixer.voices.filter(audible).length, 1, 'exactly one voice is audible')
})

// A property test rather than one scripted case: whatever order she is asked to speak, interrupted,
// unlocked and resumed in, only one Awicha may ever be audible. Overlapping voices are the one thing
// the Mixer exists to prevent, and the ways they can overlap are hard to enumerate by hand.
test('no sequence of plays, pauses and unlocks ever leaves two voices audible', async () => {
  let seed = 12345
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
  for (let run = 0; run < 200; run++) {
    const doc = fakeDocument()
    const music = new Sound('music', {loop: true, volume: 0.35})
    const voices = [new Sound('a'), new Sound('b'), new Sound('c')]
    const mixer = new Mixer(music, voices, {...FAST, doc, canFade: true})
    const pending = []
    for (let step = 0; step < 14; step++) {
      const v = voices[Math.floor(rnd() * voices.length)]
      const pick = rnd()
      if (pick < 0.25) {
        // an unlock whose silent play has not settled yet
        let settle
        v.el.nextPlay = new Promise(r => { settle = r })
        mixer.start()
        pending.push(settle)
      } else if (pick < 0.65) {
        v.playFromStart()
      } else if (pick < 0.8) {
        v.pause()
      } else if (pick < 0.9) {
        v.el.finish()                     // her recording reached its end
      } else {
        v.el.paused = false               // the phone resumed her by itself, as iOS does
        v.el.emit('playing')
      }
      const loud = voices.filter(audible)
      assert.ok(loud.length <= 1, `run ${run} step ${step}: ${loud.length} voices audible at once`)
    }
    while (pending.length) pending.pop()()
    await wait(0)
    const loud = voices.filter(audible)
    assert.ok(loud.length <= 1, `run ${run}: ${loud.length} audible after the unlocks settled`)
  }
})
