import json, re, sys, math
from collections import defaultdict

SRC = sys.argv[1] if len(sys.argv) > 1 else 'plaza.min.json'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'plaza_booths.json'

# Booth outlines may live on several layers; higher priority wins when polygons
# overlap (the same booth is often drawn on both a built layer and a space layer).
# Order = most-canonical first. Generalises across maps; add layer names as found.
BOOTH_LAYERS = [
    ('BOOTHLINE', 'built'),
    ('P-SPACE_ONLY', 'space_only'),
    ('P-SPACE_ONLY_HIDE ON BUILD', 'space_only'),
    ('P-SPACE_ONLY_HIDE-ON-BUILD', 'space_only'),
]
NUM_LAYERS = ['P-booth_nos']

with open(SRC, encoding='utf-8', errors='replace') as f:
    raw = f.read()
raw = re.sub(r'(?<=[ ,\[:])(-?)nan(?=[, \]\n])', r'\1NaN', raw)
raw = re.sub(r'(?<=[ ,\[:])(-?)inf(?=[, \]\n])', r'\1Infinity', raw)
doc = json.loads(raw); del raw
objs = doc['OBJECTS']

layers = {o['handle'][-1]: o.get('name', '?') for o in objs if o.get('object') == 'LAYER'}
by_owner = defaultdict(list)
for o in objs:
    if not o.get('entity'):
        continue
    if o.get('entmode', 0) == 2:
        by_owner[2].append(o)
    elif o.get('ownerhandle'):
        by_owner[o['ownerhandle'][-1]].append(o)
ms = by_owner.get(2, [])

def lname(o):
    l = o.get('layer')
    return layers.get(l[-1], '?') if l else '?'

# ---------- geometry helpers ----------
def dedup_pts(pts):
    out = []
    for p in pts:
        if not out or abs(p[0]-out[-1][0]) > 1e-6 or abs(p[1]-out[-1][1]) > 1e-6:
            out.append(p)
    if len(out) > 1 and abs(out[0][0]-out[-1][0]) < 1e-6 and abs(out[0][1]-out[-1][1]) < 1e-6:
        out.pop()
    return out

def poly_area(pts):
    a = 0.0; n = len(pts)
    for i in range(n):
        x1, y1 = pts[i]; x2, y2 = pts[(i+1) % n]
        a += x1*y2 - x2*y1
    return abs(a)/2.0

def centroid(pts):
    a = cx = cy = 0.0; n = len(pts)
    for i in range(n):
        x1, y1 = pts[i]; x2, y2 = pts[(i+1) % n]
        cr = x1*y2 - x2*y1; a += cr; cx += (x1+x2)*cr; cy += (y1+y2)*cr
    if abs(a) < 1e-9:
        return (sum(p[0] for p in pts)/n, sum(p[1] for p in pts)/n)
    a *= 0.5
    return (cx/(6*a), cy/(6*a))

def convex_hull(pts):
    pts = sorted(set((round(x, 4), round(y, 4)) for x, y in pts))
    if len(pts) <= 2:
        return pts
    def cross(o, a, b):
        return (a[0]-o[0])*(b[1]-o[1]) - (a[1]-o[1])*(b[0]-o[0])
    lo = []
    for p in pts:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0:
            lo.pop()
        lo.append(p)
    up = []
    for p in reversed(pts):
        while len(up) >= 2 and cross(up[-2], up[-1], p) <= 0:
            up.pop()
        up.append(p)
    return lo[:-1] + up[:-1]

def min_area_rect(pts):
    h = convex_hull(pts)
    if len(h) < 3:
        xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
        w, d = max(xs)-min(xs), max(ys)-min(ys)
        return (max(w, d), min(w, d))
    best = None; n = len(h)
    for i in range(n):
        ax, ay = h[i]; bx, by = h[(i+1) % n]
        ex, ey = bx-ax, by-ay; el = math.hypot(ex, ey)
        if el < 1e-9:
            continue
        ux, uy = ex/el, ey/el; vx, vy = -uy, ux
        minu = minv = 1e18; maxu = maxv = -1e18
        for px, py in h:
            du = (px-ax)*ux + (py-ay)*uy; dv = (px-ax)*vx + (py-ay)*vy
            minu = min(minu, du); maxu = max(maxu, du)
            minv = min(minv, dv); maxv = max(maxv, dv)
        area = (maxu-minu)*(maxv-minv)
        if best is None or area < best[0]:
            best = (area, maxu-minu, maxv-minv)
    _, w, d = best
    return (max(w, d), min(w, d))

def point_in_poly(x, y, pts):
    inside = False; n = len(pts); j = n-1
    for i in range(n):
        xi, yi = pts[i]; xj, yj = pts[j]
        if ((yi > y) != (yj > y)) and (x < (xj-xi)*(y-yi)/(yj-yi+1e-12) + xi):
            inside = not inside
        j = i
    return inside

# ---------- collect booth polygons from all booth layers ----------
layer_kind = {name: kind for name, kind in BOOTH_LAYERS}
layer_prio = {name: i for i, (name, _) in enumerate(BOOTH_LAYERS)}  # lower = more canonical
raw_polys = []
for o in ms:
    lay = lname(o)
    if lay in layer_kind and o['entity'] == 'LWPOLYLINE':
        pts = dedup_pts([(p[0], p[1]) for p in (o.get('points') or [])])
        if len(pts) >= 3:
            cx, cy = centroid(pts)
            raw_polys.append({'pts': pts, 'cx': cx, 'cy': cy, 'area': poly_area(pts),
                              'kind': layer_kind[lay], 'prio': layer_prio[lay]})

# ---------- dedup overlapping polygons across layers (same booth on two layers) ----------
# Keep the most-canonical (lowest prio). Two polys are "the same booth" if one's
# centroid lies inside the other and their areas are within 40%.
raw_polys.sort(key=lambda b: (b['prio'], -b['area']))
booths = []
for b in raw_polys:
    dup = False
    for k in booths:
        amin, amax = sorted((b['area'], k['area']))
        if amax > 0 and amin/amax >= 0.6 and (
            point_in_poly(b['cx'], b['cy'], k['pts']) or point_in_poly(k['cx'], k['cy'], b['pts'])):
            dup = True
            break
    if not dup:
        w, d = min_area_rect(b['pts'])
        xs = [p[0] for p in b['pts']]; ys = [p[1] for p in b['pts']]
        b.update({'w': w, 'd': d, 'diag': math.hypot(w, d), 'number': None,
                  'minx': min(xs), 'maxx': max(xs), 'miny': min(ys), 'maxy': max(ys)})
        booths.append(b)

# ---------- collect + classify number labels ----------
def booth_like(s):
    s = s.strip()
    if not s or ' ' in s or len(s) > 6:
        return False
    if not any(ch.isdigit() for ch in s):
        return False
    return all(ch.isalnum() for ch in s)

raw_nums = []
for o in ms:
    if lname(o) in NUM_LAYERS and o['entity'] in ('TEXT', 'MTEXT'):
        p = o.get('ins_pt'); s = (o.get('text_value') or o.get('text') or '').strip()
        if p and s:
            raw_nums.append((p[0], p[1], s))
nums = [(x, y, s) for (x, y, s) in raw_nums if booth_like(s)]
dropped = sorted(set(s for (x, y, s) in raw_nums if not booth_like(s)))

# ---------- candidate (label, booth) pairs ----------
# inside -> distance 0 (prefer smallest containing booth); else centroid distance,
# kept only within a size-relative radius so leftovers fill the right neighbour.
RADIUS_FACTOR = 0.9
pairs = []
for ni, (nx, ny, s) in enumerate(nums):
    for bi, b in enumerate(booths):
        if b['minx'] <= nx <= b['maxx'] and b['miny'] <= ny <= b['maxy'] and point_in_poly(nx, ny, b['pts']):
            pairs.append((0.0, b['area'], ni, bi))   # tie-break: smaller area first
        else:
            dist = math.hypot(b['cx']-nx, b['cy']-ny)
            if dist <= RADIUS_FACTOR * b['diag']:
                pairs.append((dist, b['area'], ni, bi))

pairs.sort(key=lambda t: (t[0], t[1]))
num_taken = [False]*len(nums)
inside = near = 0
for dist, _, ni, bi in pairs:
    if num_taken[ni] or booths[bi]['number'] is not None:
        continue
    booths[bi]['number'] = nums[ni][2]
    num_taken[ni] = True
    if dist == 0.0:
        inside += 1
    else:
        near += 1

# ---------- orphan labels (no polygon) become point-booths ----------
orphans = [(nx, ny, s) for ni, (nx, ny, s) in enumerate(nums) if not num_taken[ni]]

# ---------- emit ----------
out = []
for b in booths:
    rect = b['w']*b['d']/1e6
    area = b['area']/1e6
    # "irregular" = polygon fills meaningfully less than its min-area rectangle
    # (L-shapes, chamfers). Tolerance keeps sub-cm CAD noise from tripping it.
    irregular = rect > 0 and (rect - area)/rect > 0.02
    out.append({
        'number': b['number'], 'kind': b['kind'],
        'width_m': round(b['w']/1000, 2), 'depth_m': round(b['d']/1000, 2),
        'area_m2': round(area, 2), 'irregular': irregular,
        'centroid': [round(b['cx'], 1), round(b['cy'], 1)],
        'polygon': [[round(x, 1), round(y, 1)] for x, y in b['pts']],
    })
for nx, ny, s in orphans:
    out.append({'number': s, 'kind': 'label_only', 'width_m': None, 'depth_m': None,
                'area_m2': None, 'irregular': None, 'centroid': [round(nx, 1), round(ny, 1)],
                'polygon': None})

named = sum(1 for b in out if b['number'])
with open(OUT, 'w') as f:
    json.dump({'source': SRC, 'units': 'm', 'count': len(out), 'named': named,
               'booths': out}, f, indent=1)

print(f"booth polygons (deduped): {len(booths)}  | labels: {len(raw_nums)} "
      f"(booth-like {len(nums)}, dropped {len(dropped)}: {dropped[:6]})", file=sys.stderr)
print(f"matched: inside {inside}, nearest-fill {near}  | "
      f"unnumbered polygons: {sum(1 for b in booths if not b['number'])}  | "
      f"orphan labels kept as point-booths: {len(orphans)} {[s for _,_,s in orphans]}", file=sys.stderr)
print(f"OUTPUT: {len(out)} booth records, {named} with a number -> {OUT}", file=sys.stderr)
