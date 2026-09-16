import {test} from 'node:test'
import assert from 'node:assert/strict'
import {Quaternion, Vector3} from 'three'
import {
  coverLayout, focalLengthPx, landmarkToNdc, unprojectNdc, estimateDepth,
  palmCenter2d, palmBasis, palmPose, PoseSmoother, easeInOut, DEPTH_MAX, DEPTH_MIN,
} from '../src/hand-pose.js'

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`)

// A synthetic hand: 21 landmarks, only the five palm points matter. `world` is metric,
// camera-aligned (x right, y down); `image` is where a pinhole camera at `depth` sees them.
function syntheticHand({depth, fovDeg, containerW, containerH, layout, mirror = false, centre = {x: 0.5, y: 0.5}}) {
  const f = focalLengthPx(fovDeg, containerH)
  const s = mirror ? -1 : 1
  const world = Array.from({length: 21}, () => ({x: 0, y: 0, z: 0}))
  world[0] = {x: 0, y: 0.05, z: 0}            // wrist, lower on screen
  world[9] = {x: 0, y: -0.03, z: 0}           // middle finger base
  world[5] = {x: 0.03 * s, y: -0.02, z: 0}    // index base
  world[17] = {x: -0.03 * s, y: -0.02, z: 0}  // pinky base
  world[13] = {x: -0.015 * s, y: -0.025, z: 0}
  const image = world.map(w => ({
    x: centre.x + (w.x * f / depth) / layout.w,
    y: centre.y + (w.y * f / depth) / layout.h,
    z: 0,
  }))
  return {landmarks: image, worldLandmarks: world}
}

test('coverLayout fills the container and centres the overflow', () => {
  const l = coverLayout(1280, 720, 390, 844)        // landscape video on a portrait phone
  near(l.h, 844)
  near(l.w, 844 * 1280 / 720)
  near(l.top, 0)
  near(l.left, (390 - l.w) / 2)
  const p = coverLayout(720, 1280, 390, 844)        // portrait video, still wider than a tall phone screen
  near(p.h, 844)
  near(p.w, 844 * 720 / 1280)
  near(p.top, 0)
  const q = coverLayout(720, 1280, 800, 600)        // portrait video on a landscape screen: width-bound
  near(q.w, 800)
  near(q.h, 800 * 1280 / 720)
  near(q.left, 0)
})

test('landmarkToNdc maps the visible centre to the origin and flips y', () => {
  const layout = coverLayout(1280, 720, 390, 844)
  const c = landmarkToNdc({x: 0.5, y: 0.5}, layout, 390, 844)
  near(c.x, 0); near(c.y, 0)
  const top = landmarkToNdc({x: 0.5, y: 0}, layout, 390, 844)
  near(top.y, 1)
})

test('unprojectNdc puts points at the requested depth on the view frustum', () => {
  const p = unprojectNdc({x: 0, y: 1}, 2, 60, 0.5)
  near(p.z, -2)
  near(p.y, Math.tan(Math.PI / 6) * 2)
  near(p.x, 0)
})

test('estimateDepth recovers the true distance of a synthetic hand', () => {
  const view = {fovDeg: 55, containerW: 390, containerH: 844}
  const layout = coverLayout(1280, 720, view.containerW, view.containerH)
  for (const depth of [0.25, 0.5, 0.9]) {
    const hand = syntheticHand({depth, layout, ...view})
    const d = estimateDepth(hand.landmarks, hand.worldLandmarks, layout, focalLengthPx(view.fovDeg, view.containerH))
    near(d, depth, 1e-6)
  }
})

test('estimateDepth clamps to a sane range and returns null with no usable segments', () => {
  const view = {fovDeg: 55, containerW: 390, containerH: 844}
  const layout = coverLayout(1280, 720, view.containerW, view.containerH)
  const far = syntheticHand({depth: 6, layout, ...view})
  near(estimateDepth(far.landmarks, far.worldLandmarks, layout, focalLengthPx(55, 844)), DEPTH_MAX)
  const close = syntheticHand({depth: 0.01, layout, ...view})
  near(estimateDepth(close.landmarks, close.worldLandmarks, layout, focalLengthPx(55, 844)), DEPTH_MIN)
  const flat = Array.from({length: 21}, () => ({x: 0.5, y: 0.5, z: 0}))
  assert.equal(estimateDepth(flat, flat, layout, 800), null)
})

test('palmBasis: +Y always faces the camera, -Z points to the fingertips, for both hands', () => {
  for (const mirror of [false, true]) {
    const hand = syntheticHand({depth: 0.5, fovDeg: 55, containerW: 390, containerH: 844, layout: coverLayout(1280, 720, 390, 844), mirror})
    const m = palmBasis(hand.worldLandmarks)
    const up = new Vector3(0, 1, 0).transformDirection(m)
    const fwd = new Vector3(0, 0, -1).transformDirection(m)
    near(up.z, 1, 1e-6)                    // out of the palm, toward the viewer
    near(fwd.y, 1, 1e-6)                   // fingers point up the screen
    near(m.determinant(), 1, 1e-6)         // proper rotation, no mirroring
  }
})

test('palmPose places the palm centre under the on-screen palm at the estimated depth', () => {
  const view = {fovDeg: 55, containerW: 390, containerH: 844, aspect: 390 / 844}
  view.layout = coverLayout(1280, 720, 390, 844)
  const hand = syntheticHand({depth: 0.6, ...view, centre: {x: 0.5, y: 0.5}})
  const pose = palmPose(hand, view)
  near(pose.depth, 0.6, 1e-6)
  near(pose.position.z, -0.6, 1e-6)
  const c = palmCenter2d(hand.landmarks)
  const ndc = landmarkToNdc(c, view.layout, view.containerW, view.containerH)
  const expected = unprojectNdc(ndc, 0.6, view.fovDeg, view.aspect)
  near(pose.position.x, expected.x, 1e-6)
  near(pose.position.y, expected.y, 1e-6)
})

test('PoseSmoother snaps on the first sample, then converges without overshoot', () => {
  const s = new PoseSmoother({positionRate: 16})
  const a = {position: new Vector3(0, 0, 0), quaternion: new Quaternion()}
  const b = {position: new Vector3(1, 0, 0), quaternion: a.quaternion.clone()}
  s.update(a, 1 / 60)
  near(s.position.x, 0)
  let prev = 0
  for (let i = 0; i < 120; i++) {
    s.update(b, 1 / 60)
    assert.ok(s.position.x >= prev && s.position.x <= 1)
    prev = s.position.x
  }
  assert.ok(s.position.x > 0.99)
})

test('easeInOut is clamped and symmetric', () => {
  near(easeInOut(-1), 0); near(easeInOut(2), 1); near(easeInOut(0.5), 0.5)
  near(easeInOut(0.25) + easeInOut(0.75), 1)
})
