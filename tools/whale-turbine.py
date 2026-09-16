# Re-times the whale's tail turbine, and writes a new GLB.
#   blender -b --factory-startup --python tools/whale-turbine.py -- "../ball idle1.glb" /tmp/whale.glb 20
#   npx gltf-transform optimize /tmp/whale.glb public/models/whale.glb \
#     --compress meshopt --texture-compress webp --texture-size 2048 --simplify false --join false --flatten false --prune true
# The last argument is turns per 10-second clip: 20 is the ~2 turns a second now in public/models/whale.glb,
# 1 is how the original export came from Blender. Keep it a whole number or the loop will jump.
# The rig already turns the bone named "turbine" once per clip about its own local Z; this keeps that
# axis and that seamless start/end, and only multiplies the number of turns.
import bpy, sys, math
from mathutils import Quaternion

argv = sys.argv[sys.argv.index('--')+1:]
src, out, revs = argv[0], argv[1], int(argv[2])
BONE = 'turbine'

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
act = arm.animation_data.action
print(f"@@@ action={act.name!r} range={tuple(act.frame_range)}")

def channelbags(a):
    return [cb for L in getattr(a,'layers',[]) for s in getattr(L,'strips',[]) for cb in getattr(s,'channelbags',[])]
def curves(a):
    return list(a.fcurves) if hasattr(a,'fcurves') else [fc for cb in channelbags(a) for fc in cb.fcurves]
def drop(a, path):
    n = 0
    if hasattr(a,'fcurves'):
        for fc in list(a.fcurves):
            if fc.data_path == path: a.fcurves.remove(fc); n += 1
    else:
        for cb in channelbags(a):
            for fc in list(cb.fcurves):
                if fc.data_path == path: cb.fcurves.remove(fc); n += 1
    return n

path = f'pose.bones["{BONE}"].rotation_quaternion'
print(f"@@@ removed {drop(act, path)} old rotation curves for {BONE!r}")

f0, f1 = int(act.frame_range[0]), int(act.frame_range[1])
span = f1 - f0
pb = arm.pose.bones[BONE]
pb.rotation_mode = 'QUATERNION'
for f in range(f0, f1 + 1):
    ang = 2*math.pi * revs * (f - f0) / span          # whole turns over the clip: the loop still closes
    pb.rotation_quaternion = Quaternion((0.0, 0.0, 1.0), ang)
    pb.keyframe_insert('rotation_quaternion', frame=f)

for fc in curves(act):
    if fc.data_path == path:
        for kp in fc.keyframe_points:
            kp.interpolation = 'LINEAR'                # a turbine turns at a constant rate, it does not ease
print(f"@@@ keyed {span+1} frames, {revs} turns over {span/bpy.context.scene.render.fps:.2f}s "
      f"= {revs*bpy.context.scene.render.fps/span:.2f} rev/s, {360*revs/span:.1f} deg per frame")

bpy.ops.export_scene.gltf(
    filepath=out, export_format='GLB', export_apply=True, export_yup=True,
    export_animations=True, export_skins=True, export_morph=True, export_texcoords=True,
    export_normals=True, export_materials='EXPORT', export_image_format='AUTO',
    export_frame_range=False, export_force_sampling=True,
    export_optimize_animation_size=True,
    export_animation_mode='ACTIONS',
)
print("@@@ exported", out)
