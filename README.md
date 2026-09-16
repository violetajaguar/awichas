# Las Awichas · WebAR (open-source rebuild)

Eight robotic Awichas step out of their printed portraits and, when you hold out your hand,
come to sit on your palm. This is the rebuild of the original 8th Wall project on a fully
open-source stack, so it keeps working after the 8th Wall hosted platform disappears.

| Part | Library | License |
| --- | --- | --- |
| Image tracking (the portraits) | [MindAR](https://github.com/hiukim/mind-ar-js) 1.2.5 | MIT |
| Hand tracking (the palm) | [MediaPipe Hand Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker/web_js) 1.0 | Apache-2.0 |
| Rendering / animation | [three.js](https://threejs.org) 0.160 | MIT |
| Build | [Vite](https://vite.dev) 7 | MIT |

Everything (models, audio, decoders, the hand-tracking WASM and model) is served from this
project. There are no calls to 8th Wall, unpkg or any other CDN at runtime.

## Run it

```bash
npm install            # native build scripts are skipped on purpose (.npmrc); nothing native is needed
npm run dev            # https://<your-mac-ip>:5173  (self-signed certificate: accept the warning on the phone)
```

Open the URL on a phone on the same Wi-Fi. The camera only works over HTTPS, which is why the
dev server uses a self-signed certificate. Print the portraits from `target-sources/`
(or the originals) and scan them.

```bash
npm run build          # static site in dist/ – upload it to any web host (Netlify, GitHub Pages, S3…)
npm run preview        # serve dist/ locally over HTTPS
npm test               # unit tests for the hand-pose maths
```

## Getting the artwork

The code here is public. The artwork is not: the portraits, the 3D animals, the recordings and the
written stories belong to the artist and are kept out of this repository. A clone gives you a working
application with nothing in it to look at.

These paths are deliberately absent, and `npm run build` will succeed without them:

```
public/models/    the animals          public/cards/    the portraits shown on the welcome screen
public/audio/     the recordings       public/thumbs/   the small portraits
public/targets/   the .mind tracking targets            target-sources/  the images they are compiled from
voice-scripts/    the written stories  voice-es/        the Spanish recordings
```

Two tests check the recordings and the stories. They skip themselves when those files are not present,
so `npm test` passes on a fresh clone.

To run the real thing you need the artwork folders dropped into place. Ask the artist. If you have your
own portraits and models instead, `tools/import-model.sh`, `tools/compile-targets.mjs` and
`tools/prepare-assets.sh` are the pipeline that builds all of it, and `src/animals.js` is where each
animal is described.

The hand-tracking runtime and model are not kept here either, but those are Google's and public:
`npm install` fetches them for you (`tools/prepare-runtime.mjs`).

## Putting it online

The site is static: `npm run build` writes everything into `dist/` and any HTTPS host can serve it.
Three ways, easiest first:

1. **Netlify Drop (no account setup, 2 minutes).** Run `npm run build`, open
   https://app.netlify.com/drop and drag the `dist` folder onto the page. You get an
   `https://….netlify.app` address immediately; rename it in Site settings. Re-drag `dist` after
   every change. `netlify.toml` in this folder adds sensible cache headers if you connect a repo instead.
2. **GitHub Pages.** Put this folder in a GitHub repository (branch `main`), then in the repository's
   Settings → Pages set Source to "GitHub Actions". The workflow in `.github/workflows/deploy-pages.yml`
   builds and publishes on every push; the address is `https://<user>.github.io/<repo>/`.
3. **DreamHost, or any other Apache host.** Upload the contents of `dist/` (including the dotfile
   `.htaccess`) to the domain's web directory. See below.
4. **Anywhere else.** Any web server with HTTPS will do: no server code and no special headers are
   required. The camera does not work over plain `http://`.

Whatever the host, keep the printed portraits and the files in `public/targets/` in sync.

### DreamHost (Apache)

Everything is prepared by the build, so there is nothing to configure in the panel except the
certificate:

```
npm run build
rsync -av --delete dist/ user@server.dreamhost.com:~/yourdomain.com/
```

Then turn on the free Let's Encrypt certificate for the domain (Panel → Websites → Secure Hosting).
**The camera only starts over https**, so without it the welcome screen appears and then nothing
happens. `public/.htaccess` is copied into `dist/` by the build and does the rest: it sends visitors
to the secure address, declares the media types (`application/wasm` above all, without which
MediaPipe drops to a slower path), serves the precompressed files, and sets cache lifetimes.

`npm run build` also writes a gzipped twin beside every large compressible file
(`tools/precompress.mjs`), and `.htaccess` hands that twin to any phone that accepts gzip. It matters
more than it sounds: the download drops from about 59 MB to 25 MB, the WebAssembly runtime alone
going from 11 MB to 3.3 MB. Compressing on the fly instead would mean the server gzipping ~20 MB per
visitor, which shared hosting cannot keep up with. The cost is that `dist/` is about 30 % larger to
upload, since both copies are shipped.

A few things worth knowing:

- **No CDN.** Shared hosting is one machine. A first visit is 25-30 MB, so a room full of phones
  opening it at once all queue on that one server. If that is the situation, put Cloudflare in front
  (DreamHost has offered a free toggle for this in the panel) rather than moving host. The `.htaccess`
  already tolerates a proxy ending the TLS, so nothing changes in the site.
- **A subfolder works.** Every path in the build is relative, so `yourdomain.com/awichas/` serves
  the experience as happily as the domain root.
- **Replacing a model or a recording.** Those files keep their names, and phones hold them for a
  week. Rename the file (and its entry in `src/animals.js`) if a change has to reach people at once.
  Code and the MediaPipe runtime are held for a year, which is safe: their names carry a version.

The settings were checked against Apache 2.4 with the built site: the camera opens, MindAR loads its
target file, and MediaPipe's runtime arrives as `application/wasm`, gzipped.

## How an experience flows

The whole site is one page. `index.html?animal=gecko` is one Awicha; `index.html` with no parameter is the **tour**:
all eight portraits are in one target file (`public/targets/all.mind`), the camera is started once,
and whichever print it sees brings out that animal. Walk to the next portrait and the next one
comes out (an animal still sitting on your hand shrinks away first). See `src/experience.js`.

1. **Welcome** – the green bar, the welcome text and the portrait to scan. *Start the camera* starts the camera on
   this same page: one tap, which is also what lets the phone play sound (iOS/Android unlock audio on a tap only).
   `?camera=1` skips this screen and opens the camera as the page loads – useful for a QR
   code that should land in the camera with no tap at all. There is then no tap to unlock audio, so the
   first touch anywhere does it instead (`armAudioOnFirstTouch` in `src/experience.js`), and the back arrow
   drops the parameter so it still reaches the welcome screen.
2. **Scanning** – MindAR looks for that animal's `.mind` target. The soundtrack plays. Only the camera is
   waited for: her model downloads behind the live picture, and if the print is found first the screen says
   she is waking up.
3. **On the portrait** – the animal grows out of the print and plays her clip; her voice plays.
   The soundtrack keeps playing underneath her, dipping a little while she speaks. Only one voice is ever
   heard: each Awicha has a single `<audio>` and any sound that starts on its own (iOS resumes media after the
   camera interrupts it) is paused at once (`Mixer` and the guard in `src/audio.js`).
   *Call her to my hand* appears (she also comes by herself shortly after the voice ends).
4. **Summoning** – hand tracking loads (it is pre-loaded in the background from step 2).
   As soon as a hand is seen, image tracking is paused (only one tracker runs at a time) and the
   animal travels to the palm: flyers (condor, hummingbird, whale) in a small arc, walkers and
   crawlers in a straight line, turned to face where they are going, with their walking clip
   playing (`travel`, `forward` and `travelClip` in `src/animals.js`).
5. **On the hand** – she follows the palm, smoothed, standing on whichever side of the hand faces
   the camera. If the hand disappears she waits where she is and image tracking resumes: point the
   camera at the portrait and she flies back onto it by herself. *Back to the portrait* does the
   same while she is still on your hand. She never disappears and re-appears; both directions are
   flights.

`?debug=1` adds a panel to tune size/position/rotation on the portrait and on the hand while you
look at the real thing; copy the JSON it prints into `src/animals.js`.

## Project layout

```
index.html / src/experience.js  the whole site: welcome screen + AR experience (state machine + render loop)
experience.html                 a redirect to index.html, so older links and QR codes keep working
src/animals.js                  per-animal config: model, clips, voice, placement on portrait/hand
src/hand-pose.js                landmarks -> palm pose maths (unit-tested in tests/)
src/hand-tracker.js             MediaPipe HandLandmarker wrapper (GPU, CPU fallback)
src/model-loader.js             GLTF (draco + meshopt) loader, bounding-box pivot, clip crossfade
src/audio.js                    soundtrack / voices: mobile autoplay unlock, Mixer, one-voice-at-a-time guard
src/language.js                 English / Español choice (remembered on the device, ?lang=es in the URL)
voice-scripts/                  every story in English and Spanish (source for ElevenLabs)
tools/elevenlabs-voices.mjs     generates the voices from voice-scripts/ with ElevenLabs
public/models  public/audio     runtime assets (from the 8th Wall export, see tools/prepare-assets.sh)
public/targets/<id>.mind        compiled image targets
public/cards  public/thumbs     portrait previews and home thumbnails
public/mediapipe               hand_landmarker.task + WASM runtime (fetched by tools/prepare-runtime.mjs)
public/decoders/draco           Draco decoder (copied by tools/prepare-runtime.mjs)
target-sources/                 the portrait images the targets are compiled from
tools/                          asset prep, target compiler, smoke test
```

## New or changed animations (Blender)

Blender is installed on this Mac, so a `.blend` can be imported directly:

```bash
bash tools/import-model.sh ~/path/to/monkey.blend monkey
```

That exports a GLB headlessly with **every action as its own clip** (`tools/blender-export.py`),
compresses it (meshopt + WebP textures, `@gltf-transform/cli`), installs it as
`public/models/monkey.glb` and prints the clip names. Then set `clip` (on the portrait) and
`handClip` (on the hand) in `src/animals.js`. A GLB exported by hand from Blender works too:
`bash tools/import-model.sh monkey.glb monkey`.

Tips for the Blender side: keep one armature per animal, name actions clearly (`crawl`, `idle`,
`fly`…), keep the rest pose sensible (the app measures the model in its rest pose to size it), and
avoid parenting the mesh to scaled empties. Textures up to 2048 px are plenty on a phone.

## Image targets

Targets are compiled from `target-sources/<id>.jpg` (a crop of the print, preferred) or
`<id>-card.jpg` (the whole card). Four portraits (gecko, spider, monkey, hummingbird) reuse the
crops that were used on 8th Wall; the other four (jaguar, whale, condor, llama) use the full card
because no crop existed. **If the physical prints differ from those images, replace the file and
recompile.** Portraits with big flat black areas track worse than busy images: good, even light and
a matte print help.

```bash
npm run compile-targets              # all animals, headless in your installed Google Chrome
npm run compile-targets -- llama     # just one
```

`tools/compile.html` is the same compiler as a page you can open in a browser and drag images into.

## Tuning an animal

Edit `src/animals.js`:

- `voice` – her recording: one file (English), or `{en: 'audio/x-en.mp3', es: 'audio/x-es.mp3'}`. In Spanish,
  an Awicha without a Spanish file plays her English one.
- `clip` / `handClip` / `travelClip` – animation clip on the portrait, on the hand, and while
  travelling between them (available clips are listed in the comments; the browser console with
  `?debug=1` prints them too).
- `travel` – `fly`, `walk` or `crawl` (straight path, facing the destination; crawl is slower).
  `forward` – the model's own head direction, `[0,0,1]` or `[0,0,-1]`.
- `hide` – parts of the GLB to drop at load time, by node or material name (the hummingbird's
  built-in flower is removed this way).
- `onTarget.size` – longest side of the animal as a fraction of the portrait's width.
- `onTarget.position` – offset from the portrait centre in portrait-width units, `+z` toward the viewer.
- `onTarget.rotation` – degrees; portrait `+y` up, `+z` toward the viewer. For a model that should lie
  flat on the print, `[90, 180, 0]` shows its back and `[-90, 0, 0]` its belly.
- `onTarget.spin` – degrees, turns the animal on the print (counter-clockwise on screen) after
  `rotation`; the easy knob for "make her face the other way".
- `onHand.size` – longest side in metres on the palm. `onHand.rotation` – degrees relative to the
  palm frame (`+y` out of the palm, `-z` toward the fingertips).

## Languages and voices

A switch on the home page chooses **English** or **Español**. It changes the written welcome on the home page
and, in the experience, which recording each Awicha plays. The choice is remembered on the phone;
`?lang=es` in the URL forces Spanish (useful for a QR code next to a print). By default the phone's own language
is used when it is Spanish, otherwise English. The choice covers the words on screen as well as the voices
(`TEXT` in `src/experience.js`, `titleEs` in `src/animals.js`). The switch sits in the green bar of the welcome
screen and is gone once the camera is running.

English plays the original narrations (`public/audio/<animal>.mp3`), untouched, the gecko's "winter chill of
London" included. The English texts in `voice-scripts/` drop London: they matter only if the English voices are
ever regenerated.
Spanish plays recordings made in ElevenLabs from the approved texts in `voice-scripts/` (sources in `voice-es/`),
installed as `public/audio/<animal>-es.mp3` and turned down to the loudness of the same animal's English voice, so
switching language does not change the volume. To replace one, drop the new file in `voice-es/` and run:

```bash
# match the Spanish file to the English one's loudness (read both "I:" values with ebur128, then apply the difference)
ffmpeg -i voice-es/Gecko_Es.mp3 -af "volume=-2.8dB" -ac 1 -ar 44100 -b:a 128k public/audio/gecko-es.mp3
```

### New voices with ElevenLabs

`voice-scripts/` holds each story in English and Spanish (`<animal>.en.txt`, `<animal>.es.txt`), transcribed from
the original recordings, with Quechua names spelled as on the cards. Edit them freely, then:

```bash
cp .env.example .env                                   # put your ElevenLabs API key in .env (never share this file)
node tools/elevenlabs-voices.mjs --list-voices         # pick a voice id
node tools/elevenlabs-voices.mjs --voice <id> --dry-run   # 16 recordings, about 7,400 characters
node tools/elevenlabs-voices.mjs --voice <id>          # writes public/audio/<animal>-en.mp3 and -es.mp3
```

The default model, `eleven_multilingual_v2`, speaks both languages with the same voice. `--lang es` makes only
the Spanish ones, `--only gecko,jaguar` limits the animals, `--force` redoes existing files. Then set each
animal's `voice` in `src/animals.js` to `{en: 'audio/gecko-en.mp3', es: 'audio/gecko-es.mp3'}` (or keep the
original English file for `en`).

The soundtrack's quiet level is baked into `public/audio/amazonia.m4a` (4 dB below the original file), because
iOS ignores `volume`. While an Awicha speaks it dips to 55% where volume can be changed, and simply plays on where
it cannot.

## The tour's look

The welcome screen keeps the look of the original Las Awichas: the green bar (`#7eff00`), a white page, the welcome
text in the chosen language and the whole eight-animal picture in a green border, with *Start the camera* under it.
A single Awicha has the same screen with her own name and portrait (`index.html?animal=gecko`). Everything green is
`--accent` in `src/experience.css`.

## Look and lighting

The animals are chrome (metalness 1), so their brightness comes from what they reflect:
`src/studio-env.js` builds a dark dome with a few bright softboxes and it is used as
`scene.environment`. Two knobs, both also available as URL parameters for quick comparison on a
phone (`?exposure=1.3&env=1.4`): `renderer.toneMappingExposure` (default 1.1) and the materials'
`envMapIntensity` (default 1.1) in `src/experience.js`.

## Placement previews without a phone

```bash
npm run build
node tools/preview-placement.mjs monkey                        # the animal on its portrait -> smoke-out/monkey-portrait.png
node tools/preview-placement.mjs monkey --hand                 # + flight onto a synthetic hand -> smoke-out/monkey-hand.png
node tools/preview-placement.mjs monkey --set '{"onTarget":{"rotation":[90,220,0]}}'   # try values before editing animals.js
BASE=https://localhost:5173 node tools/preview-placement.mjs monkey   # against the running dev server, no rebuild
```

`?fakehand=1` (together with `?debug=1`) makes the experience use a synthetic hand instead of the
camera, which is how the hand phase is exercised in headless tests.

## Performance notes

- Only one tracker runs at a time except during the hand-over; MindAR is paused
  (`controller.stopProcessVideo()`) while the animal is on the hand.
- Hand landmarks run on the GPU delegate; positions are smoothed with a frame-rate-independent
  filter (`PoseSmoother`), the portrait pose with MindAR's One-Euro filter.
- Renderer pixel ratio is capped at 2; all models are meshopt/draco compressed with WebP textures.
- The soundtrack is a 64 kbps AAC (about 4 MB, streamed); the JS bundle is about 540 KB gzipped
  (three.js + TensorFlow.js for MindAR + MediaPipe).

## Testing without a phone

```bash
npm run build
ffmpeg -loop 1 -i target-sources/gecko.jpg -t 2 -r 15 \
  -vf "scale=640:480:force_original_aspect_ratio=decrease,pad=640:480:(ow-iw)/2:(oh-ih)/2" -pix_fmt yuv420p /tmp/gecko.y4m
node tools/smoke-test.mjs gecko /tmp/gecko.y4m
```

That drives the built site in headless Chrome with a fake camera playing the portrait, and checks
the page reaches *scanning → on the portrait → summoning → back to scanning* with no errors.
Screenshots land in `smoke-out/`. `node tools/tour-test.mjs two-portraits.y4m` checks the tour switches
animals when the picture changes (make the video by concatenating two portraits with ffmpeg).
`node tools/inspect-models.mjs /tmp/gecko.y4m` prints how every model
measures (skinned meshes are measured through their bones, which is what the size normalisation relies on).

## Where the original project stands

The folder above this one is the 8th Wall export. It cannot be revived as-is: the exported engine
contains no hand tracking (four experiences depended on it), the open-source 8th Wall engine also
excludes hand tracking and SLAM, image targets were never registered in the export's `app.js`, and
several scenes referenced `cdn.8thwall.com` for the Draco decoder. This rebuild replaces all of it.

## Licence

The code is MIT (see `LICENSE`), so you are free to build on it.

That covers the code only. The artwork is not in this repository and is not MIT: the portraits, the 3D
animals, the recordings and the written stories remain the artist's, all rights reserved. The third-party
pieces keep their own licences, all permissive: MindAR and three.js are MIT, MediaPipe is Apache-2.0.
