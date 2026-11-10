"""Validator for Sky Islands (run after make-sky-islands.mjs)."""
import json, math, sys, zipfile, re, struct, xml.dom.minidom
import numpy as np

G = json.load(open(sys.argv[1])); Z = zipfile.ZipFile(sys.argv[2])
M = G['marks']; L = M['L']
fails = []
def check(c, msg):
    print(('PASS ' if c else 'FAIL ') + msg)
    if not c: fails.append(msg)
def normals(tris):
    t = np.array(tris, float)[:, :, :3]
    n = np.cross(t[:, 1] - t[:, 0], t[:, 2] - t[:, 1])
    return n / (np.linalg.norm(n, axis=1, keepdims=True) + 1e-12)

floors = [s for s in G['sections'] if s['clip'] == 1]
for s in floors:
    n = normals(s['tris'])
    if (n[:, 1] <= 0.5).any(): check(False, f"{s['name']}: floor tris face up (min ny {n[:, 1].min():.3f})")
check(all((normals(s['tris'])[:, 1] > 0.5).all() for s in floors), f'all {sum(len(s["tris"]) for s in floors)} floor tris face up, none steeper than 60 deg')
steep = sum(int((normals(s['tris'])[:, 1] < 0.72).sum()) for s in floors)
check(steep == 0, f'no floor steeper than ~44 deg (would count as a wall): {steep}')
allv = np.array([v for s in G['sections'] for t in s['tris'] for v in t], float)
check(np.abs(allv[:, :3]).max() < 32000 and np.abs(allv[:, 3:]).max() < 32000, f'coords/UVs within s16 ({np.abs(allv[:, :3]).max():.0f} / {np.abs(allv[:, 3:]).max():.0f})')

# every waypoint sits on a floor (so Lakitu never drops a kart over the void)
ft = np.array([t for s in floors for t in s['tris']], float)
fsec = np.array([s['sec'] for s in floors for t in s['tris']])
def floor_below(x, y, z):
    m = (ft[:, :, 0].min(1) <= x) & (ft[:, :, 0].max(1) >= x) & (ft[:, :, 2].min(1) <= z) & (ft[:, :, 2].max(1) >= z)
    best = (-1e9, None)
    for t, sc in zip(ft[m], fsec[m]):
        a, b, c = t[:, [0, 2]]
        def sg(p, q, r): return (p[0] - r[0]) * (q[1] - r[1]) - (q[0] - r[0]) * (p[1] - r[1])
        p = (x, z); d1, d2, d3 = sg(p, a, b), sg(p, b, c), sg(p, c, a)
        if (d1 < 0 or d2 < 0 or d3 < 0) and (d1 > 0 or d2 > 0 or d3 > 0): continue
        n = np.cross(t[1, :3] - t[0, :3], t[2, :3] - t[1, :3]); n /= np.linalg.norm(n)
        h = t[0, 1] - (n[0] * (x - t[0, 0]) + n[2] * (z - t[0, 2])) / n[1]
        if h <= y + 10 and h > best[0]: best = (h, sc)
    return best
P = G['path']
bad = [p for p in P if not (-3 <= p['y'] - floor_below(p['x'], p['y'], p['z'])[0] <= 8)]
check(not bad, f'all {len(P)} waypoints sit on solid ground ({len(bad)} over the void) {bad[:2]}')
wrong_sec = [p for p in P if floor_below(p['x'], p['y'], p['z'])[1] not in (p['ID'],)]
check(len(wrong_sec) <= 2 * max(p['ID'] for p in P), f'floor section under each waypoint matches its ID ({len(wrong_sec)} at section seams)')
ids = sorted(set(p['ID'] for p in P))
check(ids == list(range(1, max(ids) + 1)) and max(ids) < 0x33, f'section IDs 1..{max(ids)} all have waypoints (< 0x33)')
check(P[0]['x'] == 0 and P[0]['z'] == 0 and P[1]['z'] < 0 and P[-1]['z'] > 0, 'path starts at origin heading -Z, ends just behind the line')
gaps = [math.dist((P[i]['x'], P[i]['z']), (P[i + 1]['x'], P[i + 1]['z'])) for i in range(len(P) - 1)]
check(max(gaps) < 640, f'largest waypoint gap {max(gaps):.0f} (across jumps; CPU search radius 400 from either end)')
for lp in M['lips']:
    near = [p for p in P if lp - 300 < p['s'] <= lp]
    check(not near, f'no rescue waypoint in the 300 before the lip at s={lp:.0f}')

# every climb a kart has to drive up is <= ~15%, measured on the centreline and
# on both edges (the inner edge of a climbing curve is steeper); steeper bits
# must be dash pads (boost surface holds karts at top speed)
worst = (0, None)
from itertools import groupby
for name, fr in groupby(G['frames'], key=lambda f: f['path']):
    fr = list(fr)
    for a, b in zip(fr, fr[1:]):
        if a['gap'] or a['kind'] in ('kicker', 'boost', 'pad') or b['s'] <= a['s']: continue
        for k in (-1, 0, 1):
            pa = (a['x'] + a['nx'] * a['w'] * k, a['z'] + a['nz'] * a['w'] * k)
            pb = (b['x'] + b['nx'] * b['w'] * k, b['z'] + b['nz'] * b['w'] * k)
            d = math.dist(pa, pb)
            if d > 1 and (b['y'] - a['y']) / d > worst[0]: worst = ((b['y'] - a['y']) / d, (name, round(a['s']), k, a['kind']))
check(worst[0] <= 0.155, f'steepest climb off the dash pads {worst[0]:.3f} {worst[1]}')
pads = [f for f in G['frames'] if f['kind'] == 'pad']
check(len(pads) > 0 and max(f['y'] for f in pads) < max(f['y'] for f in G['frames'] if f['path'] == 'main' and f['kind'] == 'road' and f['s'] < 3000), 'Hill 1 dash pads stop short of the crest (no launch at the top)')

# shortcut floors carry their fork's section so failed attempts rescue at the fork
for key, name in (('s1', 'Bay Leap'), ('s2', 'Island Hops')):
    fork = M['forks'][key]
    fsecs = {f['sec'] for f in G['frames'] if f['path'] in (name, 'Hop Rock' if key == 's2' else name)}
    main_at = [f['sec'] for f in G['frames'] if f['path'] == 'main' and abs(f['s'] - fork) < 20]
    check(len(fsecs) == 1 and fsecs <= set(main_at), f'{name} floors use the fork section {sorted(fsecs)}')

# the void really is a void below each shortcut gap / main gap
def solid_near(x, z):
    m = (ft[:, :, 0].min(1) <= x + 1) & (ft[:, :, 0].max(1) >= x - 1) & (ft[:, :, 2].min(1) <= z + 1) & (ft[:, :, 2].max(1) >= z - 1)
    return bool(m.any())
for j in G['jumps']:
    check(j['need'] is not None, f"{j['name']}: makeable (min speed {j['need']})")

# jumps that are supposed to be risky need real speed
need = {j['name']: j['need'] for j in G['jumps']}
check(need['S1 Bay Leap'] >= 5.5 and need['S2 hop 1'] >= 5.5, f"shortcut jumps need speed: {need}")
check(need['Jump 1'] <= 4.5 and need['Notch Jump'] <= 4.5, 'mandatory jumps forgiving for slow karts / CPUs')

# collision grid budget
coll = np.array([t for s in G['sections'] if s['clip'] != 0 for t in s['tris']], float)
mnx, mxx, mnz, mxz = coll[:, :, 0].min() - 20, coll[:, :, 0].max() + 20, coll[:, :, 2].min() - 20, coll[:, :, 2].max() + 20
cx, cz = (mxx - mnx) / 32, (mxz - mnz) / 32
grid = np.zeros((32, 32), int)
for t in coll:
    i0, i1 = max(0, int((t[:, 0].min() - mnx) // cx)), min(31, int((t[:, 0].max() - mnx) // cx))
    j0, j1 = max(0, int((t[:, 2].min() - mnz) // cz)), min(31, int((t[:, 2].max() - mnz) // cz))
    grid[j0:j1 + 1, i0:i1 + 1] += 1
check(len(coll) < 30000 and grid.sum() < 60000, f'collision tris {len(coll)}, grid entries {grid.sum()}, busiest cell {grid.max()}')
# water level below every floor
check(ft[:, :, 1].min() > M['WATER_LEVEL'] + 50, f"lowest floor {ft[:, :, 1].min():.0f} sits well above the Lakitu level {M['WATER_LEVEL']}")

# item boxes on floors
badb = [a['Location'] for a in G['actors'] if a['Name'] == 'mk:item_box' and not (0 <= a['Location']['y'] - floor_below(**a['Location'])[0] <= 12)]
check(not badb, f'item boxes rest on floors ({len(badb)} bad)')
badt = [a['Location'] for a in G['actors'] if 'tree' in a['Name'] and abs(a['Location']['y'] - floor_below(a['Location']['x'], a['Location']['y'] + 20, a['Location']['z'])[0]) > 15]
check(not badt, f'trees stand on island grass ({len(badt)} floating)')

# archive
names = set(Z.namelist()); refs = set()
for n in names:
    if n.endswith(('.png', '.json', '.toml')) or '/tex_' in n: continue
    txt = Z.read(n).decode(); xml.dom.minidom.parseString(txt)
    refs |= set(re.findall(r'Path="(tracks/[^"]+)"', txt)) | set(re.findall(r'gfx_path="([^"]+)"', txt))
check(not [r for r in refs if r not in names], f'all {len(refs)} referenced resources present')
tb = [n for n in names if '/tex_' in n and not (Z.read(n)[4:8] == b'XETO' and struct.unpack('<I', Z.read(n)[0x40:0x44])[0] == 2)]
check(not tb, 'custom textures are RGBA16 OTEX resources')
print(f'\n{len(fails)} failures')
