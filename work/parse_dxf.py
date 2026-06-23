import math, sys

FN = 'plaza_r2000.dxf'

class Reader:
    """Reads (code, value) pairs from a DXF file with one-token pushback."""
    def __init__(self, f):
        self.f = f
        self.pending = None

    def next_pair(self):
        if self.pending is not None:
            p = self.pending
            self.pending = None
            return p
        code = self.f.readline()
        if not code:
            return None
        val = self.f.readline()
        if not val:
            return None
        return int(code.strip()), val.rstrip('\n').rstrip('\r')

    def push_back(self, pair):
        self.pending = pair


def read_entity(r, etype):
    """Read one entity's group codes until the next 0-code. Pushes back the terminating pair."""
    data = {}
    pts = []
    cur_pt = {}
    while True:
        pair = r.next_pair()
        if pair is None:
            break
        code, val = pair
        if code == 0:
            if cur_pt:
                pts.append(cur_pt)
            r.push_back(pair)
            break
        if code in (10, 20, 30, 11, 21, 31, 40, 41, 42, 50, 51, 70, 8, 2, 1):
            if code == 10:
                if cur_pt:
                    pts.append(cur_pt)
                cur_pt = {}
            if code in (10, 20, 30, 42):
                cur_pt[code] = float(val)
            data.setdefault(code, []).append(val)
    if cur_pt and cur_pt not in pts:
        pts.append(cur_pt)
    return etype, data, pts

def fnum(d, code, default=0.0, idx=0):
    try:
        return float(d.get(code, [default])[idx])
    except (IndexError, ValueError):
        return default

# ------- Pass 1: parse BLOCKS section -------
blocks = {}

print("Pass 1: parsing BLOCKS section...", file=sys.stderr)
with open(FN, 'r', errors='replace') as f:
    r = Reader(f)
    in_blocks = False
    cur_block = None
    while True:
        pair = r.next_pair()
        if pair is None:
            break
        code, val = pair
        if code == 0 and val == 'SECTION':
            pair2 = r.next_pair()
            if pair2 and pair2[0] == 2 and pair2[1] == 'BLOCKS':
                in_blocks = True
            else:
                in_blocks = False
            continue
        if not in_blocks:
            continue
        if code == 0 and val == 'ENDSEC':
            break
        if code != 0:
            continue
        if val == 'BLOCK':
            etype, data, pts = read_entity(r, val)
            name = data.get(2, [''])[0]
            base = (fnum(data, 10), fnum(data, 20))
            cur_block = {'base': base, 'entities': []}
            blocks[name] = cur_block
        elif val == 'ENDBLK':
            etype, data, pts = read_entity(r, val)
            cur_block = None
        else:
            etype, data, pts = read_entity(r, val)
            if cur_block is not None:
                cur_block['entities'].append((etype, data, pts))

print("blocks parsed:", len(blocks), file=sys.stderr)

# ------- Pass 2: parse ENTITIES section (modelspace) -------
modelspace = []
print("Pass 2: parsing ENTITIES section...", file=sys.stderr)
with open(FN, 'r', errors='replace') as f:
    r = Reader(f)
    in_ents = False
    while True:
        pair = r.next_pair()
        if pair is None:
            break
        code, val = pair
        if code == 0 and val == 'SECTION':
            pair2 = r.next_pair()
            if pair2 and pair2[0] == 2 and pair2[1] == 'ENTITIES':
                in_ents = True
            else:
                in_ents = False
            continue
        if not in_ents:
            continue
        if code == 0 and val == 'ENDSEC':
            break
        if code != 0:
            continue
        etype, data, pts = read_entity(r, val)
        modelspace.append((etype, data, pts))

print("modelspace entities:", len(modelspace), file=sys.stderr)
from collections import Counter
print(Counter(e[0] for e in modelspace).most_common(20), file=sys.stderr)

# ------- Geometry extraction with transforms -------
lines = []

def add_line(p1, p2):
    lines.append((p1[0], p1[1], p2[0], p2[1]))

def transform_pt(x, y, ins, scale, rot, base):
    bx, by = base
    sx, sy = scale
    x, y = (x - bx) * sx, (y - by) * sy
    a = math.radians(rot)
    rx = x * math.cos(a) - y * math.sin(a)
    ry = x * math.sin(a) + y * math.cos(a)
    return (rx + ins[0], ry + ins[1])

def emit_entity(etype, data, pts, ins=(0,0), scale=(1,1), rot=0, base=(0,0), depth=0):
    if depth > 6:
        return
    def T(x, y):
        return transform_pt(x, y, ins, scale, rot, base)

    if etype == 'LINE':
        x1, y1 = fnum(data,10), fnum(data,20)
        x2, y2 = fnum(data,11), fnum(data,21)
        add_line(T(x1,y1), T(x2,y2))
    elif etype == 'LWPOLYLINE':
        flags = int(fnum(data,70,0))
        closed = bool(flags & 1)
        coords = [(p.get(10,0.0), p.get(20,0.0)) for p in pts if 10 in p]
        tcoords = [T(x,y) for x,y in coords]
        for i in range(len(tcoords)-1):
            add_line(tcoords[i], tcoords[i+1])
        if closed and len(tcoords) > 2:
            add_line(tcoords[-1], tcoords[0])
    elif etype == 'CIRCLE':
        cx, cy = fnum(data,10), fnum(data,20)
        r = fnum(data,40)
        n = 24
        prev = None
        for i in range(n+1):
            ang = 2*math.pi*i/n
            p = T(cx + r*math.cos(ang), cy + r*math.sin(ang))
            if prev:
                add_line(prev, p)
            prev = p
    elif etype == 'ARC':
        cx, cy = fnum(data,10), fnum(data,20)
        r = fnum(data,40)
        a1 = math.radians(fnum(data,50))
        a2 = math.radians(fnum(data,51))
        if a2 < a1:
            a2 += 2*math.pi
        n = 12
        prev = None
        for i in range(n+1):
            ang = a1 + (a2-a1)*i/n
            p = T(cx + r*math.cos(ang), cy + r*math.sin(ang))
            if prev:
                add_line(prev, p)
            prev = p
    elif etype == 'INSERT':
        bname = data.get(2, [''])[0]
        ix, iy = fnum(data,10), fnum(data,20)
        isx = fnum(data,41,1.0)
        isy = fnum(data,42,1.0)
        irot = fnum(data,50,0.0)
        new_ins = T(ix, iy)
        new_scale = (scale[0]*isx, scale[1]*isy)
        new_rot = rot + irot
        blk = blocks.get(bname)
        if blk:
            for be_type, be_data, be_pts in blk['entities']:
                emit_entity(be_type, be_data, be_pts, ins=new_ins, scale=new_scale, rot=new_rot, base=blk['base'], depth=depth+1)

print("Pass 3: extracting geometry...", file=sys.stderr)
for i, (etype, data, pts) in enumerate(modelspace):
    emit_entity(etype, data, pts)

print("total segments:", len(lines), file=sys.stderr)

xs = [v for l in lines for v in (l[0], l[2])]
ys = [v for l in lines for v in (l[1], l[3])]
minx, maxx = min(xs), max(xs)
miny, maxy = min(ys), max(ys)
print("bounds:", minx, miny, maxx, maxy, file=sys.stderr)

W = 2000
H = int(W * (maxy - miny) / (maxx - minx))

def sx(x):
    return (x - minx) / (maxx - minx) * W

def sy(y):
    return H - (y - miny) / (maxy - miny) * H

with open('plaza3.svg', 'w') as out:
    out.write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" style="background:white">\n')
    for x1, y1, x2, y2 in lines:
        out.write(f'<line x1="{sx(x1):.2f}" y1="{sy(y1):.2f}" x2="{sx(x2):.2f}" y2="{sy(y2):.2f}" stroke="black" stroke-width="0.4"/>\n')
    out.write('</svg>\n')

print("done", file=sys.stderr)
