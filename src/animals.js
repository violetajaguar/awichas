// One entry per Awicha. Everything an experience needs is described here, so adding or
// tuning an animal never touches the engine code (src/experience.js).
//
//   clip / handClip / travelClip   animation clips inside the GLB: on the portrait, on the hand, while travelling
//                     (available clips are listed per animal; travelClip defaults to clip, handClip to clip)
//   titleEs           her name in Spanish (title is the English one)
//   voice             her recording per language: {en: '…', es: '…'} (English: the original narrations;
//                     Spanish: ElevenLabs, from voice-es/). A plain file name means English only; a language
//                     without its own file plays the English one (see src/language.js)
//   travel            'fly' (arc through the air) | 'walk' | 'crawl' (straight path, facing where she goes, slower)
//   forward           the model's own head direction: [0,0,1] or [0,0,-1] (used to face the direction of travel)
//   hide              parts of the GLB to remove (node or material name contains any of these, case-insensitive)
//   onTarget.size     longest side of the animal as a fraction of the portrait's WIDTH (portrait width = 1)
//   onTarget.position offset from the centre of the portrait, in portrait-width units (+z = out of the print)
//   onTarget.rotation degrees; the portrait's +y points up, +z points at the viewer.
//                     For a Y-up model lying flat on the print: [90, 180, 0] shows its back, [-90, 0, 0] its belly.
//   onTarget.spin     degrees, turns the animal on the print (counter-clockwise on screen), applied after rotation
//   onHand.size       longest side of the animal in metres when it sits on the palm
//   onHand.rotation   degrees, relative to the palm frame (+y out of the palm, -z toward the fingertips)
//
// Open any experience with ?debug=1 to tune these live and copy the values back here.
export const ANIMALS = {
  jaguar: {
    order: 1, quechua: 'Huk', title: 'The Jaguaress', titleEs: 'La Jaguaresa',
    model: 'models/jaguar.glb', clip: 'All', handClip: 'All', travelClip: 'All',   // jaguar8.blend rig (long tail) + the 50s performance built by tools/jaguar-performance.py  (jaguar-all.glb is the older 42s one)
    voice: {en: 'audio/jaguar.mp3', es: 'audio/jaguar-es.mp3'},
    travel: 'walk', forward: [0, 0, 1],
    // lying on the print, feet on the paper: walking over her crossed hands toward her face (head up-left)
    // she stays put on the print (onTarget.wander would walk her in a circle; she is better held still)
    onTarget: {size: 1.1, position: [0.14, -0.24, 0.03], rotation: [90, 180, 0], spin: 40},
    onHand: {size: 0.176, rotation: [0, 0, 0], toFingers: 0.35},   // sits up towards the fingertips
  },
  monkey: {
    order: 2, quechua: 'Iskay', title: 'The trickster Monkey', titleEs: 'La Señorita Mona',
    model: 'models/monkey.glb', clip: 'All', handClip: 'All',   // clips: All
    voice: {en: 'audio/monkey.mp3', es: 'audio/monkey-es.mp3'},
    travel: 'walk', forward: [0, 0, 1],
    // crawling up her cloak toward her face: flat on the print, seen from the back, head up-left
    onTarget: {size: 0.53, position: [0.03, -0.02, 0.05], rotation: [90, 220, 0]},
    onHand: {size: 0.15, rotation: [0, 0, 0]},
  },
  gecko: {
    order: 3, quechua: 'Kinsa', title: 'The spicy Gecko', titleEs: 'La Geco',
    model: 'models/gecko.glb', clip: 'Action.001', handClip: 'Action.001',   // clips: Action.001
    voice: {en: 'audio/gecko.mp3', es: 'audio/gecko-es.mp3'},
    // she changes colour as she goes, once round the wheel every 16s (nothing in geko.blend does this)
    colourCycle: {seconds: 16, saturation: 0.5, lightness: 0.62},
    travel: 'crawl', forward: [0, 0, -1],
    // in her hair (head down-right); on the hand she turns round to face the audience
    onTarget: {size: 0.66, position: [0.23, 0.02, 0.03], rotation: [20, 90, 90], spin: 125},   // 20% larger
    onHand: {size: 0.168, rotation: [0, 180, 0]},
  },
  whale: {
    order: 4, quechua: 'Tawa', title: 'Sra Whale', titleEs: 'La Ballena',
    model: 'models/whale.glb', clip: 'side_fine.R.002Action', handClip: 'side_fine.R.002Action', travelClip: 'side_fine.R.002Action',   // clips: side_fine.R.002Action, Cube.006Action  (whale-swim.glb is the older, stiller swim: Action, ArmatureAction.001, ballena_swimin)
    voice: {en: 'audio/whale.mp3', es: 'audio/whale-es.mp3'},
    travel: 'fly', forward: [0, 0, -1],
    // vertical, swimming up along the stripes of her shawl
    onTarget: {size: 0.77, position: [0.15, -0.1, 0.08], rotation: [0, -90, 0], spin: 75},   // 10% larger
    // turned right round on the palm: her head is over the wrist and her tail towards the fingers
    onHand: {size: 0.198, rotation: [0, 180, 0]},
  },
  condor: {
    order: 5, quechua: 'Pisqa', title: 'The Condoress', titleEs: 'La Cóndora',
    model: 'models/condor.glb', clip: 'All', handClip: 'All',   // clips: All
    voice: {en: 'audio/condor.mp3', es: 'audio/condor-es.mp3'},
    travel: 'fly', forward: [0, 0, 1],
    // wings spread, seen from above (back up), flying up and to the right past her shoulder
    onTarget: {size: 0.65, position: [0.17, 0.1, 0.1], rotation: [90, 155, 0]},
    onHand: {size: 0.2, rotation: [0, 0, 0]},
  },
  llama: {
    order: 6, quechua: 'Soqta', title: 'Señorita Llama', titleEs: 'La Señorita Llama',
    model: 'models/llama.glb', clip: 'All', handClip: 'All',   // clips: All  (llama-idle.glb: llama_Idle)
    voice: {en: 'audio/llama.mp3', es: 'audio/llama-es.mp3'},
    travel: 'walk', forward: [0, 0, 1],
    // standing at her side, low, turned three-quarters toward the viewer
    onTarget: {size: 0.55, position: [0.24, -0.3, 0.08], rotation: [0, -60, 0]},
    onHand: {size: 0.15, rotation: [0, 0, 0]},
  },
  hummingbird: {
    order: 7, quechua: 'Qanchis', title: 'The beautiful Hummingbird', titleEs: 'La Picaflor',
    model: 'models/hummingbird.glb', clip: 'All', handClip: 'fly', travelClip: 'fly',   // clips: All, displace, fly, Idle
    voice: {en: 'audio/hummingbird.mp3', es: 'audio/hummingbird-es.mp3'},
    travel: 'fly', forward: [0, 0, 1],
    hide: ['_873b_Var3_LOD0', 'flor'],   // the flower that ships inside the GLB
    onTarget: {size: 0.35, position: [0.05, 0, 0.1], rotation: [0, -90, 0]},
    onHand: {size: 0.12, rotation: [0, 0, 0]},
  },
  spider: {
    order: 8, quechua: 'Pusaq', title: 'Spider Grandma', titleEs: 'La Abuela Araña',
    model: 'models/spider.glb', clip: 'All', handClip: 'araña_Idle', travelClip: 'araña_walk',   // clips: All, araña_Idle, araña_stop, araña_walk
    voice: {en: 'audio/spider.mp3', es: 'audio/spider-es.mp3'},
    travel: 'crawl', forward: [0, 0, -1],
    // crawling up her chest above her hand, back up, head toward her face
    onTarget: {size: 0.55, position: [0, 0.1, 0.03], rotation: [90, 180, 0], spin: 0},   // turned round: she crawls up towards her face
    onHand: {size: 0.14, rotation: [0, 0, 0]},
  },
}

// Shared files
export const SOUNDTRACK = 'audio/amazonia.m4a'
export const HAND_MODEL = 'mediapipe/hand_landmarker.task'
export const HAND_WASM = 'mediapipe/wasm'
export const DRACO_DECODERS = 'decoders/draco/'
export const ALL_TARGETS = 'targets/all.mind'   // all eight portraits in one file, in ORDERED order (tour mode)

export const ORDERED = Object.entries(ANIMALS)
  .map(([id, a]) => ({id, ...a, target: `targets/${id}.mind`, card: `cards/${id}.jpg`, thumb: `thumbs/${id}.jpg`}))
  .sort((a, b) => a.order - b.order)

export function getAnimal(id) {
  return ORDERED.find(a => a.id === id) || null
}

/** {language: file} for an animal's voice. A plain file name is her English recording. */
export function voiceSources(animal) {
  return typeof animal.voice === 'string' ? {en: animal.voice} : {...animal.voice}
}

/** The language she will actually speak when `lang` is chosen: `lang` if she has it, else English. */
export function voiceLanguage(animal, lang) {
  const sources = voiceSources(animal)
  if (sources[lang]) return lang
  return sources.en ? 'en' : Object.keys(sources)[0]
}
