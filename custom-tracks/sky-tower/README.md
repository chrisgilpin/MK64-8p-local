# Sky Tower — custom track for SpaghettiKart

A tall stone tower with a spiral road that climbs it 3.5 times. At the top, a walled sky bridge dives down to a boost ramp. The ramp launches you across a gap onto a grassy hill. The road then rides the ridge back down, swings through a wide U-turn, and returns along the home straight with a gentle S-bend.

| | |
|---|---|
| Lap length | ~23,800 units (Royal Raceway is ~18,000) |
| Spiral | radius 440, 3.5 turns of ~214 units each, top deck at y = 750. Climb: 7.7% in the middle of the road, 10.9% on the inside lane (was 15.4%) |
| Tower | 1150 high + pointed roof (≈1520) |
| Jump | flat boost-ramp lip at y = 306, 300-unit gap, lands on an up-slope at 281–316 |
| Item boxes | 5 rows: spiral bottom, spiral middle, sky bridge, hill summit, home straight |
| Music | Royal Raceway |

## Install

1. Copy `sky-tower.o2r` into your SpaghettiKart `mods` folder:
   `~/Library/Application Support/SpaghettiKart/mods/`
2. Launch the game, then press Esc → Debug Mode and pick **Sky Tower**. Custom tracks are listed last.

## How the jump works

The ramp uses the Royal Raceway boost-ramp surface. On that surface the engine raises kart gravity to 3500 but divides vertical acceleration by 20, so karts float. A steep kicker would send them over the whole hill. So the lip is almost flat (4% up), and the hill rises 10% to meet the flight path.

A simulation using the engine's air-physics formula has every speed from 6 to 20 units/tick touching down on the hill's up-slope, 300 to 740 units past the lip.

If you get hit or slowed before the lip and fall short, you land in the gap on a grassy slope of up to about 31°. You can drive straight up it onto the road, and no Lakitu is needed.

## Regenerating / tweaking

`make-sky-tower.mjs` is a standalone Node script with no dependencies:

```bash
node make-sky-tower.mjs out      # writes out/sky-tower.o2r + out/preview/
```

Useful knobs at the top of the file:

- `TOWER`: radius, turns, pitch (height per turn), and the tower and roof heights.
- `BRIDGE`: where the dive, boost strip, lip, gap and hill sit along the bridge line.
- `Y_DIVE`, `KICK_RISE`, `LAND_DROP`, `HILL_RISE`: jump heights.
- `TEX`: base-game textures, referenced from `mk64.o2r` by path.

Keep at least 180 units between stacked levels, because the road underneath needs headroom and the waypoint tracker needs it too. After changing anything, run the validator (needs Python and numpy):

```bash
python3 check.py out/preview/geometry.json out/sky-tower.o2r
```

It checks that floors face up, coordinates and texture values fit in 16 bits, the road clears the tower, the ground stays under the road, the waypoints and item boxes are sane, and the collision grid fits the engine's limits.
