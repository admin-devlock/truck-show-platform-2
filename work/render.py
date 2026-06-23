import ezdxf
from ezdxf import recover
import math

doc, auditor = recover.readfile('plazamin.dxf')
msp = doc.modelspace()

lines = []  # list of (x1,y1,x2,y2)

def add_line(p1, p2):
    lines.append((p1[0], p1[1], p2[0], p2[1]))

for e in msp:
    t = e.dxftype()
    try:
        if t == 'LINE':
            add_line(e.dxf.start, e.dxf.end)
        elif t == 'LWPOLYLINE':
            pts = list(e.get_points('xy'))
            closed = e.closed
            for i in range(len(pts) - 1):
                add_line(pts[i], pts[i+1])
            if closed and len(pts) > 2:
                add_line(pts[-1], pts[0])
        elif t == 'POLYLINE':
            pts = [v.dxf.location for v in e.vertices]
            closed = e.is_closed
            for i in range(len(pts) - 1):
                add_line(pts[i], pts[i+1])
            if closed and len(pts) > 2:
                add_line(pts[-1], pts[0])
        elif t == 'CIRCLE':
            c = e.dxf.center
            r = e.dxf.radius
            n = 32
            pts = [(c[0] + r*math.cos(2*math.pi*i/n), c[1] + r*math.sin(2*math.pi*i/n)) for i in range(n+1)]
            for i in range(n):
                add_line(pts[i], pts[i+1])
        elif t == 'ARC':
            c = e.dxf.center
            r = e.dxf.radius
            a1 = math.radians(e.dxf.start_angle)
            a2 = math.radians(e.dxf.end_angle)
            if a2 < a1:
                a2 += 2*math.pi
            n = 16
            pts = [(c[0] + r*math.cos(a1 + (a2-a1)*i/n), c[1] + r*math.sin(a1 + (a2-a1)*i/n)) for i in range(n+1)]
            for i in range(n):
                add_line(pts[i], pts[i+1])
    except Exception as ex:
        pass

print("total segments:", len(lines))

xs = [v for l in lines for v in (l[0], l[2])]
ys = [v for l in lines for v in (l[1], l[3])]
minx, maxx = min(xs), max(xs)
miny, maxy = min(ys), max(ys)
print("bounds:", minx, miny, maxx, maxy)

W = 1600
H = int(W * (maxy - miny) / (maxx - minx))

def sx(x):
    return (x - minx) / (maxx - minx) * W

def sy(y):
    # flip Y for SVG
    return H - (y - miny) / (maxy - miny) * H

svg_lines = []
for x1, y1, x2, y2 in lines:
    svg_lines.append(f'<line x1="{sx(x1):.2f}" y1="{sy(y1):.2f}" x2="{sx(x2):.2f}" y2="{sy(y2):.2f}" stroke="black" stroke-width="1.5"/>')

svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" style="background:white">
{chr(10).join(svg_lines)}
</svg>'''

with open('plaza.svg', 'w') as f:
    f.write(svg)

print("done")
