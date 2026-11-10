#!/usr/bin/env node
/**
 * "Downtown Toronto" — a SpaghettiKart street circuit through downtown Toronto.
 * A stylised tribute: the landmarks are real, their sizes and spacing are
 * squeezed into a race lap (the CN Tower stands 5300 units, about 1:10 of its
 * real 553 m against a street 340 wide).
 *
 * Map axes: game -Z is real-world west, +X is real-world north.
 *
 * Lap (the race starts on Front Street outside Union Station, heading west):
 *   1. Front Street past Union Station's colonnade and the Fairmont Royal York.
 *   2. Left down John Street and over the rail lands on the John Street bridge
 *      (GO trains in the cut below).
 *   3. In through a gate under the stands of the Rogers Centre: round the
 *      outfield warning track under the half-open dome, out the far side.
 *   4. Along the base of the CN Tower and round its foot, past Ripley's
 *      Aquarium, under the Gardiner Expressway.
 *   5. East along Queens Quay on the waterfront: the Power Plant, Harbourfront
 *      Centre, the WaveDeck boardwalk, Queens Quay Terminal and its clock,
 *      Sugar Beach's pink umbrellas, the Island ferry out on the lake.
 *   6. North up Bay Street under the Gardiner, past Scotiabank Arena, down
 *      through the underpass beneath the Union Station rail viaduct, and back
 *      onto Front Street at the Royal Bank Plaza's gold towers.
 * Street-circuit concrete barriers line every street (railings on the
 * waterfront, padded walls in the ballpark), so the only way round is the lap.
 *
 * Usage: node make-toronto.mjs [outDir]
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { makeTextures, texResource, toPNG } from './textures.mjs';

const TRACK = 'toronto';
const MOD = 'downtown-toronto';
const RES = 'chris:toronto';
const DIR = `tracks/${TRACK}`;
const OUT = process.argv[2] ?? '.';

const PAINTED = makeTextures();
const TEX = {};
for (const [k, im] of Object.entries(PAINTED)) TEX[k] = { path: `${DIR}/tex_${k}`, w: im.w, h: im.h, custom: true, cutout: !!im.cutout };
TEX.grass = { path: 'textures/other_textures/grass_3', w: 32, h: 32 };

const SURF = { ASPHALT: 1, DIRT: 2, CEMENT: 4, GRASS: 8, WOOD: 17, OOB: 0xfd };
const CLIP = { NONE: 0, DEFAULT: 1, WALL: 4 };
const LAYER = { INVISIBLE: 0, OPAQUE: 1 };

const G_MAX = 0.14;
const SAMPLE = 18;
const PATH_SPACING = 25;
const GROUND = -2;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const normalize = (v) => { const l = Math.hypot(...v) || 1; return v.map((c) => c / l); };
const TC = (texels) => texels * 32;
const V = (x, y, z, s, t, n) => ({ x, y, z, s, t, n });
const Q = Math.PI / 2;
