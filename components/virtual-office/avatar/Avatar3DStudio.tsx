"use client";

// Avatar3DStudio — a real-time 3D executive rendered with React Three Fiber.
//
// Loads the low-poly PBR "business man" (glTF + albedo/normal/AO maps), lights
// it with an image-based environment + contact shadows via drei's <Stage>, and
// plays the rig's idle clip. The role accent tints a rim light so each exec
// reads with their color without needing per-material customization ("fixed
// premium look + accent"). Desktop-first HD: antialiased, ACES tone-mapped,
// devicePixelRatio up to 2. Mounted lazily (dynamic import, ssr:false) so the
// three.js bundle + model only load when the Character Studio opens.
import { Suspense, useEffect, useLayoutEffect, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Stage, useAnimations, useGLTF, useTexture } from "@react-three/drei";
import * as THREE from "three";

const BASE = "/assets/3d/business-man";
const GLB = `${BASE}/business_man.glb`;

function Businessman({ accent }: { accent: string }) {
  const { scene, animations } = useGLTF(GLB);
  const tex = useTexture({ map: `${BASE}/albedo.jpg`, normalMap: `${BASE}/normal.png`, aoMap: `${BASE}/ao.jpg` });
  const ref = useRef<THREE.Group>(null);
  const { actions } = useAnimations(animations, ref);

  // Apply the real PBR maps (fbx2gltf drops them) + shadow flags + AO uv2.
  useLayoutEffect(() => {
    tex.map.colorSpace = THREE.SRGBColorSpace;
    for (const t of [tex.map, tex.normalMap, tex.aoMap]) {
      t.flipY = false;
      t.needsUpdate = true;
    }
    const mat = new THREE.MeshStandardMaterial({
      map: tex.map,
      normalMap: tex.normalMap,
      aoMap: tex.aoMap,
      roughness: 0.6,
      metalness: 0.08,
    });
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!(mesh as unknown as { isMesh?: boolean }).isMesh) return;
      mesh.material = mat;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const geo = mesh.geometry as THREE.BufferGeometry;
      if (geo.attributes.uv && !geo.attributes.uv2) geo.setAttribute("uv2", geo.attributes.uv);
    });
  }, [scene, tex]);

  // Play the rig's idle clip (fall back to the first available).
  useEffect(() => {
    const idle = actions["Rig|idle"] ?? Object.values(actions)[0] ?? null;
    idle?.reset().fadeIn(0.4).play();
    return () => {
      idle?.fadeOut(0.2);
    };
  }, [actions]);

  return <primitive ref={ref} object={scene} />;
}

export default function Avatar3DStudio({ accent = "#c9a84c" }: { accent?: string }) {
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
      camera={{ position: [0, 1.4, 3.4], fov: 34 }}
      style={{ width: "100%", height: "100%" }}
    >
      <color attach="background" args={["#0c0a07"]} />
      <Suspense fallback={null}>
        <Stage intensity={0.5} environment="city" adjustCamera={1.15} shadows={{ type: "contact", opacity: 0.45, blur: 2.6 }}>
          <Businessman accent={accent} />
        </Stage>
        {/* Role-accent rim light — the executive's color without a material swap. */}
        <spotLight position={[-3.5, 3.5, -3]} angle={0.6} penumbra={1} intensity={40} color={accent} />
      </Suspense>
      <OrbitControls
        makeDefault
        autoRotate
        autoRotateSpeed={0.7}
        enablePan={false}
        minPolarAngle={Math.PI / 2.7}
        maxPolarAngle={Math.PI / 1.95}
        minDistance={2.2}
        maxDistance={5.5}
      />
    </Canvas>
  );
}

useGLTF.preload(GLB);
