"""Build a neutral, high-detail Punk cassette case reference in native Blender units.

Coordinates are Blender Z-up: X is left/right, Y is depth (front is negative),
and Z is vertical. The PNG lighting is not baked into the model; materials are
intentionally neutral so the app's material layer can supply the final skin.
"""

import bpy
import bmesh
from bisect import bisect_right
import hashlib
import json
import math
import os
from collections import defaultdict
from mathutils import Euler, Vector


ART_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(ART_DIR)
CASE_JSON = os.path.join(PROJECT_ROOT, "src", "assets", "style", "case", "white", "case.json")
BLEND_PATH = os.path.join(ART_DIR, "punk-reference-case.blend")
GLB_PATH = os.path.join(PROJECT_ROOT, "public", "assets", "punk-reference-case.glb")
ASSET_VERSION_PATH = os.path.join(PROJECT_ROOT, "src", "punk-case-asset.ts")

FRONT_ART_Y = -0.105
BODY_X = (-2.0, 2.0)
BODY_Z = (0.0, 3.5)
BODY_BACK_Y = 0.18
FRAME_FRONT_Y = -0.16
FRAME_DEPTH = 0.33
FRAME_SIDE_WIDTH = 0.15
FRAME_SIDE_Z = (0.15, 3.35)
FRAME_CROSSBAR_WIDTH_X = 4.0
TOP_GROOVE_PATH_XZ = ((-1.69, 3.43), (-0.405, 3.43), (-0.305, 3.468), (0.90, 3.468))
TOP_GROOVE_Y = -0.155
TOP_GROOVE_CUT_DEPTH_Y = 0.018
TOP_GROOVE_CUT_WIDTH = 0.009
TOP_GROOVE_SEGMENT_OVERLAP = 0.004
TOP_GROOVE_INLAY_Y = -0.156
TOP_GROOVE_INLAY_DEPTH_Y = 0.004
TOP_GROOVE_INLAY_WIDTH = 0.0075
GLASS_X = (-1.84, 1.84)
GLASS_Z = (0.16, 3.34)
GLASS_FRONT_Y = -0.178
GLASS_BACK_Y = -0.160
SPINE_FRONT_Y = 0.015
SPINE_BACK_Y = 0.040
LABEL_FRONT_Y = -0.205
LABEL_BACK_Y = -0.195
HERO_PPU = 210.0  # The hero mapping uses the source's native 210 px/unit calibration.

# Source-traced center path from hero-clear.png. Each item contains the four
# cubic Bezier control points (native X/Z), copied here so builds do not read
# temporary audit data.
EMBLEM_BEZIER_SEGMENTS_NATIVE_XZ = (
    ((1.457619, 2.787143), (1.525780, 2.787143), (1.567381, 2.735188), (1.567381, 2.671429)),
    ((1.567381, 2.671429), (1.567381, 2.611064), (1.496928, 2.561213), (1.457619, 2.521905)),
    ((1.457619, 2.521905), (1.413397, 2.477682), (1.347619, 2.431836), (1.347619, 2.364286)),
    ((1.347619, 2.364286), (1.347619, 2.308540), (1.397123, 2.246190), (1.455714, 2.246190)),
    ((1.455714, 2.246190), (1.513594, 2.246190), (1.564762, 2.311203), (1.564762, 2.364286)),
    ((1.564762, 2.364286), (1.564762, 2.434994), (1.502957, 2.476567), (1.457619, 2.521905)),
    ((1.457619, 2.521905), (1.420655, 2.558869), (1.348095, 2.610903), (1.348095, 2.671429)),
    ((1.348095, 2.671429), (1.348095, 2.733570), (1.390995, 2.787143), (1.457619, 2.787143)),
)
EMBLEM_SOURCE_PATH_LENGTH_NATIVE = 1.483678
EMBLEM_SOURCE_PATH_LENGTH_HERO_PX = 311.572
EMBLEM_WHITE_VISIBLE_REGIONS_S = (
    ("top_crown", 0.956228, 1.043360),
    ("front_diagonal_whole", 0.130767, 0.368985),
    ("back_lower_shoulder_visible", 0.632334, 0.725622),
    ("back_upper_shoulder_visible", 0.776679, 0.868717),
    ("bottom_crown_inferred_axis", 0.449981, 0.552099),
)
EMBLEM_FRONT_TRANSVERSE_SEAMS_S = (0.197013, 0.292095)
EMBLEM_BOTTOM_CROWN_OFFSET_W = 0.011905
EMBLEM_BOTTOM_CROWN_AXIS_PIXEL_Y_INFERRED = 395.8
EMBLEM_BOTTOM_CROWN_OBSERVED_PIXEL_Y = (386.5, 400.0)
EMBLEM_TUBE_CENTER_Y = -0.1985
EMBLEM_CROSSING_DEPTH = 0.010
EMBLEM_MAX_TWIST_RADIANS = 0.18
EMBLEM_BARE_TUBE_WIDTH = 0.038
EMBLEM_WHITE_TUBE_WIDTH = 0.064
EMBLEM_TUBE_THICKNESS = 0.012
EMBLEM_TUBE_SECTION_POINTS = 32
EMBLEM_CORE_DIAMETER = 0.0052
EMBLEM_WHITE_SLEEVE_WALL = 0.001
EMBLEM_FRONT_SLEEVE_SLOT_WIDTH = 0.0065
EMBLEM_FRONT_SEAM_GAP_S = 0.0055
EMBLEM_SEAM_END_ROUNDING_NATIVE = 0.0020
EMBLEM_BOTTOM_WINDOW_ROLL_RADIANS = math.pi * 0.24
EMBLEM_PATH_RING_SAMPLES = 512
EMBLEM_SLEEVE_RING_SPACING = 0.0032
EMBLEM_SLEEVE_ANGLE_SAMPLES = 32
EMBLEM_CORE_CIRCUMFERENCE_POINTS = 16
EMBLEM_WIDTH_TRANSITION_S = 0.018
EMBLEM_CROSSING_TWIST_GUARD_S = 0.065
EMBLEM_REQUIRED_GLASS_CLEARANCE = 0.0005

PART_OBJECTS = []
MATERIALS = {}


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in list(bpy.data.collections):
        if collection.name != "Collection":
            bpy.data.collections.remove(collection)


def make_material(name, color, metallic=0.0, roughness=0.32, transmission=0.0):
    mat = bpy.data.materials.new(name=name)
    mat.diffuse_color = color
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = color
    shader.inputs["Metallic"].default_value = metallic
    shader.inputs["Roughness"].default_value = roughness
    if "Transmission" in shader.inputs:
        shader.inputs["Transmission"].default_value = transmission
    if "IOR" in shader.inputs:
        shader.inputs["IOR"].default_value = 1.46
    return mat


def setup_materials():
    MATERIALS["white"] = make_material("Punk | neutral warm white polymer", (0.82, 0.82, 0.78, 1.0), 0.12, 0.28)
    MATERIALS["trim"] = make_material("Punk | pale neutral metal trim", (0.50, 0.49, 0.46, 1.0), 0.62, 0.25)
    MATERIALS["emblem"] = make_material("Punk | raised pearl white emblem", (0.72, 0.74, 0.75, 1.0), 0.18, 0.27)
    MATERIALS["silver"] = make_material("Punk | brushed fastener metal", (0.52, 0.56, 0.58, 1.0), 0.78, 0.22)
    MATERIALS["dark"] = make_material("Punk | graphite ink and vent recess", (0.025, 0.029, 0.03, 1.0), 0.12, 0.42)
    MATERIALS["orange"] = make_material("Punk | restrained orange index accent", (0.78, 0.37, 0.22, 1.0), 0.10, 0.38)
    MATERIALS["optics"] = make_material("Punk | clear flexible emblem tube", (0.96, 0.98, 0.98, 1.0), 0.0, 0.12, 0.995)
    MATERIALS["glass"] = make_material("Punk | clear solid cover glass", (0.91, 0.96, 0.95, 1.0), 0.0, 0.12, 0.94)
    MATERIALS["ink-light"] = make_material("Punk | low contrast case lettering", (0.64, 0.65, 0.62, 1.0), 0.12, 0.4)


def tag_part(obj, part, detail):
    obj["casePart"] = part
    obj["minDetail"] = detail
    if part == "optics" or (part == "trim" and obj.name.startswith(("punk_trim_album_registration_", "punk_trim_corner_"))):
        obj["assemblyPart"] = "cover"
    PART_OBJECTS.append(obj)
    return obj


def apply_bevel(obj, width, segments=2, harden_normals=False, face_strength_mode="FSTR_NONE"):
    if width <= 0:
        return
    mod = obj.modifiers.new(name="Fine molded edge", type="BEVEL")
    mod.width = width
    mod.segments = segments
    mod.limit_method = "ANGLE"
    mod.harden_normals = harden_normals
    mod.face_strength_mode = face_strength_mode
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=mod.name)


def add_box(name, part, detail, location, dimensions, material, bevel=0.0, rotation=(0.0, 0.0, 0.0)):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0.0, 0.0, 0.0))
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    obj.location = location
    obj.rotation_euler = rotation
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if material:
        obj.data.materials.append(material)
    if bevel:
        apply_bevel(obj, min(bevel, min(dimensions) * 0.42), 2)
    return tag_part(obj, part, detail)


def make_mesh(name, part, detail, vertices, faces, material, smooth=False):
    mesh = bpy.data.meshes.new(name + "Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.validate(verbose=False)
    mesh.update()
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    if material:
        mesh.materials.append(material)
    if smooth:
        for polygon in mesh.polygons:
            polygon.use_smooth = True
    return tag_part(obj, part, detail)


def add_cylinder_y(name, part, detail, x, y, z, radius, depth, material, vertices=48, bevel=0.0):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices,
        radius=radius,
        depth=depth,
        location=(x, y, z),
        rotation=(math.pi / 2.0, 0.0, 0.0),
    )
    obj = bpy.context.object
    obj.name = name
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if material:
        obj.data.materials.append(material)
    if bevel:
        apply_bevel(obj, min(bevel, depth * 0.3), 2)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return tag_part(obj, part, detail)


def apply_difference(target, cutter, label):
    mod = target.modifiers.new(name=label, type="BOOLEAN")
    mod.operation = "DIFFERENCE"
    mod.solver = "EXACT"
    mod.object = cutter
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(cutter, do_unlink=True)


def add_grooved_box(name, part, detail, location, dimensions, material, grooves, bevel=0.0):
    """Create a molded rail with shallow boolean channels on its front face."""
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0.0, 0.0, 0.0))
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    obj.location = location
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if material:
        obj.data.materials.append(material)
    if bevel:
        apply_bevel(obj, min(bevel, min(dimensions) * 0.42), 6, harden_normals=True, face_strength_mode="FSTR_AFFECTED")
    for index, groove in enumerate(grooves, 1):
        if len(groove) == 2:
            cut_location, cut_dimensions = groove
            cut_rotation = (0.0, 0.0, 0.0)
        else:
            cut_location, cut_dimensions, cut_rotation = groove
        bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0.0, 0.0, 0.0))
        cutter = bpy.context.object
        cutter.name = "temporary_frame_groove_cutter"
        cutter.dimensions = cut_dimensions
        cutter.location = cut_location
        cutter.rotation_euler = cut_rotation
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        apply_difference(obj, cutter, "Molded frame groove %d" % index)
    prepare_rail_normals(obj)
    return tag_part(obj, part, detail)


def prepare_rail_normals(obj):
    """Smooth six-step rail chamfers while retaining hardened plane normals."""
    mesh = obj.data
    mesh.use_auto_smooth = True
    mesh.auto_smooth_angle = math.radians(30.0)
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    weighted = obj.modifiers.new(name="Weighted rail plane normals", type="WEIGHTED_NORMAL")
    weighted.mode = "FACE_AREA"
    weighted.weight = 50
    weighted.keep_sharp = True
    weighted.use_face_influence = True
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=weighted.name)
    mesh.update()


def rail_normal_quality(obj):
    mesh = obj.data
    mesh.update()
    mesh.calc_normals_split()
    planar_max_deviation = 0.0
    broad_planar_max_deviation = 0.0
    bevel_shared_max_difference = 0.0
    bevel_shared_edge_count = 0
    edge_faces = defaultdict(list)
    loop_by_face_vertex = {}

    for polygon in mesh.polygons:
        vertices = list(polygon.vertices)
        for loop_index in polygon.loop_indices:
            loop_by_face_vertex[(polygon.index, mesh.loops[loop_index].vertex_index)] = mesh.loops[loop_index].normal.copy()
        axis = max(range(3), key=lambda index: abs(polygon.normal[index]))
        if abs(polygon.normal[axis]) >= 0.999 and polygon.area > 0.001:
            expected = [0.0, 0.0, 0.0]
            expected[axis] = 1.0 if polygon.normal[axis] >= 0.0 else -1.0
            for loop_index in polygon.loop_indices:
                actual = mesh.loops[loop_index].normal
                deviation = math.degrees(math.acos(max(-1.0, min(1.0, actual.dot(type(actual)(expected))))))
                planar_max_deviation = max(planar_max_deviation, deviation)
                if polygon.area >= 0.1:
                    broad_planar_max_deviation = max(broad_planar_max_deviation, deviation)
        for index, vertex_a in enumerate(vertices):
            vertex_b = vertices[(index + 1) % len(vertices)]
            edge_faces[tuple(sorted((vertex_a, vertex_b)))].append(polygon.index)

    for edge_vertices, face_indices in edge_faces.items():
        if len(face_indices) != 2:
            continue
        face_a, face_b = (mesh.polygons[index] for index in face_indices)
        normal_a = face_a.normal
        normal_b = face_b.normal
        axis_a = max(abs(normal_a[0]), abs(normal_a[1]), abs(normal_a[2])) >= 0.999
        axis_b = max(abs(normal_b[0]), abs(normal_b[1]), abs(normal_b[2])) >= 0.999
        face_angle = math.degrees(normal_a.angle(normal_b))
        if axis_a or axis_b or face_angle < 2.0 or face_angle > 30.0:
            continue
        for vertex_index in edge_vertices:
            loop_a = loop_by_face_vertex[(face_a.index, vertex_index)]
            loop_b = loop_by_face_vertex[(face_b.index, vertex_index)]
            loop_angle = math.degrees(loop_a.angle(loop_b))
            bevel_shared_max_difference = max(bevel_shared_max_difference, loop_angle)
            bevel_shared_edge_count += 1

    return {
        "has_custom_normals": mesh.has_custom_normals,
        "planar_max_deviation_degrees": planar_max_deviation,
        "broad_planar_max_deviation_degrees": broad_planar_max_deviation,
        "bevel_shared_normal_max_difference_degrees": bevel_shared_max_difference,
        "bevel_shared_edge_loop_samples": bevel_shared_edge_count,
    }


def path_groove_cutters(points, center_y, depth_y, width, segment_overlap):
    cutters = []
    for point_a, point_b in zip(points, points[1:]):
        dx = point_b[0] - point_a[0]
        dz = point_b[1] - point_a[1]
        length = math.sqrt(dx * dx + dz * dz)
        if length <= 1.0e-8:
            raise ValueError("Top groove path contains a zero-length segment")
        angle_y = math.atan2(-dz, dx)
        cutters.append((
            ((point_a[0] + point_b[0]) * 0.5, center_y, (point_a[1] + point_b[1]) * 0.5),
            (length + segment_overlap, depth_y, width),
            (0.0, angle_y, 0.0),
        ))
    return cutters


def add_polyline_inlay(name, part, detail, points, center_y, depth_y, width, material):
    """Build one continuous shallow inlay mesh around an X/Z polyline."""
    segment_normals = []
    for point_a, point_b in zip(points, points[1:]):
        dx = point_b[0] - point_a[0]
        dz = point_b[1] - point_a[1]
        length = max(math.sqrt(dx * dx + dz * dz), 1.0e-8)
        segment_normals.append((-dz / length, dx / length))

    half_width = width * 0.5
    left_edge = []
    right_edge = []
    for index, point in enumerate(points):
        if index == 0:
            miter = segment_normals[0]
            scale = half_width
        elif index == len(points) - 1:
            miter = segment_normals[-1]
            scale = half_width
        else:
            normal_a = segment_normals[index - 1]
            normal_b = segment_normals[index]
            sum_x = normal_a[0] + normal_b[0]
            sum_z = normal_a[1] + normal_b[1]
            sum_len = max(math.sqrt(sum_x * sum_x + sum_z * sum_z), 1.0e-8)
            miter = (sum_x / sum_len, sum_z / sum_len)
            projection = miter[0] * normal_b[0] + miter[1] * normal_b[1]
            scale = half_width / max(projection, 1.0e-6)
        left_edge.append((point[0] + miter[0] * scale, point[1] + miter[1] * scale))
        right_edge.append((point[0] - miter[0] * scale, point[1] - miter[1] * scale))

    ring = []
    for left, right in zip(left_edge, right_edge):
        ring.extend((left, right))
    front_y = center_y - depth_y * 0.5
    back_y = center_y + depth_y * 0.5
    vertices = [(x, front_y, z) for x, z in ring] + [(x, back_y, z) for x, z in ring]
    point_count = len(points)

    def vertex_index(layer, point_index, side):
        return layer * point_count * 2 + point_index * 2 + side

    faces = []
    for index in range(point_count - 1):
        faces.append((vertex_index(0, index, 0), vertex_index(0, index + 1, 0), vertex_index(0, index + 1, 1), vertex_index(0, index, 1)))
        faces.append((vertex_index(1, index, 1), vertex_index(1, index + 1, 1), vertex_index(1, index + 1, 0), vertex_index(1, index, 0)))
        faces.append((vertex_index(0, index, 0), vertex_index(1, index, 0), vertex_index(1, index + 1, 0), vertex_index(0, index + 1, 0)))
        faces.append((vertex_index(0, index + 1, 1), vertex_index(1, index + 1, 1), vertex_index(1, index, 1), vertex_index(0, index, 1)))
    faces.append((vertex_index(0, 0, 1), vertex_index(1, 0, 1), vertex_index(1, 0, 0), vertex_index(0, 0, 0)))
    last = point_count - 1
    faces.append((vertex_index(0, last, 0), vertex_index(1, last, 0), vertex_index(1, last, 1), vertex_index(0, last, 1)))
    return make_mesh(name, part, detail, vertices, faces, material, smooth=False)


def pixel_bounds_to_case(points, origin, ppu):
    xy = [(float(p[0]), float(p[1])) for p in points]
    xs = [(x - origin[0]) / ppu for x, _ in xy]
    zs = [(origin[1] - y) / ppu for _, y in xy]
    return min(xs), max(xs), min(zs), max(zs)


def load_source_bounds():
    with open(CASE_JSON, "r", encoding="utf-8") as source_file:
        metadata = json.load(source_file)
    hero = metadata["hero"]
    cover = pixel_bounds_to_case(hero["cover"], hero["origin"], HERO_PPU)
    label = pixel_bounds_to_case(hero["label"], hero["origin"], HERO_PPU)
    return cover, label


def rounded_section(width, thickness, radius, corner_steps=3):
    """Return a rounded rectangular w/v profile for molded ribbon details."""
    half_w = width * 0.5
    half_v = thickness * 0.5
    radius = min(radius, half_w * 0.48, half_v * 0.82)
    corners = (
        (half_w - radius, half_v - radius, 0.0),
        (-half_w + radius, half_v - radius, 90.0),
        (-half_w + radius, -half_v + radius, 180.0),
        (half_w - radius, -half_v + radius, 270.0),
    )
    profile = []
    for corner_w, corner_v, start_degrees in corners:
        for step in range(corner_steps + 1):
            angle = math.radians(start_degrees + 90.0 * step / corner_steps)
            profile.append((corner_w + radius * math.cos(angle), corner_v + radius * math.sin(angle)))
    return profile


EMBLEM_PATH_CACHE = None


def emblem_bezier(segment, t):
    u = 1.0 - t
    weights = (u ** 3, 3.0 * u * u * t, 3.0 * u * t * t, t ** 3)
    point = tuple(sum(control[axis] * weight for control, weight in zip(segment, weights)) for axis in (0, 1))
    derivative = tuple(3.0 * (u * u * (segment[1][axis] - segment[0][axis]) +
                               2.0 * u * t * (segment[2][axis] - segment[1][axis]) +
                               t * t * (segment[3][axis] - segment[2][axis])) for axis in (0, 1))
    return point, derivative


def emblem_path_table():
    global EMBLEM_PATH_CACHE
    if EMBLEM_PATH_CACHE is not None:
        return EMBLEM_PATH_CACHE
    rows, distances, segment_stations = [], [], [0.0]
    length, previous = 0.0, None
    for segment_index, segment in enumerate(EMBLEM_BEZIER_SEGMENTS_NATIVE_XZ):
        for step in range(257):
            if segment_index and step == 0:
                continue
            t = step / 256.0
            point, _ = emblem_bezier(segment, t)
            if previous is not None:
                length += math.hypot(point[0] - previous[0], point[1] - previous[1])
            rows.append((segment_index, t))
            distances.append(length)
            previous = point
        segment_stations.append(length)
    EMBLEM_PATH_CACHE = {'rows': rows, 'stations': [d / length for d in distances],
                         'segment_stations': [d / length for d in segment_stations], 'length': length}
    return EMBLEM_PATH_CACHE


def emblem_source_point(s):
    table = emblem_path_table()
    s %= 1.0
    right = min(max(bisect_right(table['stations'], s), 1), len(table['rows']) - 1)
    left = right - 1
    ratio = (s - table['stations'][left]) / max(table['stations'][right] - table['stations'][left], 1.0e-12)
    segment_a, ta = table['rows'][left]
    segment_b, tb = table['rows'][right]
    t = ta + (tb - ta) * ratio if segment_a == segment_b else tb * ratio
    return emblem_bezier(EMBLEM_BEZIER_SEGMENTS_NATIVE_XZ[segment_b], t)


def emblem_wrapped_distance(a, b):
    return (a - b + 0.5) % 1.0 - 0.5


def emblem_bump(s, station, radius_s):
    d = emblem_wrapped_distance(s, station) / radius_s
    return (1.0 - d * d) ** 2 if abs(d) < 1.0 else 0.0


def emblem_depth(s):
    table = emblem_path_table()
    radius_s = 0.09 / table['length']
    # SOURCE right-up/left-down branch is in front, in negative native Y.
    return EMBLEM_TUBE_CENTER_Y + EMBLEM_CROSSING_DEPTH * (
        emblem_bump(s, table['segment_stations'][6], radius_s) -
        emblem_bump(s, table['segment_stations'][2], radius_s))


def emblem_frame(s):
    point, derivative = emblem_source_point(s)
    dlen = max(math.hypot(*derivative), 1.0e-12)
    slope = (emblem_depth(s + 1.0e-5) - emblem_depth(s - 1.0e-5)) / (2.0e-5 * emblem_path_table()['length'])
    tangent = Vector((derivative[0] / dlen, slope, derivative[1] / dlen)).normalized()
    normal = Vector((-derivative[1] / dlen, 0.0, derivative[0] / dlen))
    back = normal.cross(tangent).normalized()
    stations = emblem_path_table()['segment_stations']
    guard = max(emblem_bump(s, stations[index], EMBLEM_CROSSING_TWIST_GUARD_S) for index in (2, 6))
    twist = EMBLEM_MAX_TWIST_RADIANS * math.sin(4.0 * math.pi * s) * (1.0 - guard)
    w = normal * math.cos(twist) + back * math.sin(twist)
    v = -normal * math.sin(twist) + back * math.cos(twist)
    return Vector((point[0], emblem_depth(s), point[1])), w, v


def emblem_region_value(s, start, end):
    s %= 1.0
    q = s + 1.0 if s < start else s
    if start <= q <= end:
        return 1.0
    distance = min(abs(emblem_wrapped_distance(s, start)), abs(emblem_wrapped_distance(s, end)))
    t = min(distance / EMBLEM_WIDTH_TRANSITION_S, 1.0)
    return 1.0 - t * t * (3.0 - 2.0 * t)


def emblem_tube_width(s):
    coverage = max(emblem_region_value(s, start, end) for _, start, end in EMBLEM_WHITE_VISIBLE_REGIONS_S)
    return EMBLEM_BARE_TUBE_WIDTH + (EMBLEM_WHITE_TUBE_WIDTH - EMBLEM_BARE_TUBE_WIDTH) * coverage


def emblem_bottom_offset(s):
    start, end = EMBLEM_WHITE_VISIBLE_REGIONS_S[-1][1:]
    q = s % 1.0
    if not start <= q <= end:
        return 0.0
    return EMBLEM_BOTTOM_CROWN_OFFSET_W * math.sin(math.pi * (q - start) / (end - start)) ** 2


def emblem_bottom_window_roll(s, start, end):
    phase = max(0.0, min(1.0, (s - start) / (end - start)))
    # Source shows a longer lower-left orange fragment and a short upper-right
    # fragment. This asymmetric opening turn is an estimate; the core stays on
    # the source-traced path, including its explicitly inferred hidden closure.
    phase -= 0.15 * math.sin(math.pi * phase)
    return EMBLEM_BOTTOM_WINDOW_ROLL_RADIANS * math.sin(math.pi * phase) ** 2


def add_emblem_closed_tube(name, part, section_points, section):
    vertices, faces = [], []
    rings = EMBLEM_PATH_RING_SAMPLES
    for ring in range(rings):
        s = ring / rings
        center, w, v = emblem_frame(s)
        for edge in range(section_points):
            offset_w, offset_v = section(s, 2.0 * math.pi * edge / section_points)
            vertices.append(tuple(center + w * offset_w + v * offset_v))
    for ring in range(rings):
        next_ring = (ring + 1) % rings
        for edge in range(section_points):
            next_edge = (edge + 1) % section_points
            faces.append((ring * section_points + edge, next_ring * section_points + edge,
                          next_ring * section_points + next_edge, ring * section_points + next_edge))
    obj = make_mesh(name, part, 'medium', vertices, faces, MATERIALS[part if part == 'optics' else 'orange'], smooth=True)
    obj['assemblyPart'] = 'cover'
    return obj


def add_emblem_slotted_sleeve(name, start, end, bottom=False, round_start=False, round_end=False):
    span = (end - start) * emblem_path_table()['length']
    ring_spacing = EMBLEM_SLEEVE_RING_SPACING * (0.75 if bottom else 1.0)
    ring_steps = max(6, math.ceil(span / ring_spacing))
    angular_steps = EMBLEM_SLEEVE_ANGLE_SAMPLES
    columns = angular_steps + 1
    inner_a, inner_b = EMBLEM_WHITE_TUBE_WIDTH * 0.5, EMBLEM_TUBE_THICKNESS * 0.5
    outer_a, outer_b = inner_a + EMBLEM_WHITE_SLEEVE_WALL, inner_b + EMBLEM_WHITE_SLEEVE_WALL
    vertices = []
    for ring in range(ring_steps + 1):
        s = start + (end - start) * ring / ring_steps
        center, w, v = emblem_frame(s)
        offset_w = emblem_bottom_offset(s) if bottom else 0.0
        slot_left = math.asin(max(-0.95, min(0.95, (-EMBLEM_FRONT_SLEEVE_SLOT_WIDTH * 0.5 - offset_w) / inner_a)))
        slot_right = math.asin(max(-0.95, min(0.95, (EMBLEM_FRONT_SLEEVE_SLOT_WIDTH * 0.5 - offset_w) / inner_a)))
        # Bottom channel orientation is reconstructed, not observed geometry.
        crown_roll = emblem_bottom_window_roll(s, start, end) if bottom else 0.0
        rounding_blend = 0.006
        start_weight = max(0.0, 1.0 - (s - start) * emblem_path_table()['length'] / rounding_blend) ** 2 if round_start else 0.0
        end_weight = max(0.0, 1.0 - (end - s) * emblem_path_table()['length'] / rounding_blend) ** 2 if round_end else 0.0
        for a, b in ((outer_a, outer_b), (inner_a, inner_b)):
            for column in range(columns):
                angle = slot_right + crown_roll + (2.0 * math.pi + slot_left - slot_right) * column / angular_steps
                # Rounded physical cut ends: retract the broad side edges,
                # preserving the central opening and the measured seam station.
                inset_s = EMBLEM_SEAM_END_ROUNDING_NATIVE / emblem_path_table()['length'] * (1.0 - abs(math.cos(angle))) * (start_weight - end_weight)
                sample_center, sample_w, sample_v = emblem_frame(s + inset_s) if abs(inset_s) > 1.0e-12 else (center, w, v)
                vertices.append(tuple(sample_center + sample_w * (offset_w + a * math.sin(angle)) - sample_v * (b * math.cos(angle))))
    stride = columns * 2
    def vi(ring, layer, column):
        return ring * stride + layer * columns + column
    faces = []
    for ring in range(ring_steps):
        for column in range(angular_steps):
            faces.append((vi(ring, 0, column), vi(ring + 1, 0, column), vi(ring + 1, 0, column + 1), vi(ring, 0, column + 1)))
            faces.append((vi(ring, 1, column + 1), vi(ring + 1, 1, column + 1), vi(ring + 1, 1, column), vi(ring, 1, column)))
        for column in (0, angular_steps):
            faces.append((vi(ring, 0, column), vi(ring, 1, column), vi(ring + 1, 1, column), vi(ring + 1, 0, column)))
    for ring in (0, ring_steps):
        for column in range(angular_steps):
            faces.append((vi(ring, 0, column), vi(ring, 0, column + 1), vi(ring, 1, column + 1), vi(ring, 1, column)))
    obj = make_mesh(name, 'emblem', 'medium', vertices, faces, MATERIALS['emblem'], smooth=True)
    obj['assemblyPart'] = 'cover'
    obj['surfaceRole'] = 'local_slotted_white_tube_wrap'
    obj['sourceArclengthStart'], obj['sourceArclengthEnd'] = start, end
    obj['roundedSeamStart'], obj['roundedSeamEnd'] = round_start, round_end
    obj.data.use_auto_smooth = True
    obj.data.auto_smooth_angle = math.radians(40.0)
    return obj


def add_source_tube_emblem():
    created = []
    tube = add_emblem_closed_tube('punk_optics_continuous_source_tube', 'optics', EMBLEM_TUBE_SECTION_POINTS,
                                 lambda s, angle: (emblem_bottom_offset(s) + emblem_tube_width(s) * 0.5 * math.sin(angle),
                                                   -EMBLEM_TUBE_THICKNESS * 0.5 * math.cos(angle)))
    tube['surfaceRole'] = 'continuous_clear_soft_tube'
    tube['sourceTrace'] = 'white/hero-clear.png visible orange centerline; hidden bottom axis inferred'
    created.append(tube)
    core = add_emblem_closed_tube('punk_accent_continuous_internal_orange_core', 'accent', EMBLEM_CORE_CIRCUMFERENCE_POINTS,
                                 lambda s, angle: (EMBLEM_CORE_DIAMETER * 0.5 * math.sin(angle),
                                                   -EMBLEM_CORE_DIAMETER * 0.5 * math.cos(angle)))
    core['surfaceRole'] = 'continuous_internal_round_orange_core'
    core['coreVisibility'] = 'continuous geometry; rear crossing and bottom wrap can occlude the core'
    created.append(core)
    sleeve_pieces = []
    for name, start, end in EMBLEM_WHITE_VISIBLE_REGIONS_S:
        cuts = [(start, end)]
        if name == 'front_diagonal_whole':
            cuts, cursor = [], start
            for seam in EMBLEM_FRONT_TRANSVERSE_SEAMS_S:
                cuts.append((cursor, seam - EMBLEM_FRONT_SEAM_GAP_S * 0.5))
                cursor = seam + EMBLEM_FRONT_SEAM_GAP_S * 0.5
            cuts.append((cursor, end))
        for index, (a, b) in enumerate(cuts):
            is_front = name == 'front_diagonal_whole'
            obj = add_emblem_slotted_sleeve('punk_emblem_%s_%02d' % (name, index + 1), a, b, name.startswith('bottom_crown'),
                                            round_start=is_front and index > 0,
                                            round_end=is_front and index < len(cuts) - 1)
            created.append(obj)
            sleeve_pieces.append(obj)
    points = [obj.matrix_world @ vertex.co for obj in created for vertex in obj.data.vertices]
    y_max = max(point.y for point in points)
    if y_max > GLASS_FRONT_Y - EMBLEM_REQUIRED_GLASS_CLEARANCE + 1.0e-7:
        raise RuntimeError('Emblem intersects front glass: Ymax=%.8f, limit=%.8f' %
                           (y_max, GLASS_FRONT_Y - EMBLEM_REQUIRED_GLASS_CLEARANCE))
    table = emblem_path_table()
    front_s, back_s = table['segment_stations'][2], table['segment_stations'][6]
    front_center, _, front_v = emblem_frame(front_s)
    back_center, _, back_v = emblem_frame(back_s)
    half_white = EMBLEM_TUBE_THICKNESS * 0.5 + EMBLEM_WHITE_SLEEVE_WALL
    clearance = (back_center.y - abs(back_v.y) * half_white) - (front_center.y + abs(front_v.y) * half_white)
    if clearance < 0.003:
        raise RuntimeError('Source crossover surface clearance too small: %.8f' % clearance)
    # Independent visible source-orange anchors exclude concealed bottom/crossover.
    # Distances assess the source trace only, not refractive rendered similarity.
    anchors = ((806.1,282.2),(829.12,302),(829.12,306),(825.14,318),(818,326),(813.58,330),
               (806,338),(802,342),(798.14,346),(790.5,354),(783,370),(783,374),(785.86,382),
               (788.78,386),(822.4,386),(825.97,382),(828.5,374),(828.62,370),(825.3,358),
               (818.5,350),(814.62,346),(797.63,330),(794.14,326),(787.42,318),(783,306),
               (784.12,298),(788.69,290))
    projected = []
    for index in range(8192):
        point, _ = emblem_source_point(index / 8192)
        projected.append((500.0 + HERO_PPU * point[0], 867.5 - HERO_PPU * point[1]))
    errors = [min(math.hypot(x - px, y - py) for px, py in projected) for x, y in anchors]
    return {
        'model_version': 4,
        'construction': 'source-traced transparent flattened tube, internal round core, local slotted white wraps',
        'source_trace': 'src/assets/style/case/white/hero-clear.png visible orange anchors; hidden bottom crown axis inferred',
        'source_bezier_native_xz': EMBLEM_BEZIER_SEGMENTS_NATIVE_XZ,
        'path_length_native': table['length'], 'path_length_hero_px': table['length'] * HERO_PPU,
        'source_visible_anchor_count': len(anchors), 'source_visible_anchor_max_error_px': max(errors),
        'source_visible_anchor_rms_error_px': math.sqrt(sum(error * error for error in errors) / len(errors)),
        'bare_tube_width': EMBLEM_BARE_TUBE_WIDTH, 'coated_tube_width': EMBLEM_WHITE_TUBE_WIDTH,
        'tube_thickness': EMBLEM_TUBE_THICKNESS, 'tube_ring_samples': EMBLEM_PATH_RING_SAMPLES,
        'white_wrap_width': EMBLEM_WHITE_TUBE_WIDTH + 2.0 * EMBLEM_WHITE_SLEEVE_WALL,
        'white_wrap_thickness': 2.0 * half_white, 'white_sleeve_wall': EMBLEM_WHITE_SLEEVE_WALL,
        'white_visible_regions_s': EMBLEM_WHITE_VISIBLE_REGIONS_S,
        'white_visible_region_count': len(EMBLEM_WHITE_VISIBLE_REGIONS_S), 'white_sleeve_piece_count': len(sleeve_pieces),
        'front_slot_width': EMBLEM_FRONT_SLEEVE_SLOT_WIDTH, 'front_transverse_seams_s': EMBLEM_FRONT_TRANSVERSE_SEAMS_S,
        'front_seam_gap_s': EMBLEM_FRONT_SEAM_GAP_S,
        'front_seam_gap_native': EMBLEM_FRONT_SEAM_GAP_S * table['length'],
        'front_seam_gap_hero_px': EMBLEM_FRONT_SEAM_GAP_S * table['length'] * HERO_PPU,
        'front_seam_end_rounding_native': EMBLEM_SEAM_END_ROUNDING_NATIVE,
        'bottom_wrap_inward_offset': EMBLEM_BOTTOM_CROWN_OFFSET_W,
        'bottom_optics_inward_offset': EMBLEM_BOTTOM_CROWN_OFFSET_W,
        'bottom_optics_axis_status': 'local tube/sleeve body follows observed crown silhouette; hidden internal core path unchanged and inferred',
        'bottom_axis_pixel_y_inferred': EMBLEM_BOTTOM_CROWN_AXIS_PIXEL_Y_INFERRED,
        'bottom_white_observed_pixel_y': EMBLEM_BOTTOM_CROWN_OBSERVED_PIXEL_Y,
        'bottom_window_roll_inferred_radians': EMBLEM_BOTTOM_WINDOW_ROLL_RADIANS,
        'bottom_window_turn_status': 'smooth asymmetric opening estimate preserving short exposed core fragments',
        'absolute_depth_status': 'chosen to clear current glass; source absolute Y and unseen wrapping unknown',
        'core_diameter': EMBLEM_CORE_DIAMETER, 'core_local_w': 0.0, 'core_local_v': 0.0,
        'core_continuous': True, 'core_visibility': 'not continuously visible; rear crossing and bottom sleeve occlude',
        'crossing_front_branch': 'source lower-left to upper-right; native Y more negative',
        'crossing_center_plane_gap': back_center.y - front_center.y, 'crossing_surface_clearance': clearance,
        'crossing_front_s': front_s, 'crossing_back_s': back_s, 'max_twist_radians': EMBLEM_MAX_TWIST_RADIANS,
        'actual_y_max': y_max, 'glass_front_clearance': GLASS_FRONT_Y - y_max,
        'bounds_min': [min(point[axis] for point in points) for axis in range(3)],
        'bounds_max': [max(point[axis] for point in points) for axis in range(3)],
    }


def add_text_mesh(name, part, detail, body, location, size, material, extrude=0.0008, spacing=1.0):
    curve = bpy.data.curves.new(name + "Font", type="FONT")
    curve.body = body
    curve.size = size
    curve.space_character = spacing
    curve.resolution_u = 4
    curve.extrude = extrude
    curve.bevel_depth = 0.0
    curve.bevel_resolution = 0
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    obj.rotation_euler = (math.pi / 2.0, 0.0, 0.0)
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target="MESH")
    obj = bpy.context.object
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    obj.data.materials.append(material)
    return tag_part(obj, part, detail)


def object_bounds(obj):
    points = [obj.matrix_world @ vertex.co for vertex in obj.data.vertices]
    return {
        "x_min": min(point.x for point in points),
        "x_max": max(point.x for point in points),
        "z_min": min(point.z for point in points),
        "z_max": max(point.z for point in points),
    }


def build_case():
    cover_bounds, label_bounds = load_source_bounds()
    cx0, cx1, cz0, cz1 = cover_bounds
    lx0, lx1, lz0, lz1 = label_bounds

    # Four narrow beams form the perimeter, with an actual 0.33-unit shell depth.
    # Each front rail has a shallow boolean-cut groove plus a recessed fine inlay.
    frame_front = FRAME_FRONT_Y
    frame_depth = FRAME_DEPTH
    frame_y = frame_front + frame_depth * 0.5
    groove_y = -0.155
    side_center_z = (FRAME_SIDE_Z[0] + FRAME_SIDE_Z[1]) * 0.5
    side_height = FRAME_SIDE_Z[1] - FRAME_SIDE_Z[0]
    left_rail = add_grooved_box("punk_frame_left_beam", "frame", "low", (-1.925, frame_y, side_center_z), (FRAME_SIDE_WIDTH, frame_depth, side_height), MATERIALS["white"], [((-1.94, groove_y, 1.75), (0.009, 0.018, 2.82))], 0.035)
    right_rail = add_grooved_box("punk_frame_right_beam", "frame", "low", (1.925, frame_y, side_center_z), (FRAME_SIDE_WIDTH, frame_depth, side_height), MATERIALS["white"], [((1.94, groove_y, 1.75), (0.009, 0.018, 2.82))], 0.035)
    top_groove_cutters = path_groove_cutters(
        TOP_GROOVE_PATH_XZ,
        TOP_GROOVE_Y,
        TOP_GROOVE_CUT_DEPTH_Y,
        TOP_GROOVE_CUT_WIDTH,
        TOP_GROOVE_SEGMENT_OVERLAP,
    )
    top_rail = add_grooved_box("punk_frame_top_beam", "frame", "low", (0.0, frame_y, 3.425), (FRAME_CROSSBAR_WIDTH_X, frame_depth, 0.15), MATERIALS["white"], top_groove_cutters, 0.035)
    bottom_rail = add_grooved_box("punk_frame_bottom_beam", "frame", "low", (0.0, frame_y, 0.075), (FRAME_CROSSBAR_WIDTH_X, frame_depth, 0.15), MATERIALS["white"], [((0.0, groove_y, 0.05), (3.2, 0.018, 0.009))], 0.035)
    rail_targets = (
        ("left", left_rail, {"x_min": -2.0, "x_max": -1.85, "z_min": 0.15, "z_max": 3.35}),
        ("right", right_rail, {"x_min": 1.85, "x_max": 2.0, "z_min": 0.15, "z_max": 3.35}),
        ("top", top_rail, {"x_min": -2.0, "x_max": 2.0, "z_min": 3.35, "z_max": 3.5}),
        ("bottom", bottom_rail, {"x_min": -2.0, "x_max": 2.0, "z_min": 0.0, "z_max": 0.15}),
    )
    rail_measurements = []
    for role, rail_obj, target in rail_targets:
        measured = object_bounds(rail_obj)
        max_deviation = max(abs(measured[key] - target[key]) for key in target)
        normal_quality = rail_normal_quality(rail_obj)
        rail_measurements.append({
            "role": role,
            "target": target,
            "measured": measured,
            "max_deviation": max_deviation,
            "normal_quality": normal_quality,
        })
    rail_max_deviation = max(item["max_deviation"] for item in rail_measurements)
    rail_normal_summary = {
        "has_custom_normals": all(item["normal_quality"]["has_custom_normals"] for item in rail_measurements),
        "planar_max_deviation_degrees": max(item["normal_quality"]["planar_max_deviation_degrees"] for item in rail_measurements),
        "broad_planar_max_deviation_degrees": max(item["normal_quality"]["broad_planar_max_deviation_degrees"] for item in rail_measurements),
        "bevel_shared_normal_max_difference_degrees": max(item["normal_quality"]["bevel_shared_normal_max_difference_degrees"] for item in rail_measurements),
        "bevel_shared_edge_loop_samples": sum(item["normal_quality"]["bevel_shared_edge_loop_samples"] for item in rail_measurements),
        "segments": 6,
        "auto_smooth_angle_degrees": 30.0,
        "weighted_normal_applied_after_boolean": True,
    }
    add_polyline_inlay(
        "punk_frame_top_groove_inlay", "trim", "medium", TOP_GROOVE_PATH_XZ,
        TOP_GROOVE_INLAY_Y, TOP_GROOVE_INLAY_DEPTH_Y, TOP_GROOVE_INLAY_WIDTH,
        MATERIALS["ink-light"],
    )
    add_box("punk_frame_bottom_groove_inlay", "trim", "medium", (0.0, -0.148, 0.05), (3.17, 0.004, 0.004), MATERIALS["ink-light"])
    add_box("punk_frame_left_groove_inlay", "trim", "medium", (-1.94, -0.148, 1.75), (0.004, 0.004, 2.79), MATERIALS["ink-light"])
    add_box("punk_frame_right_groove_inlay", "trim", "medium", (1.94, -0.148, 1.75), (0.004, 0.004, 2.79), MATERIALS["ink-light"])

    # A real thin rear plate closes the case; its back face is exactly y=+0.18.
    add_box("punk_back_plate", "back", "low", (0.0, 0.16, 1.75), (3.84, 0.04, 3.34), MATERIALS["white"], 0.025)

    # One uninterrupted cover pane spans the whole front, including the right column.
    glass_w = GLASS_X[1] - GLASS_X[0]
    glass_h = GLASS_Z[1] - GLASS_Z[0]
    glass_x = (GLASS_X[0] + GLASS_X[1]) * 0.5
    glass_z = (GLASS_Z[0] + GLASS_Z[1]) * 0.5
    glass_depth = GLASS_BACK_Y - GLASS_FRONT_Y
    glass_y = (GLASS_FRONT_Y + GLASS_BACK_Y) * 0.5
    add_box("punk_cover_full_face_transmissive_glass", "cover", "low", (glass_x, glass_y, glass_z), (glass_w, glass_depth, glass_h), MATERIALS["glass"], 0.012)

    # A hairline print outline registers the original square cover without dividing the glass.
    art_w = cx1 - cx0
    art_h = cz1 - cz0
    art_x = (cx0 + cx1) * 0.5
    art_z = (cz0 + cz1) * 0.5
    registration_y = GLASS_FRONT_Y - 0.004
    registration_depth = 0.004
    registration_width = 0.004
    registration_offset = 0.009
    registration_ink = MATERIALS["ink-light"]
    add_box("punk_trim_album_registration_left", "trim", "medium", (cx0 - registration_offset, registration_y, art_z), (registration_width, registration_depth, art_h + registration_offset * 2.0), registration_ink)
    add_box("punk_trim_album_registration_right", "trim", "medium", (cx1 + registration_offset, registration_y, art_z), (registration_width, registration_depth, art_h + registration_offset * 2.0), registration_ink)
    add_box("punk_trim_album_registration_top", "trim", "medium", (art_x, registration_y, cz1 + registration_offset), (art_w + registration_offset * 2.0, registration_depth, registration_width), registration_ink)
    add_box("punk_trim_album_registration_bottom", "trim", "medium", (art_x, registration_y, cz0 - registration_offset), (art_w + registration_offset * 2.0, registration_depth, registration_width), registration_ink)

    # The inset right panel is a complete, thin backing plate beneath the glass.
    spine_x0, spine_x1 = 1.15, 1.77
    spine_z0, spine_z1 = 0.18, 3.34
    spine_center = ((spine_x0 + spine_x1) * 0.5, (SPINE_FRONT_Y + SPINE_BACK_Y) * 0.5, (spine_z0 + spine_z1) * 0.5)
    spine_dims = (spine_x1 - spine_x0, SPINE_BACK_Y - SPINE_FRONT_Y, spine_z1 - spine_z0)
    add_box("punk_spine_recessed_inner_panel", "spine", "low", spine_center, spine_dims, MATERIALS["white"], 0.008)

    # Vent bars are printed on the outside glass; the backing panel remains solid.
    vent_count = 9
    vent_center_z = 0.67
    vent_start_x = 1.30
    vent_pitch = 0.039
    vent_length = 0.14
    vent_thickness = 0.009
    vent_angle = -math.radians(60.0)
    vent_y = GLASS_FRONT_Y - 0.004
    vent_depth = 0.004
    for index in range(vent_count):
        x = vent_start_x + index * vent_pitch
        add_box(
            "punk_vent_glass_ink_%02d" % (index + 1),
            "vents",
            "medium",
            (x, vent_y, vent_center_z),
            (vent_length, vent_depth, vent_thickness),
            MATERIALS["dark"],
            0.0,
            (0.0, vent_angle, 0.0),
        )

    # Small molded top-edge clip, with the specified native dimensions and location.
    add_box("punk_top_clip", "clip", "low", (1.45, -0.02, 3.53), (0.46, 0.34, 0.12), MATERIALS["white"], 0.025)

    # Chamfered metal countersinks and screw heads with boolean-cut cross recesses.
    screw_positions = [(-1.8, 0.216), (1.8, 3.307)]
    for index, (x, z) in enumerate(screw_positions, 1):
        add_cylinder_y("punk_fastener_socket_%d" % index, "fasteners", "high", x, -0.168, z, 0.057, 0.009, MATERIALS["dark"], 48, 0.002)
        head = add_cylinder_y("punk_fastener_head_%d" % index, "fasteners", "high", x, -0.187, z, 0.049, 0.026, MATERIALS["silver"], 48, 0.004)
        # The crossed cutters only enter from the front, leaving a solid metal floor below.
        for arm, dims in (("horizontal", (0.068, 0.014, 0.008)), ("vertical", (0.008, 0.014, 0.068))):
            bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0.0, 0.0, 0.0))
            cutter = bpy.context.object
            cutter.name = "temporary_screw_cross_cutter"
            cutter.dimensions = dims
            cutter.location = (x, -0.198, z)
            bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
            apply_difference(head, cutter, "Recessed cross slot " + arm)

    # Horizontal/vertical corner keys match the source's square registration marks.
    corner_y = -0.19
    for x_edge, x_sign in ((cx0, 1), (cx1, -1)):
        for z_edge, z_sign in ((cz0, 1), (cz1, -1)):
            add_box(
                "punk_trim_corner_horizontal_key",
                "trim",
                "medium",
                (x_edge + x_sign * 0.085, corner_y, z_edge + z_sign * 0.012),
                (0.17, 0.006, 0.008),
                MATERIALS["ink-light"],
                0.0,
            )
            add_box(
                "punk_trim_corner_vertical_key",
                "trim",
                "medium",
                (x_edge + x_sign * 0.012, corner_y, z_edge + z_sign * 0.085),
                (0.008, 0.006, 0.17),
                MATERIALS["ink-light"],
                0.0,
            )

    # The blank label plaque sits on the outer glass, above the recessed panel.
    label_w = lx1 - lx0
    label_h = lz1 - lz0
    label_x = (lx0 + lx1) * 0.5
    label_z = (lz0 + lz1) * 0.5
    label_depth = LABEL_BACK_Y - LABEL_FRONT_Y
    label_y = (LABEL_FRONT_Y + LABEL_BACK_Y) * 0.5
    add_box("punk_dynamic_arc_label_plate", "label", "low", (label_x, label_y, label_z), (label_w, label_depth, label_h), MATERIALS["white"], 0.003)
    # The dark top rule and two tiny corner marks preserve an open center for dynamic ARC digits.
    label_ink_y = LABEL_FRONT_Y - 0.002
    label_ink_depth = 0.002
    add_box("punk_label_top_ink_rule", "ink", "high", (label_x, label_ink_y, lz1 - 0.036), (label_w - 0.045, label_ink_depth, 0.008), MATERIALS["dark"], 0.0005)
    add_box("punk_label_left_micro_mark", "ink", "high", (lx0 + 0.046, label_ink_y, lz0 + 0.034), (0.028, label_ink_depth, 0.004), MATERIALS["dark"], 0.0004)
    add_box("punk_label_right_micro_mark", "ink", "high", (lx1 - 0.046, label_ink_y, lz0 + 0.034), (0.028, label_ink_depth, 0.004), MATERIALS["dark"], 0.0004)

    # Source-traced clear hose with an internal orange thread and local white wraps.
    emblem_metadata = add_source_tube_emblem()

    # A 27-mark calibration ruler is printed on the glass below the plaque.
    ruler_x = 1.235
    ruler_y = GLASS_FRONT_Y - 0.004
    ruler_top = 1.72
    ruler_step = 0.0325
    add_box("punk_ruler_vertical_guide", "ruler", "medium", (ruler_x - 0.014, ruler_y, 1.30), (0.004, 0.004, 0.91), MATERIALS["trim"], 0.0)
    for index in range(27):
        z = ruler_top - index * ruler_step
        major = index % 5 == 0
        length = 0.055 if major else 0.033
        add_box(
            "punk_ruler_tick_%02d" % (index + 1),
            "ruler",
            "medium",
            (ruler_x + length * 0.5, ruler_y, z),
            (length, 0.004, 0.006),
            MATERIALS["ink-light"],
            0.0,
        )

    # Fine low-contrast lettering along the bottom rail, split into three small inscriptions.
    add_text_mesh("punk_lettering_audio_archive", "lettering", "high", "AUDIO ARCHIVE", (-1.63, -0.166, 0.047), 0.034, MATERIALS["ink-light"], 0.0009)
    add_text_mesh("punk_lettering_specimen_case", "lettering", "high", "SPECIMEN CASE", (-0.52, -0.166, 0.047), 0.034, MATERIALS["ink-light"], 0.0009)
    add_text_mesh("punk_lettering_a_side", "lettering", "high", "A-SIDE", (0.67, -0.166, 0.047), 0.034, MATERIALS["ink-light"], 0.0009)

    frame_metadata = {
        "rail_measurements": rail_measurements,
        "crossbar_width_x": FRAME_CROSSBAR_WIDTH_X,
        "side_rail_width_x": FRAME_SIDE_WIDTH,
        "side_rail_height_z": side_height,
        "side_rail_z_min": FRAME_SIDE_Z[0],
        "side_rail_z_max": FRAME_SIDE_Z[1],
        "rail_normal_quality": rail_normal_summary,
        "top_groove_path_xz": TOP_GROOVE_PATH_XZ,
        "top_groove_y": TOP_GROOVE_Y,
        "top_groove_cut_width": TOP_GROOVE_CUT_WIDTH,
        "top_groove_cut_depth_y": TOP_GROOVE_CUT_DEPTH_Y,
        "top_groove_inlay_y": TOP_GROOVE_INLAY_Y,
        "top_groove_inlay_width": TOP_GROOVE_INLAY_WIDTH,
        "top_groove_inlay_depth_y": TOP_GROOVE_INLAY_DEPTH_Y,
        "max_deviation": rail_max_deviation,
    }
    return cover_bounds, label_bounds, frame_metadata, emblem_metadata


def join_by_part_and_detail():
    groups = defaultdict(list)
    for obj in list(PART_OBJECTS):
        if obj.name in bpy.data.objects:
            assembly_part = obj.get("assemblyPart", "")
            groups[(obj["casePart"], obj["minDetail"], assembly_part)].append(obj)
    joined = []
    for (part, detail, assembly_part), objects in sorted(groups.items()):
        objects = [obj for obj in objects if obj.type == "MESH"]
        if not objects:
            continue
        bpy.ops.object.select_all(action="DESELECT")
        for obj in objects:
            obj.select_set(True)
        active = objects[0]
        bpy.context.view_layer.objects.active = active
        if len(objects) > 1:
            bpy.ops.object.join()
            active = bpy.context.object
        active.name = "punk_%s_%s%s" % (part, detail, "_" + assembly_part if assembly_part else "")
        active["casePart"] = part
        active["minDetail"] = detail
        if assembly_part:
            active["assemblyPart"] = assembly_part
        if part == "cover":
            active["surfaceRole"] = "continuous_front_glass"
            active["frontSurfaceY"] = GLASS_FRONT_Y
            active["backSurfaceY"] = GLASS_BACK_Y
        elif part == "spine":
            active["surfaceRole"] = "recessed_inner_panel"
            active["frontSurfaceY"] = SPINE_FRONT_Y
            active["backSurfaceY"] = SPINE_BACK_Y
        elif part == "label":
            active["surfaceRole"] = "outer_glass_label_plaque"
            active["frontSurfaceY"] = LABEL_FRONT_Y
            active["backSurfaceY"] = LABEL_BACK_Y
        joined.append(active)
    return joined


def mesh_report(objects):
    all_points = []
    cover_points = []
    part_counts = defaultdict(int)
    points_by_part = defaultdict(list)
    triangles = 0
    triangles_by_part = defaultdict(int)
    for obj in objects:
        part_counts[obj["casePart"]] += 1
        obj.data.calc_loop_triangles()
        triangles += len(obj.data.loop_triangles)
        triangles_by_part[obj["casePart"]] += len(obj.data.loop_triangles)
        points = [obj.matrix_world @ vertex.co for vertex in obj.data.vertices]
        all_points.extend(points)
        points_by_part[obj["casePart"]].extend(points)
        if obj["casePart"] == "cover":
            cover_points.extend(points)
    mins = [min(point[axis] for point in all_points) for axis in range(3)]
    maxs = [max(point[axis] for point in all_points) for axis in range(3)]
    cover_front = min(point.y for point in cover_points)
    cover_back = max(point.y for point in cover_points)
    return {
        "bbox_min": mins,
        "bbox_max": maxs,
        "cover_frontmost_y": cover_front,
        "cover_backmost_y": cover_back,
        "inner_panel_frontmost_y": min(point.y for point in points_by_part["spine"]),
        "inner_panel_backmost_y": max(point.y for point in points_by_part["spine"]),
        "label_plate_frontmost_y": min(point.y for point in points_by_part["label"]),
        "label_plate_backmost_y": max(point.y for point in points_by_part["label"]),
        "cover_triangles": sum(len(obj.data.loop_triangles) for obj in objects if obj["casePart"] == "cover"),
        "triangles": triangles,
        "triangles_by_part": dict(sorted(triangles_by_part.items())),
        "bounds_by_part": {part: {"min": [min(point[axis] for point in points) for axis in range(3)],
                                 "max": [max(point[axis] for point in points) for axis in range(3)]}
                           for part, points in sorted(points_by_part.items())},
        "part_ids": sorted(part_counts),
        "part_id_count": len(part_counts),
        "parts": dict(sorted(part_counts.items())),
    }


def configure_viewport():
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type == "VIEW_3D":
                space = area.spaces.active
                space.region_3d.view_location = (0.0, 0.0, 1.75)
                space.region_3d.view_distance = 7.2
                space.region_3d.view_rotation = Euler((math.pi / 2.0, 0.0, 0.0), "XYZ").to_quaternion()
                space.shading.type = "SOLID"
                space.shading.color_type = "MATERIAL"
                space.shading.light = "STUDIO"
                space.overlay.show_floor = False


def export_glb(objects):
    os.makedirs(os.path.dirname(GLB_PATH), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]

    available = {prop.identifier for prop in bpy.ops.export_scene.gltf.get_rna_type().properties}
    settings = {
        "filepath": GLB_PATH,
        "export_format": "GLB",
        "export_extras": True,
        "export_yup": True,
        "export_apply": True,
        "export_normals": True,
        "export_materials": "EXPORT",
        "export_cameras": False,
        "export_lights": False,
    }
    if "use_selection" in available:
        settings["use_selection"] = True
    elif "export_selected" in available:
        settings["export_selected"] = True
    settings = {key: value for key, value in settings.items() if key in available}
    result = bpy.ops.export_scene.gltf(**settings)
    if "FINISHED" not in result:
        raise RuntimeError("Blender glTF export did not finish: %r" % (result,))


def write_asset_version():
    with open(GLB_PATH, "rb") as model_file:
        digest = hashlib.sha256(model_file.read()).hexdigest()[:12]
    asset_url = "assets/punk-reference-case.glb?v=" + digest
    with open(ASSET_VERSION_PATH, "w", encoding="utf-8", newline="\n") as asset_file:
        asset_file.write(
            "// Generated by art/build_punk_reference_case.py; content changes invalidate the asset cache.\n"
            'export const PUNK_CASE_ASSET = "' + asset_url + '";\n'
        )
    return asset_url


def main():
    clear_scene()
    setup_materials()
    cover_bounds, label_bounds, frame_metadata, emblem_metadata = build_case()
    objects = join_by_part_and_detail()
    if not objects:
        raise RuntimeError("No model mesh objects were produced")
    for obj in objects:
        if obj.type != "MESH" or obj.get("casePart") not in {
            "frame", "cover", "back", "spine", "clip", "fasteners", "emblem",
            "accent", "optics", "label", "ink", "trim", "ruler", "vents", "lettering",
        }:
            raise RuntimeError("Unexpected exported object or missing casePart: " + obj.name)
        if obj.get("minDetail") not in {"low", "medium", "high"}:
            raise RuntimeError("Unexpected minDetail value: " + obj.name)

    frame_obj = next(obj for obj in objects if obj.get("casePart") == "frame")
    frame_obj["topBottomRailWidthX"] = frame_metadata["crossbar_width_x"]
    frame_obj["sideRailWidthX"] = frame_metadata["side_rail_width_x"]
    frame_obj["sideRailHeightZ"] = frame_metadata["side_rail_height_z"]
    frame_obj["sideRailZMin"] = frame_metadata["side_rail_z_min"]
    frame_obj["sideRailZMax"] = frame_metadata["side_rail_z_max"]
    frame_obj["maxDeviationFromRailTargets"] = frame_metadata["max_deviation"]
    frame_obj["railBevelSegments"] = frame_metadata["rail_normal_quality"]["segments"]
    frame_obj["railHasCustomNormals"] = frame_metadata["rail_normal_quality"]["has_custom_normals"]
    frame_obj["railPlaneNormalMaxDeviationDegrees"] = frame_metadata["rail_normal_quality"]["planar_max_deviation_degrees"]
    frame_obj["railBroadPlaneNormalMaxDeviationDegrees"] = frame_metadata["rail_normal_quality"]["broad_planar_max_deviation_degrees"]
    frame_obj["railBevelNormalMaxDifferenceDegrees"] = frame_metadata["rail_normal_quality"]["bevel_shared_normal_max_difference_degrees"]
    frame_obj["railBevelNormalLoopSamples"] = frame_metadata["rail_normal_quality"]["bevel_shared_edge_loop_samples"]
    frame_obj["topGroovePathXZ"] = json.dumps(frame_metadata["top_groove_path_xz"])
    frame_obj["topGrooveY"] = frame_metadata["top_groove_y"]
    frame_obj["topGrooveCutWidth"] = frame_metadata["top_groove_cut_width"]
    frame_obj["topGrooveCutDepthY"] = frame_metadata["top_groove_cut_depth_y"]
    frame_obj["topGrooveInlayY"] = frame_metadata["top_groove_inlay_y"]
    frame_obj["topGrooveInlayWidth"] = frame_metadata["top_groove_inlay_width"]
    frame_obj["topGrooveInlayDepthY"] = frame_metadata["top_groove_inlay_depth_y"]

    emblem_obj = next(obj for obj in objects if obj.get("casePart") == "emblem")
    emblem_obj["emblemGeometryVersion"] = emblem_metadata["model_version"]
    emblem_obj["whiteWrapWidth"] = emblem_metadata["white_wrap_width"]
    emblem_obj["whiteWrapThickness"] = emblem_metadata["white_wrap_thickness"]
    emblem_obj["whiteVisibleRegionCount"] = emblem_metadata["white_visible_region_count"]
    emblem_obj["whiteSleevePieceCount"] = emblem_metadata["white_sleeve_piece_count"]
    emblem_obj["frontSlotWidth"] = emblem_metadata["front_slot_width"]
    emblem_obj["sourceBezierNativeXZ"] = json.dumps(emblem_metadata["source_bezier_native_xz"])
    emblem_obj["whiteVisibleRegionsS"] = json.dumps(emblem_metadata["white_visible_regions_s"])
    emblem_obj["frontTransverseSeamsS"] = json.dumps(emblem_metadata["front_transverse_seams_s"])
    emblem_obj["frontSeamGapHeroPx"] = emblem_metadata["front_seam_gap_hero_px"]
    emblem_obj["frontSeamEndRoundingNative"] = EMBLEM_SEAM_END_ROUNDING_NATIVE
    emblem_obj["sourceTrace"] = emblem_metadata["source_trace"]
    emblem_obj["bottomCrownAxisStatus"] = "hidden center axis and channel turn inferred from white/hero-clear.png"
    emblem_obj["absoluteDepthStatus"] = emblem_metadata["absolute_depth_status"]
    emblem_obj["crossingCenterPlaneGap"] = emblem_metadata["crossing_center_plane_gap"]
    emblem_obj["crossingSurfaceClearance"] = emblem_metadata["crossing_surface_clearance"]
    emblem_obj["maxTwistRadians"] = emblem_metadata["max_twist_radians"]
    accent_obj = next(obj for obj in objects if obj.get("casePart") == "accent" and obj.get("assemblyPart") == "cover")
    accent_obj["coreDiameter"] = emblem_metadata["core_diameter"]
    accent_obj["coreLocalW"] = 0.0
    accent_obj["coreLocalV"] = 0.0
    accent_obj["coreContinuous"] = True
    accent_obj["coreVisibility"] = emblem_metadata["core_visibility"]
    accent_obj["sectionAttachedToBand"] = False
    optics_obj = next(obj for obj in objects if obj.get("casePart") == "optics")
    optics_obj["assemblyPart"] = "cover"
    optics_obj["tubeWidthBare"] = EMBLEM_BARE_TUBE_WIDTH
    optics_obj["tubeWidthCoated"] = EMBLEM_WHITE_TUBE_WIDTH
    optics_obj["tubeThickness"] = EMBLEM_TUBE_THICKNESS
    optics_obj["coreIsInternal"] = True
    optics_obj["bottomBodyInwardOffset"] = EMBLEM_BOTTOM_CROWN_OFFSET_W
    optics_obj["bottomBodyAxisStatus"] = emblem_metadata["bottom_optics_axis_status"]
    optics_obj["sourceVisibleAnchorMaxErrorPx"] = emblem_metadata["source_visible_anchor_max_error_px"]
    optics_obj["actualGlassClearance"] = emblem_metadata["glass_front_clearance"]

    report = mesh_report(objects)
    configure_viewport()
    os.makedirs(os.path.dirname(BLEND_PATH), exist_ok=True)
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH, compress=True)
    export_glb(objects)
    asset_url = write_asset_version()

    print("PUNK_REFERENCE_REPORT=" + json.dumps({
        "blender": bpy.app.version_string,
        "source_case_json": os.path.relpath(CASE_JSON, PROJECT_ROOT).replace(os.sep, "/"),
        "hero_ppu_used": HERO_PPU,
        "cover_bounds_x0_x1_z0_z1": cover_bounds,
        "label_bounds_x0_x1_z0_z1": label_bounds,
        "front_glass_bounds_x0_x1_z0_z1": (GLASS_X[0], GLASS_X[1], GLASS_Z[0], GLASS_Z[1]),
        "front_glass_front_y": GLASS_FRONT_Y,
        "front_glass_back_y": GLASS_BACK_Y,
        "inner_panel_front_y": SPINE_FRONT_Y,
        "inner_panel_back_y": SPINE_BACK_Y,
        "label_plate_front_y": LABEL_FRONT_Y,
        "label_plate_back_y": LABEL_BACK_Y,
        "native_body_x": BODY_X,
        "native_body_z": BODY_Z,
        "native_back_y": BODY_BACK_Y,
        "frame_rail_geometry": frame_metadata,
        "emblem_geometry": emblem_metadata,
        "max_deviation": frame_metadata["max_deviation"],
        "front_art_plane_y": FRONT_ART_Y,
        "art_plane_relation": "y=-0.105 lies 0.055 behind the pane back face and 0.120 in front of the recessed panel face",
        "blend_path": BLEND_PATH,
        "glb_path": GLB_PATH,
        "asset_url": asset_url,
        **report,
    }, sort_keys=True))


if __name__ == "__main__":
    main()
