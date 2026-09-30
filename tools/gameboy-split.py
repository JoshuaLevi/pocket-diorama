#!/usr/bin/env python3
"""Split the Game Boy model into a body and its six moving parts.

    python3 tools/gameboy-split.py [~/Downloads/gameboy.glb] [Assets/Models/gameboy.glb]

The Sketchfab DMG is one mesh. The shell wants to press its buttons, so this
cuts A, B, the D-pad, SELECT and START out of it as their own nodes, each
pivoted at its own centre, with the same vertices, normals, tangents, UVs,
material and textures as before; only the index buffers are new, and they
are uint16 now (the old one was uint32, which 5.15 converts with a warning).

A triangle belongs to a part when all three of its corners lie in that
part's region: a cylinder about the button's centre for A and B (the
buttons pass through the oval plate, whose hole ring shares their radius,
so the plate's own triangles always have a corner outside), a box over the
cross for the D-pad, a box over each pill. The regions are in the model's
measured units -- the frame GameBoyShell.ts uses -- so this script and the
shell agree on where everything is.

The measured frame is the mesh's raw one after the node matrices: RIGHT is
raw +X, UP is raw +Z, and the face normal is raw -Y, which is why the shell
sinks a button along the part node's +Y.
"""
import json
import os
import struct
import sys

import numpy as np

SRC = os.path.expanduser(sys.argv[1] if len(sys.argv) > 1 else "~/Downloads/gameboy.glb")
DST = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), "..", "Assets", "Models", "gameboy.glb")

# Measured frame, from GameBoyShell.ts. A cylinder is (cx, cy, radius, zmin); a box (cx, cy, hx, hy, zmin).
PARTS = [
    ("ButtonA", "cylinder", (104.6, -34.7, 17.4, 36.5)),
    ("ButtonB", "cylinder", (60.2, -53.5, 17.4, 36.5)),
    ("Dpad", "box", (-63.2, -49.2, 33.0, 33.0, 42.5)),
    ("Select", "box", (-24.4, -112.4, 19.0, 11.0, 41.5)),
    ("Start", "box", (19.0, -112.4, 19.0, 11.0, 41.5)),
]


def read_glb(path):
    d = open(path, "rb").read()
    magic, version, length = struct.unpack("<III", d[:12])
    assert magic == 0x46546C67 and version == 2, "not a glb 2"
    off = 12
    js = None
    binb = None
    while off < len(d):
        clen, ctype = struct.unpack("<II", d[off:off + 8])
        body = d[off + 8:off + 8 + clen]
        if ctype == 0x4E4F534A:
            js = json.loads(body)
        elif ctype == 0x004E4942:
            binb = body
        off += 8 + clen
    return js, binb


def accessor(js, binb, index):
    a = js["accessors"][index]
    bv = js["bufferViews"][a["bufferView"]]
    start = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    comp = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[a["type"]]
    dt = {5126: np.float32, 5123: np.uint16, 5125: np.uint32}[a["componentType"]]
    item = np.dtype(dt).itemsize * comp
    n = a["count"]
    stride = bv.get("byteStride", item)
    if stride == item:
        return np.frombuffer(binb, dtype=dt, count=n * comp, offset=start).reshape(n, comp).copy()
    raw = np.frombuffer(binb, dtype=np.uint8, count=stride * (n - 1) + item, offset=start)
    return np.stack([np.frombuffer(raw[i * stride:i * stride + item].tobytes(), dtype=dt) for i in range(n)])


def node_world(js, chain):
    M = np.eye(4)
    for ni in chain:
        M = M @ np.array(js["nodes"][ni]["matrix"]).reshape(4, 4).T
    return M


def main():
    js, binb = read_glb(SRC)
    assert len(js["meshes"]) == 1 and len(js["meshes"][0]["primitives"]) == 1, "expected the one-mesh Sketchfab export"
    prim = js["meshes"][0]["primitives"][0]
    attrs = prim["attributes"]
    pos = accessor(js, binb, attrs["POSITION"]).astype(np.float32)
    nrm = accessor(js, binb, attrs["NORMAL"]).astype(np.float32)
    tan = accessor(js, binb, attrs["TANGENT"]).astype(np.float32)
    uv = accessor(js, binb, attrs["TEXCOORD_0"]).astype(np.float32)
    idx = accessor(js, binb, prim["indices"]).reshape(-1, 3).astype(np.int64)
    # The mesh node is the leaf of the chain root -> ... -> Plane -> mesh.
    chain = [0, 1, 2]
    M = node_world(js, chain)
    measured = (M[:3, :3] @ pos.T).T + M[:3, 3]

    def inside(part):
        kind, p = part[1], part[2]
        if kind == "cylinder":
            cx, cy, r, zmin = p
            return (np.hypot(measured[:, 0] - cx, measured[:, 1] - cy) <= r) & (measured[:, 2] >= zmin)
        cx, cy, hx, hy, zmin = p
        return (np.abs(measured[:, 0] - cx) <= hx) & (np.abs(measured[:, 1] - cy) <= hy) & (measured[:, 2] >= zmin)

    owner = np.full(len(idx), -1, dtype=np.int64)  # -1 = body
    for k, part in enumerate(PARTS):
        sel = inside(part)
        tri_in = sel[idx].all(axis=1)
        assert not (tri_in & (owner >= 0)).any(), "a triangle claimed twice"
        owner[tri_in] = k

    names = ["Body"] + [p[0] for p in PARTS]
    groups = [idx[owner == -1]] + [idx[owner == k] for k in range(len(PARTS))]

    blob = bytearray()
    buffer_views = []
    accessors = []

    def align(n=4):
        while len(blob) % n:
            blob.append(0)

    def add_view(data, target=None):
        align()
        off = len(blob)
        blob.extend(data)
        view = {"buffer": 0, "byteOffset": off, "byteLength": len(data)}
        if target:
            view["target"] = target
        buffer_views.append(view)
        return len(buffer_views) - 1

    meshes = []
    nodes_new = []
    report = []
    for name, tris in zip(names, groups):
        assert len(tris) > 0, name + " has no triangles"
        used, remap = np.unique(tris.reshape(-1), return_inverse=True)
        local_idx = remap.reshape(-1, 3).astype(np.uint16)
        assert len(used) < 65535, name + " has too many vertices for uint16"
        p = pos[used]
        pivot = p.mean(axis=0) if name != "Body" else np.zeros(3, dtype=np.float32)
        p_local = (p - pivot).astype(np.float32)
        iv = add_view(local_idx.tobytes(), 34963)
        accessors.append({"bufferView": iv, "componentType": 5123, "count": int(local_idx.size), "type": "SCALAR"})
        ai_idx = len(accessors) - 1
        pv = add_view(p_local.tobytes(), 34962)
        accessors.append({"bufferView": pv, "componentType": 5126, "count": int(len(p_local)), "type": "VEC3",
                          "min": [float(x) for x in p_local.min(axis=0)], "max": [float(x) for x in p_local.max(axis=0)]})
        ai_pos = len(accessors) - 1
        nv = add_view(nrm[used].astype(np.float32).tobytes(), 34962)
        accessors.append({"bufferView": nv, "componentType": 5126, "count": int(len(used)), "type": "VEC3"})
        ai_nrm = len(accessors) - 1
        tv = add_view(tan[used].astype(np.float32).tobytes(), 34962)
        accessors.append({"bufferView": tv, "componentType": 5126, "count": int(len(used)), "type": "VEC4"})
        ai_tan = len(accessors) - 1
        uvv = add_view(uv[used].astype(np.float32).tobytes(), 34962)
        accessors.append({"bufferView": uvv, "componentType": 5126, "count": int(len(used)), "type": "VEC2"})
        ai_uv = len(accessors) - 1
        meshes.append({"name": name, "primitives": [{
            "attributes": {"POSITION": ai_pos, "NORMAL": ai_nrm, "TANGENT": ai_tan, "TEXCOORD_0": ai_uv},
            "indices": ai_idx, "material": prim.get("material", 0), "mode": 4}]})
        node = {"name": name, "mesh": len(meshes) - 1}
        if name != "Body":
            node["translation"] = [float(x) for x in pivot]
        nodes_new.append(node)
        centre = M[:3, :3] @ pivot + M[:3, 3]
        ext = (M[:3, :3] @ (p.max(axis=0) - p.min(axis=0)))
        report.append((name, int(len(tris)), int(len(used)), centre.round(1).tolist(), np.abs(ext).round(1).tolist()))

    # Images travel unchanged.
    image_views = {}
    for im in js.get("images", []):
        bv = js["bufferViews"][im["bufferView"]]
        data = binb[bv.get("byteOffset", 0):bv.get("byteOffset", 0) + bv["byteLength"]]
        image_views[im["bufferView"]] = add_view(bytes(data))
    images = [dict(im, bufferView=image_views[im["bufferView"]]) for im in js.get("images", [])]
    align()

    out = {
        "asset": js["asset"],
        "scene": js.get("scene", 0),
        "scenes": js["scenes"],
        "nodes": [],
        "meshes": meshes,
        "materials": js["materials"],
        "textures": js.get("textures", []),
        "images": images,
        "samplers": js.get("samplers", []),
        "accessors": accessors,
        "bufferViews": buffer_views,
        "buffers": [{"byteLength": len(blob)}],
    }
    # The node chain stays; the leaf mesh node becomes the six parts.
    base = len(chain)
    for ni in chain:
        n = dict(js["nodes"][ni])
        n.pop("mesh", None)
        out["nodes"].append(n)
    out["nodes"][-1]["children"] = list(range(base, base + len(nodes_new)))
    for i in range(len(chain) - 1):
        out["nodes"][i]["children"] = [i + 1]
    out["nodes"].extend(nodes_new)

    jtxt = json.dumps(out, separators=(",", ":")).encode()
    while len(jtxt) % 4:
        jtxt += b" "
    total = 12 + 8 + len(jtxt) + 8 + len(blob)
    with open(DST, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(jtxt), 0x4E4F534A))
        f.write(jtxt)
        f.write(struct.pack("<II", len(blob), 0x004E4942))
        f.write(blob)
    print("wrote", DST, total, "bytes;", sum(len(g) for g in groups), "triangles in", len(groups), "parts")
    for r in report:
        print("  %-8s tris %5d verts %5d centre %s extent %s" % r)


if __name__ == "__main__":
    main()
