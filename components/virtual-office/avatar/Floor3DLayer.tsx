"use client";

// Floor3DLayer — real-time 3D executives composited over the Phaser floor.
//
// The Phaser OfficeScene stays fully authoritative for movement, collision,
// proximity, the camera and every overlay. This transparent R3F canvas sits on
// top of the Phaser canvas (pointer-events:none, so clicks still reach the
// floor) and, each frame, reads the shared floorFrame snapshot the scene
// publishes, projects every character's world position through Phaser's camera,
// and places a billboarded 3D model (the same PBR businessman used in the
// Character Studio) at that screen point. One shared GLB + material is cloned
// per character via SkeletonUtils, each with its own mixer, driven idle / walk /
// sit by the snapshot. A soft accent-tinted floor marker carries the role color.
//
// Desktop-first HD: ACES tone-mapping, dpr up to 2. Mounted lazily (dynamic
// import, ssr:false) by VirtualOfficeGame. Once the models are loaded it tells
// the scene to hide the 2D figures — if WebGL never comes up, the floor simply
// stays 2D.
import { Component, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useGLTF, useTexture } from "@react-three/drei";
import { SkeletonUtils } from "three-stdlib";
import * as THREE from "three";
import { getFloorFrame, type FloorChar } from "@/lib/office/floorFrame";

const BASE = "/assets/3d/business-man";
const GLB = `${BASE}/business_man.glb`;

// Feet-to-head pixel height of a character at zoom 1 (the 2D figure is ~44px at
// zoom 2). Scaled by the live camera zoom each frame.
const CHAR_PX_AT_ZOOM1 = 23;
// Model faces +Z (toward the camera) by default — matches the studio framing.
const BASE_YAW = 0;

type PreparedModel = { source: THREE.Object3D; clips: THREE.AnimationClip[]; height: number; footY: number };

/** Load the GLB + PBR maps once, apply the material, and measure the model. */
function usePreparedBusinessman(): PreparedModel {
  const { scene, animations } = useGLTF(GLB);
  const tex = useTexture({ map: `${BASE}/albedo.jpg`, normalMap: `${BASE}/normal.png`, aoMap: `${BASE}/ao.jpg` });

  return useMemo(() => {
    tex.map.colorSpace = THREE.SRGBColorSpace;
    for (const t of [tex.map, tex.normalMap, tex.aoMap]) {
      t.flipY = false;
      t.needsUpdate = true;
    }
    const mat = new THREE.MeshStandardMaterial({
      map: tex.map,
      normalMap: tex.normalMap,
      aoMap: tex.aoMap,
      roughness: 0.62,
      metalness: 0.08,
    });
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!(mesh as unknown as { isMesh?: boolean }).isMesh) return;
      mesh.material = mat;
      const geo = mesh.geometry as THREE.BufferGeometry;
      if (geo.attributes.uv && !geo.attributes.uv2) geo.setAttribute("uv2", geo.attributes.uv);
    });
    scene.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(scene);
    return { source: scene, clips: animations, height: box.max.y - box.min.y, footY: box.min.y };
  }, [scene, animations, tex]);
}

/** Shared soft radial sprite for the floor markers (tinted per character). */
function useRadialTexture(): THREE.Texture {
  return useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const ctx = c.getContext("2d")!;
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.55, "rgba(255,255,255,0.55)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);
}

/** Orthographic camera mapped 1 unit = 1 CSS pixel, origin at the bottom-left. */
function PixelCamera() {
  const { camera, size } = useThree();
  useEffect(() => {
    const cam = camera as THREE.OrthographicCamera;
    cam.left = 0;
    cam.right = size.width;
    cam.top = size.height;
    cam.bottom = 0;
    cam.near = -1000;
    cam.far = 1000;
    cam.position.set(0, 0, 500);
    cam.zoom = 1;
    cam.updateProjectionMatrix();
  }, [camera, size]);
  return null;
}

function Character3D({
  id,
  accent,
  prepared,
  radial,
}: {
  id: string;
  accent: string;
  prepared: PreparedModel;
  radial: THREE.Texture;
}) {
  const group = useRef<THREE.Group>(null);
  const modelHolder = useRef<THREE.Group>(null);

  const { model, mixer, actions } = useMemo(() => {
    const model = SkeletonUtils.clone(prepared.source) as THREE.Object3D;
    const mixer = new THREE.AnimationMixer(model);
    const find = (re: RegExp) => prepared.clips.find((c) => re.test(c.name)) ?? null;
    const clipFor = (re: RegExp) => {
      const clip = find(re) ?? prepared.clips[0];
      const a = mixer.clipAction(clip);
      a.setLoop(THREE.LoopRepeat, Infinity);
      return a;
    };
    const actions = {
      idle: clipFor(/\bidle\b/i),
      walk: clipFor(/walk/i),
      sit: clipFor(/sitting_idle/i),
    };
    return { model, mixer, actions };
  }, [prepared]);

  const accentColor = useMemo(() => new THREE.Color(accent), [accent]);
  const current = useRef<keyof typeof actions>("idle");

  useEffect(() => {
    actions.idle.reset().play();
    return () => {
      mixer.stopAllAction();
    };
  }, [actions, mixer]);

  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
    const f = getFloorFrame();
    let c: FloorChar | undefined;
    for (const ch of f.chars) if (ch.id === id) { c = ch; break; }
    if (!c) { g.visible = false; return; }

    const { scrollX, scrollY, zoom, w, h } = f.cam;
    const sx = (c.x - scrollX) * zoom;
    const sy = (c.y - scrollY) * zoom;
    const onScreen = sx > -90 && sx < w + 90 && sy > -180 && sy < h + 90;
    g.visible = onScreen;
    if (!onScreen) return;

    // Ortho pixel space is y-up; the projected sy is y-down from the top.
    g.position.set(sx, h - sy, sy * 0.01);
    const px = (CHAR_PX_AT_ZOOM1 * zoom) / prepared.height;
    g.scale.setScalar(px);

    // Subtle facing hint — nudge the model's yaw left/right; front for up/down.
    const hint = c.facing === "left" ? 0.5 : c.facing === "right" ? -0.5 : 0;
    if (modelHolder.current) modelHolder.current.rotation.y = BASE_YAW + hint;

    const want: keyof typeof actions = c.seated ? "sit" : c.moving ? "walk" : "idle";
    if (want !== current.current) {
      actions[want].reset().fadeIn(0.25).play();
      actions[current.current].fadeOut(0.25);
      current.current = want;
    }
    mixer.update(dt);
  });

  return (
    <group ref={group}>
      {/* Grounding shadow + accent (role-color) floor marker, flattened to read
          as a pad in the top-down view. Behind the figure, unlit, no depth write. */}
      <mesh position={[0, prepared.height * 0.02, -0.03]} scale={[prepared.height * 0.34, prepared.height * 0.12, 1]} renderOrder={-2}>
        <circleGeometry args={[1, 24]} />
        <meshBasicMaterial map={radial} color="#000000" transparent opacity={0.5} depthWrite={false} />
      </mesh>
      <mesh position={[0, prepared.height * 0.03, -0.02]} scale={[prepared.height * 0.26, prepared.height * 0.09, 1]} renderOrder={-1}>
        <circleGeometry args={[1, 24]} />
        <meshBasicMaterial map={radial} color={accentColor} transparent opacity={0.7} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      <group ref={modelHolder}>
        <primitive object={model} position-y={-prepared.footY} />
      </group>
    </group>
  );
}

/** Mounts a clone per character; re-renders only when the roster changes. */
function Characters({ onActive }: { onActive: (v: boolean) => void }) {
  const prepared = usePreparedBusinessman();
  const radial = useRadialTexture();
  const [roster, setRoster] = useState<Array<{ id: string; accent: string }>>([]);
  const key = useRef("");

  useFrame(() => {
    const f = getFloorFrame();
    if (f.roster === key.current) return;
    key.current = f.roster;
    setRoster(f.chars.map((c) => ({ id: c.id, accent: c.accent })));
  });

  // Models are loaded (this subtree is past Suspense) — tell the scene it's safe
  // to hide the 2D figures. Reverts on unmount so the floor falls back to 2D.
  useEffect(() => {
    onActive(true);
    return () => onActive(false);
  }, [onActive]);

  return (
    <>
      {roster.map((r) => (
        <Character3D key={r.id} id={r.id} accent={r.accent} prepared={prepared} radial={radial} />
      ))}
    </>
  );
}

/** Keeps a WebGL failure from taking down the floor — silently falls back to 2D. */
class GLBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export default function Floor3DLayer({ onActive }: { onActive: (active: boolean) => void }) {
  return (
    <GLBoundary>
      <Canvas
        orthographic
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
        camera={{ position: [0, 0, 500], near: -1000, far: 1000 }}
        style={{ width: "100%", height: "100%", background: "transparent" }}
      >
        <PixelCamera />
        <ambientLight intensity={0.85} />
        <hemisphereLight args={[0xffffff, 0x2b2820, 1.0]} />
        <directionalLight position={[300, 700, 500]} intensity={2.4} />
        <directionalLight position={[-400, 300, -200]} intensity={0.6} color="#9fb4d8" />
        <Suspense fallback={null}>
          <Characters onActive={onActive} />
        </Suspense>
      </Canvas>
    </GLBoundary>
  );
}

useGLTF.preload(GLB);
