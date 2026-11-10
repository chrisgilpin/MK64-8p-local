# South C.I. — custom track for SpaghettiKart

A tribute track for London South Collegiate Institute in London, Ontario. It uses the school's garnet and grey, red-brown brick with limestone trim, garnet lockers, terrazzo halls and a running track. The building is a stylised three-storey 1920s collegiate with a central entrance tower and two round stair towers; it is not a floor-plan copy of the real school.

## The lap (~20,700 units)

1. **Running track:** start on the home straight in front of the bleachers. See-through chain-link fences line every outdoor stretch, so the race can only go one way. The rest of the oval is fenced off behind a **TRACK CLOSED** sign, and a **SCHOOL ↑** sign points you straight on.
2. **Basement ramp:** a walled ramp drops you down into the basement doors under the **SOUTH** sign. A short painted-block corridor runs west.
3. **Stair tower A** (the round rotunda on the front lawn, south-west corner): one turn of a spiral ramp takes you up one floor, to the ground floor.
4. **Locker hallway:** a garnet-locker hallway runs up the west wing to the other corner.
5. **Stair tower B** (north-west corner, ringed with windows): one more turn up to the top floor.
6. **Upper corridor:** a long straight hallway runs east, with classroom doors on one side and windows on the other.
7. **Math classroom:** snake down an aisle between rows of student desks. The desks are solid.
8. **Window jump:** a yellow-and-black ramp launches you out of the open classroom window. You fly over a flower bed onto the top deck of the parking garage. About 40% of top speed clears it. If you come up short, Lakitu puts you back on the course.
9. **Garage and home:** spiral down the garage ramp past the parked cars, then take an S-bend onto the back straight and the final bend past the **GO SOUTH!** scoreboard to the line.

Every climb, including the inside edge of both spirals, is 15% or less.

## Item boxes

There are 67 item boxes in 7 tight clusters. Each cluster is two staggered rows with the boxes 34 units apart, so a whole pack can grab one. The clusters are:

- 11 on the path to the school
- 9 in the basement corridor
- 9 in the locker hallway
- 9 in the upper corridor
- 5 in the classroom aisle
- 11 on the garage top deck
- 13 on the back straight

## What changed in this version

- **See-through fences:** the chain-link is now an open diamond weave, about two-thirds see-through. It's drawn as a cut-out texture, so you see the wire pattern and look straight through the gaps.
- **New climb:** instead of three laps around one hallway loop, there are now two separate spiral stair towers at different corners of the building, with a straight locker hallway between them.
- **Bigger, tighter item clusters:** 67 boxes instead of 19.

## Install

Copy `south-collegiate.o2r` into `~/Library/Application Support/SpaghettiKart/mods/`, replacing the old one. Then start the game, press Esc, open Debug Mode and pick **South C.I.**

## Files

- `make-south-ci.mjs`: the track generator (Node, no dependencies). Run `node make-south-ci.mjs out` to rebuild.
- `textures.mjs`: every custom texture is painted here in code (brick, lockers, chalkboard, desks, fence, signs and so on) and packed into the mod.
- `check.py` and `lanecheck.py`: validators (need Python and numpy). Run `python3 check.py out/preview/geometry.json out/south-collegiate.o2r`. They check:
  - floors, level stacking and climb grades
  - waypoints
  - prop clearance and item boxes
  - the collision budget
  - the window jump
  - that no wall, solid or visual-only, stands across the driving lane
- `preview/`: renders of the exported geometry, the texture set and the minimap.

Useful knobs:

- `FH` (floor height), `SPIRAL` (stair tower size)
- `ROOM`, `WEAVE` (classroom size and how much the aisle snakes)
- `KICK_LEN`, `KICK_SLOPE` (window ramp)
- `GAR` (garage), `GAR_FOOT` (its west edge sets the jump length)
- `ITEM_GAP`, `ROW_GAP` (item box spacing)
- `OVAL` (track)
- the colours in `PAL` in `textures.mjs`
