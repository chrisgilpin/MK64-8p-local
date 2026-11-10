import json, math, sys, zipfile, re
import numpy as np

G = json.load(open(sys.argv[1]))
secs = {s['name']: s for s in G['sections']}
marks = G['marks']; T = marks['tower']
fails = []
def check(cond, msg):
    print(('PASS ' if cond else 'FAIL ') + msg)
    if not cond: fails.append(msg)

def normal(t):
    a, b, c = (np.array(v[:3], float) for v in t)
    n = np.cross(b - a, c - b)   # engine: (v2-v1) x (v3-v2)
    l = np.linalg.norm(n)
    return n / l if l else n

# 1. floors face up (engine ignores normalY < -0.9 as floor)
for name in ['road', 'finish', 'boost_ramp', 'terrain']:
    ns = np.array([normal(t) for t in secs[name]['tris']])
    check((ns[:, 1] > 0.5).all(), f'{name}: all {len(ns)} floor tris face up (min ny={ns[:,1].min():.3f})')

# 2. s16 ranges
allv = np.array([v for s in G['sections'] for t in s['tris'] for v in t])
check(np.abs(allv[:, :3]).max() < 32000, f'coords within s16 (max |c|={np.abs(allv[:, :3]).max()})')
check(np.abs(allv[:, 3:]).max() < 32000, f'UVs within s16 (max |uv|={np.abs(allv[:, 3:]).max()})')

# 3. road stays outside the tower core
rv = np.array([v for n in ['road', 'finish', 'boost_ramp'] for t in secs[n]['tris'] for v in t], float)
d = np.hypot(rv[:, 0] - T['cx'], rv[:, 2] - T['cz'])
low = rv[:, 1] < T['coreTop']
check(d[low].min() >= T['coreR'] - 0.6, f'road clears tower core (min radius {d[low].min():.1f} vs core {T["coreR"]})')

# 4. stacked-level clearance (helix levels, bridge over the helix)
F = G['frames']; L = marks['L']
fx = np.array([[f['s'], f['x'], f['y'], f['z'], f['w']] for f in F])
gap = (fx[:, 0] > marks['GAP0']) & (fx[:, 0] < marks['GAP1'])
fr = fx[~gap]
minclear = 1e9; worst = None
for i in range(len(fr)):
    ds = np.abs(fr[:, 0] - fr[i, 0]); ds = np.minimum(ds, L - ds)
    hd = np.hypot(fr[:, 1] - fr[i, 1], fr[:, 3] - fr[i, 3])
    m = (ds > 600) & (hd < fr[:, 4] + fr[i, 4] + 40)
    if m.any():
        dy = np.abs(fr[m, 2] - fr[i, 2]).min()
        if dy < minclear: minclear, worst = dy, (fr[i, 0], fr[m][np.argmin(np.abs(fr[m, 2] - fr[i, 2])), 0])
check(minclear >= 180, f'overlapping road levels separated by >=180 (min {minclear:.1f} at s={worst})')

# 5. terrain never pokes through a road; clearance under elevated road
ter = np.array(secs['terrain']['tris'], float)
xs = sorted(set(ter[:, :, 0].ravel())); zs = sorted(set(ter[:, :, 2].ravel()))
xs = np.array(xs); zs = np.array(zs)
H = {}
for t in ter:
    for v in t: H[(v[0], v[2])] = v[1]
def terrain(x, z):
    j = np.searchsorted(xs, x) - 1; i = np.searchsorted(zs, z) - 1
    x0, x1, z0, z1 = xs[j], xs[j + 1], zs[i], zs[i + 1]
    u = (x - x0) / (x1 - x0); w = (z - z0) / (z1 - z0)
    h00, h01, h11, h10 = H[(x0, z0)], H[(x0, z1)], H[(x1, z1)], H[(x1, z0)]
    # split (x0,z0)-(x1,z1): tri a,b,c = (x0z0,x0z1,x1z1) has w>=u
    if w >= u: return h00 + (h11 - h01) * u + (h01 - h00) * w
    return h00 + (h10 - h00) * u + (h11 - h10) * w
gaps = []
for v in rv:
    gaps.append(v[1] - terrain(v[0], v[2]))
gaps = np.array(gaps)
check(gaps.min() >= 2.0, f'terrain stays below every road vertex (min gap {gaps.min():.2f})')
# also sample road interiors along the centreline at fine spacing
cl = [(f['x'], f['y'], f['z']) for f in F if not (marks['GAP0'] < f['s'] < marks['GAP1'])]
cg = np.array([y - terrain(x, z) for x, y, z in cl])
check(cg.min() >= 2.0, f'terrain below road centreline (min {cg.min():.2f})')
br = [(f['x'], f['y'], f['z'], f['w'], f['nx'], f['nz']) for f in F if marks['S_BRIDGE'] <= f['s'] <= marks['GAP0']]
bc = min(min(y - terrain(x + nx * k, z + nz * k) for k in (-w, 0, w)) for x, y, z, w, nx, nz in br)
check(bc >= 80, f'sky bridge clears the ground/hill by >=80 (min {bc:.1f})')

# 6. path sanity
P = G['path']
check(P[0] == {'x': 0, 'y': 0, 'z': 0}, 'path[0] at origin')
check(P[1]['z'] < 0 and abs(P[1]['x']) < 2, 'path leaves start heading -Z')
check(P[-1]['z'] > 0 and abs(P[-1]['x']) < 2, f'path ends behind start line (last {P[-1]})')
check(len(P) < 2000, f'path points {len(P)} < 2000')
sp = [math.dist((P[i]['x'], P[i]['z']), (P[i+1]['x'], P[i+1]['z'])) for i in range(len(P) - 1)]
check(max(sp) < 30 and min(sp) > 20, f'waypoint spacing {min(sp):.1f}..{max(sp):.1f}')
# path y matches road surface where there is road
pa = np.array([[p['x'], p['y'], p['z']] for p in P], float)
# human waypoint tracking = global 3D nearest; make sure every road sample's nearest waypoint is its own
idx_of = []
for f in F:
    if marks['GAP0'] < f['s'] < marks['GAP1']: continue
    for k in (-1, 0, 1):
        q = np.array([f['x'] + f['nx'] * f['w'] * 0.95 * k, f['y'] + 6, f['z'] + f['nz'] * f['w'] * 0.95 * k])
        j = np.argmin(((pa - q) ** 2).sum(1))
        exp = f['s'] / L * len(P)
        dj = min(abs(j - exp), len(P) - abs(j - exp))
        idx_of.append(dj)
check(max(idx_of) < 4, f'nearest waypoint is always local (max index error {max(idx_of):.1f})')

# 7. collision grid budget (u16 indices)
coll = [t for s in G['sections'] if s['clip'] != 0 for t in s['tris']]
ca = np.array(coll, float)
mnx, mxx = ca[:, :, 0].min() - 20, ca[:, :, 0].max() + 20
mnz, mxz = ca[:, :, 2].min() - 20, ca[:, :, 2].max() + 20
cx = (mxx - mnx) / 32; cz = (mxz - mnz) / 32
entries = 0; cell = np.zeros((32, 32), int)
for t in ca:
    i0 = int((t[:, 0].min() - mnx) // cx); i1 = int((t[:, 0].max() - mnx) // cx)
    j0 = int((t[:, 2].min() - mnz) // cz); j1 = int((t[:, 2].max() - mnz) // cz)
    for i in range(max(0, i0), min(31, i1) + 1):
        for j in range(max(0, j0), min(31, j1) + 1):
            cell[j, i] += 1; entries += 1
check(len(coll) < 30000, f'collision triangles {len(coll)}')
check(entries < 60000, f'collision grid entries ~{entries} (u16 budget 65535), busiest cell {cell.max()}')

# 8. item boxes sit on some road surface just below them
tris_floor = np.array([t for n in ['road', 'finish', 'boost_ramp'] for t in secs[n]['tris']], float)
def surface_below(x, y, z):
    best = -1e9
    for t in tris_floor:
        a, b, c = t[:, [0, 2]]
        if x < t[:, 0].min() or x > t[:, 0].max() or z < t[:, 2].min() or z > t[:, 2].max(): continue
        def sgn(p, q, r): return (p[0]-r[0])*(q[1]-r[1])-(q[0]-r[0])*(p[1]-r[1])
        p = (x, z); d1, d2, d3 = sgn(p, a, b), sgn(p, b, c), sgn(p, c, a)
        if (d1 < 0 or d2 < 0 or d3 < 0) and (d1 > 0 or d2 > 0 or d3 > 0): continue
        n = normal(t); h = t[0, 1] - (n[0]*(x-t[0,0]) + n[2]*(z-t[0,2]))/n[1]
        if h <= y + 10 and h > best: best = h
    return best
bad = []
for a in G['actors']:
    if a['Name'] != 'mk:item_box': continue
    l = a['Location']; h = surface_below(l['x'], l['y'], l['z'])
    if not (0 <= l['y'] - h <= 12): bad.append((l, h))
check(not bad, f'item boxes rest on road ({len(bad)} bad) {bad[:2]}')

# 9. the .o2r archive parses and every referenced resource exists
z = zipfile.ZipFile(sys.argv[2])
names = set(z.namelist())
refs = set()
for n in names:
    if n.endswith('.png') or n.endswith('.json') or n.endswith('.toml'): continue
    txt = z.read(n).decode()
    refs |= set(re.findall(r'Path="(tracks/[^"]+)"', txt))
    refs |= set(re.findall(r'gfx_path="([^"]+)"', txt))
missing = [r for r in refs if r not in names]
check(not missing, f'all {len(refs)} referenced resources present in archive')
import xml.dom.minidom
for n in names:
    if n.endswith(('.png', '.json', '.toml')): continue
    xml.dom.minidom.parseString(z.read(n))
check(True, 'all XML resources well-formed')
scene = json.loads(z.read('tracks/stair_tower/scene.json'))
check(scene['Props']['ResourceName'] == 'chris:stair_tower', 'scene resource is chris:stair_tower')
print('\n%d failures' % len(fails))
