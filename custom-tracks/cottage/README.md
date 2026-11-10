# Cottage Living Room — custom track for SpaghettiKart

The karts are toy cars racing round the cottage living room, built from three photos of the room. The scale is 6 game units to the centimetre, so a kart is a ~3 cm toy car. The coffee table stands as tall as a two-storey building, and the stone chimney disappears into the vaulted plank ceiling.

What's in the room:

- dark cedar floorboards, white V-groove walls, and a vaulted white plank ceiling with a ridge beam
- the fieldstone chimney with its rough-hewn mantel beam, three framed black-and-white photos, candles, and a fire in the grate
- the long striped sofa and the cream loveseat with the red-and-white striped cushion, the tufted ottoman, the walnut coffee table with magazines, and the jute rug
- the faded Persian runner, the digital piano and bench, and the big canvas of the outrigger boat
- the brown leather armchair, the side table, and the chrome arc floor lamp
- the wall of lake windows: pines, the lake, and the deck railing
- the boot tray with the green crocs, the white crocs on the striped rug, the kitchen doorway with its console table, and the chandelier

## The lap (~13,600 units)

1. **The Runner:** start on the Persian runner between the sofa's back and the piano, walled in by wooden ABC blocks. A block-tower start gate with a chequered banner stands over the line.
2. **Toy track:** an orange toy race track takes over. It runs past the armchair, under the arm of the floor lamp, then west along the lake windows past the boot tray and the crocs.
3. **Book Climb:** the track climbs on stacks of books to coffee-table height (14% at most), swings round a hairpin high above the floor, and runs out onto the coffee table.
4. **Coffee Table:** race across the walnut tabletop past the magazines. There are no rails, so don't drive off the edge.
5. **Magazine Jump:** a stack of magazines launches you onto the tufted ottoman. Any kart doing about a third of top speed makes it, and the fastest karts still land on the ottoman.
6. **Cushion Drop:** the red striped cushion throws you down onto the stone hearth.
7. **Through the Fireplace:** drive straight through the firebox between the burning logs, out the back of the chimney, and round the back of the room on the orange track to the line.

**The floor is lava.** Touch the bare floorboards, or a rug that isn't part of the course, and Lakitu fishes you out and puts you back. On the floor the course is always walled in by blocks or the track's curbs, so you can only fall off the furniture.

There are 52 item boxes in 6 tight clusters: on the runner, on the book climb, on the high section, on the coffee table, at the back of the room and on the final straight. The music is Mario Raceway.

## Install

Copy `cottage-living-room.o2r` into `~/Library/Application Support/SpaghettiKart/mods/`. Then start the game, press Esc, open Debug Mode and pick **Cottage Living Room**.

## Files

- `make-cottage.mjs`: the track generator (Node, no dependencies). Run `node make-cottage.mjs out` to rebuild; it prints the jump table each time.
- `textures.mjs`: every texture is painted here in code.
- `check.py` and `lanecheck.py`: validators (need Python and numpy). Run `python3 check.py out/preview/geometry.json out/cottage-living-room.o2r`. They check:
  - floors and climb grades
  - nothing pokes through the road
  - waypoints and item boxes
  - both jumps can be made, and every faster kart lands too
  - the bare floor is out of bounds
  - no wall crosses the driving lane
  - the collision budget and the archive
- `preview/`: renders of the exported geometry, the texture set and the minimap.

Useful knobs:

- `TOP` (coffee-table height)
- `GAP1` / `GAP2` (the two jumps), `OTT_TOP`, `HEARTH_Y`
- `G_MAX` (steepest climb)
- `ROOM` (walls and ceiling)
- `ITEM_GAP` / `ROW_GAP` (item box spacing)
