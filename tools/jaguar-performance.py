# Builds a 50-second performance for the jaguar on the jaguar8.blend rig and exports it as one GLB clip.
#   blender -b ~/Desktop/Huk/jaguar8.blend --python tools/jaguar-performance.py -- out.glb [seconds]
#
# jaguar8.blend ships one authored thing: a 1-second walk cycle (JaguarAction, 18 bones). Everything the
# jaguar does for the rest of the clip is built here on top of that, because the file has nothing else in it:
#   walk    the artist's own cycle, looped, untouched
#   stand   the rig's rest pose, breathing, weight shifting
#   paw     she lifts a front paw, reaches, sets it down
#   tail    a travelling wave down all 20 tail bones, the whole time, so the long tail is never dead
#   blink   the "parpados" shape key, at uneven intervals, as eyes actually blink
# It is exported in SCENE mode so the body and the eyelids land in ONE glTF animation: the app plays a
# single clip, and a separate shape-key clip would simply never run.
import bpy, sys, math, random
from mathutils import Quaternion, Vector

argv = sys.argv[sys.argv.index('--')+1:]
OUT = argv[0]
SECONDS = float(argv[1]) if len(argv) > 1 else 50.0
FPS = 24
TOTAL = int(round(SECONDS * FPS))
random.seed(4)

scene = bpy.context.scene
scene.render.fps = FPS
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
src = bpy.data.actions['JaguarAction']
for pb in arm.pose.bones:
    pb.rotation_mode = 'QUATERNION'

# ---- 1. read the authored walk cycle, frame by frame -------------------------------------------------
f0, f1 = int(src.frame_range[0]), int(src.frame_range[1])
CYCLE = f1 - f0                      # 24 frames: the loop point repeats frame 0, so don't sample it twice
arm.animation_data.action = src
WALK = []
for i in range(CYCLE):
    scene.frame_set(f0 + i)
    WALK.append({pb.name: (pb.location.copy(), pb.rotation_quaternion.copy(), pb.scale.copy())
                 for pb in arm.pose.bones})
walk_bones = sorted({n for snap in WALK for n, v in snap.items()
                     if v[1].angle > 1e-5 or v[0].length > 1e-5})
print(f"@@@ walk cycle {CYCLE} frames, moving bones: {len(walk_bones)}")

TAIL = [b.name for b in arm.data.bones if b.name.lower().startswith('tail')]
TAIL.sort()
ARM_R = [n for n in ('upper_arm.R', 'forearm.R', 'hand.R') if n in arm.pose.bones]
SPINE = [n for n in ('spine', 'spine.001', 'spine.002', 'spine.003') if n in arm.pose.bones]
KEYED = sorted(set(walk_bones) | set(TAIL) | set(ARM_R) | set(SPINE))
print(f"@@@ tail bones {len(TAIL)}, keyed bones {len(KEYED)}")

def qslerp(a, b, t):
    return a.slerp(b, t) if t > 0 else a.copy()
def vlerp(a, b, t):
    return a.lerp(b, t)

REST = (Vector((0,0,0)), Quaternion((1,0,0,0)), Vector((1,1,1)))

# ---- 2. the three things she does -------------------------------------------------------------------
def pose_walk(f):
    return WALK[f % CYCLE]

def pose_stand(f):
    """Rest pose, breathing, and a slow shift of weight, so standing still is not standing frozen."""
    t = f / FPS
    out = {}
    breath = math.sin(2*math.pi*t/3.4)                       # one slow breath every 3.4s
    sway = math.sin(2*math.pi*t/7.1)
    for i, n in enumerate(SPINE):
        out[n] = (Vector((0,0,0)),
                  Quaternion((1,0,0,0)).slerp(Quaternion((1,0,0), math.radians(1.6*breath)), 1.0)
                  @ Quaternion((0,0,1), math.radians(0.8*sway)),
                  Vector((1,1,1)))
    return out

def pose_paw(f, phase):
    """One front paw lifts, reaches forward, and is set down again. phase 0..1 over the gesture."""
    p = phase
    lift = math.sin(math.pi * min(1.0, p*1.15)) ** 0.8       # up and back down
    reach = math.sin(math.pi * p) * math.sin(2*math.pi*p*2)  # a small swipe at the top
    out = {}
    if 'upper_arm.R' in arm.pose.bones:
        out['upper_arm.R'] = (Vector((0,0,0)), Quaternion((1,0,0), math.radians(-38*lift)), Vector((1,1,1)))
    if 'forearm.R' in arm.pose.bones:
        out['forearm.R'] = (Vector((0,0,0)), Quaternion((1,0,0), math.radians(46*lift + 10*reach)), Vector((1,1,1)))
    if 'hand.R' in arm.pose.bones:
        out['hand.R'] = (Vector((0,0,0)), Quaternion((1,0,0), math.radians(-22*lift + 14*reach)), Vector((1,1,1)))
    return out

def tail_wave(f):
    """A travelling wave down the whole tail, always running: a long tail that never moves looks dead."""
    t = f / FPS
    out = {}
    for i, n in enumerate(TAIL):
        ph = 2*math.pi * (t/2.6 - i/14.0)
        yaw = math.radians(2.6) * math.sin(ph)
        pitch = math.radians(1.3) * math.sin(ph + 1.2)
        out[n] = Quaternion((0,0,1), yaw) @ Quaternion((1,0,0), pitch)
    return out

# ---- 3. the timeline --------------------------------------------------------------------------------
# Starts and ends walking so the loop closes: the walk phase is f % CYCLE, and TOTAL is a whole number
# of cycles, so the last frame runs straight back into the first.
assert TOTAL % CYCLE == 0, f"{TOTAL} frames is not a whole number of {CYCLE}-frame walk cycles"
SEGMENTS = [('walk', 0.00, 0.20), ('stand', 0.20, 0.42), ('paw', 0.42, 0.52),
            ('stand', 0.52, 0.60), ('walk', 0.60, 0.80), ('stand', 0.80, 0.88),
            ('paw', 0.88, 0.93), ('walk', 0.93, 1.00)]
SEGMENTS = [(k, int(a*TOTAL), int(b*TOTAL)) for k, a, b in SEGMENTS]
FADE = 14   # frames of cross-fade between one behaviour and the next

def weights(f):
    """How much of each behaviour is showing at frame f. Cross-fades, so nothing snaps."""
    w = {}
    for kind, a, b in SEGMENTS:
        if f < a - FADE or f > b + FADE: continue
        if f < a:      k = (f - (a - FADE)) / FADE          # fading in
        elif f > b:    k = ((b + FADE) - f) / FADE          # fading out
        else:          k = 1.0
        w[kind] = max(w.get(kind, 0.0), max(0.0, min(1.0, k)))
    total = sum(w.values()) or 1.0
    return {k: v/total for k, v in w.items()}

def paw_phase(f):
    for kind, a, b in SEGMENTS:
        if kind == 'paw' and a - FADE <= f <= b + FADE:
            span = max(1, b - a)
            return max(0.0, min(1.0, (f - a) / span))
    return 0.0

# ---- 4. bake ----------------------------------------------------------------------------------------
for a in list(bpy.data.actions):
    bpy.data.actions.remove(a)                    # only the new performance should reach the GLB
arm.animation_data_clear(); arm.animation_data_create()
act = bpy.data.actions.new('All')                 # the project's other animals call their clip "All" too
arm.animation_data.action = act

scene.frame_start, scene.frame_end = 0, TOTAL
for f in range(TOTAL + 1):
    w = weights(f)
    wk = pose_walk(f)
    st = pose_stand(f)
    pw = pose_paw(f, paw_phase(f))
    tw = tail_wave(f)
    for name in KEYED:
        pb = arm.pose.bones[name]
        loc, rot, scl = Vector((0,0,0)), Quaternion((1,0,0,0)), Vector((1,1,1))
        acc = 0.0
        for kind, amount in w.items():
            if amount <= 0: continue
            src_pose = {'walk': wk, 'stand': st, 'paw': pw}[kind]
            v = src_pose.get(name)
            if v is None:
                v = (Vector((0,0,0)), Quaternion((1,0,0,0)), Vector((1,1,1)))
            acc += amount
            k = amount / acc
            loc = vlerp(loc, v[0], k); rot = qslerp(rot, v[1], k); scl = vlerp(scl, v[2], k)
        if name in tw:
            rot = rot @ tw[name]                  # the tail wave rides on top of whatever she is doing
        pb.location, pb.rotation_quaternion, pb.scale = loc, rot, scl
        pb.keyframe_insert('location', frame=f, group=name)
        pb.keyframe_insert('rotation_quaternion', frame=f, group=name)

# ---- 5. blinks ---------------------------------------------------------------------------------------
blinks = 0
for ob in bpy.data.objects:
    ks = ob.data.shape_keys if ob.type == 'MESH' else None
    if not ks or 'parpados' not in ks.key_blocks: continue
    kb = ks.key_blocks['parpados']
    if ks.animation_data is None: ks.animation_data_create()
    kb.value = 0.0; kb.keyframe_insert('value', frame=0)
    f = 18
    while f < TOTAL - 20:
        for df, v in ((0, 0.0), (3, 1.0), (7, 0.0)):        # shut fast, open a little slower
            kb.value = v; kb.keyframe_insert('value', frame=f + df)
        blinks += 1
        f += random.randint(46, 128)                         # every 2-5 seconds, unevenly
        if random.random() < 0.22: f -= 30                   # now and then, a double blink
    kb.value = 0.0; kb.keyframe_insert('value', frame=TOTAL)
    print(f"@@@ {blinks} blinks on {ob.name!r}")

print(f"@@@ baked {TOTAL+1} frames ({TOTAL/FPS:.1f}s), {len(KEYED)} bones")
scene.name = 'All'
bpy.ops.export_scene.gltf(
    filepath=OUT, export_format='GLB', export_apply=True, export_yup=True,
    export_animations=True, export_skins=True, export_morph=True, export_texcoords=True,
    export_normals=True, export_materials='EXPORT', export_image_format='AUTO',
    export_frame_range=True, export_force_sampling=True, export_optimize_animation_size=True,
    export_animation_mode='SCENE',        # body + eyelids in ONE clip, which is all the app will play
)
print("@@@ exported", OUT)
