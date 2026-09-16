// Loads an animal GLB (draco / meshopt compressed, WebP textures) and wraps it so the
// caller can place it by a single pivot at the centre of its bounding box.
import {AnimationMixer, Box3, Group, LoopRepeat, Vector3} from 'three'
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js'
import {DRACOLoader} from 'three/examples/jsm/loaders/DRACOLoader.js'
import {MeshoptDecoder} from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import {DRACO_DECODERS} from './animals.js'

const _box = new Box3()
function measure(root) {
  const box = new Box3()
  root.traverse((o) => {
    if (!o.isMesh) return
    if (o.isSkinnedMesh) {
      o.computeBoundingBox()           // applies bone transforms (bones' matrixWorld must be current)
      _box.copy(o.boundingBox)
    } else {
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox()
      _box.copy(o.geometry.boundingBox)
    }
    if (!_box.isEmpty()) box.union(_box.applyMatrix4(o.matrixWorld))
  })
  return box
}

let loader = null
function getLoader() {
  if (!loader) {
    loader = new GLTFLoader()
    const draco = new DRACOLoader()
    draco.setDecoderPath(DRACO_DECODERS)
    loader.setDRACOLoader(draco)
    loader.setMeshoptDecoder(MeshoptDecoder)
  }
  return loader
}

/**
 * Resolves to a "rig":
 *   pivot    Group to position/rotate/scale; the model's bounding-box centre sits at its origin
 *   size     bounding box size of the raw model (model units)
 *   longest  longest side of that box (used to normalise the animal to a wanted size)
 *   clips    names of the animation clips in the file
 *   play()   crossfade to a clip by name (falls back to the first clip)
 *   mixer    call mixer.update(dt) every frame
 */
export async function loadAnimalModel(url, {hide = []} = {}) {
  const gltf = await getLoader().loadAsync(url)
  const model = gltf.scene
  if (hide.length) {
    const needles = hide.map(h => h.toLowerCase())
    const doomed = []
    model.traverse((o) => {
      const names = [o.name || '']
      if (o.isMesh) for (const m of [].concat(o.material)) names.push(m.name || '')
      if (names.some(n => needles.some(h => n.toLowerCase().includes(h)))) doomed.push(o)
    })
    doomed.forEach(o => o.removeFromParent())
  }
  model.traverse((o) => {
    if (o.isMesh) o.frustumCulled = false   // animated meshes are often culled wrongly by their bind-pose bounds
  })
  // Measure the model as it will be rendered: world matrices must be current, and skinned
  // meshes must be measured through their bones (their raw geometry can be at a very different scale).
  model.updateMatrixWorld(true)
  const box = measure(model)
  const size = box.getSize(new Vector3())
  const center = box.getCenter(new Vector3())
  const longest = Math.max(size.x, size.y, size.z) || 1

  const inner = new Group()
  inner.position.copy(center).negate()
  inner.add(model)
  const pivot = new Group()
  pivot.add(inner)

  const mixer = new AnimationMixer(model)
  const clips = gltf.animations || []
  let current = null
  const play = (name, fade = 0.35) => {
    const clip = clips.find(c => c.name === name) || clips[0]
    if (!clip) return
    const action = mixer.clipAction(clip)
    action.setLoop(LoopRepeat, Infinity)
    action.enabled = true
    if (current === action) return
    if (current) {
      action.reset().play()
      current.crossFadeTo(action, fade, false)
    } else {
      action.play()
    }
    current = action
  }

  return {pivot, model, mixer, size, longest, clips: clips.map(c => c.name), play}
}
