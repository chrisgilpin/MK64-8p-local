import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { TrackDoc } from '../model/types';
import { loftTrack } from '../geometry/loft';
import {
  createDriveState,
  KART_HALF_LENGTH,
  KART_HALF_WIDTH,
  KART_HEIGHT,
  speedToKmh,
  stepDrive,
  type DriveKeys,
  type DriveState,
} from '../preview/drivePhysics';
import { buildGroundTris, queryGround } from '../preview/groundQuery';

type Props = { doc: TrackDoc };
type ViewMode = 'fly' | 'drive';

type FlyState = {
  yaw: number;
  pitch: number;
  pos: THREE.Vector3;
};

function buildSceneContent(doc: TrackDoc): {
  group: THREE.Group;
  center: THREE.Vector3;
  radius: number;
} {
  const lofted = loftTrack(doc);
  const group = new THREE.Group();
  const box = new THREE.Box3();

  // Draw low→high so grass never paints over asphalt (transparent fill used
  // to sort after the road and look like the road was buried).
  const ordered = [...lofted.sections].sort((a, b) => {
    const rank = (s: (typeof lofted.sections)[0]) => {
      if (s.name === 'ground_fill') return 0;
      if (s.name === 'apron' || s.name === 'spawn_pad') return 1;
      if (s.name.startsWith('road')) return 2;
      if (s.surface === 0xfb) return 4; // water on top
      if (s.clip === 4 || s.clip === 2) return 3;
      return 2;
    };
    return rank(a) - rank(b);
  });

  for (const sec of ordered) {
    const geo = new THREE.BufferGeometry();
    const positions: number[] = [];
    for (const tri of sec.tris) {
      for (const v of tri.v) positions.push(v.x, v.y, v.z);
    }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.computeVertexNormals();

    const isRamp = sec.surface >= 0xfc;
    const isWater = sec.surface === 0xfb;
    const isWall = sec.clip === 4 || sec.clip === 2;
    const isGround = sec.name === 'ground_fill';
    const isApron = sec.name === 'apron' || sec.name === 'spawn_pad';
    const mat = new THREE.MeshStandardMaterial({
      color: isWater
        ? 0x3388cc
        : isWall
          ? 0xcc6644
          : isRamp
            ? 0xff8844
            : isGround
              ? 0x3a6b45
              : isApron
                ? 0x4a7a52
                : 0x556677,
      flatShading: true,
      side: THREE.DoubleSide,
      // Only water needs transparency. Semi-transparent grass was depth-sorted
      // after the road and made asphalt look "under" the land.
      transparent: isWater,
      opacity: isWater ? 0.65 : 1,
      depthWrite: !isWater,
      polygonOffset: isGround || isApron,
      polygonOffsetFactor: isGround ? 2 : isApron ? 1 : 0,
      polygonOffsetUnits: isGround ? 2 : isApron ? 1 : 0,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = isGround ? 0 : isApron ? 1 : isWater ? 4 : isWall ? 3 : 2;
    group.add(mesh);
    box.expandByObject(mesh);
  }

  if (lofted.path.length > 1) {
    const pts = lofted.path.map((p) => new THREE.Vector3(p.x, p.y + 5, p.z));
    group.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: 0x55ffaa }),
      ),
    );
  }

  for (const actor of doc.actors ?? []) {
    const isBox = actor.name.includes('item_box');
    const isTree =
      actor.name.includes('tree') ||
      actor.name.includes('cactus') ||
      actor.name.includes('bush') ||
      actor.name.includes('palm');
    let marker: THREE.Object3D;
    if (isBox) {
      marker = new THREE.Mesh(
        new THREE.BoxGeometry(40, 40, 40),
        new THREE.MeshStandardMaterial({ color: 0x66ccff }),
      );
      marker.position.set(
        actor.location.x,
        actor.location.y + 20,
        actor.location.z,
      );
    } else if (isTree) {
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(6, 8, 50, 6),
        new THREE.MeshStandardMaterial({ color: 0x6b4423 }),
      );
      trunk.position.y = 25;
      const crown = new THREE.Mesh(
        new THREE.SphereGeometry(28, 8, 6),
        new THREE.MeshStandardMaterial({ color: 0x2d8a4e }),
      );
      crown.position.y = 60;
      marker = new THREE.Group();
      marker.add(trunk, crown);
      marker.position.set(actor.location.x, actor.location.y, actor.location.z);
    } else {
      marker = new THREE.Mesh(
        new THREE.ConeGeometry(18, 50, 6),
        new THREE.MeshStandardMaterial({ color: 0xdd5555 }),
      );
      marker.position.set(
        actor.location.x,
        actor.location.y + 25,
        actor.location.z,
      );
    }
    group.add(marker);
    box.expandByObject(marker);
  }

  if (box.isEmpty()) {
    box.set(new THREE.Vector3(-500, 0, -500), new THREE.Vector3(500, 200, 500));
  }
  const center = new THREE.Vector3();
  box.getCenter(center);
  const size = new THREE.Vector3();
  box.getSize(size);
  const radius = Math.max(size.x, size.y, size.z, 400) * 0.6;
  return { group, center, radius };
}

function makeKartMesh(): THREE.Group {
  const g = new THREE.Group();
  // Body — proportions roughly match bounding box ~5.5
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(
      KART_HALF_WIDTH * 2,
      KART_HEIGHT * 0.55,
      KART_HALF_LENGTH * 2,
    ),
    new THREE.MeshStandardMaterial({ color: 0xe03030, flatShading: true }),
  );
  body.position.y = KART_HEIGHT * 0.35;
  g.add(body);
  // Cockpit / seat
  const seat = new THREE.Mesh(
    new THREE.BoxGeometry(KART_HALF_WIDTH * 1.2, KART_HEIGHT * 0.35, 3),
    new THREE.MeshStandardMaterial({ color: 0x222222, flatShading: true }),
  );
  seat.position.set(0, KART_HEIGHT * 0.65, -0.5);
  g.add(seat);
  // Wheels
  const wheelMat = new THREE.MeshStandardMaterial({
    color: 0x111111,
    flatShading: true,
  });
  const wheelGeo = new THREE.CylinderGeometry(1.1, 1.1, 0.8, 10);
  const places: [number, number, number][] = [
    [-KART_HALF_WIDTH * 0.95, 1.1, KART_HALF_LENGTH * 0.7],
    [KART_HALF_WIDTH * 0.95, 1.1, KART_HALF_LENGTH * 0.7],
    [-KART_HALF_WIDTH * 0.95, 1.1, -KART_HALF_LENGTH * 0.7],
    [KART_HALF_WIDTH * 0.95, 1.1, -KART_HALF_LENGTH * 0.7],
  ];
  for (const [wx, wy, wz] of places) {
    const wh = new THREE.Mesh(wheelGeo, wheelMat);
    wh.rotation.z = Math.PI / 2;
    wh.position.set(wx, wy, wz);
    g.add(wh);
  }
  return g;
}

function disposeObject(root: THREE.Object3D) {
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose();
      const m = obj.material;
      if (Array.isArray(m)) m.forEach((x) => x.dispose());
      else m.dispose();
    } else if (obj instanceof THREE.Line) {
      obj.geometry.dispose();
      (obj.material as THREE.Material).dispose();
    }
  });
}

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    t.isContentEditable
  );
}

/**
 * Free-fly 3D preview + Test Drive (scale-accurate arcade kart).
 */
export function Preview3D({ doc }: Props) {
  const [overlay, setOverlay] = useState(false);
  const [mode, setMode] = useState<ViewMode>('fly');
  const [focused, setFocused] = useState(false);
  const [camEpoch, setCamEpoch] = useState(0);
  const [hudKmh, setHudKmh] = useState(0);
  const mountRef = useRef<HTMLDivElement>(null);
  const exploreMountRef = useRef<HTMLDivElement>(null);
  const flyRef = useRef<FlyState | null>(null);
  const driveRef = useRef<DriveState | null>(null);
  const keysRef = useRef<Set<string>>(new Set());
  const inputActiveRef = useRef(false);
  const modeRef = useRef<ViewMode>('fly');

  const ensureFly = useCallback((center: THREE.Vector3, radius: number) => {
    if (!flyRef.current) {
      flyRef.current = {
        yaw: Math.PI * 0.25,
        pitch: -0.45,
        pos: new THREE.Vector3(
          center.x + radius * 0.9,
          center.y + radius * 0.55,
          center.z + radius * 0.9,
        ),
      };
    }
    return flyRef.current;
  }, []);

  useEffect(() => {
    inputActiveRef.current = focused || overlay;
  }, [focused, overlay]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    const mount = overlay ? exploreMountRef.current : mountRef.current;
    if (!mount) return;

    // Small sidebar preview always stays fly-orbit unless overlay drive
    const activeMode: ViewMode = overlay ? mode : 'fly';

    const w = mount.clientWidth || 480;
    const h = mount.clientHeight || 320;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87b0f0);

    const camera = new THREE.PerspectiveCamera(60, w / h, 2, 50000);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);
    renderer.domElement.tabIndex = 0;
    renderer.domElement.style.outline = 'none';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.cursor =
      activeMode === 'drive' ? 'default' : overlay ? 'crosshair' : 'grab';

    const light = new THREE.DirectionalLight(0xffffff, 1.15);
    light.position.set(500, 1000, 200);
    scene.add(light);
    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    scene.add(new THREE.AxesHelper(200));

    const { group, center, radius } = buildSceneContent(doc);
    scene.add(group);

    const groundTris = buildGroundTris(doc);
    const fly = ensureFly(center, radius);

    // Spawn test kart at origin / first path point heading −Z initially (game start).
    const spawnY =
      queryGround(groundTris, 0, -40)?.y ??
      queryGround(groundTris, 0, 0)?.y ??
      0;
    if (!driveRef.current) {
      // Face −Z at start (common MK64 start direction)
      driveRef.current = createDriveState(0, spawnY, -40, Math.PI);
    }
    const drive = driveRef.current;

    const kart = makeKartMesh();
    kart.visible = activeMode === 'drive';
    scene.add(kart);

    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let pointerLocked = false;

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const k = e.key.toLowerCase();
      if (
        [
          'w',
          'a',
          's',
          'd',
          'q',
          'e',
          'shift',
          ' ',
          'arrowup',
          'arrowdown',
          'arrowleft',
          'arrowright',
          'r',
        ].includes(k)
      ) {
        keysRef.current.add(k === ' ' ? 'space' : k);
        if (inputActiveRef.current) e.preventDefault();
      }
      if (e.key === 'Escape' && overlay) {
        setOverlay(false);
      }
      if (k === 'r' && modeRef.current === 'drive') {
        const gy = queryGround(groundTris, 0, -40)?.y ?? 0;
        drive.x = 0;
        drive.y = gy;
        drive.z = -40;
        drive.yaw = Math.PI;
        drive.speed = 0;
        drive.vy = 0;
        drive.onGround = true;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      keysRef.current.delete(k === ' ' ? 'space' : k);
    };

    const onPointerDown = (e: PointerEvent) => {
      setFocused(true);
      renderer.domElement.focus();
      if (activeMode === 'fly' && overlay && e.button === 0) {
        renderer.domElement.requestPointerLock?.();
      }
      if (activeMode === 'fly' && (e.button === 0 || e.button === 2)) {
        dragging = true;
        lastX = e.clientX;
        lastY = e.clientY;
        renderer.domElement.style.cursor = 'grabbing';
        renderer.domElement.setPointerCapture(e.pointerId);
      }
    };
    const onPointerUp = (e: PointerEvent) => {
      dragging = false;
      renderer.domElement.style.cursor =
        activeMode === 'drive' ? 'default' : overlay ? 'crosshair' : 'grab';
      try {
        renderer.domElement.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    };
    const onPointerMove = (e: PointerEvent) => {
      if (activeMode !== 'fly') return;
      let dx = 0;
      let dy = 0;
      if (pointerLocked) {
        dx = e.movementX;
        dy = e.movementY;
      } else if (dragging) {
        dx = e.clientX - lastX;
        dy = e.clientY - lastY;
        lastX = e.clientX;
        lastY = e.clientY;
      } else return;
      const sens = 0.0025;
      fly.yaw -= dx * sens;
      fly.pitch -= dy * sens;
      const lim = Math.PI / 2 - 0.05;
      fly.pitch = Math.max(-lim, Math.min(lim, fly.pitch));
    };
    const onContextMenu = (e: Event) => e.preventDefault();
    const onLockChange = () => {
      pointerLocked = document.pointerLockElement === renderer.domElement;
    };

    const onResize = () => {
      const nw = mount.clientWidth || w;
      const nh = mount.clientHeight || h;
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
      renderer.setSize(nw, nh);
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(mount);

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    document.addEventListener('pointerlockchange', onLockChange);
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('contextmenu', onContextMenu);

    let alive = true;
    let last = performance.now();
    let hudAcc = 0;

    const tick = (now: number) => {
      if (!alive) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const keys = keysRef.current;
      const m = modeRef.current;

      if (m === 'drive' && overlay) {
        const dk: DriveKeys = {
          accel: keys.has('w') || keys.has('arrowup'),
          brake: keys.has('s') || keys.has('arrowdown'),
          left: keys.has('a') || keys.has('arrowleft'),
          right: keys.has('d') || keys.has('arrowright'),
          handbrake: keys.has('space') || keys.has('shift'),
        };
        const hit = queryGround(groundTris, drive.x, drive.z);
        const next = stepDrive(
          drive,
          dk,
          dt,
          hit ? hit.y : null,
          hit?.ny ?? 1,
        );
        Object.assign(drive, next);

        kart.position.set(drive.x, drive.y, drive.z);
        kart.rotation.set(0, drive.yaw, 0);
        kart.visible = true;

        // Third-person camera behind kart (game-scale follow distance)
        const back = 28;
        const height = 14;
        const lookAhead = 20;
        const fx = Math.sin(drive.yaw);
        const fz = Math.cos(drive.yaw);
        const camTarget = new THREE.Vector3(
          drive.x + fx * lookAhead,
          drive.y + 4,
          drive.z + fz * lookAhead,
        );
        const camPos = new THREE.Vector3(
          drive.x - fx * back,
          drive.y + height,
          drive.z - fz * back,
        );
        camera.position.lerp(camPos, 1 - Math.exp(-8 * dt));
        camera.lookAt(camTarget);

        hudAcc += dt;
        if (hudAcc > 0.08) {
          hudAcc = 0;
          setHudKmh(Math.round(speedToKmh(Math.abs(drive.speed))));
        }
      } else {
        kart.visible = false;
        // Free fly
        {
          const baseSpeed = overlay ? 900 : 600;
          const speed =
            (keys.has('shift') ? baseSpeed * 2.5 : baseSpeed) * dt;
          const cp = Math.cos(fly.pitch);
          const forward = new THREE.Vector3(
            Math.sin(fly.yaw) * cp,
            Math.sin(fly.pitch),
            Math.cos(fly.yaw) * cp,
          ).normalize();
          const right = new THREE.Vector3()
            .crossVectors(forward, new THREE.Vector3(0, 1, 0))
            .normalize();
          if (right.lengthSq() < 1e-6) {
            right.set(Math.cos(fly.yaw), 0, -Math.sin(fly.yaw));
          }
          const up = new THREE.Vector3(0, 1, 0);
          if (keys.has('w')) fly.pos.addScaledVector(forward, speed);
          if (keys.has('s')) fly.pos.addScaledVector(forward, -speed);
          if (keys.has('a')) fly.pos.addScaledVector(right, -speed);
          if (keys.has('d')) fly.pos.addScaledVector(right, speed);
          if (keys.has('e')) fly.pos.addScaledVector(up, speed);
          if (keys.has('q')) fly.pos.addScaledVector(up, -speed);
        }
        const cp = Math.cos(fly.pitch);
        const dir = new THREE.Vector3(
          Math.sin(fly.yaw) * cp,
          Math.sin(fly.pitch),
          Math.cos(fly.yaw) * cp,
        );
        camera.position.copy(fly.pos);
        camera.lookAt(fly.pos.clone().add(dir));
      }

      renderer.render(scene, camera);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);

    return () => {
      alive = false;
      keysRef.current.clear();
      if (document.pointerLockElement === renderer.domElement) {
        document.exitPointerLock?.();
      }
      ro.disconnect();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      document.removeEventListener('pointerlockchange', onLockChange);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('contextmenu', onContextMenu);
      disposeObject(group);
      disposeObject(kart);
      renderer.dispose();
      if (mount.contains(renderer.domElement)) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, [doc, overlay, mode, ensureFly, camEpoch]);

  useEffect(() => {
    flyRef.current = null;
    driveRef.current = null;
    setCamEpoch((n) => n + 1);
  }, [doc.meta.debugName, doc.meta.resourceName]);

  const openOverlay = (m: ViewMode) => {
    setMode(m);
    modeRef.current = m;
    setOverlay(true);
    setFocused(true);
  };

  return (
    <div className="preview3d-root">
      <div className="preview3d-toolbar">
        <button
          type="button"
          className="primary"
          onClick={() => openOverlay('drive')}
          title="Drive a scale-accurate kart on the track"
        >
          Test drive
        </button>
        <button type="button" onClick={() => openOverlay('fly')}>
          Explore 3D
        </button>
        <button
          type="button"
          onClick={() => {
            flyRef.current = null;
            driveRef.current = null;
            setFocused(false);
            setCamEpoch((n) => n + 1);
          }}
          title="Reset camera / kart spawn"
        >
          Reset
        </button>
      </div>
      <div
        className={`preview3d${focused && !overlay ? ' focused' : ''}`}
        ref={mountRef}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          if (!overlay) setFocused(false);
        }}
      />
      <p className="hint preview-hint">
        <strong>Test drive</strong> — kart & speed use MK64 game units (bbox
        ~5.5, ~108 km/h top). <strong>Explore</strong> free-flies for inspection.
      </p>

      {overlay && (
        <div
          className="preview-explore-overlay"
          role="dialog"
          aria-label={mode === 'drive' ? 'Test drive' : '3D explore'}
        >
          <div className="preview-explore-bar">
            <span>
              {mode === 'drive' ? (
                <>
                  Test drive — <strong>↑/W</strong> accel · <strong>↓/S</strong>{' '}
                  brake · <strong>A/D</strong> steer · <strong>Space</strong>{' '}
                  handbrake · <strong>R</strong> respawn ·{' '}
                  <span className="speedo">{hudKmh} km/h</span>
                </>
              ) : (
                <>
                  Explore — WASD move · QE up/down · click to capture mouse · Esc
                  exit
                </>
              )}
            </span>
            <div className="preview-explore-actions">
              {mode === 'drive' ? (
                <button type="button" onClick={() => setMode('fly')}>
                  Switch to fly
                </button>
              ) : (
                <button type="button" onClick={() => setMode('drive')}>
                  Switch to drive
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setOverlay(false);
                  setFocused(false);
                }}
              >
                Exit
              </button>
            </div>
          </div>
          <div className="preview-explore-stage" ref={exploreMountRef} />
        </div>
      )}
    </div>
  );
}
