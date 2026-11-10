"""Does any collision wall cut across the driving lane? Sweeps short segments
from each frame to the next at several lateral offsets and two heights and
tests them against every wall triangle (Moller-Trumbore)."""
import json, sys, numpy as np
G = json.load(open(sys.argv[1])); F = G['frames']
# every steep triangle (solid walls and visual-only walls alike: driving
# through a wall you can see is just as wrong as hitting one you can't)
allt = [(s['name'], t) for s in G['sections'] for t in s['tris']]
A = np.array([t for _, t in allt], float)[:, :, :3]
n = np.cross(A[:, 1] - A[:, 0], A[:, 2] - A[:, 1]); n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-12
steep = np.abs(n[:, 1]) < 0.7
W = A[steep]; names = [allt[i][0] for i in np.where(steep)[0]]
lo, hi = W.min(1), W.max(1)
hits = []
for a, b in zip(F, F[1:]):
    if a['kind'] in ('gap',) or b['s'] <= a['s']: continue
    for k in (-0.8, -0.4, 0, 0.4, 0.8):
        for h in (12, 30):
            p = np.array([a['x'] + a['nx'] * a['w'] * k, a['y'] + h, a['z'] + a['nz'] * a['w'] * k])
            q = np.array([b['x'] + b['nx'] * b['w'] * k, b['y'] + h, b['z'] + b['nz'] * b['w'] * k])
            m = np.all(lo <= np.maximum(p, q) + 1, 1) & np.all(hi >= np.minimum(p, q) - 1, 1)
            if not m.any(): continue
            T = W[m]; d = q - p
            e1, e2 = T[:, 1] - T[:, 0], T[:, 2] - T[:, 0]
            pv = np.cross(d, e2); det = (e1 * pv).sum(1)
            ok = np.abs(det) > 1e-9; inv = np.where(ok, 1 / np.where(ok, det, 1), 0)
            tv = p - T[:, 0]; u = (tv * pv).sum(1) * inv
            qv = np.cross(tv, e1); v = (d * qv).sum(1) * inv; t = (e2 * qv).sum(1) * inv
            hit = ok & (u >= 0) & (v >= 0) & (u + v <= 1) & (t >= 0) & (t <= 1)
            if hit.any():
                idx = np.where(m)[0][np.where(hit)[0][0]]
                hits.append((round(a['s']), a['kind'], k, h, names[idx]))
print(len(hits), 'lane/wall hits')
seen = set()
for hh in hits:
    key = (hh[0] // 100, hh[4])
    if key not in seen: seen.add(key); print(' ', hh)
sys.exit(1 if hits else 0)
