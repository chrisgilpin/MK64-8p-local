# Sky Islands: a high-risk, high-reward SpaghettiKart track

Floating grass islands over a bottomless cloud sea. Miss a jump and you fall off the map. Lakitu fishes you out, the same way Rainbow Road works.

## The main lap (~17,600 units)

| | |
|---|---|
| **Start island** | Start straight, then the big **Hill 1** climbs to 290 on a **dash-pad strip** (orange chevrons, BOOST! signs) that holds you at top speed all the way up. A kicker sends you over the void (**Jump 1**) down onto island B. |
| **Island B** | Landing straight, low camel humps, then a huge horseshoe U-turn around a void bay. |
| **Rope Bridge** | A long railed plank bridge climbing steadily to island C. |
| **Island C** | A long, steady climb around the mountain loop, a small **Notch Jump**, a short climb, then a red **boost-ramp launch** across the void onto island D's rising hillside. |
| **Island D** | Over the summit, down **The Spine** (a narrow, railless plank bridge with sheer drops), then an S-bend and the home straight. |

Every jump on the main lap can be cleared even at low speed, so CPU racers can complete the lap.

## Hills you can drive up

Every climb you drive on normal road is now at most **15%**. That includes the inside edge of climbing curves, which is steeper than the middle of the road. The checker measures the centre line and both edges.

- **Hill 1** keeps its height. It now starts climbing right after the start line, and its steep middle (25%) is paved with **dash pads**. These are the Royal Raceway boost surface, which holds every kart, CPUs included, at top speed. The pads end before the crest, so you don't get launched off the top.
- **Mountain loop:** the old short, steep humps were replaced by one long climb, about 15% on the straights and gentler in the curves. The rest of the course was rebalanced around the new heights.
- **Rope Bridge** and **camel humps:** made gentler as well.
- **Shortcuts:** both still need the same speeds as before.

## Shortcuts (blue SHORTCUT signs)

| Shortcut | Where | The gamble |
|---|---|---|
| **Bay Leap** | Dirt path off the start of the horseshoe | A kicker straight across the void bay that lands you at the horseshoe's exit. It skips about 2,500 units of road. You need **about 70% of top speed or more** to clear it. |
| **Island Hops** | Dirt path off the climb onto island D's crest | Kicker → a tiny floating rock (with item boxes) → kicker → land beside the home straight. Two chances to fall; each hop needs **about 70–75% of top speed**. |

Speeds come from simulating the game's own air physics against the exported geometry (top speed is 9 units per tick):

| Jump | Lowest speed that lands |
|---|---|
| Jump 1 | 3.75 |
| Notch Jump | 3 |
| Boost Launch | 4.25 (the boost ramp sets you to top speed anyway) |
| Bay Leap | **6.5** |
| Hop 1 | **6.5** |
| Hop 2 | **6.5** |

If you get hit, drift too long or bump a wall on the run-up, you won't make the shortcut jumps. These numbers are a simulation, so if the shortcuts feel too easy or too hard in-game, tell me and I'll tune the gaps.

## How falling works

- The track's "water level" is set to −450, far below every island. Dropping below it with nothing underneath triggers Lakitu.
- Every main-lap waypoint sits on solid ground. There are none over the gaps, and none in the 300 units before each mandatory ramp, so Lakitu never drops you over the void or onto a lip with no run-up.
- The track is split into 26 numbered sections, like the original courses. Shortcut surfaces belong to the section where the shortcut branches off. So **if you fall off a shortcut, Lakitu puts you back at the fork**, while a successful jump counts from where you land.

## Install

Copy `sky-islands.o2r` into `~/Library/Application Support/SpaghettiKart/mods/`. Then start the game, press Esc, open Debug Mode and pick **Sky Islands**. The music is Rainbow Road.

## Files

- `make-sky-islands.mjs`: the generator. Run `node make-sky-islands.mjs out`; it prints the jump table each time.
- `textures.mjs` / `texlib.mjs`: hand-painted textures (grass, rock strata, planks, chevron kickers, dash pads, clouds, signs).
- `check.py`: the validator (needs Python and numpy). It also fails the build if any normal-road climb is steeper than 15%.
- `preview/`: renders, a top-down map and the minimap.

Tuning: the main lap is built piece by piece near the top of the generator (`M.line`, `M.arc`, `M.gline`/`M.garc` for climbs with a set grade, `M.kicker`, `M.gap`). `G_MAX` is the steepest grade allowed without dash pads; Hill 1's height is `TOP`. Shortcut gap sizes are set in the `S1`, `S2`, `S2b` and `S2c` blocks.
