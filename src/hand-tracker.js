// Thin wrapper around MediaPipe's HandLandmarker (Apache-2.0), self-hosted from public/mediapipe.
import {FilesetResolver, HandLandmarker} from '@mediapipe/tasks-vision'
import {HAND_MODEL, HAND_WASM} from './animals.js'

export class HandTracker {
  constructor() {
    this.landmarker = null
    this.ready = null
    this.delegate = null
    this.lastTime = -1
    this.lastResult = null
  }

  /** Loads the WASM runtime + model once. GPU first, CPU as a fallback. Safe to call repeatedly. */
  init() {
    if (!this.ready) {
      this.ready = this._create('GPU').catch((err) => {
        console.warn('GPU hand landmarker failed, falling back to CPU', err)
        return this._create('CPU')
      })
    }
    return this.ready
  }

  async _create(delegate) {
    const vision = await FilesetResolver.forVisionTasks(HAND_WASM)
    this.landmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {modelAssetPath: HAND_MODEL, delegate},
      runningMode: 'VIDEO',
      numHands: 1,
      minHandDetectionConfidence: 0.6,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    })
    this.delegate = delegate
    return this.landmarker
  }

  /**
   * Runs the landmarker on the current video frame (once per new frame; repeated calls in the same
   * frame return the cached result). Returns {landmarks, worldLandmarks} for the first hand, or null.
   * `nowMs` must increase monotonically (performance.now()).
   */
  detect(video, nowMs) {
    if (!this.landmarker || !video || video.readyState < 2) return null
    if (video.currentTime === this.lastTime) return this.lastResult
    this.lastTime = video.currentTime
    let res
    try {
      res = this.landmarker.detectForVideo(video, nowMs)
    } catch (err) {
      // A broken GPU delegate shows up here on some phones: switch to CPU once, keep going.
      console.warn(`hand landmarker (${this.delegate}) failed:`, err)
      const wasGpu = this.delegate === 'GPU'
      this.dispose()
      if (wasGpu) this.ready = this._create('CPU').catch(e => console.warn('CPU hand landmarker failed too', e))
      this.lastResult = null
      return null
    }
    this.lastResult = res.landmarks && res.landmarks.length
      ? {landmarks: res.landmarks[0], worldLandmarks: res.worldLandmarks[0]}
      : null
    return this.lastResult
  }

  dispose() {
    if (this.landmarker) this.landmarker.close()
    this.landmarker = null
    this.ready = null
  }
}

/**
 * A made-up open right hand for testing without a camera: palm just below the centre of the
 * frame, about 8 cm across, drifting slowly. Same shape as a real HandLandmarker result.
 */
export function syntheticHand(timeMs) {
  const t = timeMs / 1000
  const cx = 0.5 + 0.08 * Math.sin(t * 0.7)
  const cy = 0.58 + 0.05 * Math.sin(t * 0.9)
  const spread = 0.11 + 0.02 * Math.sin(t * 0.5)   // apparent size on screen -> depth changes too
  const world = Array.from({length: 21}, () => ({x: 0, y: 0, z: 0}))
  world[0] = {x: 0, y: 0.05, z: 0}
  world[9] = {x: 0, y: -0.03, z: 0}
  world[5] = {x: 0.03, y: -0.02, z: 0}
  world[13] = {x: -0.015, y: -0.025, z: 0}
  world[17] = {x: -0.03, y: -0.02, z: 0}
  const landmarks = world.map(w => ({x: cx + w.x * spread / 0.06, y: cy + w.y * spread / 0.06, z: 0}))
  return {landmarks, worldLandmarks: world}
}
