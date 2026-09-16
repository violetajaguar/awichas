# Turns a recorded take (tools/huk-record.py) into one GLB clip, headless.
#   blender ~/Desktop/Huk/jaguar.blend -b --python tools/huk-bake.py -- take.json out.glb [start_s] [end_s]
# Runs in a fresh Blender so nothing is posing the rig while keyframes are written. Curves are built in
# bulk (foreach_set), not with keyframe_insert per bone per frame: a 7-minute take is millions of keys
# and the per-key path would run for a very long time.
import bpy, sys, json, numpy as np

argv = sys.argv[sys.argv.index('--')+1:]
TAKE, OUT = argv[0], argv[1]
START_S = float(argv[2]) if len(argv) > 2 else None
END_S = float(argv[3]) if len(argv) > 3 else None

take = json.load(open(TAKE))
S, FPS = take['samples'], take['fps']
arm = bpy.data.objects[take['armature']]
for pb in arm.pose.bones: pb.rotation_mode = 'XYZ'

names = [n for n in S[0][1]]
keynames = sorted(S[0][2])
N = len(S)
times = np.array([s[0] for s in S], dtype=np.float64)
raw_bone = np.zeros((N, len(names), 9), dtype=np.float32)
raw_keys = np.zeros((N, len(keynames)), dtype=np.float32)
for i, (t, b, k) in enumerate(S):
    for j, n in enumerate(names):
        v = b.get(n)
        if v: raw_bone[i, j, 0:3], raw_bone[i, j, 3:6], raw_bone[i, j, 6:9] = v[0], v[1], v[2]
    for j, kn in enumerate(keynames):
        raw_keys[i, j] = k.get(kn, 0.0)
del take, S

# Blender's timer cannot hold a steady 24Hz, so the samples are not evenly spaced: laying them out one per
# frame would play the whole performance back faster than it was actually danced. Resample onto real time.
span = float(times[-1] - times[0])
M = int(round(span * FPS)) + 1
want = times[0] + np.arange(M) / FPS
hi_i = np.searchsorted(times, want).clip(1, N - 1)
lo_i = hi_i - 1
w = ((want - times[lo_i]) / np.maximum(times[hi_i] - times[lo_i], 1e-9)).clip(0, 1).astype(np.float32)
bone = raw_bone[lo_i] * (1 - w)[:, None, None] + raw_bone[hi_i] * w[:, None, None]
keys = raw_keys[lo_i] * (1 - w)[:, None] + raw_keys[hi_i] * w[:, None]
N = M
print(f"@@@ {len(times)} samples over {span:.1f}s captured at {len(times)/span:.1f}Hz "
      f"-> resampled to {M} frames at {FPS}fps ({M/FPS:.1f}s, true to the performance)")
del raw_bone, raw_keys

# --- trim dead air, or cut the window the caller asked for -------------------------------------------
if START_S is None:
    motion = np.abs(np.diff(bone[:, :, 3:6], axis=0)).max(axis=(1, 2))
    live = np.nonzero(motion > 2e-4)[0]
    lo, hi = (int(live[0]), int(live[-1]) + 1) if len(live) else (0, N - 1)
else:
    lo = max(0, int(START_S * FPS))
    hi = min(N - 1, int(END_S * FPS)) if END_S else N - 1
bone, keys = bone[lo:hi+1], keys[lo:hi+1]
M = len(bone)
print(f"@@@ {M} frames ({M/FPS:.1f}s) of {N} ({N/FPS:.1f}s); cut {lo} head / {N-1-hi} tail")

# --- build one action, in bulk ------------------------------------------------------------------------
for a in list(bpy.data.actions): bpy.data.actions.remove(a)
arm.animation_data_clear(); arm.animation_data_create()
act = bpy.data.actions.new('All')
slot = act.slots.new(id_type='OBJECT', name=arm.name)
cb = act.layers.new('Layer').strips.new(type='KEYFRAME').channelbag(slot, ensure=True)
arm.animation_data.action = act
arm.animation_data.action_slot = slot

frames = np.arange(M, dtype=np.float32)
made = flat = 0
for j, n in enumerate(names):
    if n not in arm.pose.bones: continue
    for chan, base in (('location', 0), ('rotation_euler', 3)):
        for i in range(3):
            vals = bone[:, j, base + i]
            span = float(vals.max() - vals.min())
            if span < 1e-6:
                # a channel that never moves still has to carry its value: two keys, not M
                if abs(float(vals[0])) < 1e-6: flat += 1; continue
                f2 = np.array([0, M - 1], dtype=np.float32); v2 = np.array([vals[0], vals[0]], np.float32)
                fc = cb.fcurves.new(f'pose.bones["{n}"].{chan}', index=i)
                fc.keyframe_points.add(2)
                co = np.empty(4, np.float32); co[0::2] = f2; co[1::2] = v2
                fc.keyframe_points.foreach_set('co', co)
                fc.keyframe_points.foreach_set('interpolation', [1, 1])
                fc.update(); made += 1; continue
            fc = cb.fcurves.new(f'pose.bones["{n}"].{chan}', index=i)
            fc.keyframe_points.add(M)
            co = np.empty(M * 2, np.float32); co[0::2] = frames; co[1::2] = vals
            fc.keyframe_points.foreach_set('co', co)
            fc.keyframe_points.foreach_set('interpolation', [1] * M)
            fc.update(); made += 1
print(f"@@@ {made} curves built, {flat} flat channels skipped")

# --- shape keys (few enough that the simple path is fine) ---------------------------------------------
meshes = {o.name: o for o in bpy.data.objects if o.type == 'MESH' and o.data.shape_keys}
for o in meshes.values():
    if o.data.shape_keys.animation_data is None: o.data.shape_keys.animation_data_create()
kmade = 0
for j, kn in enumerate(keynames):
    mesh, key = kn.split('|', 1)
    o = meshes.get(mesh)
    if o is None or key not in o.data.shape_keys.key_blocks: continue
    vals = keys[:, j]
    if float(vals.max() - vals.min()) < 1e-4: continue
    kb = o.data.shape_keys.key_blocks[key]
    for f in range(M):
        kb.value = float(vals[f]); kb.keyframe_insert('value', frame=f)
    kmade += 1
print(f"@@@ {kmade} shape-key channels")

scene = bpy.context.scene
scene.render.fps = FPS
scene.frame_start, scene.frame_end = 0, M - 1
scene.name = 'All'
bpy.ops.export_scene.gltf(
    filepath=OUT, export_format='GLB', export_apply=True, export_yup=True,
    export_animations=True, export_skins=True, export_morph=True, export_texcoords=True,
    export_normals=True, export_materials='EXPORT', export_image_format='AUTO',
    export_frame_range=True, export_force_sampling=True, export_optimize_animation_size=True,
    export_animation_mode='SCENE',
)
print(f"@@@ exported {M/FPS:.1f}s -> {OUT}")
