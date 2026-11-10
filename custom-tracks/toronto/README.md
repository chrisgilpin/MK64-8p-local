# Downtown Toronto: custom track for SpaghettiKart

A street circuit through downtown Toronto, from Union Station down to the lake. The landmarks are real, but their sizes and spacing are squeezed to fit a race lap. The CN Tower stands 5,300 units, about 1:10 of its real 553 m against streets 340 units wide. On the map, game −X is the lake (south), and the lap runs counter-clockwise.

## The lap (~26,800 units)

1. **Front Street:** start outside Union Station's colonnade and head west past the Fairmont Royal York, with First Canadian Place and the TD towers behind it.
2. **John Street bridge:** climb up and over the rail lands (14% at most). GO trains wait in the cut below.
3. **Rogers Centre:** a gate under the stands takes you into the ballpark. Race round the outfield warning track, past the padded walls marked 328, 375 and 400 and under the half-open dome and the Blue Jays video board. Out the far side through a second tunnel.
4. **CN Tower:** sweep round the foot of the tower on Bremner, past Ripley's Aquarium, and under the Gardiner Expressway.
5. **Queens Quay:** east along the waterfront past the Power Plant and its chimney, Harbourfront Centre, a red TTC streetcar, and Queens Quay Terminal and its clock tower. In the middle, the wavy **WaveDeck** boardwalk. Sugar Beach's pink umbrellas are at the end, and the Island ferry and the Toronto Islands are out on the lake.
6. **Bay Street:** north under the Gardiner, past Scotiabank Arena, then down through the underpass beneath the Union Station rail viaduct (a GO train runs overhead). Back onto Front Street at the Royal Bank Plaza's gold towers.

Concrete street-circuit barriers line every street, with railings along the water and padding in the ballpark, so the only way round is the lap. The lake is out of bounds: Lakitu fishes you out.

There are 104 item boxes in 8 tight clusters:

- Front Street
- the John Street bridge
- the warning track
- Bremner
- Queens Quay
- after the WaveDeck
- Bay Street
- Front Street east

The music is Royal Raceway.

Also on the map:

- the John Street Roundhouse and its turntable
- the Metro Toronto Convention Centre
- the CBC
- City Hall with the 3D TORONTO sign
- the CityPlace condos and a few hundred generic skyline towers

## Install

Copy `downtown-toronto.o2r` into `~/Library/Application Support/SpaghettiKart/mods/`. Then start the game, press Esc, open Debug Mode and pick **Downtown Toronto**.

## Files

- `make-toronto.mjs`: the track generator (Node, no dependencies). Run `node make-toronto.mjs out` to rebuild. It's assembled from `src/` with `cat src/a_head.mjs src/b_path.mjs src/c_route.mjs src/d_helpers.mjs src/e_world.mjs src/z_tail.mjs > make-toronto.mjs`.
- `textures.mjs`: every texture and sign, painted in code.
- `check.py` and `lanecheck.py`: validators (need Python and numpy). Run `python3 check.py out/preview/geometry.json out/downtown-toronto.o2r`. They check:
  - floors and climb grades
  - headroom of at least 150 under the Gardiner, the viaduct and the stadium gates
  - waypoints and item boxes
  - the lake is out of bounds
  - no wall crosses the driving lane
  - the collision budget and the archive
- `render.py` and `pov.py`: software renders of the export.
- `preview/`: aerial and driver's-eye renders, plus the minimap.

Useful knobs:

- `G_MAX` (steepest climb)
- `BRIDGE_Y` and `DIP` (the John Street bridge and the Bay Street underpass)
- `PARK.R` (warning track radius)
- `TOWER` and `GARDINER`
- `ITEM_GAP` / `ROW_GAP` (item box spacing)
