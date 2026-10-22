"""Build the three native camera-player rail sections and their projection map.

Run from the repository root with Blender 3.6 in factory/background mode:
  blender --factory-startup --background --python-exit-code 1 \
    --python art/build_style_player_rail.py

All authored paths are limited to this script's sibling .blend, the rail asset
directory, and the project-local .tools/art-build/
theme-blender directory for transient render/log files.
"""

from __future__ import annotations

import json
import hashlib
import math
import time
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector


ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = ROOT / "art" / "build_style_player_rail.py"
BLEND_PATH = ROOT / "art" / "style-player-rail.blend"
ASSET_DIR = ROOT / "src" / "assets" / "style" / "camera-player" / "rail"
TEMP_DIR = ROOT / ".tools" / "art-build" / "theme-blender"
LOG_PATH = TEMP_DIR / "rail-build.log"

RESOLUTION = (900, 900)
PPU = 147.0
ORIGIN = (450.0, 581.62)
PITCH = 1.0
ORTHO_SCALE = RESOLUTION[0] / PPU
MAX_SAMPLES = 64
GPU_SAMPLES = 48
CAMERA_DISTANCE = 12.0

# The cover quad is inspect-23 from the existing case metadata. These projected
# x/z axes produce the shared low-angle pose before the rigid screen rotation.
RAW_X = ((596.15 - 217.11) / 2.78, (308.98 - 211.05) / 2.78)
RAW_Z = ((217.11 - 176.17) / 2.78, (211.05 - 578.33) / 2.78)


def srgb_channel_to_linear(value: int) -> float:
    channel = value / 255.0
    if channel <= 0.04045:
        return channel / 12.92
    return ((channel + 0.055) / 1.055) ** 2.4


def hex_color(value: str) -> tuple[float, float, float, float]:
    text = value.lstrip("#")
    return tuple(srgb_channel_to_linear(int(text[index:index + 2], 16)) for index in (0, 2, 4)) + (1.0,)


def log(message: str) -> None:
    line = f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {message}"
    print(line, flush=True)
    with LOG_PATH.open("a", encoding="utf-8") as stream:
        stream.write(line + "\n")


def projection_axes() -> tuple[dict[str, list[float]], Vector, Vector, Vector, float]:
    ax = RAW_X
    az = RAW_Z
    ax_x = ax[0] / PPU
    ax_y = ax[1] / PPU
    az_x = az[0] / PPU
    az_y = az[1] / PPU
    ay_x = math.sqrt(max(0.0, 1.0 - ax_x * ax_x - az_x * az_x))
    ay_y = -(ax_x * ax_y + az_x * az_y) / ay_x
    raw_y = (ay_x * PPU, ay_y * PPU)

    angle = -math.pi / 2 - math.atan2(az[1], az[0])
    cosine = math.cos(angle)
    sine = math.sin(angle)

    def rotate(axis: tuple[float, float]) -> list[float]:
        return [cosine * axis[0] - sine * axis[1], sine * axis[0] + cosine * axis[1]]

    axes = {
        "x": rotate(ax),
        "y": rotate(raw_y),
        "z": rotate(az),
    }
    right = Vector((axes["x"][0], axes["y"][0], axes["z"][0])) / PPU
    up = -Vector((axes["x"][1], axes["y"][1], axes["z"][1])) / PPU
    right.normalize()
    up.normalize()
    # Re-orthogonalize at sub-pixel precision after rounding in the source quad.
    up = up - right * right.dot(up)
    up.normalize()
    normal = right.cross(up).normalized()
    return axes, right, up, normal, math.degrees(angle)


def make_material(
    name: str,
    color: str,
    metallic: float,
    roughness: float,
    coat: float = 0.0,
) -> bpy.types.Material:
    material = bpy.data.materials.new(name)
    material.diffuse_color = hex_color(color)
    material.use_nodes = True
    principled = material.node_tree.nodes.get("Principled BSDF")
    principled.inputs["Base Color"].default_value = hex_color(color)
    principled.inputs["Metallic"].default_value = metallic
    principled.inputs["Roughness"].default_value = roughness
    coat_input = principled.inputs.get("Clearcoat")
    if coat_input is None:
        coat_input = principled.inputs.get("Coat Weight")
    coat_roughness = principled.inputs.get("Clearcoat Roughness")
    if coat_roughness is None:
        coat_roughness = principled.inputs.get("Coat Roughness")
    if coat_input:
        coat_input.default_value = coat
    if coat_roughness:
        coat_roughness.default_value = 0.28
    return material


def move_to_collection(obj: bpy.types.Object, collection: bpy.types.Collection) -> None:
    for previous in list(obj.users_collection):
        previous.objects.unlink(obj)
    collection.objects.link(obj)


def add_box(
    collection: bpy.types.Collection,
    name: str,
    dimensions: tuple[float, float, float],
    location: tuple[float, float, float],
    material: bpy.types.Material,
    bevel: float = 0.008,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.use_auto_smooth = True
    obj.data.materials.append(material)
    move_to_collection(obj, collection)

    bevel_mod = obj.modifiers.new("Soft machined edges", "BEVEL")
    bevel_mod.width = min(bevel, min(dimensions) * 0.22)
    bevel_mod.segments = 3
    bevel_mod.limit_method = "ANGLE"
    bevel_mod.angle_limit = math.radians(28)
    bevel_mod.harden_normals = True
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    weighted = obj.modifiers.new("Satin face normals", "WEIGHTED_NORMAL")
    weighted.keep_sharp = True
    weighted.weight = 35
    return obj


def add_area_light(
    collection: bpy.types.Collection,
    name: str,
    offset: tuple[float, float, float],
    target_offset: tuple[float, float, float],
    energy: float,
    size: float,
    size_y: float,
) -> bpy.types.Object:
    light_data = bpy.data.lights.new(name, "AREA")
    light_data.energy = energy
    light_data.shape = "RECTANGLE"
    light_data.size = size
    light_data.size_y = size_y
    light_obj = bpy.data.objects.new(name, light_data)
    collection.objects.link(light_obj)
    light_obj.location = offset
    target = Vector(target_offset)
    light_obj.rotation_euler = (target - light_obj.location).to_track_quat("-Z", "Y").to_euler()
    return light_obj


def create_segment(
    collection: bpy.types.Collection,
    name: str,
    center_y: float,
    variant: str,
    materials: dict[str, bpy.types.Material],
) -> None:
    aluminum = materials["aluminum"]
    edge = materials["edge"]
    groove = materials["groove"]
    accent = materials["accent"]
    panel = materials["panel"]

    add_box(collection, f"{name} / satin aluminum tray", (4.4, PITCH, 0.10),
            (0.0, center_y, -0.05), aluminum, 0.024)

    for side, x in (("left", -2.165), ("right", 2.165)):
        add_box(collection, f"{name} / {side} narrow rim", (0.07, PITCH, 0.24),
                (x, center_y, 0.12), edge, 0.018)

    # Shallow, medium-dark seating channels add contact definition without
    # reading as black slots under the lower camera angle.
    for index, local_y in enumerate((-0.345, 0.345), start=1):
        add_box(collection, f"{name} / contact channel {index}", (4.12, 0.014, 0.002),
                (0.0, center_y + local_y, 0.001), groove, 0.0007)

    # One fine orange index line follows the queue direction; it carries no
    # baked row number, leaving the original renderer free to draw dynamic text.
    add_box(collection, f"{name} / orange index line", (0.014, 0.72, 0.003),
            (-2.055, center_y, 0.002), accent, 0.001)

    # Only the front section gets the blank plate and supports: the renderer
    # overlays ROW there, while mid/back sections remain uninterrupted rails.
    if variant == "front":
        panel_x = -1.56
        panel_z = 0.135
        panel_width = 0.62
        panel_height = 0.14
        panel_depth = 0.026
        panel_y = center_y - 0.498
        for post_x in (panel_x - 0.25, panel_x + 0.25):
            add_box(collection, f"{name} / label plate support", (0.025, 0.06, 0.13),
                    (post_x, center_y - 0.468, 0.12), edge, 0.005)
        plate = add_box(collection, f"{name} / blank ROW plate", (panel_width, panel_depth, panel_height),
                        (panel_x, panel_y, panel_z), panel, 0.012)
        plate["dynamic_overlay"] = "ROW"

    # The exposed outer end receives a low machined closure. Mid sections stay
    # open at both joins so adjacent tiles form a continuous shelf.
    if variant == "front":
        end_y = center_y - 0.475
        cap_name = "front endcap"
    elif variant == "back":
        end_y = center_y + 0.475
        cap_name = "back endcap"
    else:
        end_y = None
        cap_name = ""
    if end_y is not None:
        add_box(collection, f"{name} / {cap_name}", (4.12, 0.05, 0.065),
                (0.0, end_y, 0.0325), edge, 0.012)


def project_point(
    point: tuple[float, float, float],
    axes: dict[str, list[float]],
) -> list[float]:
    x, y, z = point
    return [
        round(ORIGIN[0] + axes["x"][0] * x + axes["y"][0] * y + axes["z"][0] * z, 2),
        round(ORIGIN[1] + axes["x"][1] * x + axes["y"][1] * y + axes["z"][1] * z, 2),
    ]


def label_quad(axes: dict[str, list[float]]) -> list[list[float]]:
    panel_x = -1.56
    panel_z = 0.135
    panel_width = 0.62
    panel_height = 0.14
    panel_face_y = -0.498 - 0.026 / 2
    corners = (
        (panel_x - panel_width / 2, panel_face_y, panel_z + panel_height / 2),
        (panel_x + panel_width / 2, panel_face_y, panel_z + panel_height / 2),
        (panel_x + panel_width / 2, panel_face_y, panel_z - panel_height / 2),
        (panel_x - panel_width / 2, panel_face_y, panel_z - panel_height / 2),
    )
    return [project_point(point, axes) for point in corners]


def configure_gpu(scene: bpy.types.Scene) -> tuple[str, list[str], str | None]:
    cycles_addon = bpy.context.preferences.addons.get("cycles")
    if not cycles_addon:
        scene.cycles.device = "CPU"
        return "CPU", [], "Cycles preferences are unavailable in this Blender process"

    preferences = cycles_addon.preferences
    errors = []
    for backend in ("OPTIX", "CUDA", "HIP", "ONEAPI"):
        try:
            preferences.compute_device_type = backend
            preferences.get_devices()
            devices = list(preferences.devices)
            gpus = [device for device in devices if device.type == backend]
            if not gpus:
                continue
            for device in devices:
                device.use = device in gpus
            scene.cycles.device = "GPU"
            return backend, [f"{device.name} ({device.type})" for device in gpus], None
        except Exception as error:  # Device discovery is optional; don't alter preferences on disk.
            errors.append(f"{backend}: {type(error).__name__}: {error}")

    scene.cycles.device = "CPU"
    reason = "; ".join(errors) if errors else "No OPTIX/CUDA/HIP/ONEAPI GPU device was exposed to Blender"
    return "CPU", [], reason


def configure_camera(
    camera: bpy.types.Object,
    camera_data: bpy.types.Camera,
    center_y: float,
    right: Vector,
    up: Vector,
    normal: Vector,
) -> None:
    target = Vector((0.0, center_y, 0.0))
    target += right * ((RESOLUTION[0] / 2 - ORIGIN[0]) / PPU)
    target += up * ((ORIGIN[1] - RESOLUTION[1] / 2) / PPU)
    rotation = Matrix((right, up, normal)).transposed()
    camera.location = target + normal * CAMERA_DISTANCE
    camera.rotation_euler = rotation.to_euler()
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = ORTHO_SCALE
    camera_data.lens = 50
    camera_data.dof.use_dof = False
    camera_data.clip_start = 0.1
    camera_data.clip_end = 200.0


def ensure_allowed_output_paths() -> None:
    repo = ROOT.resolve()
    repository_outputs = {
        SCRIPT_PATH.resolve(),
        BLEND_PATH.resolve(),
        ASSET_DIR.resolve(),
    }
    for target in repository_outputs:
        try:
            target.relative_to(repo)
        except ValueError as error:
            raise RuntimeError(f"Output escaped repository root: {target}") from error
    expected_repository_outputs = {
        (repo / "art" / "build_style_player_rail.py").resolve(),
        (repo / "art" / "style-player-rail.blend").resolve(),
        (repo / "src" / "assets" / "style" / "camera-player" / "rail").resolve(),
    }
    expected_temp = (repo / ".tools" / "art-build" / "theme-blender").resolve()
    if repository_outputs != expected_repository_outputs or TEMP_DIR.resolve() != expected_temp:
        raise RuntimeError("A build destination is outside the task's explicit allowlist")


def requested_variants() -> list[str]:
    arguments = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if not arguments:
        return ["front", "mid", "back"]
    if len(arguments) != 2 or arguments[0] != "--variants":
        raise ValueError("Expected optional arguments: -- --variants front,mid,back")
    requested = [name.strip().lower() for name in arguments[1].split(",") if name.strip()]
    if not requested or any(name not in {"front", "mid", "back"} for name in requested):
        raise ValueError("Variants must be a comma-separated subset of front,mid,back")
    return list(dict.fromkeys(requested))


def main() -> None:
    global LOG_PATH
    ensure_allowed_output_paths()
    variants_to_render = requested_variants()
    source_hash = hashlib.sha256(SCRIPT_PATH.read_bytes()).hexdigest()
    variant_tag = "-".join(variants_to_render)
    LOG_PATH = TEMP_DIR / f"rail-build-{variant_tag}-{time.strftime('%Y%m%d-%H%M%S')}.log"
    TEMP_DIR.mkdir(parents=True, exist_ok=True)
    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    for temporary in (TEMP_DIR / "rail-front.png", TEMP_DIR / "rail-mid.png", TEMP_DIR / "rail-back.png"):
        if temporary.exists():
            temporary.unlink()

    # Factory startup avoids loading or saving any user's Blender scene or
    # preferences. Remove only the startup scene objects created for this run.
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)

    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.render.resolution_x = RESOLUTION[0]
    scene.render.resolution_y = RESOLUTION[1]
    scene.render.resolution_percentage = 100
    scene.render.pixel_aspect_x = 1.0
    scene.render.pixel_aspect_y = 1.0
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.image_settings.compression = 18
    scene.render.film_transparent = True
    scene.render.use_file_extension = True
    scene.render.use_compositing = False
    scene.render.use_sequencer = False
    scene.render.use_persistent_data = True
    scene.cycles.use_denoising = True
    scene.cycles.samples = MAX_SAMPLES
    # Blender 3.6 uses Filmic; AgX was introduced in the later color pipeline.
    scene.view_settings.view_transform = "Filmic"
    scene.view_settings.look = "Medium High Contrast"
    scene.render.use_stamp = False
    scene.render.filepath = str(TEMP_DIR / "render.png")

    world = bpy.data.worlds.new("Soft reflective studio world")
    world.use_nodes = True
    world.color = hex_color("#aeb8be")[:3]
    world_nodes = world.node_tree.nodes
    background = world_nodes.get("Background")
    background.inputs["Color"].default_value = hex_color("#aeb8be")
    background.inputs["Strength"].default_value = 0.28
    scene.world = world

    materials = {
        "aluminum": make_material("Rail / satin silver aluminum", "#aab2b6", 0.72, 0.36, 0.14),
        "edge": make_material("Rail / softened edge alloy", "#c1c6c7", 0.68, 0.32, 0.12),
        "groove": make_material("Rail / shallow contact channel", "#747c80", 0.42, 0.48, 0.04),
        "accent": make_material("Rail / orange index line", "#ff7a01", 0.12, 0.4, 0.0),
        "panel": make_material("Rail / blank dynamic ROW plate", "#d1d3cf", 0.32, 0.44, 0.08),
    }

    section_specs = (("front", 0.0), ("mid", PITCH), ("back", PITCH * 2))
    rail_collections: dict[str, bpy.types.Collection] = {}
    for variant, center_y in section_specs:
        collection = bpy.data.collections.new(f"Camera player rail / {variant}")
        scene.collection.children.link(collection)
        rail_collections[variant] = collection
        create_segment(collection, variant.title(), center_y, variant, materials)

    studio = bpy.data.collections.new("Studio / soft areas and orthographic camera")
    scene.collection.children.link(studio)
    axes, right, up, normal, roll_degrees = projection_axes()
    camera_data = bpy.data.cameras.new("Inspect-23 equivalent / 25.27 degree low pose")
    camera = bpy.data.objects.new("Camera / shared 147 ppu rail projection", camera_data)
    studio.objects.link(camera)
    scene.camera = camera
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = ORTHO_SCALE

    light_specs = (
        ("Large top-left softbox", (-3.4, -3.2, 5.4), (0.0, 0.0, 0.0), 560.0, 5.0, 3.8),
        ("Gentle camera-side fill", (3.4, -2.2, 3.0), (0.0, 0.0, 0.0), 220.0, 4.0, 3.0),
        ("Soft rear edge reflection", (-1.4, 2.5, 4.1), (0.0, 0.0, 0.0), 340.0, 3.8, 2.8),
    )
    lights = []
    for light_name, light_offset, target_offset, energy, size_x, size_y in light_specs:
        lights.append(add_area_light(studio, light_name, light_offset, target_offset, energy, size_x, size_y))

    backend, device_names, fallback_reason = configure_gpu(scene)
    gpu_enabled = backend != "CPU"
    scene.cycles.samples = GPU_SAMPLES if gpu_enabled else MAX_SAMPLES
    log(f"Blender {bpy.app.version_string}; backend={backend}; scene.cycles.device={scene.cycles.device}; "
        f"devices={device_names or ['CPU']}; samples={scene.cycles.samples}; denoise={scene.cycles.use_denoising}")
    if fallback_reason:
        log(f"GPU unavailable reason: {fallback_reason}")

    metadata_path = ASSET_DIR / "rail.json"
    prior_metadata = {}
    if set(variants_to_render) != {"front", "mid", "back"} and metadata_path.is_file():
        prior_metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    image_paths: dict[str, str] = dict(prior_metadata.get("assets", {}))
    prior_source = prior_metadata.get("source", {})
    render_details: dict[str, dict[str, object]] = dict(prior_source.get("renders", {}))
    section_by_name = dict(section_specs)
    for variant in variants_to_render:
        if variant not in image_paths:
            image_paths[variant] = f"rail-{variant}.png"
    for variant in variants_to_render:
        center_y = section_by_name[variant]
        for other_name, collection in rail_collections.items():
            for obj in collection.objects:
                obj.hide_render = other_name != variant

        center = Vector((0.0, center_y, 0.0))
        configure_camera(camera, camera_data, center_y, right, up, normal)
        for light, spec in zip(lights, light_specs):
            light_offset = Vector(spec[1])
            target_offset = Vector(spec[2])
            light.location = center + light_offset
            light.rotation_euler = (center + target_offset - light.location).to_track_quat("-Z", "Y").to_euler()

        final_path = ASSET_DIR / f"rail-{variant}.png"
        temp_path = TEMP_DIR / f"rail-{variant}.png"
        scene.render.filepath = str(temp_path)
        scene.cycles.samples = GPU_SAMPLES if gpu_enabled else MAX_SAMPLES
        start = time.perf_counter()
        try:
            result = bpy.ops.render.render(write_still=True)
            if "FINISHED" not in result:
                raise RuntimeError(f"Blender render returned {sorted(result)}")
        except Exception as error:
            if not gpu_enabled:
                raise
            log(f"GPU render failed on {variant}: {type(error).__name__}: {error}; retrying on CPU")
            gpu_enabled = False
            backend = "CPU"
            device_names = []
            fallback_reason = f"GPU render failed: {type(error).__name__}: {error}"
            scene.cycles.device = "CPU"
            scene.cycles.samples = MAX_SAMPLES
            if temp_path.exists():
                temp_path.unlink()
            result = bpy.ops.render.render(write_still=True)
            if "FINISHED" not in result:
                raise RuntimeError(f"CPU fallback render returned {sorted(result)}")
        if not temp_path.is_file() and gpu_enabled:
            log(f"GPU render on {variant} produced no PNG; retrying on CPU")
            gpu_enabled = False
            backend = "CPU"
            device_names = []
            fallback_reason = f"GPU render on {variant} produced no PNG"
            scene.cycles.device = "CPU"
            scene.cycles.samples = MAX_SAMPLES
            result = bpy.ops.render.render(write_still=True)
            if "FINISHED" not in result:
                raise RuntimeError(f"CPU fallback render returned {sorted(result)}")
        elapsed = time.perf_counter() - start
        if not temp_path.is_file():
            raise RuntimeError(f"Blender reported success without creating {temp_path}")
        temp_path.replace(final_path)
        image_paths[variant] = final_path.name
        render_details[variant] = {
            "seconds": round(elapsed, 3),
            "device": scene.cycles.device,
            "samples": scene.cycles.samples,
            "backend": backend,
            "devices": device_names or ["CPU"],
            "executedSourceSha256": source_hash,
        }
        log(f"Rendered {image_paths[variant]} in {elapsed:.3f}s at {scene.cycles.samples} samples using {scene.cycles.device}")

    for collection in rail_collections.values():
        for obj in collection.objects:
            obj.hide_render = False
    configure_camera(camera, camera_data, 0.0, right, up, normal)
    for light, spec in zip(lights, light_specs):
        light.location = Vector(spec[1])
        light.rotation_euler = (Vector(spec[2]) - light.location).to_track_quat("-Z", "Y").to_euler()

    # Keep the saved source file ready to re-render the front section, while all
    # three contiguous rail sections and the reusable studio rig stay present.
    scene.render.filepath = "//../src/assets/style/camera-player/rail/rail-front.png"
    scene.render.resolution_x = RESOLUTION[0]
    scene.render.resolution_y = RESOLUTION[1]
    scene.render.resolution_percentage = 100
    scene.cycles.device = "GPU" if gpu_enabled else "CPU"
    scene.cycles.samples = GPU_SAMPLES if gpu_enabled else MAX_SAMPLES
    scene.cycles.use_denoising = True
    bpy.context.scene.render.filepath = "//../src/assets/style/camera-player/rail/rail-front.png"
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH), check_existing=False)

    label = label_quad(axes)
    metadata = {
        "schemaVersion": 1,
        "assets": {variant: image_paths.get(variant, f"rail-{variant}.png") for variant, _ in section_specs},
        "axes": {key: [round(value, 6) for value in vector] for key, vector in axes.items()},
        "res": list(RESOLUTION),
        "ppu": PPU,
        "origin": list(ORIGIN),
        "pitch": PITCH,
        "label": label,
        "projection": {
            "source": "white case inspect-23 cover quad",
            "lowPoseDegrees": 25.27,
            "screenRollDegrees": round(roll_degrees, 9),
            "orthographicScale": round(ORTHO_SCALE, 9),
            "cameraRight": [round(value, 9) for value in right],
            "cameraUp": [round(value, 9) for value in up],
            "cameraNormal": [round(value, 9) for value in normal],
        },
        "pitchAxis": "y",
        "source": {
            "blenderVersion": bpy.app.version_string,
            "script": str(SCRIPT_PATH.relative_to(ROOT)).replace("\\", "/"),
            "reproducibleSourceSha256": hashlib.sha256(SCRIPT_PATH.read_bytes()).hexdigest(),
            "blend": str(BLEND_PATH.relative_to(ROOT)).replace("\\", "/"),
            "engine": "CYCLES",
            "backend": backend,
            "devices": device_names or ["CPU"],
            "effectiveBackend": backend,
            "physicalGpuCount": len({device.split(" (", 1)[0] for device in device_names}),
            "selectedBackendDevices": device_names or ["CPU"],
            "deviceSelectionNote": (
                "Only Blender devices whose type matches the selected backend are enabled."
                if backend != "CPU" else "No compatible GPU backend was available; rendering used CPU."
            ),
            "sceneDevice": scene.cycles.device,
            "samples": scene.cycles.samples,
            "denoising": scene.cycles.use_denoising,
            "transparentRGBA": True,
            "renders": render_details,
            "fallbackReason": fallback_reason,
            "renderedVariants": variants_to_render,
            "executedSourceSha256": source_hash,
            "reproducibleSourceSha256": source_hash,
            "executionRecordNote": (
                "The manifest retains per-image device and sample facts when only a subset was rendered. "
                "The source hash identifies this executed script revision."
            ),
        },
    }
    metadata_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    log(f"Saved source {BLEND_PATH.relative_to(ROOT)} and metadata {metadata_path.relative_to(ROOT)}")
    log(f"Final renderer backend={backend}; devices={device_names or ['CPU']}; scene.cycles.device={scene.cycles.device}")


if __name__ == "__main__":
    main()
