import { useCallback, useEffect, useRef, useState } from 'react';
import type { TrackDoc, Vec3 } from '../model/types';
import { paletteEntry } from '../model/actorPalette';

export type EditorTool = 'path' | 'place' | 'wall' | 'water';

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
  wallDraft: Vec3[];
  waterDraft: Vec3[];
  /** When true, empty clicks append draft points (new shape). */
  drawingWall: boolean;
  drawingWater: boolean;
  onSelect: (index: number) => void;
  onSelectActor: (id: string | null) => void;
  onSelectWall: (id: string | null, pointIndex?: number | null) => void;
  onSelectWater: (id: string | null, pointIndex?: number | null) => void;
  onMoveKnot: (index: number, pos: Vec3) => void;
  onAddKnot: (pos: Vec3) => void;
  onMoveActor: (id: string, pos: Vec3) => void;
  onPlaceActor: (pos: Vec3) => void;
  onWallClick: (pos: Vec3) => void;
  onWaterClick: (pos: Vec3) => void;
  onMoveWallPoint: (id: string, index: number, pos: Vec3) => void;
  onMoveWaterPoint: (id: string, index: number, pos: Vec3) => void;
  onInsertWallPoint: (id: string, afterIndex: number, pos: Vec3) => void;
  onInsertWaterPoint: (id: string, afterIndex: number, pos: Vec3) => void;
};

const PAD = 40;
/** userZoom=1 means "fit track in viewport". */
const ZOOM_MIN = 0.1;
const ZOOM_MAX = 32;
const ZOOM_STEP = 1.25;

type DragShape =
  | { kind: 'wall'; id: string; index: number }
  | { kind: 'water'; id: string; index: number }
  | null;

export function LayoutCanvas({
  doc,
  selected,
  selectedActorId,
  selectedWallId,
  selectedWaterId,
  selectedWallPointIndex,
  selectedWaterPointIndex,
  tool,
  placeActorName,
  wallDraft,
  waterDraft,
  drawingWall,
  drawingWater,
  onSelect,
  onSelectActor,
  onSelectWall,
  onSelectWater,
  onMoveKnot,
  onAddKnot,
  onMoveActor,
  onPlaceActor,
  onWallClick,
  onWaterClick,
  onMoveWallPoint,
  onMoveWaterPoint,
  onInsertWallPoint,
  onInsertWaterPoint,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragKnot = useRef<number | null>(null);
  const dragActor = useRef<string | null>(null);
  const dragShape = useRef<DragShape>(null);
  const didDrag = useRef(false);
  /** Active pan (after threshold, or immediate for middle/alt). */
  const panDrag = useRef<{
    startX: number;
    startY: number;
    panX: number;
    panY: number;
  } | null>(null);
  /** Left-press on empty map: may become pan once moved past threshold. */
  const panCandidate = useRef<{
    startX: number;
    startY: number;
    panX: number;
    panY: number;
  } | null>(null);
  const didInitialFit = useRef(false);

  /** 1 = fit entire track in the viewport. */
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [vpSize, setVpSize] = useState({ w: 640, h: 480 });
  const PAN_THRESHOLD_PX = 4;

  const knots = doc.spline.knots;
  const actors = doc.actors ?? [];
  const walls = doc.walls ?? [];
  const waters = doc.water ?? [];
  const fillPad = doc.decor?.groundFill?.enabled
    ? (doc.decor.groundFill.padding ?? 1200)
    : 0;
  let minX = 0,
    maxX = 0,
    minZ = 0,
    maxZ = 0;
  for (const k of knots) {
    minX = Math.min(minX, k.x);
    maxX = Math.max(maxX, k.x);
    minZ = Math.min(minZ, k.z);
    maxZ = Math.max(maxZ, k.z);
  }
  for (const a of actors) {
    minX = Math.min(minX, a.location.x);
    maxX = Math.max(maxX, a.location.x);
    minZ = Math.min(minZ, a.location.z);
    maxZ = Math.max(maxZ, a.location.z);
  }
  for (const w of walls) {
    for (const p of w.points) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
  }
  for (const w of waters) {
    for (const p of w.points) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
  }
  minX -= fillPad;
  maxX += fillPad;
  minZ -= fillPad;
  maxZ += fillPad;

  const worldW = Math.max(1, maxX - minX);
  const worldH = Math.max(1, maxZ - minZ);

  // SVG always fills the center panel viewport.
  const width = Math.max(1, vpSize.w);
  const height = Math.max(1, vpSize.h);

  // Scale that fits the world in the viewport at zoom=1.
  const fitScale = Math.min(
    (width - PAD * 2) / worldW,
    (height - PAD * 2) / worldH,
  );
  const scale = Math.max(1e-6, fitScale * zoom);

  const centerPan = useCallback(
    (s: number) => ({
      x: (width - worldW * s) / 2 - PAD,
      y: (height - worldH * s) / 2 - PAD,
    }),
    [width, height, worldW, worldH],
  );

  const toScreen = useCallback(
    (p: { x: number; z: number }) => ({
      x: (p.x - minX) * scale + PAD + pan.x,
      y: (p.z - minZ) * scale + PAD + pan.y,
    }),
    [minX, minZ, scale, pan.x, pan.y],
  );

  const fromScreen = useCallback(
    (sx: number, sy: number, preserveY = 0): Vec3 => ({
      x: Math.round((sx - PAD - pan.x) / scale + minX),
      y: preserveY,
      z: Math.round((sy - PAD - pan.y) / scale + minZ),
    }),
    [minX, minZ, scale, pan.x, pan.y],
  );

  const clientToLocal = (e: { clientX: number; clientY: number }) => {
    const svg = svgRef.current!;
    const rect = svg.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

  /** Zoom keeping the world point under (sx,sy) fixed on screen. */
  const zoomAt = (sx: number, sy: number, nextZoom: number) => {
    const z = clampZoom(nextZoom);
    if (z === zoom) return;
    const oldScale = fitScale * zoom;
    const newScale = fitScale * z;
    const worldX = (sx - PAD - pan.x) / oldScale + minX;
    const worldZ = (sy - PAD - pan.y) / oldScale + minZ;
    setZoom(z);
    setPan({
      x: sx - PAD - (worldX - minX) * newScale,
      y: sy - PAD - (worldZ - minZ) * newScale,
    });
  };

  const zoomBy = (factor: number) => {
    const svg = svgRef.current;
    if (!svg) {
      setZoom((z) => clampZoom(z * factor));
      return;
    }
    const rect = svg.getBoundingClientRect();
    zoomAt(rect.width / 2, rect.height / 2, zoom * factor);
  };

  /** Fit track in the full center viewport (zoom=1, centered). */
  const resetView = useCallback(() => {
    setZoom(1);
    setPan(centerPan(fitScale));
  }, [centerPan, fitScale]);

  // Measure the center viewport so the SVG can fill it.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const apply = (w: number, h: number) => {
      if (w < 2 || h < 2) return;
      setVpSize((prev) =>
        prev.w === Math.round(w) && prev.h === Math.round(h)
          ? prev
          : { w: Math.round(w), h: Math.round(h) },
      );
    };
    apply(el.clientWidth, el.clientHeight);
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (cr) apply(cr.width, cr.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Initial fit once we have a real viewport size.
  useEffect(() => {
    if (didInitialFit.current) return;
    if (vpSize.w < 40 || vpSize.h < 40) return;
    didInitialFit.current = true;
    setZoom(1);
    setPan(centerPan(fitScale));
  }, [vpSize.w, vpSize.h, fitScale, centerPan]);

  // Non-passive wheel so we can preventDefault (page won't scroll while zooming).
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheelNative = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = el.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const intensity = Math.min(3, Math.abs(e.deltaY) / 100);
      const step = Math.pow(ZOOM_STEP, Math.max(0.35, intensity * 0.35));
      const factor = e.deltaY > 0 ? 1 / step : step;
      setZoom((z) => {
        const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z * factor));
        if (next === z) return z;
        const oldScale = fitScale * z;
        const newScale = fitScale * next;
        setPan((p) => {
          const worldX = (sx - PAD - p.x) / oldScale + minX;
          const worldZ = (sy - PAD - p.y) / oldScale + minZ;
          return {
            x: sx - PAD - (worldX - minX) * newScale,
            y: sy - PAD - (worldZ - minZ) * newScale,
          };
        });
        return next;
      });
    };
    el.addEventListener('wheel', onWheelNative, { passive: false });
    return () => el.removeEventListener('wheel', onWheelNative);
  }, [minX, minZ, fitScale]);

  const onKnotPointerDown = (e: React.PointerEvent, index: number) => {
    if (tool !== 'path') return;
    e.stopPropagation();
    onSelect(index);
    onSelectActor(null);
    onSelectWall(null, null);
    onSelectWater(null, null);
    dragKnot.current = index;
    didDrag.current = false;
    (e.target as Element).setPointerCapture(e.pointerId);
  };

  const onActorPointerDown = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    onSelectActor(id);
    onSelectWall(null, null);
    onSelectWater(null, null);
    dragActor.current = id;
    didDrag.current = false;
    (e.target as Element).setPointerCapture(e.pointerId);
  };

  const onWallPointDown = (
    e: React.PointerEvent,
    id: string,
    index: number,
  ) => {
    e.stopPropagation();
    onSelectActor(null);
    onSelectWater(null, null);
    onSelectWall(id, index);
    dragShape.current = { kind: 'wall', id, index };
    didDrag.current = false;
    (e.target as Element).setPointerCapture(e.pointerId);
  };

  const onWaterPointDown = (
    e: React.PointerEvent,
    id: string,
    index: number,
  ) => {
    e.stopPropagation();
    onSelectActor(null);
    onSelectWall(null, null);
    onSelectWater(id, index);
    dragShape.current = { kind: 'water', id, index };
    didDrag.current = false;
    (e.target as Element).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const { x, y } = clientToLocal(e);

    // Promote empty left-press to pan after a small move threshold.
    if (panCandidate.current && !panDrag.current) {
      const c = panCandidate.current;
      const dx = x - c.startX;
      const dy = y - c.startY;
      if (dx * dx + dy * dy >= PAN_THRESHOLD_PX * PAN_THRESHOLD_PX) {
        panDrag.current = c;
        panCandidate.current = null;
        setIsPanning(true);
        didDrag.current = true;
      }
    }

    if (panDrag.current) {
      didDrag.current = true;
      const d = panDrag.current;
      setPan({
        x: d.panX + (x - d.startX),
        y: d.panY + (y - d.startY),
      });
      return;
    }
    if (dragKnot.current !== null) {
      didDrag.current = true;
      const idx = dragKnot.current;
      const keepY = knots[idx]?.y ?? 0;
      const pos = fromScreen(x, y, keepY);
      if (idx === 0) {
        onMoveKnot(0, { x: 0, y: keepY, z: 0 });
      } else {
        onMoveKnot(idx, pos);
      }
      return;
    }
    if (dragActor.current) {
      didDrag.current = true;
      const actor = actors.find((a) => a.id === dragActor.current);
      const pos = fromScreen(x, y, actor?.location.y ?? 0);
      onMoveActor(dragActor.current, pos);
      return;
    }
    if (dragShape.current) {
      didDrag.current = true;
      const d = dragShape.current;
      if (d.kind === 'wall') {
        const wall = walls.find((w) => w.id === d.id);
        const keepY = wall?.points[d.index]?.y ?? 0;
        onMoveWallPoint(d.id, d.index, fromScreen(x, y, keepY));
      } else {
        const water = waters.find((w) => w.id === d.id);
        const keepY = water?.points[d.index]?.y ?? water?.y ?? 0;
        onMoveWaterPoint(d.id, d.index, fromScreen(x, y, keepY));
      }
    }
  };

  const onPointerUp = () => {
    dragKnot.current = null;
    dragActor.current = null;
    dragShape.current = null;
    panDrag.current = null;
    panCandidate.current = null;
    setIsPanning(false);
  };

  const beginPan = (e: React.PointerEvent, immediate: boolean) => {
    e.preventDefault();
    const { x, y } = clientToLocal(e);
    const state = {
      startX: x,
      startY: y,
      panX: pan.x,
      panY: pan.y,
    };
    if (immediate) {
      panDrag.current = state;
      panCandidate.current = null;
      setIsPanning(true);
    } else {
      panCandidate.current = state;
      panDrag.current = null;
    }
    didDrag.current = false;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };

  const onBackgroundPointerDown = (e: React.PointerEvent) => {
    // Only the empty map backdrop (not knots / props / walls / water).
    const target = e.target as HTMLElement;
    if (target.getAttribute?.('data-map-bg') !== '1') return;

    // Middle mouse or Alt+left: pan immediately (always available).
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      e.stopPropagation();
      beginPan(e, true);
      return;
    }
    // While placing walls/water/props, left-click must not start a pan —
    // that steals clicks meant to place points.
    if (tool === 'wall' || tool === 'water' || tool === 'place') {
      return;
    }
    // Path tool: left drag on empty space pans the view.
    if (e.button === 0) {
      beginPan(e, false);
    }
  };

  const onBgClick = (e: React.MouseEvent) => {
    if (didDrag.current) {
      didDrag.current = false;
      return;
    }
    if (dragActor.current || dragKnot.current !== null || dragShape.current) {
      return;
    }
    const { x, y } = clientToLocal(e);
    const pos = fromScreen(x, y, 0);
    if (tool === 'place') {
      onPlaceActor(pos);
      return;
    }
    // Wall/water tools: every empty click places a draft vertex (no "New" required).
    if (tool === 'wall') {
      onWallClick(pos);
      return;
    }
    if (tool === 'water') {
      onWaterClick(pos);
      return;
    }
  };

  const onBgDoubleClick = (e: React.MouseEvent) => {
    if (tool === 'path') {
      const { x, y } = clientToLocal(e);
      onAddKnot(fromScreen(x, y, 0));
    }
  };

  const pathD =
    knots.length > 0
      ? knots
          .map((k, i) => {
            const s = toScreen(k);
            return `${i === 0 ? 'M' : 'L'} ${s.x} ${s.y}`;
          })
          .join(' ') + ' Z'
      : '';

  let arrow: { x1: number; y1: number; x2: number; y2: number } | null = null;
  if (knots.length >= 2) {
    const a = toScreen(knots[0]);
    const b = toScreen(knots[1]);
    arrow = { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
  }

  const placeInfo = paletteEntry(placeActorName);

  const zoomPct = Math.round(zoom * 100);

  return (
    <div className="layout-canvas-wrap">
      <div className="zoom-bar">
        <button
          type="button"
          title="Zoom out"
          onClick={() => zoomBy(1 / ZOOM_STEP)}
          disabled={zoom <= ZOOM_MIN}
        >
          −
        </button>
        <span className="zoom-label" title="Click to reset">
          <button type="button" className="zoom-pct" onClick={resetView}>
            {zoomPct}%
          </button>
        </span>
        <button
          type="button"
          title="Zoom in"
          onClick={() => zoomBy(ZOOM_STEP)}
          disabled={zoom >= ZOOM_MAX}
        >
          +
        </button>
        <button type="button" title="Reset zoom and pan" onClick={resetView}>
          Fit
        </button>
        <span className="zoom-hint">
          100% = fit · scroll zoom · drag empty space to pan
        </span>
      </div>
      <div className="layout-viewport" ref={viewportRef}>
      <svg
        ref={svgRef}
        width={width}
        height={height}
        className={`layout-canvas tool-${tool}${isPanning ? ' is-panning' : ''}`}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerDown={onBackgroundPointerDown}
        onClick={onBgClick}
        onDoubleClick={onBgDoubleClick}
      >
        <defs>
          <marker
            id="arrow"
            markerWidth="8"
            markerHeight="8"
            refX="6"
            refY="3"
            orient="auto"
          >
            <path d="M0,0 L6,3 L0,6 Z" fill="#5af" />
          </marker>
        </defs>
        {/* Full-size hit target for empty-space pan / clicks */}
        <rect
          data-map-bg="1"
          width={width}
          height={height}
          fill="#1a1d24"
          style={{ cursor: isPanning ? 'grabbing' : 'grab' }}
        />
        {fillPad > 0 &&
          (() => {
            const tl = toScreen({ x: minX, z: minZ });
            const br = toScreen({ x: maxX, z: maxZ });
            const x = Math.min(tl.x, br.x);
            const y = Math.min(tl.y, br.y);
            const w = Math.abs(br.x - tl.x);
            const h = Math.abs(br.y - tl.y);
            return (
              <rect
                data-map-bg="1"
                x={x}
                y={y}
                width={w}
                height={h}
                fill="#1e3a28"
                stroke="#2a5a38"
                strokeWidth={1}
                opacity={0.55}
                style={{ cursor: isPanning ? 'grabbing' : 'grab' }}
              />
            );
          })()}
        <g opacity={0.12} stroke="#fff">
          {Array.from(
            { length: Math.ceil(width / 48) + 1 },
            (_, i) => (
              <line
                key={`v${i}`}
                x1={i * 48}
                y1={0}
                x2={i * 48}
                y2={height}
              />
            ),
          )}
          {Array.from(
            { length: Math.ceil(height / 48) + 1 },
            (_, i) => (
              <line
                key={`h${i}`}
                x1={0}
                y1={i * 48}
                x2={width}
                y2={i * 48}
              />
            ),
          )}
        </g>
        {(() => {
          const o = toScreen({ x: 0, z: 0 });
          return (
            <g stroke="#f66" strokeWidth={1} opacity={0.6}>
              <line x1={o.x - 12} y1={o.y} x2={o.x + 12} y2={o.y} />
              <line x1={o.x} y1={o.y - 12} x2={o.x} y2={o.y + 12} />
            </g>
          );
        })()}
        <path d={pathD} fill="none" stroke="#4a8" strokeWidth={3} />
        {arrow && (
          <line
            x1={arrow.x1}
            y1={arrow.y1}
            x2={arrow.x2}
            y2={arrow.y2}
            stroke="#5af"
            strokeWidth={2}
            markerEnd="url(#arrow)"
          />
        )}
        {knots.map((k, i) => {
          const s = toScreen(k);
          const isSel = tool === 'path' && i === selected;
          const elevated = Math.abs(k.y) > 0.5;
          return (
            <g key={`k${i}`}>
              <circle
                cx={s.x}
                cy={s.y}
                r={isSel ? 8 : 6}
                fill={
                  i === 0 ? '#f84' : isSel ? '#5af' : elevated ? '#c8e' : '#ccc'
                }
                stroke="#000"
                strokeWidth={1}
                style={{ cursor: tool === 'path' ? 'grab' : 'default' }}
                onPointerDown={(e) => onKnotPointerDown(e, i)}
              />
              {elevated && (
                <text
                  x={s.x + 10}
                  y={s.y - 8}
                  fill="#c8e"
                  fontSize={11}
                  style={{ pointerEvents: 'none', userSelect: 'none' }}
                >
                  y={Math.round(k.y)}
                </text>
              )}
            </g>
          );
        })}
        {actors.map((actor) => {
          const s = toScreen(actor.location);
          const entry = paletteEntry(actor.name);
          const isSel = actor.id === selectedActorId;
          return (
            <g
              key={actor.id}
              style={{ cursor: 'grab' }}
              onPointerDown={(e) => onActorPointerDown(e, actor.id)}
            >
              <circle
                cx={s.x}
                cy={s.y}
                r={isSel ? 9 : 7}
                fill={entry?.color ?? '#aaa'}
                stroke={isSel ? '#fff' : '#000'}
                strokeWidth={isSel ? 2 : 1}
              />
              <text
                x={s.x}
                y={s.y + 4}
                textAnchor="middle"
                fontSize={10}
                fill="#111"
                style={{ pointerEvents: 'none', userSelect: 'none' }}
              >
                {entry?.glyph ?? '?'}
              </text>
            </g>
          );
        })}
        {/* Water regions */}
        {waters.map((region) => {
          const isSel = region.id === selectedWaterId;
          if (region.points.length < 2) return null;
          const d =
            region.points
              .map((p, i) => {
                const s = toScreen(p);
                return `${i === 0 ? 'M' : 'L'} ${s.x} ${s.y}`;
              })
              .join(' ') + ' Z';
          return (
            <g key={region.id}>
              <path
                d={d}
                fill={isSel ? 'rgba(60,140,220,0.45)' : 'rgba(40,110,200,0.35)'}
                stroke={isSel ? '#7cf' : '#4af'}
                strokeWidth={isSel ? 2.5 : 1.5}
                style={{ cursor: 'pointer' }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onSelectWater(region.id, selectedWaterPointIndex ?? 0);
                  onSelectActor(null);
                  onSelectWall(null, null);
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  // Insert on nearest edge
                  const { x, y } = clientToLocal(e);
                  const pos = fromScreen(x, y, region.y);
                  let bestEdge = 0;
                  let bestD = Infinity;
                  for (let i = 0; i < region.points.length; i++) {
                    const a = toScreen(region.points[i]);
                    const b = toScreen(
                      region.points[(i + 1) % region.points.length],
                    );
                    const d2 = distToSegment(x, y, a.x, a.y, b.x, b.y);
                    if (d2 < bestD) {
                      bestD = d2;
                      bestEdge = i;
                    }
                  }
                  onInsertWaterPoint(region.id, bestEdge, pos);
                }}
              />
              {region.points.map((p, i) => {
                const s = toScreen(p);
                const ptSel = isSel && selectedWaterPointIndex === i;
                return (
                  <circle
                    key={i}
                    cx={s.x}
                    cy={s.y}
                    r={ptSel ? 8 : isSel ? 6 : 4}
                    fill={ptSel ? '#9ef' : isSel ? '#6cf' : '#48a'}
                    stroke={ptSel ? '#fff' : '#024'}
                    strokeWidth={ptSel ? 2 : 1}
                    style={{ cursor: 'grab' }}
                    onPointerDown={(e) => onWaterPointDown(e, region.id, i)}
                  />
                );
              })}
            </g>
          );
        })}
        {waterDraft.length > 0 && (
          <g>
            <path
              d={
                waterDraft
                  .map((p, i) => {
                    const s = toScreen(p);
                    return `${i === 0 ? 'M' : 'L'} ${s.x} ${s.y}`;
                  })
                  .join(' ') + (waterDraft.length >= 3 ? ' Z' : '')
              }
              fill={
                waterDraft.length >= 3 ? 'rgba(80,160,255,0.25)' : 'none'
              }
              stroke="#6cf"
              strokeWidth={2}
              strokeDasharray="6 4"
            />
            {waterDraft.map((p, i) => {
              const s = toScreen(p);
              return <circle key={i} cx={s.x} cy={s.y} r={4} fill="#6cf" />;
            })}
          </g>
        )}
        {/* Walls */}
        {walls.map((wall) => {
          const isSel = wall.id === selectedWallId;
          const d = wall.points
            .map((p, i) => {
              const s = toScreen(p);
              return `${i === 0 ? 'M' : 'L'} ${s.x} ${s.y}`;
            })
            .join(' ');
          return (
            <g key={wall.id}>
              <path
                d={d}
                fill="none"
                stroke={isSel ? '#ff8866' : '#cc5533'}
                strokeWidth={isSel ? 4 : 3}
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ cursor: 'pointer' }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onSelectWall(wall.id, selectedWallPointIndex ?? 0);
                  onSelectActor(null);
                  onSelectWater(null, null);
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  const { x, y } = clientToLocal(e);
                  let bestEdge = 0;
                  let bestD = Infinity;
                  for (let i = 0; i < wall.points.length - 1; i++) {
                    const a = toScreen(wall.points[i]);
                    const b = toScreen(wall.points[i + 1]);
                    const d2 = distToSegment(x, y, a.x, a.y, b.x, b.y);
                    if (d2 < bestD) {
                      bestD = d2;
                      bestEdge = i;
                    }
                  }
                  const keepY = wall.points[bestEdge]?.y ?? 0;
                  onInsertWallPoint(
                    wall.id,
                    bestEdge,
                    fromScreen(x, y, keepY),
                  );
                }}
              />
              {wall.points.map((p, i) => {
                const s = toScreen(p);
                const ptSel = isSel && selectedWallPointIndex === i;
                return (
                  <circle
                    key={i}
                    cx={s.x}
                    cy={s.y}
                    r={ptSel ? 8 : isSel ? 6 : 4}
                    fill={ptSel ? '#fdb' : isSel ? '#faa' : '#c64'}
                    stroke={ptSel ? '#fff' : '#400'}
                    strokeWidth={ptSel ? 2 : 1}
                    style={{ cursor: 'grab' }}
                    onPointerDown={(e) => onWallPointDown(e, wall.id, i)}
                  />
                );
              })}
            </g>
          );
        })}
        {wallDraft.length > 0 && (
          <g>
            <path
              d={wallDraft
                .map((p, i) => {
                  const s = toScreen(p);
                  return `${i === 0 ? 'M' : 'L'} ${s.x} ${s.y}`;
                })
                .join(' ')}
              fill="none"
              stroke="#ffaa44"
              strokeWidth={3}
              strokeDasharray="6 4"
            />
            {wallDraft.map((p, i) => {
              const s = toScreen(p);
              return (
                <circle key={i} cx={s.x} cy={s.y} r={4} fill="#ffaa44" />
              );
            })}
          </g>
        )}
      </svg>
      </div>
      <p className="hint">
        {tool === 'path' &&
          'Path: drag knots · double-click insert · scroll zoom · drag empty space to pan'}
        {tool === 'place' &&
          `Place: click map to drop ${placeInfo?.label ?? placeActorName}`}
        {tool === 'wall' &&
          (wallDraft.length > 0 || drawingWall
            ? `Wall: click map to add points (${wallDraft.length}) · Finish (Enter) · Esc cancel · Alt-drag pan`
            : 'Wall: click map to start a wall · drag existing vertices to edit · Alt-drag pan')}
        {tool === 'water' &&
          (waterDraft.length > 0 || drawingWater
            ? `Water: click shoreline (${waterDraft.length} pts, need 3+) · Finish (Enter) · Esc cancel · Alt-drag pan`
            : 'Water: click map to start a lake · drag existing vertices to edit · Alt-drag pan')}
      </p>
    </div>
  );
}

function distToSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const qx = x1 + t * dx;
  const qy = y1 + t * dy;
  return (px - qx) * (px - qx) + (py - qy) * (py - qy);
}
