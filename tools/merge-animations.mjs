// Folds every animation in a GLB into one, named "All".
//   node tools/merge-animations.mjs in.glb out.glb [name]
// Run it on the raw Blender export, before `gltf-transform optimize`.
// Blender's SCENE export writes one animation per object, so a rig and its shape keys come out as two
// clips. The app plays a single clip, so the second one would simply never run: the jaguar would walk
// but never blink. This puts every channel back into one clip.
import {NodeIO} from '@gltf-transform/core'
import {ALL_EXTENSIONS} from '@gltf-transform/extensions'
import {MeshoptDecoder, MeshoptEncoder} from 'meshoptimizer'

const [, , src, dst, name = 'All'] = process.argv
if (!src || !dst) throw new Error('usage: merge-animations.mjs in.glb out.glb [name]')

// the decoders are only needed when the input has already been compressed; harmless otherwise
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder})
const doc = await io.read(src)
const root = doc.getRoot()
const anims = root.listAnimations()
if (!anims.length) throw new Error('no animations in ' + src)

const keep = anims[0]
let moved = 0
for (const other of anims.slice(1)) {
  for (const ch of other.listChannels()) { other.removeChannel(ch); keep.addChannel(ch); moved++ }
  for (const s of other.listSamplers()) { other.removeSampler(s); keep.addSampler(s) }
  other.dispose()
}
keep.setName(name)
await io.write(dst, doc)

const secs = Math.max(...keep.listSamplers().map(s => s.getInput()?.getMax([])[0] ?? 0))
console.log(`merged ${anims.length} clips -> ${name!==undefined?`"${name}"`:''}: ${keep.listChannels().length} channels ` +
            `(${moved} moved in), ${secs.toFixed(1)}s`)
