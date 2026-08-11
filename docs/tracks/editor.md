@page editor Browser Track Editor
# Browser Track Editor

Create SpaghettiKart custom tracks in a web browser — no Blender required.

Tracks export as standard `.o2r` mods. The **same file** runs on stock SpaghettiKart
and on the eight-player local multiplayer build. Validation can warn more strictly
for 8-player start width / spawn apron, but export bytes never fork.

## Run the editor

```bash
cd tools/track-editor
npm install
npm run dev
```

Open the URL Vite prints (default `http://localhost:5173`).

## Save / load work in progress

| Action | What it does |
|---|---|
| **Save project** | Downloads a `.mk64track.json` file (full editable document: knots, walls, water, props, settings). |
| **Open project** | Loads a previously saved `.mk64track.json` (or a bare TrackDoc JSON). |
| **Autosave** | The browser also keeps a local autosave; reopening the editor restores it. |
| **Export .o2r** | Builds a **game** mod for SpaghettiKart — not re-opened by the editor. |

Drag-and-drop of a `.mk64track.json` onto the window also opens it.

## Workflow

1. **Load mk64.o2r** (header button, from your ExtractAssets / game build) so the
   texture browser can list and **preview** base-game textures. Click any
   **Browse…** control (road, ground, apron, water) → search e.g. `grass` → pick a
   thumbnail. Textures are referenced by path in the export — not copied into
   your mod.
2. **Path tool:** draw a closed loop in the top-down layout. Orange knot = start
   (origin). Arrow = race direction (**−Z**). Set Height (Y) per knot for hills.
3. **Place props tool:** pick trees / item boxes / signs from the palette, click
   the map to place, drag to move, Delete to remove. Exported into `scene.json`.
4. **Ground fill (default on):** fills the whole map extents with collidable land.
   Choose surface type (grass, sand, dirt…) and texture path. Optional
   **perimeter walls** block driving off the map edge.
5. **Water tool:** click points around a lake (3+), then **Finish water**. The
   polygon is filled with water collision (`WATER_SURFACE`) so karts splash /
   get rescued. Set water height (Y) below the road. Default texture is
   harbour water from `spaghetti.o2r`.
6. **Walls tool:** click to draw freehand barrier polylines — solid double-sided
   collision (cannot drive through). Path **segment Walls** also add edge barriers
   along a road span (left / right / both).
6. **Export .o2r** and place it in the game `mods/` folder:
   - Next to the executable, or
   - macOS: `~/Library/Application Support/SpaghettiKart/mods/`
7. Launch the game → **ESC** → enable **Debug Mode** → return to the title screen →
   arrow to your track (custom tracks sort last) → race.

## Stock vs 8-player

| | Stock | 8-player |
|---|---|---|
| Export format | `.o2r` custom track | same |
| Validation | start width / tri budget | wider start, longer spawn apron, lower tri soft limit |

If you design with validation set to **Both**, you get a portable track.

## Advanced / Blender

The Blender + fast64 pipeline remains fully supported for complex scenery.
See [Overview](trackoverview.md) and the other pages in this section.

## M0 spike (developers)

```bash
cd tools/track-editor
npm run spike
```

Regenerates the hand-coded format fixture used during exporter development.
