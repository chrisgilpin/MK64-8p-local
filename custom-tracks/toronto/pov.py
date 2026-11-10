"""Render driver's-eye views at given route distances: python3 pov.py name:s ..."""
import json, sys, subprocess
G = json.load(open('out/preview/geometry.json')); F = G['frames']
def at(s): return min(F, key=lambda f: abs(f['s'] - s))
views = []
for arg in sys.argv[1:]:
    name, s = arg.split(':'); s = float(s)
    a, b = at(s), at(s + 260)
    views.append({'eye': [a['x'], a['y'] + 38, a['z']], 'target': [b['x'], b['y'] + 25, b['z']], 'out': f'r_{name}.png', 'fov': 72})
subprocess.run(['python3', 'render.py', 'out/preview/geometry.json', 'out/preview/tex', json.dumps(views)], check=True)
