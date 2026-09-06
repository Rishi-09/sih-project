"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { EngineModel } from "./EngineModel";
import { FaultHighlighter } from "./FaultHighlighter";
import { ScanlineEffect } from "./ScanlineEffect";
import { TickFrame } from "@/lib/types";

interface Props {
  frame: TickFrame | null;
  autoRotate?: boolean;
}

export function Twin3DCanvas({ frame, autoRotate = true }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineModelRef = useRef<EngineModel | null>(null);
  const faultHighlighterRef = useRef<FaultHighlighter | null>(null);
  const scanlineRef = useRef<ScanlineEffect | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const frameRef = useRef<TickFrame | null>(frame);
  const [isLoaded, setIsLoaded] = useState(false);

  // Update engine model materials when frame changes. The ref is what the
  // animation loop reads — the loop is created once, so closing over `frame`
  // would pin it to the first render's value forever.
  useEffect(() => {
    frameRef.current = frame;
    if (engineModelRef.current) {
      engineModelRef.current.updateFromFrame(frame);
    }
  }, [frame]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // 1. Scene setup
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0a1219, 0.05);

    // 2. Camera setup
    const width = container.clientWidth || 800;
    const height = container.clientHeight || 500;
    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 100);
    // Front-quarter view, framed close enough that the engine fills the panel
    camera.position.set(2.7, 1.35, 2.7);

    // 3. WebGL Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    container.appendChild(renderer.domElement);

    // Image-based lighting: without an environment the model's metal surfaces
    // have nothing to reflect and collapse into flat silhouettes.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = envRT.texture;
    scene.environmentIntensity = 0.35;

    // 4. OrbitControls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxDistance = 10;
    controls.minDistance = 1.2;
    controls.target.set(0, -0.05, 0);
    controls.autoRotate = autoRotate;
    controls.autoRotateSpeed = 0.4;
    controlsRef.current = controls;

    // 5. High-Tech Holographic Lighting
    // Intensities are tuned for lit PBR surfaces; the previous values were set
    // for a fully emissive model and blow real materials out to flat white.
    const ambientLight = new THREE.AmbientLight(0x0e2430, 0.6);
    scene.add(ambientLight);

    const cyanKeyLight = new THREE.DirectionalLight(0xa8e6ee, 2.2);
    cyanKeyLight.position.set(5, 7, 5);
    scene.add(cyanKeyLight);

    const cyanFillLight = new THREE.DirectionalLight(0x38a0ad, 1.1);
    cyanFillLight.position.set(-5, 4, -4);
    scene.add(cyanFillLight);

    const blueRimLight = new THREE.DirectionalLight(0x2a6ea8, 1.6);
    blueRimLight.position.set(-2, -4, -6);
    scene.add(blueRimLight);

    const corePointLight = new THREE.PointLight(0x54c6d1, 1.2, 8);
    corePointLight.position.set(0, 0.2, 0);
    scene.add(corePointLight);

    // 6. Holographic Floor Grid
    const gridHelper = new THREE.GridHelper(7, 28, 0x54c6d1, 0x112733);
    gridHelper.position.y = -1.2;
    scene.add(gridHelper);

    // Subtle concentric distance rings on the floor
    const ringGeo1 = new THREE.RingGeometry(2.4, 2.42, 48);
    ringGeo1.rotateX(-Math.PI / 2);
    const ringMat1 = new THREE.MeshBasicMaterial({
      color: 0x54c6d1,
      transparent: true,
      opacity: 0.14,
      side: THREE.DoubleSide,
      // Additive: at normal blending these read as flat grey paint on the floor
      // rather than as emitted cyan light.
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const ringMesh1 = new THREE.Mesh(ringGeo1, ringMat1);
    ringMesh1.position.y = -1.19;
    scene.add(ringMesh1);

    const ringGeo2 = new THREE.RingGeometry(3.4, 3.42, 48);
    ringGeo2.rotateX(-Math.PI / 2);
    const ringMesh2 = new THREE.Mesh(ringGeo2, ringMat1);
    ringMesh2.position.y = -1.19;
    scene.add(ringMesh2);

    // 7. Authentic Rotax 915 iS Engine Model (Hologram FBX)
    const engineModel = new EngineModel(() => {
      setIsLoaded(true);
    });
    scene.add(engineModel.group);
    engineModelRef.current = engineModel;

    // 8. Fault Highlighter
    const faultHighlighter = new FaultHighlighter(engineModel);
    faultHighlighterRef.current = faultHighlighter;

    // 9. Holographic Scanline Sweep Effect
    const scanline = new ScanlineEffect();
    scene.add(scanline.mesh);
    scanlineRef.current = scanline;

    // 10. Animation loop
    const clock = new THREE.Clock();
    let animationFrameId: number;

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      const delta = clock.getDelta();

      controls.update();

      if (faultHighlighterRef.current) {
        faultHighlighterRef.current.update(delta, frameRef.current);
      }
      if (scanlineRef.current) {
        scanlineRef.current.update(delta);
      }

      renderer.render(scene, camera);
    };

    animate();

    // 11. Responsive Resize
    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    // Cleanup
    return () => {
      cancelAnimationFrame(animationFrameId);
      resizeObserver.disconnect();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      envRT.dispose();
      pmrem.dispose();
      controls.dispose();
      renderer.dispose();
    };
  }, []);

  return (
    <div className="holo-canvas-wrapper" style={{ position: "relative", width: "100%", height: "100%", minHeight: "450px" }}>
      <div ref={containerRef} style={{ width: "100%", height: "100%", position: "absolute", top: 0, left: 0 }} />

      {!isLoaded && (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(10, 18, 25, 0.75)",
            backdropFilter: "blur(4px)",
            zIndex: 10,
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              width: "40px",
              height: "40px",
              border: "3px solid rgba(84, 198, 209, 0.2)",
              borderTop: "3px solid #54c6d1",
              borderRadius: "50%",
              animation: "spin 1s linear infinite",
              marginBottom: "12px",
            }}
          />
          <div style={{ color: "#54c6d1", fontSize: "12px", fontWeight: 600, letterSpacing: "1.5px", textTransform: "uppercase" }}>
            Loading Rotax 915 iS Hologram...
          </div>
        </div>
      )}

      <div className="holo-overlay-badge">
        <span className="holo-dot" />
        <span>ROTAX 915 iS HOLOGRAPHIC DIGITAL TWIN</span>
      </div>
      <div className="holo-instructions">
        <span>Left-click + drag: Rotate | Scroll: Zoom | Right-click: Pan</span>
      </div>
    </div>
  );
}
