"""Validator for the Western track export (run after make-western.mjs)."""
import json, math, sys, os, re, struct, subprocess, zipfile, xml.dom.minidom
from itertools import groupby
import numpy as np

G = json.load(open(sys.argv[1])); Z = zipfile.ZipFile(sys.argv[2])
M = G['marks']; L = M['L']
secs = {s['name']: s for s in G['sections']}
fails = []
def check(cond, msg):
    print(('PASS ' if cond else 'FAIL ') + msg)
    if not cond: fails.append(msg)
def normals(tris):
    t = np.array(tris, float)[:, :, :3]
    n = np.cross(t[:, 1] - t[:, 0], t[:, 2] - t[:, 1])
    return n / (np.linalg.norm(n, axis=1, keepdims=True) + 1e-12)

# 1. floors face up, none so steep they count as walls
floors = [s for s in G['sections'] if s['clip'] == 1]
for s in floors:
    n = normals(s['tris']); lim = 0.0 if s['name'].startswith('terrain') else 0.5  # steep grass banks are fine (they act as walls)
    if (n[:, 1] <= lim).any(): check(False, f"{s['name']}: floor tris face up (min ny {n[:, 1].min():.3f})")
route_floors = [s for s in floors if s['name'].startswith('floor_')]
steep = sum(int((normals(s['tris'])[:, 1] < 0.72).sum()) for s in route_floors)
check(all((normals(s['tris'])[:, 1] > (0.0 if s['name'].startswith('terrain') else 0.5)).all() for s in floors), f'all {sum(len(s["tris"]) for s in floors)} floor tris face up')
check(steep == 0, f'no route floor steep enough to count as a wall ({steep})')
allv = np.array([v for s in G['sections'] for t in s['tris'] for v in t], float)
check(np.abs(allv[:, :3]).max() < 32000 and np.abs(allv[:, 3:]).max() < 32000, f'coords/UVs within s16 ({np.abs(allv[:, :3]).max():.0f} / {np.abs(allv[:, 3:]).max():.0f})')

# 2. every climb <= ~14% on the centreline and both edges
F = G['frames']
worst = (0, None)
for a, b in zip(F, F[1:]):
    if b['s'] <= a['s']: continue
    for k in (-1, 0, 1):
        pa = (a['x'] + a['nx'] * a['w'] * k, a['z'] + a['nz'] * a['w'] * k)
        pb = (b['x'] + b['nx'] * b['w'] * k, b['z'] + b['nz'] * b['w'] * k)
        d = math.dist(pa, pb)
        if d > 1 and (b['y'] - a['y']) / d > worst[0]: worst = ((b['y'] - a['y']) / d, (round(a['s']), k, a['kind']))
check(worst[0] <= 0.15, f'steepest climb {worst[0]:.3f} {worst[1]}')

# 3. stacked roads (the riverside path under the bridge) are far enough apart
fa = np.array([[f['s'], f['x'], f['y'], f['z'], f['w']] for f in F])
minsep, where = 1e9, None
for i in range(len(fa)):
    ds = np.abs(fa[:, 0] - fa[i, 0]); ds = np.minimum(ds, L - ds)
    m = (ds > 600) & (np.hypot(fa[:, 1] - fa[i, 1], fa[:, 3] - fa[i, 3]) < fa[:, 4] + fa[i, 4] - 5)
    if m.any():
        a = np.abs(fa[m, 2] - fa[i, 2]).min()
        if a < minsep: minsep, where = a, (round(fa[i, 0]), F[i]['kind'])
check(minsep >= 200, f'stacked route levels separated by >= 200 (min {minsep:.0f} at {where})')

# 4. nothing pokes up through the road: the highest floor under every point of
#    the lane is the road itself
ft = np.array([t for s in floors for t in s['tris']], float)[:, :, :3]
fname = [s['name'] for s in floors for t in s['tris']]
lo, hi = ft.min(1), ft.max(1)
def floors_at(x, z):
    m = np.where((lo[:, 0] <= x) & (hi[:, 0] >= x) & (lo[:, 2] <= z) & (hi[:, 2] >= z))[0]
    out = []
    for i in m:
        a, b, c = ft[i][:, [0, 2]]
        def sg(p, q, r): return (p[0] - r[0]) * (q[1] - r[1]) - (q[0] - r[0]) * (p[1] - r[1])
        p = (x, z); d1, d2, d3 = sg(p, a, b), sg(p, b, c), sg(p, c, a)
        if (d1 < 0 or d2 < 0 or d3 < 0) and (d1 > 0 or d2 > 0 or d3 > 0): continue
        n = np.cross(ft[i][1] - ft[i][0], ft[i][2] - ft[i][1]); n /= np.linalg.norm(n)
        out.append((ft[i][0, 1] - (n[0] * (x - ft[i][0, 0]) + n[2] * (z - ft[i][0, 2])) / n[1], fname[i]))
    return out
poke = []
for f in F[::3]:
    for k in (-0.95, -0.5, 0, 0.5, 0.95):
        x, z = f['x'] + f['nx'] * f['w'] * k, f['z'] + f['nz'] * f['w'] * k
        above = [(h, n) for h, n in floors_at(x, z) if f['y'] + 1.5 < h < f['y'] + 60 and not n.startswith('floor_')]
        if above: poke.append((round(f['s']), f['kind'], k, above[0][1], round(above[0][0] - f['y'], 1)))
check(not poke, f'no terrain or other floor pokes through the road ({len(poke)}) {poke[:3]}')

# 5. waypoints
P = G['path']; PS = np.array(G['pathS'])
check(P[0] == {'x': 0, 'y': 0, 'z': 0} and P[1]['z'] < 0 and P[-1]['z'] > 0 and abs(P[-1]['x']) < 2, 'path starts at the origin heading -Z and ends just behind the line')
sp = [math.dist((P[i]['x'], P[i]['y'], P[i]['z']), (P[i + 1]['x'], P[i + 1]['y'], P[i + 1]['z'])) for i in range(len(P) - 1)]
check(len(P) < 2000 and max(sp) < 32, f'{len(P)} waypoints, spacing {min(sp):.1f}..{max(sp):.1f}')
pa = np.array([[p['x'], p['y'], p['z']] for p in P], float)
errs = []
for f in F[::2]:
    for k in (-0.95, 0, 0.95):
        q = np.array([f['x'] + f['nx'] * f['w'] * k, f['y'] + 6, f['z'] + f['nz'] * f['w'] * k])
        j = np.argmin(((pa - q) ** 2).sum(1)); d = abs(PS[j] - f['s'])
        errs.append(min(d, L - d))
check(max(errs) < 200, f'nearest waypoint is always the local one (max s error {max(errs):.0f})')
badwp = [p for p in P[::4] if not any(-3 <= p['y'] - h <= 8 and n.startswith('floor_') for h, n in floors_at(p['x'], p['z']))]
check(not badwp, f'every waypoint sits on the road ({len(badwp)} off) {badwp[:2]}')

# 6. item boxes on the road, trees clear of every lane
badb = [a['Location'] for a in G['actors'] if a['Name'] == 'mk:item_box'
        and not any(0 <= a['Location']['y'] - h <= 12 and n.startswith('floor_') for h, n in floors_at(a['Location']['x'], a['Location']['z']))]
check(not badb, f'item boxes sit on the road ({len(badb)} bad) {badb[:2]}')
trees = [a['Location'] for a in G['actors'] if 'tree' in a['Name']]
fxz = fa[:, [1, 3]]
close = [t for t in trees if (np.hypot(fxz[:, 0] - t['x'], fxz[:, 1] - t['z']) - fa[:, 4]).min() < 60]
check(not close, f'{len(trees)} trees all well clear of the lanes ({len(close)} close)')
inwater = [t for t in trees if M['RIVER']['zW'] < t['z'] < M['RIVER']['zE']]
check(not inwater, 'no trees in the river')

# 7. walls: none (solid or visual) across the driving lane
r = subprocess.run([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lanecheck.py'), sys.argv[1]], capture_output=True, text=True)
check(r.returncode == 0, 'no wall crosses the driving lane: ' + r.stdout.strip().splitlines()[0])

# 8. collision grid budget
coll = np.array([t for s in G['sections'] if s['clip'] != 0 for t in s['tris']], float)
mnx, mxx, mnz, mxz = coll[:, :, 0].min() - 20, coll[:, :, 0].max() + 20, coll[:, :, 2].min() - 20, coll[:, :, 2].max() + 20
cx, cz = (mxx - mnx) / 32, (mxz - mnz) / 32
grid = np.zeros((32, 32), int)
for t in coll:
    i0, i1 = max(0, int((t[:, 0].min() - mnx) // cx)), min(31, int((t[:, 0].max() - mnx) // cx))
    j0, j1 = max(0, int((t[:, 2].min() - mnz) // cz)), min(31, int((t[:, 2].max() - mnz) // cz))
    grid[j0:j1 + 1, i0:i1 + 1] += 1
check(len(coll) < 30000 and grid.sum() < 60000, f'collision tris {len(coll)}, grid entries {grid.sum()} (u16 budget), busiest cell {grid.max()}')

# 9. archive
names = set(Z.namelist()); refs = set()
for n in names:
    if n.endswith(('.png', '.json', '.toml')) or '/tex_' in n: continue
    txt = Z.read(n).decode(); xml.dom.minidom.parseString(txt)
    refs |= set(re.findall(r'Path="(tracks/[^"]+)"', txt)) | set(re.findall(r'gfx_path="([^"]+)"', txt))
check(not [r_ for r_ in refs if r_ not in names], f'all {len(refs)} referenced resources present')
tb = []
for n in names:
    if '/tex_' not in n: continue
    d = Z.read(n); typ, w, h, size = struct.unpack('<IIII', d[0x40:0x50])
    if d[4:8] != b'XETO' or typ != 2 or size != w * h * 2 or len(d) != 0x50 + size or w * h > 2048: tb.append(n)
check(not tb, f'custom textures well-formed RGBA16 <= 2048 texels ({len(tb)} bad)')
json.loads(Z.read('tracks/western/scene.json'))
print(f'\n{len(fails)} failures')
