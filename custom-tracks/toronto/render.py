"""Tiny software rasterizer for previewing the exported track geometry."""
import json, sys, math
import numpy as np
from PIL import Image

G = json.load(open(sys.argv[1]))
TEXDIR = sys.argv[2]
texcache = {}
def tex(path):
    n = path.split('/')[-1]
    if n not in texcache:
        texcache[n] = np.asarray(Image.open(f'{TEXDIR}/{n}.png').convert('RGBA'), dtype=np.float32) / 255
    return texcache[n]

def look_at(eye, target, up=(0, 1, 0)):
    eye, target, up = map(lambda v: np.array(v, float), (eye, target, up))
    f = target - eye; f /= np.linalg.norm(f)
    r = np.cross(f, up); r /= np.linalg.norm(r)
    u = np.cross(r, f)
    return eye, r, u, f

def render(eye, target, W=1280, Hh=720, fov=60, out='out.png', skip=(), sky=True, actors=True):
    eye, r, u, f = look_at(eye, target)
    fl = (W / 2) / math.tan(math.radians(fov) / 2)
    img = np.zeros((Hh, W, 3), np.float32)
    if sky:
        g = np.linspace(0, 1, Hh)[:, None]
        top = np.array([70, 130, 205]) / 255; bot = np.array([190, 215, 235]) / 255
        img[:] = (top * (1 - g) + bot * g)[:, None, :]
    zb = np.full((Hh, W), np.inf, np.float32)
    light = np.array([0.4, 1.0, 0.3]); light /= np.linalg.norm(light)
    for sec in G['sections']:
        if sec['layer'] == 0 or sec['name'] in skip: continue
        T = tex(sec['tex']['path']); th, tw = T.shape[:2]
        tris = np.array(sec['tris'], np.float64)  # n,3,5
        P = tris[:, :, :3] - eye
        cx = P @ r; cy = P @ u; cz = P @ f
        keep = (cz > 5).all(1)
        tris, cx, cy, cz = tris[keep], cx[keep], cy[keep], cz[keep]
        sx = W / 2 + fl * cx / cz; sy = Hh / 2 - fl * cy / cz
        # normals for shading
        a = tris[:, 0, :3]; b = tris[:, 1, :3]; c = tris[:, 2, :3]
        n = np.cross(b - a, c - b); n /= (np.linalg.norm(n, axis=1, keepdims=True) + 1e-9)
        shade = 0.55 + 0.45 * np.abs(n @ light)
        for i in range(len(tris)):
            x0, x1 = int(max(0, math.floor(sx[i].min()))), int(min(W - 1, math.ceil(sx[i].max())))
            y0, y1 = int(max(0, math.floor(sy[i].min()))), int(min(Hh - 1, math.ceil(sy[i].max())))
            if x1 < x0 or y1 < y0: continue
            if (x1 - x0) * (y1 - y0) > W * Hh: continue
            xs = np.arange(x0, x1 + 1) + 0.5; ys = np.arange(y0, y1 + 1) + 0.5
            X, Y = np.meshgrid(xs, ys)
            (ax, bx, cx_), (ay, by, cy_) = sx[i], sy[i]
            den = (by - cy_) * (ax - cx_) + (cx_ - bx) * (ay - cy_)
            if abs(den) < 1e-9: continue
            l0 = ((by - cy_) * (X - cx_) + (cx_ - bx) * (Y - cy_)) / den
            l1 = ((cy_ - ay) * (X - cx_) + (ax - cx_) * (Y - cy_)) / den
            l2 = 1 - l0 - l1
            m = (l0 >= -1e-4) & (l1 >= -1e-4) & (l2 >= -1e-4)
            if not m.any(): continue
            iz = l0 / cz[i, 0] + l1 / cz[i, 1] + l2 / cz[i, 2]
            z = 1 / iz
            sub = zb[y0:y1 + 1, x0:x1 + 1]
            m &= z < sub
            if not m.any(): continue
            uvs = tris[i, :, 3:5] / 32.0
            uu = (l0 * uvs[0, 0] / cz[i, 0] + l1 * uvs[1, 0] / cz[i, 1] + l2 * uvs[2, 0] / cz[i, 2]) * z
            vv = (l0 * uvs[0, 1] / cz[i, 0] + l1 * uvs[1, 1] / cz[i, 1] + l2 * uvs[2, 1] / cz[i, 2]) * z
            tx = np.floor(uu).astype(int) % tw; ty = np.floor(vv).astype(int) % th
            texel = T[ty, tx]
            m &= texel[..., 3] > 0.5  # cut-out textures (fence mesh)
            if not m.any(): continue
            col = texel[..., :3] * shade[i]
            # distance haze
            fog = np.clip((z - 2500) / 9000, 0, 0.55)[..., None]
            col = col * (1 - fog) + np.array([0.75, 0.85, 0.95]) * fog
            sub[m] = z[m]
            img[y0:y1 + 1, x0:x1 + 1][m] = col[m]
    if actors:
        for a in G['actors']:
            p = np.array([a['Location']['x'], a['Location']['y'], a['Location']['z']], float)
            if a['Name'] == 'mk:item_box': p[1] += 16; size, colr = 10, (1.0, 0.85, 0.2)
            else: p[1] += 90; size, colr = 70, (0.1, 0.45, 0.15)
            q = p - eye; zc = q @ f
            if zc < 10: continue
            px = W / 2 + fl * (q @ r) / zc; py = Hh / 2 - fl * (q @ u) / zc
            rad = max(2, fl * size / zc)
            x0, x1 = int(px - rad), int(px + rad); y0, y1 = int(py - rad * (1.6 if size == 70 else 1)), int(py + rad)
            x0c, x1c, y0c, y1c = max(0, x0), min(W - 1, x1), max(0, y0), min(Hh - 1, y1)
            if x1c <= x0c or y1c <= y0c: continue
            sub = zb[y0c:y1c + 1, x0c:x1c + 1]
            mm = zc < sub
            img[y0c:y1c + 1, x0c:x1c + 1][mm] = colr
    Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8)).save(out)
    print('wrote', out)

if __name__ == '__main__':
    views = json.loads(sys.argv[3])
    for v in views:
        render(**v)
