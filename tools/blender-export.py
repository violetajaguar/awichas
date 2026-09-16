# Runs inside Blender (headless) to export a .blend as GLB with every action as its own animation clip.
#   blender -b file.blend --python tools/blender-export.py -- out.glb
# Used by tools/import-model.sh; you normally do not call this directly.
import sys
import bpy

out = sys.argv[sys.argv.index('--') + 1]

# Make sure every action in the file gets exported, even the ones not currently assigned.
for obj in bpy.data.objects:
    if obj.animation_data is None and obj.type == 'ARMATURE':
        obj.animation_data_create()

kwargs = dict(
    filepath=out,
    export_format='GLB',
    export_apply=True,               # apply modifiers (not on skinned meshes; the exporter handles armatures)
    export_yup=True,
    export_animations=True,
    export_skins=True,
    export_morph=True,
    export_texcoords=True,
    export_normals=True,
    export_materials='EXPORT',
    export_image_format='AUTO',
    export_frame_range=False,
    export_force_sampling=True,
    export_optimize_animation_size=True,
)
# Blender 3.6+ names; older versions use export_nla_strips
try:
    bpy.ops.export_scene.gltf(export_animation_mode='ACTIONS', **kwargs)
except TypeError:
    bpy.ops.export_scene.gltf(export_nla_strips=True, **kwargs)
print(f'exported {out}')
