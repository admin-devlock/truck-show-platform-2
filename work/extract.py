import json, sys
from collections import Counter, defaultdict

print("loading json...", file=sys.stderr)
import re
with open('plaza.min.json', encoding='utf-8', errors='replace') as f:
    raw = f.read()
raw = re.sub(r'(?<=[ ,\[:])(-?)nan(?=[, \]\n])', r'\1NaN', raw)
raw = re.sub(r'(?<=[ ,\[:])(-?)inf(?=[, \]\n])', r'\1Infinity', raw)
doc = json.loads(raw)
del raw

objs = doc['OBJECTS']
print("objects:", len(objs), file=sys.stderr)

layers = {}          # handle -> name
block_hdrs = {}      # handle -> name
for o in objs:
    if o.get('object') == 'LAYER':
        layers[o['handle'][-1]] = o.get('name', '?')
    elif o.get('object') == 'BLOCK_HEADER':
        block_hdrs[o['handle'][-1]] = o.get('name', '?')

print("layers:", len(layers), "blocks:", len(block_hdrs), file=sys.stderr)

GEOM = {'LINE', 'LWPOLYLINE', 'POLYLINE_2D', 'ARC', 'CIRCLE', 'INSERT',
        'MTEXT', 'TEXT', 'SPLINE', 'ELLIPSE', 'HATCH', 'POINT', '3DFACE'}

by_owner = defaultdict(list)
for o in objs:
    et = o.get('entity')
    if not et:
        continue
    own = o.get('ownerhandle')
    entmode = o.get('entmode', 0)
    if entmode == 2:
        owner = 2  # modelspace
    elif own:
        owner = own[-1]
    else:
        owner = None
    by_owner[owner].append(o)

ms = by_owner.get(2, [])
print("modelspace entities:", len(ms), file=sys.stderr)

# histogram: layer name -> Counter of entity types (modelspace only)
hist = defaultdict(Counter)
for o in ms:
    lay = layers.get(o.get('layer', [None])[-1] if o.get('layer') else None, '?')
    hist[lay][o.get('entity')] += 1

for lay in sorted(hist, key=lambda l: -sum(hist[l].values())):
    print(f"{sum(hist[lay].values()):6d}  {lay!r:50s} {dict(hist[lay].most_common(6))}")
