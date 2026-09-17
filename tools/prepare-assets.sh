#!/usr/bin/env bash
# Derives the optimized runtime assets in public/ from the original 8th Wall export
# (the parent folder). Run once from las-awichas/:  bash tools/prepare-assets.sh
# Requires: ffmpeg (brew install ffmpeg) and macOS sips. Works with the macOS default bash 3.2.
set -euo pipefail
cd "$(dirname "$0")/.."
X=..                      # the 8th Wall export
A=$X/src/assets/audio; C=$X/src/assets/cards; D=$X/src/assets/decoration; M=$X/src/assets/awichas-models
mkdir -p public/models public/audio public/cards public/thumbs public/targets public/mediapipe target-sources

# 3D models (already meshopt/draco compressed by echo3D)
cp $M/geko_All_Compressed-Ultimate.glb          public/models/gecko.glb
cp $M/Spider_All_Compressed-Ultimate.glb        public/models/spider.glb
cp $M/monkey_All_Compressed-Ultimate.glb        public/models/monkey.glb
cp $M/hummingbird_All_Compressed-Ultimate.glb   public/models/hummingbird.glb
cp $M/condor_All_2_Compressed-Ultimate.glb      public/models/condor.glb
# The whale in use is a later Blender export, brought in with tools/import-model.sh (it moves far more
# than this one); the original swim is kept beside it so re-running this script does not undo that.
cp $M/whale_swim_Compressed-Ultimate.glb        public/models/whale-swim.glb
# The jaguar in use comes from jaguar8.blend via tools/import-model.sh (longer tail); the older 42s
# "All" performance is kept beside it so re-running this script does not undo that.
cp $M/jaguar_All_2_Compressed-Ultimate.glb      public/models/jaguar-all.glb
cp $M/jaguar_Idle_Compressed-Ultimate.glb       public/models/jaguar-idle.glb
cp $M/llama_All_Compressed-Ultimate.glb         public/models/llama.glb
cp $M/llama_idle_Compressed-Ultimate.glb        public/models/llama-idle.glb

# Voices + soundtrack (soundtrack re-encoded 128k mp3 -> 64k AAC, ~half the size)
# English narration: the 2026 re-recording in ../New Voice, not the original 8th Wall take in $A.
# (The originals are still there as $A/<animal>_voice.mp3 if you ever want them back.)
NV=$X/New\ Voice
for pair in jaguar:Jaguarra monkey:Monk gecko:Geka whale:Ballenita condor:Condoress llama:Llamita hummingbird:Humi spider:Spidere; do
  a=${pair%%:*}; f=${pair#*:}
  cp "$NV/$f.mp3" public/audio/$a.mp3
done
ffmpeg -nostdin -loglevel error -y -i $A/01_Amazonia_compressed.mp3 -c:a aac -b:a 64k public/audio/amazonia.m4a

# Portrait cards: 800px preview for the "scan this" overlay, 1200px source for the target compiler
for pair in jaguar:Awicha_01_Huk_Jaguar monkey:Awicha_02_Iskay_Monkey gecko:Awicha_03_Kinsa_Gecko whale:Awicha_04_Tawa_whale condor:Awicha_05_Pisqa_Condor llama:Awicha_06_Soqta_Llama hummingbird:Awicha_07_Qanchis spider:Awicha_08_Pusaq_Spider; do
  a=${pair%%:*}; f=${pair#*:}
  sips -Z 800  -s format jpeg -s formatOptions 80 $C/$f.jpg --out public/cards/$a.jpg >/dev/null
  sips -Z 1200 -s format jpeg -s formatOptions 90 $C/$f.jpg --out target-sources/$a-card.jpg >/dev/null
done
sips -Z 900 -s format jpeg -s formatOptions 82 $C/Mockup_Final_8_Animals.jpg --out public/cards/all.jpg >/dev/null   # tour intro
# The four portraits that already had cropped 8th Wall image targets: keep those crops as the target source
for a in geko spider monkey hummingbird; do n=$a; [ $a = geko ] && n=gecko
  sips -Z 1200 -s format jpeg -s formatOptions 90 $X/image-targets/$a-image-target_target.jpeg --out target-sources/$n.jpg >/dev/null
done

# Home-screen thumbnails (PNG 400-900KB each -> ~60KB JPEG)
for pair in gecko:Gecko spider:Aracnida monkey:Mono hummingbird:Picaflor condor:Condora whale:Ballena jaguar:Jaguarra llama:Llama; do
  a=${pair%%:*}; f=${pair#*:}
  sips -Z 640 -s format jpeg -s formatOptions 82 $D/$f.png --out public/thumbs/$a.jpg >/dev/null
done
echo "assets prepared:"; du -sh public/* target-sources
