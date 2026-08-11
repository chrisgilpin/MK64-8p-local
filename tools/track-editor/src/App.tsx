import { useCallback, useEffect, useMemo, useState } from 'react';
import { createDefaultOval, createSpikeLikeDoc, newActorId } from './model/defaults';
import { canDeleteKnot, deleteKnot } from './model/editKnots';
import {
  deleteShapePoint,
  insertShapePoint,
  MIN_WALL_POINTS,
  MIN_WATER_POINTS,
  moveShapePoint,
  setShapePoint,
} from './model/editShapes';
import {
  clearAutosave,
  downloadProject,
  PROJECT_EXTENSION,
  readAutosave,
  readProjectFile,
  writeAutosave,
} from './model/projectIO';
import {
  applyTextureRun,
  applyWallRun,
  healAllManualStyleFlags,
  newInheritedSegment,
} from './model/segmentStyle';
import type {
  ActorPlacement,
  GroundFill,
  Segment,
  TrackDoc,
  ValidationTarget,
  Vec3,
  WallBarrier,
  WaterRegion,
} from './model/types';
import { DEFAULT_WATER_TEXTURE } from './model/types';
import { exportTrack, downloadExport } from './export/exportTrack';
import { validateTrack, canExport } from './validate/validate';
import {
  catalogFromZip,
  filterPickerTextures,
  type O2rCatalog,
} from './o2r/readO2r';
import type { TextureRef } from './model/types';
import { resolveGroundFill, sampleHeightAt } from './geometry/loft';
import { LayoutCanvas, type EditorTool } from './ui/LayoutCanvas';
import { Preview3D } from './ui/Preview3D';
import { Inspector } from './ui/Inspector';
import { ValidationPanel } from './ui/ValidationPanel';
import './App.css';

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/** Ensure older in-memory docs have groundFill / walls / sane style flags. */
function normalizeDoc(d: TrackDoc): TrackDoc {
  if (!d.walls) d.walls = [];
  if (!d.water) d.water = [];
  if (!d.actors) d.actors = [];
  if (!d.decor.groundFill) {
    d.decor.groundFill = resolveGroundFill(d);
  }
  for (const s of d.segments) {
    if (s.wallHeight === undefined) s.wallHeight = 80;
    if (!s.wall) s.wall = 'none';
  }
  // Autosaves that marked every segment as a manual style break.
  d.segments = healAllManualStyleFlags(d.segments);
  return d;
}

function initialDoc(): TrackDoc {
  const autosave = readAutosave();
  if (autosave?.ok) return normalizeDoc(autosave.doc);
  return createDefaultOval();
}

export default function App() {
  const [doc, setDoc] = useState<TrackDoc>(() => initialDoc());
  const [selected, setSelected] = useState(0);
  const [selectedActorId, setSelectedActorId] = useState<string | null>(null);
  const [selectedWallId, setSelectedWallId] = useState<string | null>(null);
  const [selectedWaterId, setSelectedWaterId] = useState<string | null>(null);
  const [selectedWallPointIndex, setSelectedWallPointIndex] = useState<
    number | null
  >(null);
  const [selectedWaterPointIndex, setSelectedWaterPointIndex] = useState<
    number | null
  >(null);
  const [tool, setTool] = useState<EditorTool>('path');
  const [placeActorName, setPlaceActorName] = useState('mk:item_box');
  const [wallDraft, setWallDraft] = useState<Vec3[]>([]);
  const [waterDraft, setWaterDraft] = useState<Vec3[]>([]);
  const [drawingWall, setDrawingWall] = useState(false);
  const [drawingWater, setDrawingWater] = useState(false);
  const [defaultWallHeight, setDefaultWallHeight] = useState(100);
  const [defaultWaterY, setDefaultWaterY] = useState(-20);
  const [target, setTarget] = useState<ValidationTarget>('both');
  const [textureCatalog, setTextureCatalog] = useState<O2rCatalog | null>(null);
  const [assetStatus, setAssetStatus] = useState(() => {
    const autosave = readAutosave();
    if (autosave?.ok) {
      return `Restored autosave: ${autosave.doc.meta.name}. Load mk64.o2r for texture previews.`;
    }
    return 'Load mk64.o2r for texture previews · Save/Open project for WIP · Export .o2r to play.';
  });
  const [exportMsg, setExportMsg] = useState('');
  const [editMsg, setEditMsg] = useState('');

  const issues = useMemo(() => validateTrack(doc, target), [doc, target]);
  const exportOk = canExport(issues);

  const updateDoc = useCallback((fn: (d: TrackDoc) => TrackDoc) => {
    setDoc((prev) => normalizeDoc(fn(structuredClone(prev))));
  }, []);

  // Debounced browser autosave so refresh doesn't lose work.
  useEffect(() => {
    const t = window.setTimeout(() => writeAutosave(doc), 800);
    return () => window.clearTimeout(t);
  }, [doc]);

  const resetSelection = useCallback(() => {
    setSelected(0);
    setSelectedActorId(null);
    setSelectedWallId(null);
    setSelectedWaterId(null);
    setSelectedWallPointIndex(null);
    setSelectedWaterPointIndex(null);
    setWallDraft([]);
    setWaterDraft([]);
    setDrawingWall(false);
    setDrawingWater(false);
    setTool('path');
  }, []);

  const loadTrackDoc = useCallback(
    (next: TrackDoc, sourceLabel: string, warnings: string[] = []) => {
      setDoc(normalizeDoc(next));
      resetSelection();
      writeAutosave(next);
      const warn =
        warnings.length > 0 ? ` (${warnings.length} migration note(s))` : '';
      setEditMsg(`Loaded ${sourceLabel}${warn}.`);
      setAssetStatus(
        `Editing “${next.meta.name}” from ${sourceLabel}. Use Save project for a .mk64track.json file.`,
      );
    },
    [resetSelection],
  );

  const onSaveProject = () => {
    try {
      const name = downloadProject(doc);
      writeAutosave(doc);
      setEditMsg(`Saved project as ${name}`);
    } catch (e) {
      setEditMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const onOpenProjectFile = async (file: File) => {
    const result = await readProjectFile(file);
    if (!result.ok) {
      setEditMsg(`Could not open project: ${result.error}`);
      return;
    }
    loadTrackDoc(result.doc, file.name, result.warnings);
  };

  const onMoveKnot = (index: number, pos: Vec3) => {
    updateDoc((d) => {
      const prev = d.spline.knots[index];
      d.spline.knots[index] = {
        x: pos.x,
        y: pos.y !== undefined && !Number.isNaN(pos.y) ? pos.y : (prev?.y ?? 0),
        z: pos.z,
      };
      if (index === 0) {
        d.spline.knots[0] = { x: 0, y: d.spline.knots[0].y, z: 0 };
      }
      return d;
    });
  };

  const onChangeKnot = (index: number, patch: Partial<Vec3>) => {
    updateDoc((d) => {
      const prev = d.spline.knots[index] ?? { x: 0, y: 0, z: 0 };
      const next = {
        x: patch.x !== undefined ? patch.x : prev.x,
        y: patch.y !== undefined ? patch.y : prev.y,
        z: patch.z !== undefined ? patch.z : prev.z,
      };
      if (index === 0) {
        next.x = 0;
        next.z = 0;
      }
      d.spline.knots[index] = next;
      return d;
    });
  };

  const onAddKnot = (pos: Vec3) => {
    updateDoc((d) => {
      const i = selected + 1;
      const a = d.spline.knots[selected];
      const b = d.spline.knots[i % d.spline.knots.length];
      const midY = Math.round(((a?.y ?? 0) + (b?.y ?? 0)) / 2);
      d.spline.knots.splice(i, 0, {
        x: pos.x,
        y: pos.y !== 0 ? pos.y : midY,
        z: pos.z,
      });
      const template = d.segments[selected] ?? d.segments[0];
      // New span inherits texture/walls until the next manual break.
      d.segments.splice(i, 0, newInheritedSegment(template));
      return d;
    });
    setSelected(selected + 1);
    setEditMsg('');
  };

  const onDeleteKnot = useCallback(
    (index: number = selected) => {
      const result = deleteKnot(doc, index, selected);
      if (!result.ok) {
        setEditMsg(result.reason);
        return;
      }
      setDoc(normalizeDoc(result.doc));
      setSelected(result.selected);
      setEditMsg(`Deleted knot ${index}.`);
    },
    [doc, selected],
  );

  const onPlaceActor = (pos: Vec3) => {
    const y = sampleHeightAt(doc, pos.x, pos.z);
    const actor: ActorPlacement = {
      id: newActorId(),
      name: placeActorName,
      location: { x: pos.x, y, z: pos.z },
    };
    updateDoc((d) => {
      d.actors = [...(d.actors ?? []), actor];
      return d;
    });
    setSelectedActorId(actor.id);
    setSelectedWallId(null);
    setEditMsg(`Placed ${placeActorName}`);
  };

  const onMoveActor = (id: string, pos: Vec3) => {
    updateDoc((d) => {
      d.actors = (d.actors ?? []).map((a) =>
        a.id === id
          ? {
              ...a,
              location: {
                x: pos.x,
                y: sampleHeightAt(d, pos.x, pos.z),
                z: pos.z,
              },
            }
          : a,
      );
      return d;
    });
  };

  const onChangeActor = (id: string, patch: Partial<ActorPlacement>) => {
    updateDoc((d) => {
      d.actors = (d.actors ?? []).map((a) =>
        a.id === id
          ? {
              ...a,
              ...patch,
              location: patch.location ?? a.location,
            }
          : a,
      );
      return d;
    });
  };

  const onDeleteActor = useCallback(
    (id: string) => {
      updateDoc((d) => {
        d.actors = (d.actors ?? []).filter((a) => a.id !== id);
        return d;
      });
      setSelectedActorId(null);
      setEditMsg('Deleted prop.');
    },
    [updateDoc],
  );

  const onWallClick = (pos: Vec3) => {
    const y = resolveGroundFill(doc).y;
    setDrawingWall(true);
    setDrawingWater(false);
    setWaterDraft([]);
    setWallDraft((prev) => [...prev, { x: pos.x, y, z: pos.z }]);
    setSelectedWallId(null);
    setSelectedWallPointIndex(null);
    setSelectedActorId(null);
    setSelectedWaterId(null);
    setEditMsg('Wall point added — keep clicking, then Finish wall (Enter).');
  };

  const onStartNewWall = () => {
    setDrawingWall(true);
    setDrawingWater(false);
    setWaterDraft([]);
    setWallDraft([]);
    setSelectedWallId(null);
    setSelectedWallPointIndex(null);
    setTool('wall');
    setEditMsg('Wall tool: click the map to place vertices, then Finish (Enter).');
  };

  const onFinishWall = useCallback(() => {
    if (wallDraft.length < 2) {
      setEditMsg('Need at least 2 points for a wall.');
      return;
    }
    const wall: WallBarrier = {
      id: newActorId(),
      points: wallDraft,
      height: defaultWallHeight,
    };
    updateDoc((d) => {
      d.walls = [...(d.walls ?? []), wall];
      return d;
    });
    setWallDraft([]);
    setDrawingWall(false);
    setSelectedWallId(wall.id);
    setSelectedWallPointIndex(0);
    setEditMsg(`Added wall with ${wall.points.length} points.`);
  }, [wallDraft, defaultWallHeight, updateDoc]);

  const onCancelWall = () => {
    setWallDraft([]);
    setDrawingWall(false);
    setEditMsg('Wall draft cleared.');
  };

  const onDeleteWall = useCallback(
    (id: string) => {
      updateDoc((d) => {
        d.walls = (d.walls ?? []).filter((w) => w.id !== id);
        return d;
      });
      setSelectedWallId(null);
      setSelectedWallPointIndex(null);
      setEditMsg('Deleted wall.');
    },
    [updateDoc],
  );

  const onChangeWallHeight = (id: string, height: number) => {
    updateDoc((d) => {
      d.walls = (d.walls ?? []).map((w) =>
        w.id === id ? { ...w, height } : w,
      );
      return d;
    });
  };

  const onMoveWallPoint = (id: string, index: number, pos: Vec3) => {
    updateDoc((d) => {
      d.walls = (d.walls ?? []).map((w) =>
        w.id === id
          ? { ...w, points: moveShapePoint(w.points, index, pos) }
          : w,
      );
      return d;
    });
  };

  const onChangeWallPoint = (
    id: string,
    index: number,
    patch: Partial<Vec3>,
  ) => {
    updateDoc((d) => {
      d.walls = (d.walls ?? []).map((w) =>
        w.id === id
          ? { ...w, points: setShapePoint(w.points, index, patch) }
          : w,
      );
      return d;
    });
  };

  const onDeleteWallPoint = (id: string, index: number) => {
    const wall = (doc.walls ?? []).find((w) => w.id === id);
    if (!wall) return;
    const result = deleteShapePoint(wall.points, index, MIN_WALL_POINTS);
    if (!result.ok) {
      setEditMsg(result.reason);
      return;
    }
    updateDoc((d) => {
      d.walls = (d.walls ?? []).map((w) =>
        w.id === id ? { ...w, points: result.points } : w,
      );
      return d;
    });
    setSelectedWallPointIndex(result.selectedIndex);
    setEditMsg(`Deleted wall vertex ${index}.`);
  };

  const onInsertWallPoint = (id: string, afterIndex: number, pos: Vec3) => {
    updateDoc((d) => {
      d.walls = (d.walls ?? []).map((w) => {
        if (w.id !== id) return w;
        const { points, selectedIndex } = insertShapePoint(
          w.points,
          afterIndex,
          pos,
        );
        queueMicrotask(() => {
          setSelectedWallId(id);
          setSelectedWallPointIndex(selectedIndex);
        });
        return { ...w, points };
      });
      return d;
    });
  };

  const onWaterClick = (pos: Vec3) => {
    setDrawingWater(true);
    setDrawingWall(false);
    setWallDraft([]);
    setWaterDraft((prev) => [
      ...prev,
      { x: pos.x, y: defaultWaterY, z: pos.z },
    ]);
    setSelectedWaterId(null);
    setSelectedWaterPointIndex(null);
    setSelectedActorId(null);
    setSelectedWallId(null);
    setEditMsg('Water point added — keep clicking shoreline, then Finish (Enter, 3+ pts).');
  };

  const onStartNewWater = () => {
    setDrawingWater(true);
    setDrawingWall(false);
    setWallDraft([]);
    setWaterDraft([]);
    setSelectedWaterId(null);
    setSelectedWaterPointIndex(null);
    setTool('water');
    setEditMsg('Water tool: click the map to outline a lake, then Finish (Enter, 3+ pts).');
  };

  const onFinishWater = useCallback(() => {
    if (waterDraft.length < 3) {
      setEditMsg('Need at least 3 points for a water shape.');
      return;
    }
    const region: WaterRegion = {
      id: newActorId(),
      points: waterDraft,
      y: defaultWaterY,
      texture: { ...DEFAULT_WATER_TEXTURE },
    };
    updateDoc((d) => {
      d.water = [...(d.water ?? []), region];
      return d;
    });
    setWaterDraft([]);
    setDrawingWater(false);
    setSelectedWaterId(region.id);
    setSelectedWaterPointIndex(0);
    setEditMsg(`Added water region with ${region.points.length} points.`);
  }, [waterDraft, defaultWaterY, updateDoc]);

  const onCancelWater = () => {
    setWaterDraft([]);
    setDrawingWater(false);
    setEditMsg('Water draft cleared.');
  };

  const onDeleteWater = useCallback(
    (id: string) => {
      updateDoc((d) => {
        d.water = (d.water ?? []).filter((w) => w.id !== id);
        return d;
      });
      setSelectedWaterId(null);
      setSelectedWaterPointIndex(null);
      setEditMsg('Deleted water region.');
    },
    [updateDoc],
  );

  const onChangeWater = (id: string, patch: Partial<WaterRegion>) => {
    updateDoc((d) => {
      d.water = (d.water ?? []).map((w) =>
        w.id === id
          ? {
              ...w,
              ...patch,
              texture: patch.texture ?? w.texture,
              points: patch.points ?? w.points,
            }
          : w,
      );
      return d;
    });
  };

  const onMoveWaterPoint = (id: string, index: number, pos: Vec3) => {
    updateDoc((d) => {
      d.water = (d.water ?? []).map((w) =>
        w.id === id
          ? { ...w, points: moveShapePoint(w.points, index, pos) }
          : w,
      );
      return d;
    });
  };

  const onChangeWaterPoint = (
    id: string,
    index: number,
    patch: Partial<Vec3>,
  ) => {
    updateDoc((d) => {
      d.water = (d.water ?? []).map((w) =>
        w.id === id
          ? { ...w, points: setShapePoint(w.points, index, patch) }
          : w,
      );
      return d;
    });
  };

  const onDeleteWaterPoint = (id: string, index: number) => {
    const water = (doc.water ?? []).find((w) => w.id === id);
    if (!water) return;
    const result = deleteShapePoint(water.points, index, MIN_WATER_POINTS);
    if (!result.ok) {
      setEditMsg(result.reason);
      return;
    }
    updateDoc((d) => {
      d.water = (d.water ?? []).map((w) =>
        w.id === id ? { ...w, points: result.points } : w,
      );
      return d;
    });
    setSelectedWaterPointIndex(result.selectedIndex);
    setEditMsg(`Deleted water vertex ${index}.`);
  };

  const onInsertWaterPoint = (id: string, afterIndex: number, pos: Vec3) => {
    updateDoc((d) => {
      d.water = (d.water ?? []).map((w) => {
        if (w.id !== id) return w;
        const { points, selectedIndex } = insertShapePoint(
          w.points,
          afterIndex,
          { ...pos, y: w.y },
        );
        queueMicrotask(() => {
          setSelectedWaterId(id);
          setSelectedWaterPointIndex(selectedIndex);
        });
        return { ...w, points };
      });
      return d;
    });
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;

      if (drawingWall && e.key === 'Enter') {
        e.preventDefault();
        onFinishWall();
        return;
      }
      if (drawingWall && e.key === 'Escape') {
        e.preventDefault();
        onCancelWall();
        return;
      }
      if (drawingWater && e.key === 'Enter') {
        e.preventDefault();
        onFinishWater();
        return;
      }
      if (drawingWater && e.key === 'Escape') {
        e.preventDefault();
        onCancelWater();
        return;
      }

      if (e.key !== 'Backspace' && e.key !== 'Delete') return;
      e.preventDefault();
      if (selectedActorId) {
        onDeleteActor(selectedActorId);
        return;
      }
      // Prefer deleting a single vertex when one is selected
      if (
        selectedWallId != null &&
        selectedWallPointIndex != null &&
        !e.shiftKey
      ) {
        onDeleteWallPoint(selectedWallId, selectedWallPointIndex);
        return;
      }
      if (
        selectedWaterId != null &&
        selectedWaterPointIndex != null &&
        !e.shiftKey
      ) {
        onDeleteWaterPoint(selectedWaterId, selectedWaterPointIndex);
        return;
      }
      if (selectedWallId) {
        onDeleteWall(selectedWallId);
        return;
      }
      if (selectedWaterId) {
        onDeleteWater(selectedWaterId);
        return;
      }
      if (tool === 'path') onDeleteKnot(selected);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    drawingWall,
    drawingWater,
    onDeleteActor,
    onDeleteKnot,
    onDeleteWall,
    onDeleteWater,
    onFinishWall,
    onFinishWater,
    selected,
    selectedActorId,
    selectedWallId,
    selectedWallPointIndex,
    selectedWaterId,
    selectedWaterPointIndex,
    tool,
  ]);

  const onChangeMeta = (patch: Partial<TrackDoc['meta']>) => {
    updateDoc((d) => {
      d.meta = { ...d.meta, ...patch };
      return d;
    });
  };

  const onChangeDecor = (patch: Partial<TrackDoc['decor']>) => {
    updateDoc((d) => {
      d.decor = { ...d.decor, ...patch };
      return d;
    });
  };

  const onChangeGroundFill = (patch: Partial<GroundFill>) => {
    updateDoc((d) => {
      const cur = resolveGroundFill(d);
      d.decor = {
        ...d.decor,
        groundFill: { ...cur, ...patch },
      };
      return d;
    });
  };

  const onChangeSegment = (index: number, patch: Partial<Segment>) => {
    updateDoc((d) => {
      const prev = d.segments[index];
      // Wall fields propagate forward until the next manual wall break.
      if (patch.wall !== undefined || patch.wallHeight !== undefined) {
        d.segments = applyWallRun(d.segments, index, {
          wall: patch.wall,
          wallHeight: patch.wallHeight,
        });
        // Apply any non-wall fields only on the edited segment.
        const rest = { ...patch };
        delete rest.wall;
        delete rest.wallHeight;
        if (Object.keys(rest).length > 0) {
          d.segments[index] = {
            ...d.segments[index],
            ...rest,
          };
        }
        return d;
      }
      d.segments[index] = {
        ...prev,
        wallHeight: prev.wallHeight ?? 80,
        ...patch,
      };
      return d;
    });
  };

  const onChangeSegmentTexture = (index: number, tex: TextureRef) => {
    updateDoc((d) => {
      d.segments = applyTextureRun(d.segments, index, tex);
      return d;
    });
    setEditMsg(
      `Texture applied from segment ${index} forward until the next manual texture.`,
    );
  };

  const onExport = () => {
    try {
      const result = exportTrack(normalizeDoc(structuredClone(doc)));
      downloadExport(result);
      setExportMsg(
        `Exported ${result.filename} — ${result.stats.triangles} tris, ${(doc.actors ?? []).length} props, ${(doc.walls ?? []).length} walls, ${(doc.water ?? []).length} water. Drop into mods/.`,
      );
    } catch (e) {
      setExportMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const onO2rFile = async (file: File) => {
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const catalog = catalogFromZip(buf);
      const pickable = filterPickerTextures(catalog);
      setTextureCatalog(catalog);
      setAssetStatus(
        `Texture library ready from ${file.name}: ${pickable.length} browsable previews (${catalog.textures.length} parsed). Open any Texture → Browse…`,
      );
    } catch (e) {
      setAssetStatus(
        `Failed to read ${file.name}: ${e instanceof Error ? e.message : e}`,
      );
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (!f) return;
    const name = f.name.toLowerCase();
    if (
      name.endsWith(PROJECT_EXTENSION) ||
      name.endsWith('.mk64track') ||
      (name.endsWith('.json') && !name.includes('mods'))
    ) {
      void onOpenProjectFile(f);
      return;
    }
    if (name.endsWith('.o2r') || name.endsWith('.zip')) {
      void onO2rFile(f);
    }
  };

  return (
    <div className="app" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <header className="header">
        <div>
          <h1>MK64 Track Editor</h1>
          <p className="sub">
            Browser authoring for SpaghettiKart custom tracks — works on stock
            and 8-player builds (same .o2r).
          </p>
        </div>
        <div className="header-actions">
          <button
            type="button"
            onClick={() => {
              setDoc(createDefaultOval());
              resetSelection();
              clearAutosave();
              setEditMsg('Started new oval.');
            }}
          >
            New oval
          </button>
          <button
            type="button"
            onClick={() => {
              setDoc(createSpikeLikeDoc());
              resetSelection();
              setEditMsg('Loaded spike template.');
            }}
          >
            Load spike template
          </button>
          <button type="button" onClick={onSaveProject}>
            Save project
          </button>
          <label className="file-btn">
            Open project
            <input
              type="file"
              accept={`.json,.mk64track.json,${PROJECT_EXTENSION},.mk64track`}
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onOpenProjectFile(f);
                e.target.value = '';
              }}
            />
          </label>
          <label className="file-btn">
            Load mk64.o2r
            <input
              type="file"
              accept=".o2r,.zip"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onO2rFile(f);
                e.target.value = '';
              }}
            />
          </label>
          <button
            type="button"
            className="primary"
            disabled={!exportOk}
            onClick={onExport}
          >
            Export .o2r
          </button>
        </div>
      </header>

      <p className="asset-status">{assetStatus}</p>
      {exportMsg && <p className="export-msg">{exportMsg}</p>}
      {editMsg && <p className="edit-msg">{editMsg}</p>}

      <div className="main">
        <aside className="left">
          <Inspector
            doc={doc}
            selected={selected}
            selectedActorId={selectedActorId}
            selectedWallId={selectedWallId}
            selectedWaterId={selectedWaterId}
            selectedWallPointIndex={selectedWallPointIndex}
            selectedWaterPointIndex={selectedWaterPointIndex}
            tool={tool}
            placeActorName={placeActorName}
            wallDraftCount={wallDraft.length}
            waterDraftCount={waterDraft.length}
            drawingWall={drawingWall}
            drawingWater={drawingWater}
            defaultWallHeight={defaultWallHeight}
            defaultWaterY={defaultWaterY}
            target={target}
            onChangeMeta={onChangeMeta}
            onChangeSegment={onChangeSegment}
            onChangeKnot={onChangeKnot}
            onChangeDecor={onChangeDecor}
            onChangeGroundFill={onChangeGroundFill}
            onChangeTarget={setTarget}
            onChangeSegmentTexture={onChangeSegmentTexture}
            onChangeTool={(t) => {
              setTool(t);
              // Clear drafts when switching tools so path/place don't leave stray points.
              // Wall/water: first map click starts a draft automatically.
              setWallDraft([]);
              setWaterDraft([]);
              setDrawingWall(t === 'wall');
              setDrawingWater(t === 'water');
              if (t === 'wall') {
                setEditMsg('Wall tool: click the map to place points, then Finish wall (Enter).');
              } else if (t === 'water') {
                setEditMsg('Water tool: click the map to outline water, then Finish water (Enter).');
              }
            }}
            onChangePlaceActor={setPlaceActorName}
            onChangeActor={onChangeActor}
            onDeleteActor={onDeleteActor}
            onStartNewWall={onStartNewWall}
            onFinishWall={onFinishWall}
            onCancelWall={onCancelWall}
            onDeleteWall={onDeleteWall}
            onChangeWallHeight={onChangeWallHeight}
            onChangeDefaultWallHeight={setDefaultWallHeight}
            onChangeWallPoint={onChangeWallPoint}
            onDeleteWallPoint={onDeleteWallPoint}
            onSelectWallPoint={(i) => setSelectedWallPointIndex(i)}
            onStartNewWater={onStartNewWater}
            onFinishWater={onFinishWater}
            onCancelWater={onCancelWater}
            onDeleteWater={onDeleteWater}
            onChangeWater={onChangeWater}
            onChangeDefaultWaterY={setDefaultWaterY}
            onChangeWaterPoint={onChangeWaterPoint}
            onDeleteWaterPoint={onDeleteWaterPoint}
            onSelectWaterPoint={(i) => setSelectedWaterPointIndex(i)}
            textureCatalog={textureCatalog}
            canDeleteKnot={canDeleteKnot(doc, selected)}
            onDeleteKnot={() => onDeleteKnot(selected)}
          />
          <ValidationPanel issues={issues} />
        </aside>
        <main className="center">
          <h2>Layout (top-down)</h2>
          <LayoutCanvas
            doc={doc}
            selected={selected}
            selectedActorId={selectedActorId}
            selectedWallId={selectedWallId}
            selectedWaterId={selectedWaterId}
            selectedWallPointIndex={selectedWallPointIndex}
            selectedWaterPointIndex={selectedWaterPointIndex}
            tool={tool}
            placeActorName={placeActorName}
            wallDraft={wallDraft}
            waterDraft={waterDraft}
            drawingWall={drawingWall}
            drawingWater={drawingWater}
            onSelect={(i) => {
              setSelected(i);
              setSelectedActorId(null);
              setSelectedWallId(null);
              setSelectedWaterId(null);
              setSelectedWallPointIndex(null);
              setSelectedWaterPointIndex(null);
              setEditMsg('');
            }}
            onSelectActor={(id) => {
              setSelectedActorId(id);
              setSelectedWallId(null);
              setSelectedWaterId(null);
              setSelectedWallPointIndex(null);
              setSelectedWaterPointIndex(null);
              setEditMsg('');
            }}
            onSelectWall={(id, pointIndex) => {
              setSelectedWallId(id);
              setSelectedWallPointIndex(
                id == null ? null : (pointIndex ?? 0),
              );
              setSelectedActorId(null);
              setSelectedWaterId(null);
              setSelectedWaterPointIndex(null);
              setDrawingWall(false);
              setEditMsg('');
            }}
            onSelectWater={(id, pointIndex) => {
              setSelectedWaterId(id);
              setSelectedWaterPointIndex(
                id == null ? null : (pointIndex ?? 0),
              );
              setSelectedActorId(null);
              setSelectedWallId(null);
              setSelectedWallPointIndex(null);
              setDrawingWater(false);
              setEditMsg('');
            }}
            onMoveKnot={onMoveKnot}
            onAddKnot={onAddKnot}
            onMoveActor={onMoveActor}
            onPlaceActor={onPlaceActor}
            onWallClick={onWallClick}
            onWaterClick={onWaterClick}
            onMoveWallPoint={onMoveWallPoint}
            onMoveWaterPoint={onMoveWaterPoint}
            onInsertWallPoint={onInsertWallPoint}
            onInsertWaterPoint={onInsertWaterPoint}
          />
        </main>
        <aside className="right">
          <h2>3D preview</h2>
          <Preview3D doc={doc} />
          <ol className="howto">
            <li>Shape the loop with the Path tool.</li>
            <li>Ground fill covers blank land. Perimeter walls optional.</li>
            <li>Water / Walls tools for lakes and barriers.</li>
            <li>
              <strong>Test drive</strong> a scale-accurate kart ·{' '}
              <strong>Explore 3D</strong> free-flies.
            </li>
            <li>Export .o2r → mods folder → Debug Mode → race.</li>
          </ol>
        </aside>
      </div>
    </div>
  );
}
