import json, re, sys, math
from collections import defaultdict

# ---- tunables ----
VENUE_MIN_LEN = 1500.0   # mm; drop venue segments shorter than this (hatch/furniture/detail)
VENUE_MAX_LEN = 80000.0  # mm; drop absurdly long strays (leaders/construction lines)
INCLUDE_STAND_WALLS = False   # SYMA/UNI booth-stand construction detail

print("loading json...", file=sys.stderr)
with open('plaza.min.json', encoding='utf-8', errors='replace') as f:
    raw = f.read()
raw = re.sub(r'(?<=[ ,\[:])(-?)nan(?=[, \]\n])', r'\1NaN', raw)
raw = re.sub(r'(?<=[ ,\[:])(-?)inf(?=[, \]\n])', r'\1Infinity', raw)
doc = json.loads(raw); del raw
objs = doc['OBJECTS']

layers = {}
for o in objs:
    if o.get('object') == 'LAYER':
        layers[o['handle'][-1]] = o.get('name', '?')

by_owner = defaultdict(list)
for o in objs:
    if not o.get('entity'):
        continue
    own = o.get('ownerhandle')
    if o.get('entmode', 0) == 2:
        by_owner[2].append(o)
    elif own:
        by_owner[own[-1]].append(o)

ms = by_owner.get(2, [])
print("modelspace entities:", len(ms), file=sys.stderr)

def lname(o):
    l = o.get('layer')
    return layers.get(l[-1], '?') if l else '?'

def clean_mtext(s):
    s = re.sub(r'\{\\f[^;]*;', '', s)
    s = re.sub(r'\\[A-Za-z][^;\\}]*;?', '', s)
    s = s.replace('{', '').replace('}', '').replace('\\P', ' ')
    return s.strip()

# group buckets
segs = {'venue': [], 'booth': [], 'stand': []}
texts = []   # (x, y, height, string, kind)

def T_id(x, y):
    return (x, y)

def make_T(parent_T, ins, scale, rot):
    sx, sy = scale[0], scale[1]
    c, s = math.cos(rot), math.sin(rot)
    def T(x, y):
        x0, y0 = x * sx, y * sy
        rx = x0 * c - y0 * s
        ry = x0 * s + y0 * c
        return parent_T(ins[0] + rx, ins[1] + ry)
    return T

def add_seg(group, p, q, min_len=0.0):
    if min_len:
        d2 = (p[0]-q[0])**2 + (p[1]-q[1])**2
        if d2 < min_len*min_len or d2 > VENUE_MAX_LEN*VENUE_MAX_LEN:
            return
    segs[group].append((p[0], p[1], q[0], q[1]))

def emit_geom(o, T, group, min_len=0.0):
    et = o['entity']
    if et == 'LINE':
        p, q = o.get('start'), o.get('end')
        if p and q:
            add_seg(group, T(p[0], p[1]), T(q[0], q[1]), min_len)
    elif et == 'LWPOLYLINE':
        pts = [T(p[0], p[1]) for p in o.get('points') or []]
        closed = bool(o.get('flag', 0) & 512)
        for i in range(len(pts)-1):
            add_seg(group, pts[i], pts[i+1], min_len)
        if closed and len(pts) > 2:
            add_seg(group, pts[-1], pts[0], min_len)
    elif et == 'POLYLINE_2D':
        vs = [v for v in by_owner.get(o['handle'][-1], []) if v.get('entity') == 'VERTEX_2D']
        pts = [T(v['point'][0], v['point'][1]) for v in vs if v.get('point')]
        for i in range(len(pts)-1):
            add_seg(group, pts[i], pts[i+1], min_len)
    elif et == 'ARC':
        cpt, r = o.get('center'), o.get('radius', 0)
        if cpt and r:
            a1, a2 = o.get('start_angle', 0), o.get('end_angle', 0)
            if a2 < a1:
                a2 += 2*math.pi
            n = 8
            pts = [T(cpt[0]+r*math.cos(a1+(a2-a1)*i/n), cpt[1]+r*math.sin(a1+(a2-a1)*i/n)) for i in range(n+1)]
            for i in range(n):
                add_seg(group, pts[i], pts[i+1], min_len)
    elif et == 'CIRCLE':
        cpt, r = o.get('center'), o.get('radius', 0)
        if cpt and r:
            n = 16
            pts = [T(cpt[0]+r*math.cos(2*math.pi*i/n), cpt[1]+r*math.sin(2*math.pi*i/n)) for i in range(n+1)]
            for i in range(n):
                add_seg(group, pts[i], pts[i+1], min_len)

def walk_insert(o, T, group, min_len, depth=0):
    if depth > 5:
        return
    bh = o.get('block_header')
    if not bh:
        return
    ins = o.get('ins_pt', [0, 0, 0])
    scale = o.get('scale', [1, 1, 1])
    rot = o.get('rotation', 0.0) or 0.0
    Tc = make_T(T, ins, scale, rot)
    for ch in by_owner.get(bh[-1], []):
        et = ch.get('entity')
        if et in ('ENDBLK', 'BLOCK', 'SEQEND'):
            continue
        if et == 'INSERT':
            walk_insert(ch, Tc, group, min_len, depth+1)
        else:
            emit_geom(ch, Tc, group, min_len)

# layer routing for modelspace
BOOTH_LAYERS = {'BOOTHLINE', 'P-SPACE_ONLY', 'P-SPACE_ONLY_HIDE ON BUILD',
                'P-SPACE_ONLY_HIDE-ON-BUILD', 'DIV05-NO BUILD ZONE'}
STAND_PREFIXES = ('S-SYMA', 'UNI-', 'S-UPRIGHT', 'EV-UPRIGHT', '0C.SYMA',
                  'S-BRACING', 'P-Bracing', 'T-UNIFLEX', 'UNI-FASCIA')
LABEL_LAYERS = {'P-booth_nos', 'P-SPACE_ONLY', 'N-NOTES_Area_Name'}

for o in ms:
    lay = lname(o)
    et = o['entity']
    # text labels
    if et == 'TEXT' and lay in LABEL_LAYERS:
        p = o.get('ins_pt'); s = o.get('text_value', '')
        if p and s:
            texts.append((p[0], p[1], o.get('height', 1500.0), s, 'num'))
        continue
    if et == 'MTEXT' and lay in LABEL_LAYERS:
        p = o.get('ins_pt'); s = clean_mtext(o.get('text', ''))
        if p and s:
            texts.append((p[0], p[1], o.get('text_height', 1500.0), s, 'area'))
        continue
    # venue building -> long segments only
    if lay == 'Y-VENUE-X-REF':
        if et == 'INSERT':
            walk_insert(o, T_id, 'venue', VENUE_MIN_LEN)
        else:
            emit_geom(o, T_id, 'venue', VENUE_MIN_LEN)
        continue
    # booth outlines
    if lay in BOOTH_LAYERS:
        if et == 'INSERT':
            walk_insert(o, T_id, 'booth', 0.0)
        else:
            emit_geom(o, T_id, 'booth', 0.0)
        continue
    # stand construction detail (optional)
    if INCLUDE_STAND_WALLS and any(lay.startswith(p) for p in STAND_PREFIXES):
        if et == 'INSERT':
            walk_insert(o, T_id, 'stand', 0.0)
        else:
            emit_geom(o, T_id, 'stand', 0.0)
        continue

print("segments:", {k: len(v) for k, v in segs.items()}, "texts:", len(texts), file=sys.stderr)

# Frame to the BOOTH cluster (+ booth-number labels), not full extents — venue/leader
# lines have far-flung stray segments that otherwise shrink the map to nothing.
framepts = []
for x1, y1, x2, y2 in segs['booth']:
    framepts.append((x1, y1)); framepts.append((x2, y2))
for x, y, h, s, k in texts:
    if k == 'num':
        framepts.append((x, y))
fxs = [p[0] for p in framepts]; fys = [p[1] for p in framepts]
minx, maxx, miny, maxy = min(fxs), max(fxs), min(fys), max(fys)
print("booth bounds:", minx, miny, maxx, maxy, file=sys.stderr)

pad = 0.02 * max(maxx-minx, maxy-miny)
minx, maxx, miny, maxy = minx-pad, maxx+pad, miny-pad, maxy+pad
W, H = maxx-minx, maxy-miny

def fx(x): return x - minx
def fy(y): return maxy - y

STYLE = {
    'venue': ('#9aa0a6', 90),
    'booth': ('#1a56db', 70),
    'stand': ('#c0392b', 40),
}

with open('booths.svg', 'w') as out:
    out.write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W:.1f} {H:.1f}" '
              f'style="background:white" font-family="Helvetica,Arial,sans-serif">\n')
    for group in ('venue', 'stand', 'booth'):
        if not segs[group]:
            continue
        col, w = STYLE[group]
        out.write(f'<g stroke="{col}" stroke-width="{w}" fill="none" stroke-linecap="round" class="{group}">\n')
        for x1, y1, x2, y2 in segs[group]:
            out.write(f'<line x1="{fx(x1):.1f}" y1="{fy(y1):.1f}" x2="{fx(x2):.1f}" y2="{fy(y2):.1f}"/>\n')
        out.write('</g>\n')
    out.write('<g fill="#0f3d8a" text-anchor="middle" class="labels">\n')
    for x, y, h, s, kind in texts:
        esc = s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
        fs = max(h, 600) if kind == 'num' else max(h, 800)
        col = '#0f3d8a' if kind == 'num' else '#555'
        out.write(f'<text x="{fx(x):.1f}" y="{fy(y):.1f}" font-size="{fs:.0f}" fill="{col}">{esc}</text>\n')
    out.write('</g>\n</svg>\n')

print("done", file=sys.stderr)
