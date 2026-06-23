import json, re, sys, math
from collections import defaultdict, Counter

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
    if not o.get('entity'): continue
    own = o.get('ownerhandle')
    if o.get('entmode', 0) == 2:
        by_owner[2].append(o)
    elif own:
        by_owner[own[-1]].append(o)

def lname(o):
    l = o.get('layer')
    return layers.get(l[-1], '?') if l else '?'

# Find the modelspace INSERT(s) on Y-VENUE-X-REF and recurse, counting child layers + segments
def count_segs(o):
    et = o['entity']
    if et == 'LINE': return 1
    if et == 'LWPOLYLINE': return max(0, len(o.get('points') or [])-1)
    if et == 'POLYLINE_2D':
        vs=[v for v in by_owner.get(o['handle'][-1],[]) if v.get('entity')=='VERTEX_2D']
        return max(0,len(vs)-1)
    if et in ('ARC','CIRCLE'): return 12
    return 0

layer_seg = Counter()
layer_ecount = Counter()

def walk(o, depth=0):
    if depth>5: return
    et=o['entity']
    if et=='INSERT':
        bh=o.get('block_header')
        if not bh: return
        for ch in by_owner.get(bh[-1],[]):
            if ch.get('entity') in ('ENDBLK','BLOCK','SEQEND'): continue
            walk(ch, depth+1)
    else:
        lay=lname(o)
        layer_seg[lay]+=count_segs(o)
        layer_ecount[lay]+=1

ms=by_owner.get(2,[])
venue_inserts=[o for o in ms if o['entity']=='INSERT' and lname(o)=='Y-VENUE-X-REF']
print("venue inserts in modelspace:", len(venue_inserts), file=sys.stderr)
for vi in venue_inserts:
    walk(vi)

print("\n=== Sublayers inside Y-VENUE-X-REF xref (by segment count) ===", file=sys.stderr)
for lay,seg in layer_seg.most_common(40):
    print(f"{seg:8d} segs  {layer_ecount[lay]:6d} ents  {lay!r}", file=sys.stderr)
