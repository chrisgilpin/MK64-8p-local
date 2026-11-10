# Western — custom track for SpaghettiKart

A lap of Western University's main campus in London, Ontario, in Western purple, collegiate-gothic sandstone and limestone. The landmarks are real, but their positions and sizes are squeezed into a race lap rather than copied from the campus map.

## The lap (~20,000 units)

1. **Richmond Street gates:** start just inside the stone gate pillars under a purple **WESTERN** banner, then run down University Drive past purple light-pole banners.
2. **University Drive Bridge:** cross the Thames on the stone bridge with its balustrades. The riverside path runs through one of its arches below you.
3. **UC Hill:** climb straight up the hill at **University College** and the **Middlesex Memorial Tower**. The tower is crenellated with corner pinnacles, a belfry and a purple flag.
4. **Through the tower:** the brick walk (Kent Drive) takes you through the pointed archway under the tower and out the back.
5. **Concrete Beach:** sweep across the wide concrete plaza in front of the **UCC**. **Weldon Library** looms behind you and **Physics & Astronomy** sits alongside.
6. **Middlesex College:** pass the clock tower with its green copper spire.
7. **The woods:** wind down a long S-bend through the trees, between split-rail fences.
8. **Footbridge:** cross the Thames on a purple steel truss footbridge.
9. **Thames Valley pathway:** follow the river past **Medway-Sydenham Hall** and back under the University Drive Bridge.
10. **Sydenham Hill and Richmond Street:** climb back up, past a **GO MUSTANGS!** sign, and turn in through the gates to the line.

Every climb is 14% or less, measured on the centre line and on both edges.

Every edge of the route is lined, so you can't cut across the lawns:

- hedges
- stone balustrades
- concrete seat walls
- split rails in the woods
- the footbridge truss
- rubble-stone river walls

There are 98 item boxes in 8 tight clusters. Each cluster is two staggered rows with the boxes 34 units apart: two on University Drive and UC Hill, one on Concrete Beach, one in the woods, two on the riverside path, and two on Sydenham Hill and Richmond Street. The music is Royal Raceway.

## Install

Copy `western-university.o2r` into `~/Library/Application Support/SpaghettiKart/mods/`. Then start the game, press Esc, open Debug Mode and pick **Western**.

## Files

- `make-western.mjs`: the track generator (Node, no dependencies). Run `node make-western.mjs out` to rebuild.
- `textures.mjs`: every custom texture is painted here in code and packed into the mod. That includes the sandstone gothic windows, the belfry, the clock face, the balustrade, the river, the hedges, the purple truss and the signs.
- `check.py` and `lanecheck.py`: validators (need Python and numpy). Run `python3 check.py out/preview/geometry.json out/western-university.o2r`. They check:
  - floors and climb grades
  - the path under the bridge has enough headroom
  - no terrain pokes through the road
  - waypoints
  - item boxes and tree clearance
  - no wall, solid or visual-only, crosses the driving lane
  - the collision budget and the archive
- `preview/`: renders of the exported geometry, the texture set and the minimap.

Useful knobs:

- `G_MAX` (steepest climb)
- `UC` (University College size and position)
- `RIVER`
- the S-bend radii in the woods
- `ITEM_GAP` / `ROW_GAP` (item box spacing)
- the colours in `PAL` in `textures.mjs`
