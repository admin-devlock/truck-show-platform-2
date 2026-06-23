#!/usr/bin/env python3
"""
Convert a libredwg minJSON dump of a trade-show floorplan into:
  - a clean SVG (venue walls + booth outlines + booth-number labels), and
  - a structured booths JSON (number, dimensions, area, polygon).

Usage:  convert_floorplan.py <input.min.json> <out.svg> <out.booths.json> [<out.thumb.svg>]

Stdlib only (no third-party deps). Mirrors work/render_booths.py + work/extract_booths.py.
The optional 4th arg writes a small thumbnail SVG (filled booths + major walls only,
integer coords, no text) suitable for storing on the map doc for dashboard previews.
"""
import json, re, sys, math
from collections import defaultdict

if len(sys.argv) not in (4, 5):
    print("usage: convert_floorplan.py <input.min.json> <out.svg> <out.booths.json> [<out.thumb.svg>]", file=sys.stderr)
    sys.exit(2)

IN_JSON, OUT_SVG, OUT_BOOTHS = sys.argv[1], sys.argv[2], sys.argv[3]
OUT_THUMB = sys.argv[4] if len(sys.argv) == 5 else None

# ---- tunables ----
VENUE_MIN_LEN = 1500.0      # drop venue segments shorter than this (hatch/furniture/detail)
VENUE_MAX_LEN = 80000.0     # drop absurdly long strays (leaders/construction lines)

BOOTH_LAYERS = [
    ("BOOTHLINE", "built"),
    ("P-SPACE_ONLY", "space_only"),
    ("P-SPACE_ONLY_HIDE ON BUILD", "space_only"),
    ("P-SPACE_ONLY_HIDE-ON-BUILD", "space_only"),
]
VENUE_LAYER = "Y-VENUE-X-REF"
STAND_PREFIXES = ("S-SYMA", "UNI-", "S-UPRIGHT", "EV-UPRIGHT", "0C.SYMA",
                  "S-BRACING", "P-Bracing", "T-UNIFLEX")
# Only area headings ("MERCH AREA" etc.) are taken from CAD text; booth numbers +
# dimensions are drawn ourselves, centred on each booth (see SVG write below).
LABEL_LAYERS = {"N-NOTES_Area_Name"}
NUM_LAYERS = {"P-booth_nos"}
INCLUDE_STAND = False

# Overlapping-polygon cleanup.
# The source CAD sometimes stacks extra polygons on top of a real booth: the same
# booth drawn on both BOOTHLINE and P-SPACE_ONLY, or a booth left split into pieces
# (e.g. booth 406 in the Plaza file has a 3-vertex triangle = half the booth sitting
# on top of it — a drafting leftover). Without cleanup each extra polygon becomes its
# own phantom (usually unnumbered, "irregular") booth and its dimension label renders
# on top of the real one.
#
# Dedup keeps the canonical booth (BOOTHLINE first, then largest area) and absorbs any
# later polygon that is either (a) near-identical in area to a kept booth, or (b) sits
# MOSTLY INSIDE a kept booth (its centroid is inside and it's not bigger). Absorbed
# polygons are preserved under each booth's "absorbed" list in the booths JSON, so the
# merge is fully auditable and reversible later.
#
# Set ABSORB_CONTAINED_SUBPOLYS = False to revert to the old behaviour (keep every
# polygon as its own booth); NEAR_EQUAL_RATIO controls the (a) "same booth, two layers"
# case and was the only rule before this cleanup was added (2026-06-22).
ABSORB_CONTAINED_SUBPOLYS = True
NEAR_EQUAL_RATIO = 0.6

# ---- load ----
with open(IN_JSON, encoding="utf-8", errors="replace") as f:
    raw = f.read()
raw = re.sub(r"(?<=[ ,\[:])(-?)nan(?=[, \]\n])", r"\1NaN", raw)
raw = re.sub(r"(?<=[ ,\[:])(-?)inf(?=[, \]\n])", r"\1Infinity", raw)
doc = json.loads(raw)
del raw
objs = doc["OBJECTS"]

layers = {o["handle"][-1]: o.get("name", "?") for o in objs if o.get("object") == "LAYER"}
by_owner = defaultdict(list)
for o in objs:
    if not o.get("entity"):
        continue
    if o.get("entmode", 0) == 2:
        by_owner[2].append(o)
    elif o.get("ownerhandle"):
        by_owner[o["ownerhandle"][-1]].append(o)
ms = by_owner.get(2, [])

def lname(o):
    l = o.get("layer")
    return layers.get(l[-1], "?") if l else "?"

# =====================================================================
#  PART 1 — SVG
# =====================================================================
segs = {"venue": [], "booth": [], "stand": []}
texts = []  # (x, y, height, string)

def clean_mtext(s):
    s = re.sub(r"\{\\f[^;]*;", "", s)
    s = re.sub(r"\\[A-Za-z][^;\\}]*;?", "", s)
    return s.replace("{", "").replace("}", "").replace("\\P", " ").strip()

def T_id(x, y):
    return (x, y)

def make_T(parent_T, ins, scale, rot):
    sx, sy = scale[0], scale[1]
    c, s = math.cos(rot), math.sin(rot)
    def T(x, y):
        x0, y0 = x * sx, y * sy
        return parent_T(ins[0] + x0 * c - y0 * s, ins[1] + x0 * s + y0 * c)
    return T

def add_seg(group, p, q, min_len=0.0):
    if min_len:
        d2 = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2
        if d2 < min_len * min_len or d2 > VENUE_MAX_LEN * VENUE_MAX_LEN:
            return
    segs[group].append((p[0], p[1], q[0], q[1]))

def emit_geom(o, T, group, min_len=0.0):
    t = o["entity"]
    if t == "LINE":
        p, q = o.get("start"), o.get("end")
        if p and q:
            add_seg(group, T(p[0], p[1]), T(q[0], q[1]), min_len)
    elif t == "LWPOLYLINE":
        pts = [T(p[0], p[1]) for p in o.get("points") or []]
        closed = bool(o.get("flag", 0) & 512)
        for i in range(len(pts) - 1):
            add_seg(group, pts[i], pts[i + 1], min_len)
        if closed and len(pts) > 2:
            add_seg(group, pts[-1], pts[0], min_len)
    elif t == "POLYLINE_2D":
        vs = [v for v in by_owner.get(o["handle"][-1], []) if v.get("entity") == "VERTEX_2D"]
        pts = [T(v["point"][0], v["point"][1]) for v in vs if v.get("point")]
        for i in range(len(pts) - 1):
            add_seg(group, pts[i], pts[i + 1], min_len)
    elif t == "ARC":
        c, r = o.get("center"), o.get("radius", 0)
        if c and r:
            a1, a2 = o.get("start_angle", 0), o.get("end_angle", 0)
            if a2 < a1:
                a2 += 2 * math.pi
            n = 8
            pts = [T(c[0] + r * math.cos(a1 + (a2 - a1) * i / n),
                     c[1] + r * math.sin(a1 + (a2 - a1) * i / n)) for i in range(n + 1)]
            for i in range(n):
                add_seg(group, pts[i], pts[i + 1], min_len)
    elif t == "CIRCLE":
        c, r = o.get("center"), o.get("radius", 0)
        if c and r:
            n = 16
            pts = [T(c[0] + r * math.cos(2 * math.pi * i / n),
                     c[1] + r * math.sin(2 * math.pi * i / n)) for i in range(n + 1)]
            for i in range(n):
                add_seg(group, pts[i], pts[i + 1], min_len)

def walk_insert(o, T, group, min_len, depth=0):
    if depth > 5:
        return
    bh = o.get("block_header")
    if not bh:
        return
    Tc = make_T(T, o.get("ins_pt", [0, 0, 0]), o.get("scale", [1, 1, 1]),
                o.get("rotation", 0.0) or 0.0)
    for ch in by_owner.get(bh[-1], []):
        et = ch.get("entity")
        if et in ("ENDBLK", "BLOCK", "SEQEND"):
            continue
        if et == "INSERT":
            walk_insert(ch, Tc, group, min_len, depth + 1)
        else:
            emit_geom(ch, Tc, group, min_len)

booth_layer_names = {n for n, _ in BOOTH_LAYERS}
for o in ms:
    lay = lname(o)
    et = o["entity"]
    if et == "TEXT" and lay in LABEL_LAYERS:
        p, s = o.get("ins_pt"), (o.get("text_value") or "").strip()
        if p and s:
            texts.append((p[0], p[1], o.get("height", 1500.0), s))
        continue
    if et == "MTEXT" and lay in LABEL_LAYERS:
        p, s = o.get("ins_pt"), clean_mtext(o.get("text", ""))
        if p and s:
            texts.append((p[0], p[1], o.get("text_height", 1500.0), s))
        continue
    if lay == VENUE_LAYER:
        walk_insert(o, T_id, "venue", VENUE_MIN_LEN) if et == "INSERT" else emit_geom(o, T_id, "venue", VENUE_MIN_LEN)
        continue
    if lay in booth_layer_names:
        walk_insert(o, T_id, "booth", 0.0) if et == "INSERT" else emit_geom(o, T_id, "booth", 0.0)
        continue
    if INCLUDE_STAND and any(lay.startswith(p) for p in STAND_PREFIXES):
        walk_insert(o, T_id, "stand", 0.0) if et == "INSERT" else emit_geom(o, T_id, "stand", 0.0)

# frame to the booth cluster (venue strays would otherwise shrink the map)
frame = [(x1, y1) for x1, y1, x2, y2 in segs["booth"]] + \
        [(x2, y2) for x1, y1, x2, y2 in segs["booth"]] + \
        [(x, y) for x, y, h, s in texts]
if not frame:
    frame = [(x1, y1) for v in segs.values() for x1, y1, x2, y2 in v] + \
            [(x2, y2) for v in segs.values() for x1, y1, x2, y2 in v]
if not frame:
    print("no geometry found", file=sys.stderr)
    sys.exit(1)

fxs = [p[0] for p in frame]; fys = [p[1] for p in frame]
minx, maxx, miny, maxy = min(fxs), max(fxs), min(fys), max(fys)
pad = 0.02 * max(maxx - minx, maxy - miny)
minx, maxx, miny, maxy = minx - pad, maxx + pad, miny - pad, maxy + pad
W, H = maxx - minx, maxy - miny

def fx(x): return x - minx
def fy(y): return maxy - y

# =====================================================================
#  PART 2 — booth records
# =====================================================================
def dedup_pts(pts):
    o = []
    for p in pts:
        if not o or abs(p[0] - o[-1][0]) > 1e-6 or abs(p[1] - o[-1][1]) > 1e-6:
            o.append(p)
    if len(o) > 1 and abs(o[0][0] - o[-1][0]) < 1e-6 and abs(o[0][1] - o[-1][1]) < 1e-6:
        o.pop()
    return o

def poly_area(pts):
    a = 0.0; n = len(pts)
    for i in range(n):
        x1, y1 = pts[i]; x2, y2 = pts[(i + 1) % n]
        a += x1 * y2 - x2 * y1
    return abs(a) / 2.0

def centroid(pts):
    a = cx = cy = 0.0; n = len(pts)
    for i in range(n):
        x1, y1 = pts[i]; x2, y2 = pts[(i + 1) % n]
        cr = x1 * y2 - x2 * y1; a += cr; cx += (x1 + x2) * cr; cy += (y1 + y2) * cr
    if abs(a) < 1e-9:
        return (sum(p[0] for p in pts) / n, sum(p[1] for p in pts) / n)
    a *= 0.5
    return (cx / (6 * a), cy / (6 * a))

def convex_hull(pts):
    pts = sorted(set((round(x, 4), round(y, 4)) for x, y in pts))
    if len(pts) <= 2:
        return pts
    def cr(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo = []
    for p in pts:
        while len(lo) >= 2 and cr(lo[-2], lo[-1], p) <= 0:
            lo.pop()
        lo.append(p)
    up = []
    for p in reversed(pts):
        while len(up) >= 2 and cr(up[-2], up[-1], p) <= 0:
            up.pop()
        up.append(p)
    return lo[:-1] + up[:-1]

def min_area_rect(pts):
    h = convex_hull(pts)
    if len(h) < 3:
        xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
        w, d = max(xs) - min(xs), max(ys) - min(ys)
        return (max(w, d), min(w, d))
    best = None; n = len(h)
    for i in range(n):
        ax, ay = h[i]; bx, by = h[(i + 1) % n]
        ex, ey = bx - ax, by - ay; el = math.hypot(ex, ey)
        if el < 1e-9:
            continue
        ux, uy = ex / el, ey / el; vx, vy = -uy, ux
        mnu = mnv = 1e18; mxu = mxv = -1e18
        for px, py in h:
            du = (px - ax) * ux + (py - ay) * uy; dv = (px - ax) * vx + (py - ay) * vy
            mnu = min(mnu, du); mxu = max(mxu, du); mnv = min(mnv, dv); mxv = max(mxv, dv)
        area = (mxu - mnu) * (mxv - mnv)
        if best is None or area < best[0]:
            best = (area, mxu - mnu, mxv - mnv)
    _, w, d = best
    return (max(w, d), min(w, d))

def point_in_poly(x, y, pts):
    inside = False; n = len(pts); j = n - 1
    for i in range(n):
        xi, yi = pts[i]; xj, yj = pts[j]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi):
            inside = not inside
        j = i
    return inside

layer_kind = {n: k for n, k in BOOTH_LAYERS}
layer_prio = {n: i for i, (n, _) in enumerate(BOOTH_LAYERS)}
raw_polys = []
for o in ms:
    lay = lname(o)
    if lay in layer_kind and o["entity"] == "LWPOLYLINE":
        pts = dedup_pts([(p[0], p[1]) for p in (o.get("points") or [])])
        if len(pts) >= 3:
            cx, cy = centroid(pts)
            raw_polys.append({"pts": pts, "cx": cx, "cy": cy, "area": poly_area(pts),
                              "kind": layer_kind[lay], "prio": layer_prio[lay]})

raw_polys.sort(key=lambda b: (b["prio"], -b["area"]))
booths = []
for b in raw_polys:
    host = None  # the already-kept booth this polygon duplicates / belongs inside
    for k in booths:
        b_in_k = point_in_poly(b["cx"], b["cy"], k["pts"])
        k_in_b = point_in_poly(k["cx"], k["cy"], b["pts"])
        if not (b_in_k or k_in_b):
            continue
        amin, amax = sorted((b["area"], k["area"]))
        near_equal = amax > 0 and amin / amax >= NEAR_EQUAL_RATIO         # same booth on two layers
        contained = ABSORB_CONTAINED_SUBPOLYS and b_in_k and b["area"] <= k["area"] * 1.05  # artifact inside a kept booth
        if near_equal or contained:
            host = k
            break
    if host is None:
        w, d = min_area_rect(b["pts"])
        xs = [p[0] for p in b["pts"]]; ys = [p[1] for p in b["pts"]]
        b.update({"w": w, "d": d, "diag": math.hypot(w, d), "number": None,
                  "minx": min(xs), "maxx": max(xs), "miny": min(ys), "maxy": max(ys)})
        booths.append(b)
    else:
        # keep the dropped overlapping polygon on its host as auditable evidence
        host.setdefault("absorbed", []).append(b)

def booth_like(s):
    s = s.strip()
    if not s or " " in s or len(s) > 6:
        return False
    if not any(ch.isdigit() for ch in s):
        return False
    return all(ch.isalnum() for ch in s)

raw_nums = []
for o in ms:
    if lname(o) in NUM_LAYERS and o["entity"] in ("TEXT", "MTEXT"):
        p = o.get("ins_pt"); s = (o.get("text_value") or o.get("text") or "").strip()
        if p and s:
            raw_nums.append((p[0], p[1], s))
nums = [(x, y, s) for (x, y, s) in raw_nums if booth_like(s)]

RADIUS_FACTOR = 0.9
pairs = []
for ni, (nx, ny, s) in enumerate(nums):
    for bi, b in enumerate(booths):
        if b["minx"] <= nx <= b["maxx"] and b["miny"] <= ny <= b["maxy"] and point_in_poly(nx, ny, b["pts"]):
            pairs.append((0.0, b["area"], ni, bi))
        else:
            dist = math.hypot(b["cx"] - nx, b["cy"] - ny)
            if dist <= RADIUS_FACTOR * b["diag"]:
                pairs.append((dist, b["area"], ni, bi))
pairs.sort(key=lambda t: (t[0], t[1]))
num_taken = [False] * len(nums)
for dist, _, ni, bi in pairs:
    if num_taken[ni] or booths[bi]["number"] is not None:
        continue
    booths[bi]["number"] = nums[ni][2]
    num_taken[ni] = True
orphans = [(nx, ny, s) for ni, (nx, ny, s) in enumerate(nums) if not num_taken[ni]]

# =====================================================================
#  SVG — geometry + booth labels (number + dimensions) centred on each booth
# =====================================================================
def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

def dim_str(b):
    return f"{round(b['w'] / 1000, 1):g} × {round(b['d'] / 1000, 1):g}"

STYLE = {"venue": ("#9aa0a6", 90), "booth": ("#1a56db", 70), "stand": ("#c0392b", 40)}

with open(OUT_SVG, "w") as out:
    out.write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W:.1f} {H:.1f}" '
              f'style="background:white" font-family="Helvetica,Arial,sans-serif">\n')
    for group in ("venue", "stand", "booth"):
        if not segs[group]:
            continue
        col, w = STYLE[group]
        out.write(f'<g stroke="{col}" stroke-width="{w}" fill="none" stroke-linecap="round" class="{group}">\n')
        for x1, y1, x2, y2 in segs[group]:
            out.write(f'<line x1="{fx(x1):.1f}" y1="{fy(y1):.1f}" x2="{fx(x2):.1f}" y2="{fy(y2):.1f}"/>\n')
        out.write("</g>\n")

    # area headings kept from CAD (e.g. "MERCH AREA")
    out.write('<g fill="#5f6368" text-anchor="middle" font-weight="600" class="areas">\n')
    for x, y, h, s in texts:
        out.write(f'<text x="{fx(x):.1f}" y="{fy(y):.1f}" font-size="{max(h, 800):.0f}">{esc(s)}</text>\n')
    out.write("</g>\n")

    # Booth number (top) + dimensions (below) as a block centred on the booth, sized
    # to fit the booth's bounding box so nothing spills outside. CW ≈ glyph width /
    # font size; we fit both the booth's height (stacked lines) and width (longest line).
    out.write('<g text-anchor="middle" class="labels">\n')
    CW = 0.62
    for b in booths:
        bw = b["maxx"] - b["minx"]
        bh = b["maxy"] - b["miny"]
        cxf, cyf = fx(b["cx"]), fy(b["cy"])
        dim = dim_str(b)
        num = b["number"]
        if num:
            # number font: fit height (two lines fit when font_n ≤ ~0.42*bh) and width
            font_n = min(bh * 0.42, bw * 0.86 / (len(num) * CW), 2200.0)
            if font_n < 240:
                continue  # booth too small for a readable label
            font_d = min(font_n * 0.6, bw * 0.86 / (len(dim) * CW))
            if font_d >= 200:  # room for both lines: centre the block on the centroid
                gap = font_n * 0.12
                block = font_n + gap + font_d
                y_n = cyf - block / 2 + font_n * 0.5
                y_d = cyf + block / 2 - font_d * 0.5
                out.write(f'<text x="{cxf:.1f}" y="{y_n:.1f}" font-size="{font_n:.0f}" '
                          f'fill="#0f3d8a" dominant-baseline="central">{esc(num)}</text>\n')
                out.write(f'<text x="{cxf:.1f}" y="{y_d:.1f}" font-size="{font_d:.0f}" '
                          f'fill="#5f6368" dominant-baseline="central">{dim}</text>\n')
            else:  # only room for the number — centre it
                out.write(f'<text x="{cxf:.1f}" y="{cyf:.1f}" font-size="{font_n:.0f}" '
                          f'fill="#0f3d8a" dominant-baseline="central">{esc(num)}</text>\n')
        else:
            font_d = min(bh * 0.5, bw * 0.86 / (len(dim) * CW), 1600.0)
            if font_d >= 240:
                out.write(f'<text x="{cxf:.1f}" y="{cyf:.1f}" font-size="{font_d:.0f}" '
                          f'fill="#80868b" dominant-baseline="central">{dim}</text>\n')
    # orphan numbers (no booth outline) drawn at their point
    for nx, ny, s in orphans:
        out.write(f'<text x="{fx(nx):.1f}" y="{fy(ny):.1f}" font-size="900" '
                  f'fill="#0f3d8a" dominant-baseline="central">{esc(s)}</text>\n')
    out.write("</g>\n</svg>\n")

# emit booth records in the SAME framed coordinate space as the SVG (so the webapp can
# overlay them on the floorplan directly): x' = x - minx, y' = maxy - y.
out_booths = []
for b in booths:
    rect = b["w"] * b["d"] / 1e6
    area = b["area"] / 1e6
    rec = {
        "number": b["number"], "kind": b["kind"],
        "width_m": round(b["w"] / 1000, 2), "depth_m": round(b["d"] / 1000, 2),
        "area_m2": round(area, 2), "irregular": rect > 0 and (rect - area) / rect > 0.02,
        "centroid": [round(fx(b["cx"]), 1), round(fy(b["cy"]), 1)],
        "polygon": [[round(fx(x), 1), round(fy(y), 1)] for x, y in b["pts"]],
    }
    # EVIDENCE: overlapping polygons we merged into this booth (see ABSORB_CONTAINED_SUBPOLYS).
    # Preserved so a future change can audit or restore the original source polygons.
    if b.get("absorbed"):
        rec["absorbed"] = [
            {"kind": a["kind"], "area_m2": round(a["area"] / 1e6, 2),
             "polygon": [[round(fx(x), 1), round(fy(y), 1)] for x, y in a["pts"]]}
            for a in b["absorbed"]
        ]
    out_booths.append(rec)
for nx, ny, s in orphans:
    out_booths.append({"number": s, "kind": "label_only", "width_m": None, "depth_m": None,
                       "area_m2": None, "irregular": None,
                       "centroid": [round(fx(nx), 1), round(fy(ny), 1)], "polygon": None})

named = sum(1 for b in out_booths if b["number"])
absorbed_total = sum(len(b.get("absorbed", [])) for b in booths)
with open(OUT_BOOTHS, "w") as f:
    json.dump({"units": "m", "viewBox": [round(W, 1), round(H, 1)],
               "count": len(out_booths), "named": named, "absorbed": absorbed_total,
               "booths": out_booths}, f)

# ---- optional compact thumbnail (filled booths + major walls, no text) ----
if OUT_THUMB:
    big = max(W, H)
    sw_v = big / 500    # venue stroke, integer-rounded coords keep it small
    sw_b = big / 700
    thumb_min = 4000.0  # only long walls in the thumbnail
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W:.0f} {H:.0f}" '
             f'style="background:white">']
    parts.append(f'<g stroke="#cdd1d6" stroke-width="{sw_v:.0f}" fill="none" stroke-linecap="round">')
    for x1, y1, x2, y2 in segs["venue"]:
        if (x1 - x2) ** 2 + (y1 - y2) ** 2 >= thumb_min * thumb_min:
            parts.append(f'<line x1="{fx(x1):.0f}" y1="{fy(y1):.0f}" x2="{fx(x2):.0f}" y2="{fy(y2):.0f}"/>')
    parts.append("</g>")
    parts.append(f'<g fill="#dbe5fb" stroke="#1a56db" stroke-width="{sw_b:.0f}" stroke-linejoin="round">')
    for b in booths:
        pts = " ".join(f"{fx(x):.0f},{fy(y):.0f}" for x, y in b["pts"])
        parts.append(f'<polygon points="{pts}"/>')
    parts.append("</g></svg>")
    with open(OUT_THUMB, "w") as f:
        f.write("\n".join(parts))

# machine-readable summary for the caller
print(json.dumps({"width": round(W, 1), "height": round(H, 1),
                  "boothCount": len(out_booths), "named": named,
                  "absorbed": absorbed_total,
                  "segments": {k: len(v) for k, v in segs.items()}}))
