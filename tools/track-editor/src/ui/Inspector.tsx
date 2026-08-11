import type {
  ActorPlacement,
  GroundFill,
  Segment,
  SurfaceType,
  TextureRef,
  TrackDoc,
  ValidationTarget,
  Vec3,
  WallMode,
  WaterRegion,
} from '../model/types';
import { SURFACE_LABELS } from '../model/types';
import { ACTOR_PALETTE, paletteEntry } from '../model/actorPalette';
import { resolveGroundFill } from '../geometry/loft';
import type { O2rCatalog } from '../o2r/readO2r';
import { filterPickerTextures } from '../o2r/readO2r';
import type { EditorTool } from './LayoutCanvas';
import { TexturePicker } from './TexturePicker';

type Props = {
  doc: TrackDoc;
  selected: number;
  selectedActorId: string | null;
  selectedWallId: string | null;
  selectedWaterId: string | null;
  selectedWallPointIndex: number | null;
  selectedWaterPointIndex: number | null;
  tool: EditorTool;
  placeActorName: string;
  wallDraftCount: number;
  waterDraftCount: number;
  drawingWall: boolean;
  drawingWater: boolean;
  defaultWallHeight: number;
  defaultWaterY: number;
  target: ValidationTarget;
  onChangeMeta: (patch: Partial<TrackDoc['meta']>) => void;
  onChangeSegment: (index: number, patch: Partial<Segment>) => void;
  onChangeKnot: (index: number, patch: Partial<Vec3>) => void;
  onChangeDecor: (patch: Partial<TrackDoc['decor']>) => void;
  onChangeGroundFill: (patch: Partial<GroundFill>) => void;
  onChangeTarget: (t: ValidationTarget) => void;
  onChangeSegmentTexture: (index: number, tex: TextureRef) => void;
  onChangeTool: (t: EditorTool) => void;
  onChangePlaceActor: (name: string) => void;
  onChangeActor: (id: string, patch: Partial<ActorPlacement>) => void;
  onDeleteActor: (id: string) => void;
  onStartNewWall: () => void;
  onFinishWall: () => void;
  onCancelWall: () => void;
  onDeleteWall: (id: string) => void;
  onChangeWallHeight: (id: string, height: number) => void;
  onChangeDefaultWallHeight: (h: number) => void;
  onChangeWallPoint: (id: string, index: number, patch: Partial<Vec3>) => void;
  onDeleteWallPoint: (id: string, index: number) => void;
  onSelectWallPoint: (index: number) => void;
  onStartNewWater: () => void;
  onFinishWater: () => void;
  onCancelWater: () => void;
  onDeleteWater: (id: string) => void;
  onChangeWater: (id: string, patch: Partial<WaterRegion>) => void;
  onChangeDefaultWaterY: (y: number) => void;
  onChangeWaterPoint: (id: string, index: number, patch: Partial<Vec3>) => void;
  onDeleteWaterPoint: (id: string, index: number) => void;
  onSelectWaterPoint: (index: number) => void;
  textureCatalog: O2rCatalog | null;
  canDeleteKnot?: boolean;
  onDeleteKnot?: () => void;
};

const SURFACES = Object.keys(SURFACE_LABELS) as SurfaceType[];
const WALLS: { value: WallMode; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
  { value: 'both', label: 'Both' },
];

export function Inspector({
  doc,
  selected,
  selectedActorId,
  selectedWallId,
  selectedWaterId,
  selectedWallPointIndex,
  selectedWaterPointIndex,
  tool,
  placeActorName,
  wallDraftCount,
  waterDraftCount,
  drawingWall: _drawingWall,
  drawingWater: _drawingWater,
  defaultWallHeight,
  defaultWaterY,
  target,
  onChangeMeta,
  onChangeSegment,
  onChangeKnot,
  onChangeDecor,
  onChangeGroundFill,
  onChangeTarget,
  onChangeSegmentTexture,
  onChangeTool,
  onChangePlaceActor,
  onChangeActor,
  onDeleteActor,
  onStartNewWall,
  onFinishWall,
  onCancelWall,
  onDeleteWall,
  onChangeWallHeight,
  onChangeDefaultWallHeight,
  onChangeWallPoint,
  onDeleteWallPoint,
  onSelectWallPoint,
  onStartNewWater,
  onFinishWater,
  onCancelWater,
  onDeleteWater,
  onChangeWater,
  onChangeDefaultWaterY,
  onChangeWaterPoint,
  onDeleteWaterPoint,
  onSelectWaterPoint,
  textureCatalog,
  canDeleteKnot = false,
  onDeleteKnot,
}: Props) {
  const seg = doc.segments[selected] ?? doc.segments[0];
  const knot = doc.spline.knots[selected] ?? { x: 0, y: 0, z: 0 };
  const actor = (doc.actors ?? []).find((a) => a.id === selectedActorId);
  const wall = (doc.walls ?? []).find((w) => w.id === selectedWallId);
  const water = (doc.water ?? []).find((w) => w.id === selectedWaterId);
  const pickerEntries = textureCatalog
    ? filterPickerTextures(textureCatalog)
    : undefined;
  const wallPt =
    wall && selectedWallPointIndex != null
      ? wall.points[selectedWallPointIndex]
      : null;
  const waterPt =
    water && selectedWaterPointIndex != null
      ? water.points[selectedWaterPointIndex]
      : null;
  const fill = resolveGroundFill(doc);

  return (
    <div className="inspector">
      <section>
        <h3>Tool</h3>
        <div className="btn-row">
          <button
            type="button"
            className={tool === 'path' ? 'active' : ''}
            onClick={() => onChangeTool('path')}
          >
            Path
          </button>
          <button
            type="button"
            className={tool === 'place' ? 'active' : ''}
            onClick={() => onChangeTool('place')}
          >
            Place props
          </button>
          <button
            type="button"
            className={tool === 'wall' ? 'active' : ''}
            onClick={() => onChangeTool('wall')}
          >
            Walls
          </button>
          <button
            type="button"
            className={tool === 'water' ? 'active' : ''}
            onClick={() => onChangeTool('water')}
          >
            Water
          </button>
        </div>
      </section>

      <section>
        <h3>Track</h3>
        <label>
          Display name
          <input
            value={doc.meta.name}
            onChange={(e) => onChangeMeta({ name: e.target.value })}
          />
        </label>
        <label>
          Resource name
          <input
            value={doc.meta.resourceName}
            onChange={(e) => onChangeMeta({ resourceName: e.target.value })}
          />
        </label>
        <label>
          Debug name
          <input
            value={doc.meta.debugName}
            onChange={(e) => onChangeMeta({ debugName: e.target.value })}
          />
        </label>
        <label>
          Mod / file name
          <input
            value={doc.meta.modName}
            onChange={(e) => onChangeMeta({ modName: e.target.value })}
          />
        </label>
        <label>
          Road apron width
          <input
            type="number"
            min={0}
            step={10}
            value={doc.decor.apronWidth}
            onChange={(e) =>
              onChangeDecor({ apronWidth: Math.max(0, Number(e.target.value) || 0) })
            }
          />
        </label>
      </section>

      <section>
        <h3>Ground fill (world land)</h3>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={fill.enabled}
            onChange={(e) => onChangeGroundFill({ enabled: e.target.checked })}
          />
          Fill blank areas with land
        </label>
        <p className="hint">
          Covers the whole map extents with collidable ground so players cannot
          fall forever. Road sits on top.
        </p>
        {fill.enabled && (
          <>
            <label>
              Surface type
              <select
                value={fill.surface}
                onChange={(e) =>
                  onChangeGroundFill({
                    surface: e.target.value as SurfaceType,
                  })
                }
              >
                {SURFACES.map((s) => (
                  <option key={s} value={s}>
                    {SURFACE_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
            <TexturePicker
              label="Ground texture"
              value={fill.texture}
              catalog={textureCatalog}
              entries={pickerEntries}
              onChange={(tex) => onChangeGroundFill({ texture: tex })}
            />
            <p className="hint">
              Also used for freehand barrier walls. Load mk64.o2r for previews
              (try searching &quot;grass&quot;).
            </p>
            <TexturePicker
              label="Road apron texture"
              value={doc.decor.apronTexture}
              catalog={textureCatalog}
              entries={pickerEntries}
              onChange={(tex) => onChangeDecor({ apronTexture: tex })}
            />
            <label>
              Padding around track
              <input
                type="number"
                min={0}
                step={100}
                value={fill.padding}
                onChange={(e) =>
                  onChangeGroundFill({
                    padding: Math.max(0, Number(e.target.value) || 0),
                  })
                }
              />
            </label>
            <label>
              Ground height (Y)
              <input
                type="number"
                step={10}
                value={fill.y}
                onChange={(e) =>
                  onChangeGroundFill({ y: Number(e.target.value) || 0 })
                }
              />
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={fill.perimeterWalls}
                onChange={(e) =>
                  onChangeGroundFill({ perimeterWalls: e.target.checked })
                }
              />
              Perimeter walls (block map edges)
            </label>
            {fill.perimeterWalls && (
              <label>
                Perimeter wall height
                <input
                  type="number"
                  min={10}
                  value={fill.perimeterWallHeight}
                  onChange={(e) =>
                    onChangeGroundFill({
                      perimeterWallHeight: Math.max(
                        10,
                        Number(e.target.value) || 120,
                      ),
                    })
                  }
                />
              </label>
            )}
          </>
        )}
      </section>

      <section>
        <h3>Validation target</h3>
        <div className="btn-row">
          {(['both', 'stock', '8p'] as ValidationTarget[]).map((t) => (
            <button
              key={t}
              type="button"
              className={target === t ? 'active' : ''}
              onClick={() => onChangeTarget(t)}
            >
              {t === '8p' ? '8-player' : t === 'stock' ? 'Stock' : 'Both'}
            </button>
          ))}
        </div>
      </section>

      {/* Water editor — visible whenever a water region is selected, or water tool */}
      {(tool === 'water' || water) && (
        <section>
          <h3>Water</h3>
          {tool === 'water' && (
            <>
              <p className="hint">
                <strong>Click the map</strong> to outline a lake. Need 3+ points,
                then Finish (or press Enter). Alt-drag pans the map.
              </p>
              <label>
                Water height (Y)
                <input
                  type="number"
                  step={5}
                  value={defaultWaterY}
                  onChange={(e) =>
                    onChangeDefaultWaterY(Number(e.target.value) || 0)
                  }
                />
              </label>
              <div className="btn-row">
                <button
                  type="button"
                  className="primary"
                  disabled={waterDraftCount < 3}
                  onClick={onFinishWater}
                >
                  Finish water ({waterDraftCount} pts)
                </button>
                <button
                  type="button"
                  disabled={waterDraftCount === 0}
                  onClick={onCancelWater}
                >
                  Cancel
                </button>
                <button type="button" onClick={onStartNewWater}>
                  Clear &amp; restart
                </button>
              </div>
            </>
          )}
          <p className="hint">{(doc.water ?? []).length} water region(s) — click one to edit</p>
          {water && (
            <>
              <label>
                Surface height (Y)
                <input
                  type="number"
                  step={5}
                  value={water.y}
                  onChange={(e) =>
                    onChangeWater(water.id, {
                      y: Number(e.target.value) || 0,
                    })
                  }
                />
              </label>
              <TexturePicker
                label="Water texture"
                value={water.texture}
                catalog={textureCatalog}
                entries={pickerEntries}
                onChange={(tex) => onChangeWater(water.id, { texture: tex })}
              />
              <label>
                Point
                <select
                  value={selectedWaterPointIndex ?? 0}
                  onChange={(e) => onSelectWaterPoint(Number(e.target.value))}
                >
                  {water.points.map((_, i) => (
                    <option key={i} value={i}>
                      Vertex {i}
                    </option>
                  ))}
                </select>
              </label>
              {waterPt && selectedWaterPointIndex != null && (
                <>
                  <label>
                    Point X
                    <input
                      type="number"
                      step={10}
                      value={waterPt.x}
                      onChange={(e) =>
                        onChangeWaterPoint(water.id, selectedWaterPointIndex, {
                          x: Number(e.target.value) || 0,
                        })
                      }
                    />
                  </label>
                  <label>
                    Point Z
                    <input
                      type="number"
                      step={10}
                      value={waterPt.z}
                      onChange={(e) =>
                        onChangeWaterPoint(water.id, selectedWaterPointIndex, {
                          z: Number(e.target.value) || 0,
                        })
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className="danger"
                    disabled={water.points.length <= 3}
                    onClick={() =>
                      onDeleteWaterPoint(water.id, selectedWaterPointIndex)
                    }
                  >
                    Delete vertex
                  </button>
                </>
              )}
              <p className="hint">
                Drag vertices on the map · double-click an edge to insert a point
              </p>
              <button
                type="button"
                className="danger"
                onClick={() => onDeleteWater(water.id)}
              >
                Delete water region
              </button>
            </>
          )}
        </section>
      )}

      {(tool === 'wall' || wall) && (
        <section>
          <h3>Walls</h3>
          {tool === 'wall' && (
            <>
              <p className="hint">
                <strong>Click the map</strong> to place wall points. Need 2+, then
                Finish (or press Enter). Alt-drag pans the map.
              </p>
              <label>
                Wall height
                <input
                  type="number"
                  min={10}
                  value={defaultWallHeight}
                  onChange={(e) =>
                    onChangeDefaultWallHeight(
                      Math.max(10, Number(e.target.value) || 80),
                    )
                  }
                />
              </label>
              <div className="btn-row">
                <button
                  type="button"
                  className="primary"
                  disabled={wallDraftCount < 2}
                  onClick={onFinishWall}
                >
                  Finish wall ({wallDraftCount} pts)
                </button>
                <button
                  type="button"
                  disabled={wallDraftCount === 0}
                  onClick={onCancelWall}
                >
                  Cancel
                </button>
                <button type="button" onClick={onStartNewWall}>
                  Clear &amp; restart
                </button>
              </div>
            </>
          )}
          <p className="hint">{(doc.walls ?? []).length} wall(s) — click one to edit</p>
          {wall && (
            <>
              <label>
                Wall height
                <input
                  type="number"
                  min={10}
                  value={wall.height}
                  onChange={(e) =>
                    onChangeWallHeight(
                      wall.id,
                      Math.max(10, Number(e.target.value) || 80),
                    )
                  }
                />
              </label>
              <label>
                Point
                <select
                  value={selectedWallPointIndex ?? 0}
                  onChange={(e) => onSelectWallPoint(Number(e.target.value))}
                >
                  {wall.points.map((_, i) => (
                    <option key={i} value={i}>
                      Vertex {i}
                    </option>
                  ))}
                </select>
              </label>
              {wallPt && selectedWallPointIndex != null && (
                <>
                  <label>
                    Point X
                    <input
                      type="number"
                      step={10}
                      value={wallPt.x}
                      onChange={(e) =>
                        onChangeWallPoint(wall.id, selectedWallPointIndex, {
                          x: Number(e.target.value) || 0,
                        })
                      }
                    />
                  </label>
                  <label>
                    Point Z
                    <input
                      type="number"
                      step={10}
                      value={wallPt.z}
                      onChange={(e) =>
                        onChangeWallPoint(wall.id, selectedWallPointIndex, {
                          z: Number(e.target.value) || 0,
                        })
                      }
                    />
                  </label>
                  <label>
                    Point base Y
                    <input
                      type="number"
                      step={5}
                      value={wallPt.y}
                      onChange={(e) =>
                        onChangeWallPoint(wall.id, selectedWallPointIndex, {
                          y: Number(e.target.value) || 0,
                        })
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className="danger"
                    disabled={wall.points.length <= 2}
                    onClick={() =>
                      onDeleteWallPoint(wall.id, selectedWallPointIndex)
                    }
                  >
                    Delete vertex
                  </button>
                </>
              )}
              <p className="hint">
                Drag vertices on the map · double-click an edge to insert a point
              </p>
              <button
                type="button"
                className="danger"
                onClick={() => onDeleteWall(wall.id)}
              >
                Delete wall
              </button>
            </>
          )}
          <p className="hint">
            Path segments also have <strong>Walls</strong> (left/right/both) for
            road-edge barriers.
          </p>
        </section>
      )}

      {tool === 'place' && (
        <section>
          <h3>Props palette</h3>
          <p className="hint">
            Select a type, then click the map to place. Drag markers to move.
            Height snaps to the nearest road sample.
          </p>
          <div className="palette">
            {ACTOR_PALETTE.map((entry) => (
              <button
                key={entry.name}
                type="button"
                className={placeActorName === entry.name ? 'active palette-item' : 'palette-item'}
                style={{ borderLeftColor: entry.color }}
                onClick={() => onChangePlaceActor(entry.name)}
                title={entry.name}
              >
                <span className="glyph">{entry.glyph}</span> {entry.label}
              </button>
            ))}
          </div>
          <p className="hint">{(doc.actors ?? []).length} props on track</p>
        </section>
      )}

      {actor && (
        <section>
          <h3>Selected prop</h3>
          <p className="hint">
            {paletteEntry(actor.name)?.label ?? actor.name}
          </p>
          <label>
            Height (Y)
            <input
              type="number"
              value={actor.location.y}
              step={10}
              onChange={(e) =>
                onChangeActor(actor.id, {
                  location: {
                    ...actor.location,
                    y: Number(e.target.value) || 0,
                  },
                })
              }
            />
          </label>
          <label>
            X
            <input
              type="number"
              value={actor.location.x}
              step={10}
              onChange={(e) =>
                onChangeActor(actor.id, {
                  location: {
                    ...actor.location,
                    x: Number(e.target.value) || 0,
                  },
                })
              }
            />
          </label>
          <label>
            Z
            <input
              type="number"
              value={actor.location.z}
              step={10}
              onChange={(e) =>
                onChangeActor(actor.id, {
                  location: {
                    ...actor.location,
                    z: Number(e.target.value) || 0,
                  },
                })
              }
            />
          </label>
          <button
            type="button"
            className="danger"
            onClick={() => onDeleteActor(actor.id)}
          >
            Delete prop
          </button>
        </section>
      )}

      {tool === 'path' && (
        <section>
          <h3>Knot {selected}</h3>
          <p className="hint">
            {selected === 0
              ? 'Start knot — X/Z fixed at origin (spawns). Height is editable.'
              : `${doc.spline.knots.length} knots in loop.`}
          </p>
          <label>
            Height (Y)
            <input
              type="number"
              value={knot.y}
              step={10}
              onChange={(e) =>
                onChangeKnot(selected, { y: Number(e.target.value) || 0 })
              }
            />
          </label>
          {selected !== 0 && (
            <>
              <label>
                X
                <input
                  type="number"
                  value={knot.x}
                  step={10}
                  onChange={(e) =>
                    onChangeKnot(selected, { x: Number(e.target.value) || 0 })
                  }
                />
              </label>
              <label>
                Z
                <input
                  type="number"
                  value={knot.z}
                  step={10}
                  onChange={(e) =>
                    onChangeKnot(selected, { z: Number(e.target.value) || 0 })
                  }
                />
              </label>
            </>
          )}
          {onDeleteKnot && (
            <button
              type="button"
              className="danger"
              disabled={!canDeleteKnot}
              onClick={onDeleteKnot}
            >
              Delete knot
            </button>
          )}
        </section>
      )}

      {tool === 'path' && seg && (
        <section>
          <h3>Segment {selected}</h3>
          <label>
            Width left
            <input
              type="number"
              value={seg.widthLeft}
              onChange={(e) =>
                onChangeSegment(selected, { widthLeft: Number(e.target.value) })
              }
            />
          </label>
          <label>
            Width right
            <input
              type="number"
              value={seg.widthRight}
              onChange={(e) =>
                onChangeSegment(selected, { widthRight: Number(e.target.value) })
              }
            />
          </label>
          <label>
            Surface
            <select
              value={seg.surface}
              onChange={(e) =>
                onChangeSegment(selected, {
                  surface: e.target.value as SurfaceType,
                })
              }
            >
              {SURFACES.map((s) => (
                <option key={s} value={s}>
                  {SURFACE_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Walls
            <select
              value={seg.wall}
              onChange={(e) =>
                onChangeSegment(selected, {
                  wall: e.target.value as WallMode,
                })
              }
            >
              {WALLS.map((w) => (
                <option key={w.value} value={w.value}>
                  {w.label}
                </option>
              ))}
            </select>
          </label>
          {seg.wall !== 'none' && (
            <label>
              Wall height
              <input
                type="number"
                min={10}
                value={seg.wallHeight}
                onChange={(e) =>
                  onChangeSegment(selected, {
                    wallHeight: Math.max(10, Number(e.target.value) || 80),
                  })
                }
              />
            </label>
          )}
          <TexturePicker
            label="Road / segment wall texture"
            value={seg.texture}
            catalog={textureCatalog}
            entries={pickerEntries}
            onChange={(tex) => onChangeSegmentTexture(selected, tex)}
          />
          <p className="hint">
            {seg.textureManual
              ? 'Texture break — applies forward through knots that share this texture.'
              : 'Same texture as previous — change it here to start a new run forward.'}
            {' · '}
            {seg.wallManual
              ? 'Wall break — applies forward while wall settings match.'
              : 'Wall settings match previous segment.'}
          </p>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={!!seg.rampKick}
              onChange={(e) =>
                onChangeSegment(selected, {
                  rampKick: e.target.checked
                    ? { liftHeight: 120, lipLength: 300 }
                    : undefined,
                  surface: e.target.checked ? 'boost_ramp_asphalt' : 'asphalt',
                })
              }
            />
            Boost ramp
          </label>
          {seg.rampKick && (
            <label>
              Lift height
              <input
                type="number"
                value={seg.rampKick.liftHeight}
                onChange={(e) =>
                  onChangeSegment(selected, {
                    rampKick: {
                      ...seg.rampKick!,
                      liftHeight: Number(e.target.value),
                    },
                  })
                }
              />
            </label>
          )}
        </section>
      )}
    </div>
  );
}
