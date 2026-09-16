// Audio for the experience: a small wrapper around <audio> that copes with mobile autoplay rules,
// and a Mixer that keeps the sounds from overlapping.

// iOS ignores HTMLMediaElement.volume (always 1), so fades are only possible elsewhere.
function volumeIsSettable() {
  try {
    const probe = new Audio()
    probe.volume = 0.5
    return Math.abs(probe.volume - 0.5) < 0.01
  } catch {
    return false
  }
}

export class Sound {
  constructor(src, {loop = false, volume = 1} = {}) {
    const el = new Audio()
    el.src = src
    el.loop = loop
    el.volume = volume
    el.preload = 'auto'
    el.setAttribute('playsinline', '')
    this.el = el
    this.src = src
    this.volume = volume     // the level asked for (the Mixer fades relative to it)
    this.wanted = false      // true from play() until pause() or the end of the file
    this.unlocking = false   // the silent play() of unlock() has not settled yet
    this.blocked = false     // the phone refused the last play(): it can be started again from a tap
    this.onChange = null     // called when `wanted` changes (used by the Mixer)
    el.addEventListener('ended', () => { if (!el.loop) this.setWanted(false) })
    // Browsers can start an element by themselves: iOS resumes media after the camera, a call or a notification
    // interrupts audio. A sound nobody asked for is paused at once, so recordings can never play over each other.
    const guard = () => { if (!this.wanted && !this.unlocking) el.pause() }
    el.addEventListener('play', guard)
    el.addEventListener('playing', guard)
  }

  /** Swap the recording (e.g. another language). Stops it; the next play() starts the new file from the top. */
  setSrc(src) {
    if (src === this.src) return
    this.pause()
    this.src = src
    this.el.src = src
    this.el.load()
  }

  setWanted(value) {
    if (this.wanted === value) return
    this.wanted = value
    if (this.onChange) this.onChange(this)
  }

  /** Call inside a user gesture (tap) so the element may be played later without another tap. */
  unlock() {
    const el = this.el
    if (this.wanted || !el.paused) return
    this.unlocking = true
    el.muted = true
    const settle = () => { this.unlocking = false; el.muted = false }
    const p = el.play()
    if (p && p.then) {
      p.then(() => {
        // A real play() may have arrived while the silent one was starting: keep playing, from the top.
        if (!this.wanted) el.pause()
        el.currentTime = 0
        settle()
      }).catch(() => {
        settle()
        if (this.wanted) this.play()
        else el.pause()
      })
    } else {
      settle()
    }
  }

  play() {
    this.setWanted(true)
    this.blocked = false
    if (this.unlocking) return   // the pending unlock keeps it playing and unmutes it
    const p = this.el.play()
    if (p && p.catch) {
      p.catch((err) => {
        if (err && err.name === 'AbortError') return   // interrupted by pause(): expected
        console.warn('audio play blocked:', err && err.message)
        this.blocked = true
        this.setWanted(false)
      })
    }
  }

  pause() {
    this.setWanted(false)
    this.el.pause()
  }

  restart() {
    this.el.currentTime = 0
    this.play()
  }

  /**
   * Tell her story: from the beginning, unless she is already telling it.
   * Plain play() would carry on from wherever she was interrupted, so walking to another portrait and
   * coming back would lose her opening words. `wanted` is still true for a voice the page paused when
   * it was hidden, and that one does resume where it stopped, which is what you want coming back to the app.
   */
  playFromStart() {
    if (this.wanted) this.play()
    else this.restart()
  }

  onEnded(fn) { this.el.addEventListener('ended', fn) }
}

// Keeps the audio from overlapping:
//   - only one voice is heard at a time: starting a voice pauses any other voice
//   - the soundtrack keeps playing underneath, dipping a little while a voice speaks and coming back up after
//     (on iOS, where volume cannot be changed, it stays at its own level: that level is baked into the file)
//   - leaving the page pauses everything; coming back resumes what was playing
export class Mixer {
  constructor(music, voices, {fadeOut = 0.4, fadeIn = 1.5, musicBackAfter = 0.8, duck = 0.55, doc = document, canFade = volumeIsSettable()} = {}) {
    this.music = music
    this.voices = voices
    this.opts = {fadeOut, fadeIn, musicBackAfter, duck}
    this.doc = doc
    this.canFade = canFade
    this.started = false
    this.level = 1            // soundtrack level, 0..1, relative to music.volume
    this.target = 1
    this.fadeTimer = null
    this.backTimer = null
    this.heldVoice = null     // the voice that was speaking when the page was hidden
    for (const v of voices) v.onChange = () => this.voiceChanged(v)
    doc.addEventListener('visibilitychange', () => this.visibilityChanged())
  }

  /** Inside the Start tap: starts the soundtrack and unlocks every voice for later. */
  start() {
    this.started = true
    this.setLevel(1)
    this.music.play()
    for (const v of this.voices) v.unlock()
  }

  get speaking() { return this.voices.find(v => v.wanted) || null }

  voiceChanged(voice) {
    if (voice.wanted) {
      for (const other of this.voices) {
        if (other === voice) continue
        if (other.unlocking) {
          // She is still inside her silent unlock. Skipping her here used to let two voices end up
          // audible: a voice asked to play during its own unlock keeps `wanted`, so when the unlock
          // settled it unmuted and carried on underneath the new one. Clearing `wanted` makes the
          // unlock stop her when it settles, instead of handing her the floor.
          other.setWanted(false)
          continue
        }
        if (other.wanted || !other.el.paused) other.pause()   // also one that started by itself
      }
    }
    this.update()
  }

  update() {
    clearTimeout(this.backTimer)
    this.backTimer = null
    if (!this.started) return
    if (this.doc.hidden) return this.stopMusic()
    if (this.speaking) return this.fadeTo(this.opts.duck)   // underneath her voice, not away
    // Wait a moment before the music comes back up, so switching from one voice to the next does not let it jump.
    this.backTimer = setTimeout(() => { this.backTimer = null; if (!this.speaking && !this.doc.hidden) this.fadeTo(1) }, this.opts.musicBackAfter * 1000)
  }

  visibilityChanged() {
    if (!this.started) return
    if (this.doc.hidden) {
      const voice = this.speaking
      if (voice) { this.heldVoice = voice; voice.el.pause() }   // keeps `wanted`, so the music stays down
      this.update()
    } else {
      const voice = this.heldVoice
      this.heldVoice = null
      if (voice && voice.wanted) voice.play()
      this.update()
    }
  }

  setLevel(level) {
    this.level = level
    if (this.canFade) this.music.el.volume = this.music.volume * level
  }

  stopMusic() {
    clearInterval(this.fadeTimer)
    this.fadeTimer = null
    this.target = 0
    this.setLevel(0)
    this.music.pause()
  }

  fadeTo(target) {
    this.target = target
    if (target > 0 && !this.music.wanted) {
      if (!this.canFade) this.setLevel(1)
      this.music.play()
    }
    if (!this.canFade) {                      // iOS: no volume control, so it simply keeps playing at its own level
      if (target === 0) this.stopMusic()
      return
    }
    if (this.fadeTimer) return
    let last = performance.now()
    this.fadeTimer = setInterval(() => {
      const now = performance.now()
      const dt = (now - last) / 1000
      last = now
      const up = this.target > this.level
      const step = dt / (up ? this.opts.fadeIn : this.opts.fadeOut)
      this.setLevel(up ? Math.min(this.target, this.level + step) : Math.max(this.target, this.level - step))
      if (this.level === this.target) {
        clearInterval(this.fadeTimer)
        this.fadeTimer = null
        if (this.target === 0) this.music.pause()
      }
    }, 40)
  }
}
