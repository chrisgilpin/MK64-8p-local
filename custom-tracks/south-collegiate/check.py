"""Validator for the South C.I. track export (run after make-south-ci.mjs)."""
import json, math, sys, zipfile, re, xml.dom.minidom
import numpy as np

G = json.load(open(sys.argv[1]))
Z = zipfile.ZipFile(sys.argv[2])
M = G['marks']; L = M['L']
secs = {s['name']: s for s in G['sections']}
fails = []
def check(cond, msg):
    print(('PASS ' if cond else 'FAIL ') + msg)
    if not cond: fails.append(msg)
def tri_normals(tris):
    t = np.array(tris, float)[:, :, :3]
    n = np.cross(t[:, 1] - t[:, 0], t[:, 2] - t[:, 1])
    return n / (np.linalg.norm(n, axis=1, keepdims=True) + 1e-12)

# 1. every collision floor faces up (engine ignores floors with ny < -0.9)
for s in G['sections']:
    if s['clip'] != 1: continue
    n = tri_normals(s['tris'])
    check((n[:, 1] > 0.5).all(), f"{s['name']}: {len(n)} floor tris face up (min ny {n[:, 1].min():.3f})")

# 2. 16-bit ranges
allv = np.array([v for s in G['sections'] for t in s['tris'] for v in t], float)
check(np.abs(allv[:, :3]).max() < 32000, f'coords within s16 (max {np.abs(allv[:, :3]).max():.0f})')
check(np.abs(allv[:, 3:]).max() < 32000, f'UVs within s16 (max {np.abs(allv[:, 3:]).max():.0f})')

# 3. stacked route sections: vertical separation and headroom
F = G['frames']
fa = np.array([[f['s'], f['x'], f['y'], f['z'], f['w']] for f in F])
ceil_kinds = {'hall', 'stairs', 'skywalk'}
kinds = [f['kind'] for f in F]
minsep = 1e9; worst = None; headroom_bad = []
notgap = np.array([k != 'gap' for k in kinds])  # gap frames are air, not floors
for i in range(len(fa)):
    ds = np.abs(fa[:, 0] - fa[i, 0]); ds = np.minimum(ds, L - ds)
    hd = np.hypot(fa[:, 1] - fa[i, 1], fa[:, 3] - fa[i, 3])
    m = (ds > 600) & (hd < fa[:, 4] + fa[i, 4] - 5) & notgap
    if kinds[i] == 'gap': continue
    if not m.any(): continue
    dy = fa[m, 2] - fa[i, 2]
    a = np.abs(dy).min()
    if a < minsep: minsep, worst = a, (round(fa[i, 0]), kinds[i])
    if kinds[i] in ceil_kinds:
        above = dy[dy > 0]
        if len(above) and above.min() < 200 + 1: headroom_bad.append((fa[i, 0], above.min()))
check(minsep >= 200, f'stacked route levels separated by >= 200 (min {minsep:.1f} at {worst})')
check(not headroom_bad, f'ceilings stay below the floor above ({len(headroom_bad)} bad)')

# 4. terrain never pokes through: route floors over lawn must sit above it,
#    and below-grade floors must be over a hole in the lawn
ter = [t for n in ('terrain_grass', 'terrain_turf', 'terrain_lot', 'coping') if n in secs for t in secs[n]['tris']]
rects = []
for t in ter:
    xs = [v[0] for v in t]; zs = [v[2] for v in t]
    rects.append((min(xs), max(xs), min(zs), max(zs)))
rects = np.array(sorted(set(rects)), float)
def has_ground(x, z):
    return bool(((rects[:, 0] < x) & (rects[:, 1] > x) & (rects[:, 2] < z) & (rects[:, 3] > z)).any())
bad = []
floor_names = [n for n in secs if n.startswith('floor_') or n in ('path', 'road', 'trench_floor', 'running_track', 'running_finish')]
for n in floor_names:
    for t in secs[n]['tris']:
        cx = sum(v[0] for v in t) / 3; cz = sum(v[2] for v in t) / 3; cy = sum(v[1] for v in t) / 3
        if has_ground(cx, cz) and cy < -4:
            bad.append((n, [round(cx), round(cy), round(cz)]))
check(not bad, f'no route floor below the lawn ({len(bad)} bad) {bad[:2]}')

# 5. path
P = G['path']
check(P[0] == {'x': 0, 'y': 0, 'z': 0}, 'path[0] at origin')
check(P[1]['z'] < 0 and abs(P[1]['x']) < 2, 'path leaves the line heading -Z')
check(P[-1]['z'] > 0 and abs(P[-1]['x']) < 2, f"path ends just behind the line {P[-1]}")
sp = [math.dist((P[i]['x'], P[i]['y'], P[i]['z']), (P[i + 1]['x'], P[i + 1]['y'], P[i + 1]['z'])) for i in range(len(P) - 1)]
check(len(P) < 2000 and sorted(sp)[-2] < 32 and max(sp) < 650, f'{len(P)} waypoints, spacing {min(sp):.1f}..{max(sp):.1f}')
pa = np.array([[p['x'], p['y'], p['z']] for p in P], float)
PS = np.array(G['pathS'], float)
errs = []
for f in F[::2]:
    if f['kind'] == 'gap': continue
    for k in (-0.95, 0, 0.95):
        q = np.array([f['x'] + f['nx'] * f['w'] * k, f['y'] + 6, f['z'] + f['nz'] * f['w'] * k])
        j = np.argmin(((pa - q) ** 2).sum(1)); d = abs(PS[j] - f['s'])
        errs.append(min(d, L - d))
check(max(errs) < 200, f'nearest waypoint is always the local one (max s error {max(errs):.1f})')

# 5a. every climb is drivable: <= ~15% on the centreline and on both edges
#     (the inner edge of a spiral ramp is the steep one)
worst = (0, None)
for a, b in zip(F, F[1:]):
    if a['kind'] in ('kicker', 'gap') or b['s'] <= a['s']: continue
    for k in (-1, 0, 1):
        pa = (a['x'] + a['nx'] * a['w'] * k, a['z'] + a['nz'] * a['w'] * k)
        pb = (b['x'] + b['nx'] * b['w'] * k, b['z'] + b['nz'] * b['w'] * k)
        d = math.dist(pa, pb)
        if d > 1 and (b['y'] - a['y']) / d > worst[0]: worst = ((b['y'] - a['y']) / d, (round(a['s']), k, a['kind']))
check(worst[0] <= 0.155, f'steepest climb {worst[0]:.3f} {worst[1]}')

# 5b. window jump: makeable at modest speed, and a miss lands in the flower bed
kick = [f for f in F if f['kind'] == 'kicker']; gapf = [f for f in F if f['kind'] == 'gap']
lip = kick[-1]; land_x = gapf[-1]['x']; deck = M['GAR']['deck']
def fly(v, slope=0.35):
    th = math.atan(slope); vx, vy = v * math.cos(th), v * math.sin(th); x, y = lip['x'], lip['y']
    for _ in range(600):
        g = deck if x >= land_x else 0
        vy += (-2600 - 696 * vy) / 6000 / (2 if y - g > 50 else 1); x += vx; y += vy
        if x >= land_x and y <= deck: return True
        if x < land_x and y < deck: return False
need = next((v / 10 for v in range(10, 91) if fly(v / 10)), None)
check(need is not None and need <= 4.2, f'window jump makeable from {need} units/tick (top speed 9)')
pitwp = [p for p in P if lip['x'] < p['x'] < land_x and abs(p['z'] - lip['z']) < 400]
check(not pitwp, 'no waypoint in the flower-bed pit (Lakitu puts misses back on solid floor)')

# 6. solid props (columns, cars, posts, bleachers) stay out of every lane
props = [n for n in secs if n.startswith('cars_') or n in ('garage_columns', 'posts', 'bleachers', 'desks')]
hits = []
for n in props:
    for t in secs[n]['tris']:
        for v in t:
            hd = np.hypot(fa[:, 1] - v[0], fa[:, 3] - v[2])
            yo = (v[1] > fa[:, 2] + 1) & (v[1] < fa[:, 2] + 150)
            m = (hd < fa[:, 4] + 2) & yo
            if m.any(): hits.append((n, v[:3]))
check(not hits, f'props clear of the lanes ({len(hits)} hits) {hits[:2]}')

# 7. item boxes rest on a floor just below them
floors = np.array([t for n in floor_names for t in secs[n]['tris']], float)
def floor_below(x, y, z):
    best = -1e9
    m = (floors[:, :, 0].min(1) <= x) & (floors[:, :, 0].max(1) >= x) & (floors[:, :, 2].min(1) <= z) & (floors[:, :, 2].max(1) >= z)
    for t in floors[m]:
        a, b, c = t[:, [0, 2]]
        def sg(p, q, r): return (p[0] - r[0]) * (q[1] - r[1]) - (q[0] - r[0]) * (p[1] - r[1])
        p = (x, z); d1, d2, d3 = sg(p, a, b), sg(p, b, c), sg(p, c, a)
        if (d1 < 0 or d2 < 0 or d3 < 0) and (d1 > 0 or d2 > 0 or d3 > 0): continue
        n = np.cross(t[1, :3] - t[0, :3], t[2, :3] - t[1, :3]); n /= np.linalg.norm(n)
        h = t[0, 1] - (n[0] * (x - t[0, 0]) + n[2] * (z - t[0, 2])) / n[1]
        if h <= y + 10 and h > best: best = h
    return best
badb = [a['Location'] for a in G['actors'] if a['Name'] == 'mk:item_box' and not (0 <= a['Location']['y'] - floor_below(**a['Location']) <= 12)]
check(not badb, f'item boxes sit on the route ({len(badb)} bad) {badb[:2]}')

# 8. collision grid budget (u16 indices)
coll = np.array([t for s in G['sections'] if s['clip'] != 0 for t in s['tris']], float)
mnx, mxx = coll[:, :, 0].min() - 20, coll[:, :, 0].max() + 20
mnz, mxz = coll[:, :, 2].min() - 20, coll[:, :, 2].max() + 20
cx, cz = (mxx - mnx) / 32, (mxz - mnz) / 32
grid = np.zeros((32, 32), int)
for t in coll:
    i0 = max(0, int((t[:, 0].min() - mnx) // cx)); i1 = min(31, int((t[:, 0].max() - mnx) // cx))
    j0 = max(0, int((t[:, 2].min() - mnz) // cz)); j1 = min(31, int((t[:, 2].max() - mnz) // cz))
    grid[j0:j1 + 1, i0:i1 + 1] += 1
check(len(coll) < 30000, f'collision triangles {len(coll)}')
check(grid.sum() < 60000, f'collision grid entries {grid.sum()} (u16 budget 65535), busiest cell {grid.max()}')

# 9. archive integrity: every referenced resource is inside, XML parses, textures sized right
names = set(Z.namelist())
refs = set()
for n in names:
    if n.endswith(('.png', '.json', '.toml')) or '/tex_' in n: continue
    txt = Z.read(n).decode()
    xml.dom.minidom.parseString(txt)
    refs |= set(re.findall(r'Path="(tracks/[^"]+)"', txt)) | set(re.findall(r'gfx_path="([^"]+)"', txt))
missing = sorted(r for r in refs if r not in names)
check(not missing, f'all {len(refs)} referenced resources present {missing[:3]}')
import struct
texbad = []
for n in names:
    if '/tex_' not in n: continue
    d = Z.read(n)
    typ, w, h, size = struct.unpack('<IIII', d[0x40:0x50])
    if d[4:8] != b'XETO' or typ != 2 or size != w * h * 2 or len(d) != 0x50 + size or w * h > 2048: texbad.append(n)
check(not texbad, f'custom textures well-formed RGBA16 <= 2048 texels ({len(texbad)} bad)')
json.loads(Z.read('tracks/south_ci/scene.json'))
# 10. nothing you can see (or hit) stands across the driving lane
import subprocess, os
r = subprocess.run([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lanecheck.py'), sys.argv[1]], capture_output=True, text=True)
check(r.returncode == 0, 'no wall crosses the driving lane: ' + r.stdout.strip().splitlines()[0])
print(f'\n{len(fails)} failures')
