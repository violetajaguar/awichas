// Pure math: turns MediaPipe hand landmarks into a 3D "palm pose" expressed in the
// three.js camera space that MindAR uses (camera at the origin, looking down -Z).
// No DOM access, so it is unit-tested in Node (tests/hand-pose.test.mjs).
import {Matrix4, Quaternion, Vector3} from 'three'

export const LM = {WRIST: 0, INDEX_MCP: 5, MIDDLE_MCP: 9, RING_MCP: 13, PINKY_MCP: 17}
const PALM_IDS = [LM.WRIST, LM.INDEX_MCP, LM.MIDDLE_MCP, LM.RING_MCP, LM.PINKY_MCP]
// Segments across the palm whose real length barely changes when fingers move.
const DEPTH_PAIRS = [[0, 9], [5, 17], [0, 5], [0, 17], [5, 9], [9, 13], [13, 17]]

export const DEPTH_MIN = 0.12   // metres; closer than this and the hand fills the frame
export const DEPTH_MAX = 1.5

/** How a video is drawn "cover"-style inside a container (the same rule MindAR uses). */
export function coverLayout(videoW, videoH, containerW, containerH) {
  const videoRatio = videoW / videoH
  const containerRatio = containerW / containerH
  let w, h
  if (videoRatio > containerRatio) {
    h = containerH
    w = h * videoRatio
  } else {
    w = containerW
    h = w / videoRatio
  }
  return {w, h, left: (containerW - w) / 2, top: (containerH - h) / 2}
}

/** Vertical focal length in pixels of a perspective camera rendering into containerH pixels. */
export function focalLengthPx(fovDeg, containerH) {
  return (containerH / 2) / Math.tan((fovDeg * Math.PI) / 360)
}

/** A normalized video landmark (0..1) to NDC (-1..1) of the canvas that fills the container. */
export function landmarkToNdc(lm, layout, containerW, containerH) {
  const px = layout.left + lm.x * layout.w
  const py = layout.top + lm.y * layout.h
  return {x: (px / containerW) * 2 - 1, y: -((py / containerH) * 2 - 1)}
}

/** NDC point at a given distance in front of the camera to a camera-space point. */
export function unprojectNdc(ndc, depth, fovDeg, aspect, out = new Vector3()) {
  const t = Math.tan((fovDeg * Math.PI) / 360)
  return out.set(ndc.x * t * aspect * depth, ndc.y * t * depth, -depth)
}

/**
 * Distance of the hand from the camera, in metres. MediaPipe's world landmarks give the
 * real size of the palm; comparing that with its size on screen gives the depth
 * (pinhole model: depth = focal * realLength / pixelLength). Only the x/y components of the
 * world segment are used because that is the length the camera actually sees.
 */
export function estimateDepth(landmarks, worldLandmarks, layout, focalPx) {
  let sum = 0
  let n = 0
  for (const [a, b] of DEPTH_PAIRS) {
    const pa = landmarks[a], pb = landmarks[b], wa = worldLandmarks[a], wb = worldLandmarks[b]
    const pix = Math.hypot((pa.x - pb.x) * layout.w, (pa.y - pb.y) * layout.h)
    const metres = Math.hypot(wa.x - wb.x, wa.y - wb.y)
    if (pix < 2 || metres < 0.01) continue
    sum += (focalPx * metres) / pix
    n++
  }
  if (!n) return null
  return Math.min(DEPTH_MAX, Math.max(DEPTH_MIN, sum / n))
}

/** Centre of the palm in normalized video coordinates. */
export function palmCenter2d(landmarks) {
  let x = 0, y = 0
  for (const i of PALM_IDS) {
    x += landmarks[i].x
    y += landmarks[i].y
  }
  return {x: x / PALM_IDS.length, y: y / PALM_IDS.length}
}

// MediaPipe frame (x right, y down, z away from camera) -> three camera frame (x right, y up, z toward viewer)
const toThree = (v, out) => out.set(v.x, -v.y, -v.z)

const _wrist = new Vector3(), _mid = new Vector3(), _idx = new Vector3(), _pnk = new Vector3()
const _fingers = new Vector3(), _side = new Vector3(), _up = new Vector3(), _right = new Vector3(), _back = new Vector3()

/**
 * Orientation of the palm as a rotation matrix whose local axes are:
 *   +Y  out of the palm, always on the side that faces the camera (so an object "stands" on
 *       whichever side of the hand is visible, left or right hand alike),
 *   -Z  toward the fingertips (so +Z points at the wrist, i.e. roughly toward the viewer),
 *   +X  completes a right-handed frame.
 */
export function palmBasis(worldLandmarks, out = new Matrix4()) {
  toThree(worldLandmarks[LM.WRIST], _wrist)
  toThree(worldLandmarks[LM.MIDDLE_MCP], _mid)
  toThree(worldLandmarks[LM.INDEX_MCP], _idx)
  toThree(worldLandmarks[LM.PINKY_MCP], _pnk)
  _fingers.subVectors(_mid, _wrist).normalize()
  _side.subVectors(_idx, _pnk).normalize()
  _up.crossVectors(_side, _fingers).normalize()
  if (_up.z < 0) _up.negate()               // stand on the side facing the camera
  _back.copy(_fingers).negate()
  _right.crossVectors(_up, _back).normalize()
  _back.crossVectors(_right, _up).normalize() // re-orthogonalise
  return out.makeBasis(_right, _up, _back)
}

const _basis = new Matrix4()

/**
 * Full palm pose (position + orientation in camera space, plus the estimated depth).
 * `view` describes the current camera: {layout, containerW, containerH, fovDeg, aspect}.
 * When the depth cannot be estimated the previous depth (out.depth) is kept.
 */
export function palmPose(result, view, out = {position: new Vector3(), quaternion: new Quaternion(), depth: 0.45}) {
  const {landmarks, worldLandmarks} = result
  const f = focalLengthPx(view.fovDeg, view.containerH)
  const depth = estimateDepth(landmarks, worldLandmarks, view.layout, f) ?? out.depth
  const ndc = landmarkToNdc(palmCenter2d(landmarks), view.layout, view.containerW, view.containerH)
  unprojectNdc(ndc, depth, view.fovDeg, view.aspect, out.position)
  out.quaternion.setFromRotationMatrix(palmBasis(worldLandmarks, _basis))
  out.depth = depth
  return out
}

/**
 * Frame-rate independent exponential smoothing for a pose. Higher rates follow faster;
 * lower rates are steadier. Depth is smoothed harder than screen position because it is
 * the noisiest estimate.
 */
export class PoseSmoother {
  constructor({positionRate = 16, rotationRate = 12} = {}) {
    this.positionRate = positionRate
    this.rotationRate = rotationRate
    this.position = new Vector3()
    this.quaternion = new Quaternion()
    this.primed = false
  }

  reset() {
    this.primed = false
  }

  /** Blend toward `target` given `dt` seconds since the previous frame. Returns this. */
  update(target, dt) {
    if (!this.primed) {
      this.position.copy(target.position)
      this.quaternion.copy(target.quaternion)
      this.primed = true
      return this
    }
    const kp = 1 - Math.exp(-dt * this.positionRate)
    const kr = 1 - Math.exp(-dt * this.rotationRate)
    this.position.lerp(target.position, kp)
    this.quaternion.slerp(target.quaternion, kr)
    return this
  }
}

/** Smooth-step easing for the fly-to-hand transition. */
export const easeInOut = t => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t))
