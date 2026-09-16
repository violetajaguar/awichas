# Records a live Huk performance. Runs INSIDE the Blender that jaguaress_story.py / jaguaress_poses.py
# is driving, alongside the receiver, and samples the posed rig 24 times a second.
#   blender ~/Desktop/Huk/jaguar.blend --python <receiver>.py --python tools/huk-record.py
#   ... perform ...
#   touch $HUK_CTRL/STOP        -> writes $HUK_TAKE and stops
# It only reads the rig; it never poses it, so it cannot fight the receiver. Turning the take into a
# clip happens afterwards, in a separate headless Blender (tools/huk-bake.py), for the same reason.
import bpy, os, time, json

CTRL = os.environ.get('HUK_CTRL', '/tmp/huk-ctrl')
TAKE = os.environ.get('HUK_TAKE', '/tmp/huk-take.json')
ARMATURE = os.environ.get('HUK_ARMATURE', 'Jaguar')
FPS = int(os.environ.get('HUK_FPS', '24'))
os.makedirs(CTRL, exist_ok=True)
for stale in ('STOP', 'DONE'):
    p = os.path.join(CTRL, stale)
    if os.path.exists(p): os.remove(p)

arm = bpy.data.objects.get(ARMATURE)
meshes = [o for o in bpy.data.objects if o.type == 'MESH' and o.data.shape_keys]
samples = []
t0 = time.time()
r5 = lambda v: [round(float(x), 5) for x in v]

def tick():
    if os.path.exists(os.path.join(CTRL, 'STOP')):
        save()
        return None
    samples.append([
        round(time.time() - t0, 4),
        {pb.name: [r5(pb.location), r5(pb.rotation_euler), r5(pb.scale)] for pb in arm.pose.bones},
        {f"{o.name}|{kb.name}": round(kb.value, 4)
         for o in meshes for kb in o.data.shape_keys.key_blocks if kb.name != 'Basis'},
    ])
    return 1.0 / FPS

def save():
    with open(TAKE, 'w') as f:
        json.dump({'fps': FPS, 'armature': ARMATURE, 'samples': samples}, f)
    open(os.path.join(CTRL, 'DONE'), 'w').write(f"{len(samples)} {samples[-1][0] if samples else 0}\n")
    print(f"HUK-RECORD: {len(samples)} samples, {samples[-1][0] if samples else 0:.1f}s -> {TAKE}")

if arm is None:
    print(f"HUK-RECORD: armature {ARMATURE!r} not found; not recording")
else:
    bpy.app.timers.register(tick)
    print(f"HUK-RECORD: recording {ARMATURE} at {FPS}fps. touch {CTRL}/STOP to finish.")
