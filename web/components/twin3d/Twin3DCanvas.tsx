"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { EngineModel } from "./EngineModel";
import { FaultHighlighter } from "./FaultHighlighter";
import { ScanlineEffect } from "./ScanlineEffect";
import { HologramMaterialFactory, ViewMode } from "./HologramMaterials";
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
  const [viewMode, setViewMode] = useState<ViewMode>("solid"); // Default to Solid CAD (Point 3)
  const [isRotating, setIsRotating] = useState(autoRotate);

  // Update engine model materials when frame changes
  useEffect(() => {
    frameRef.current = frame;
    if (engineModelRef.current) {
      engineModelRef.current.updateFromFrame(frame);
    }
  }, [frame]);

  const handleSwitchMode = (mode: ViewMode) => {
    setViewMode(mode);
    HologramMaterialFactory.getInstance().setViewMode(mode);
    if (scanlineRef.current) {
      scanlineRef.current.mesh.visible = mode === "hologram";
    }
    if (engineModelRef.current && frameRef.current) {
      engineModelRef.current.updateFromFrame(frameRef.current);
    }
  };

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
    renderer.toneMappingExposure = 1.05;
    container.appendChild(renderer.domElement);

    // Image-based lighting for metal reflections
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = envRT.texture;
    scene.environmentIntensity = 0.55;

    // 4. OrbitControls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxDistance = 10;
    controls.minDistance = 1.2;
    controls.target.set(0, -0.05, 0);
    controls.autoRotate = isRotating;
    controls.autoRotateSpeed = 0.4;
    controlsRef.current = controls;

    // 5. Lighting Setup
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
    keyLight.position.set(5, 7, 5);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xa0c0d8, 1.2);
    fillLight.position.set(-5, 4, -4);
    scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0x54c6d1, 1.5);
    rimLight.position.set(-2, -4, -6);
    scene.add(rimLight);

    // 6. Floor Grid
    const gridHelper = new THREE.GridHelper(7, 28, 0x38bdf8, 0x112733);
    gridHelper.position.y = -1.2;
    scene.add(gridHelper);

    // 7. Authentic Rotax 915 iS Engine Model
    const engineModel = new EngineModel(() => {
      setIsLoaded(true);
      HologramMaterialFactory.getInstance().setViewMode(viewMode);
    });
    scene.add(engineModel.group);
    engineModelRef.current = engineModel;

    // 8. Fault Highlighter
    const faultHighlighter = new FaultHighlighter(engineModel);
    faultHighlighterRef.current = faultHighlighter;

    // 9. Scanline Sweep Effect (Hologram mode only)
    const scanline = new ScanlineEffect();
    scanline.mesh.visible = viewMode === "hologram";
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
      if (scanlineRef.current && scanlineRef.current.mesh.visible) {
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

  // Update autoRotate when state toggles
  useEffect(() => {
    if (controlsRef.current) {
      controlsRef.current.autoRotate = isRotating;
    }
  }, [isRotating]);

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
            background: "rgba(10, 18, 25, 0.8)",
            backdropFilter: "blur(6px)",
            zIndex: 10,
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              width: "44px",
              height: "44px",
              border: "3px solid rgba(56, 189, 248, 0.2)",
              borderTop: "3px solid #38bdf8",
              borderRadius: "50%",
              animation: "spin 1s linear infinite",
              marginBottom: "14px",
            }}
          />
          <div style={{ color: "#38bdf8", fontSize: "13px", fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase" }}>
            Loading Rotax 915 iS Engine Assembly...
          </div>
        </div>
      )}

      {/* Point 15: View Mode Switcher Toggle */}
      <div
        style={{
          position: "absolute",
          top: 14,
          left: 14,
          zIndex: 20,
          display: "flex",
          alignItems: "center",
          gap: 4,
          background: "rgba(15, 23, 42, 0.85)",
          backdropFilter: "blur(6px)",
          padding: "3px",
          borderRadius: "8px",
          border: "1px solid rgba(255, 255, 255, 0.12)",
        }}
      >
        <button
          type="button"
          onClick={() => handleSwitchMode("solid")}
          style={{
            background: viewMode === "solid" ? "#1e293b" : "transparent",
            color: viewMode === "solid" ? "#38bdf8" : "#94a3b8",
            border: viewMode === "solid" ? "1px solid rgba(56, 189, 248, 0.3)" : "1px solid transparent",
            padding: "5px 10px",
            borderRadius: "6px",
            fontSize: "11px",
            fontWeight: 700,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 5,
          }}
        >
          <span>⚙️ Solid CAD</span>
        </button>

        <button
          type="button"
          onClick={() => handleSwitchMode("thermal")}
          style={{
            background: viewMode === "thermal" ? "#7f1d1d" : "transparent",
            color: viewMode === "thermal" ? "#fca5a5" : "#94a3b8",
            border: viewMode === "thermal" ? "1px solid #ef4444" : "1px solid transparent",
            padding: "5px 10px",
            borderRadius: "6px",
            fontSize: "11px",
            fontWeight: 700,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 5,
          }}
        >
          <span>🔥 Thermal FLIR</span>
        </button>

        <button
          type="button"
          onClick={() => handleSwitchMode("hologram")}
          style={{
            background: viewMode === "hologram" ? "#0e3a47" : "transparent",
            color: viewMode === "hologram" ? "#54c6d1" : "#94a3b8",
            border: viewMode === "hologram" ? "1px solid #54c6d1" : "1px solid transparent",
            padding: "5px 10px",
            borderRadius: "6px",
            fontSize: "11px",
            fontWeight: 700,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 5,
          }}
        >
          <span>🔷 Hologram</span>
        </button>
      </div>

      {/* Point 15: Thermal Scale Bar Legend (visible in Thermal mode) */}
      {viewMode === "thermal" && (
        <div
          style={{
            position: "absolute",
            bottom: 38,
            left: 14,
            zIndex: 20,
            background: "rgba(15, 23, 42, 0.9)",
            border: "1px solid rgba(239, 68, 68, 0.4)",
            borderRadius: "8px",
            padding: "8px 12px",
            fontSize: "11px",
            color: "#e2e8f0",
            minWidth: "240px",
          }}
        >
          <div style={{ fontWeight: 700, color: "#fca5a5", marginBottom: 4, display: "flex", justifyContent: "space-between" }}>
            <span>THERMAL HEATMAP SCALE</span>
            <span>FLIR INFRARED</span>
          </div>
          <div
            style={{
              height: "10px",
              borderRadius: "4px",
              background: "linear-gradient(to right, #001f5c, #00d4ff, #00ff66, #ffdd00, #ff5500, #ff0000)",
              marginBottom: "4px",
            }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10px", color: "#94a3b8", fontFamily: "var(--font-mono, monospace)" }}>
            <span>20°C (Cold)</span>
            <span>450°C</span>
            <span>950°C (EGT Peak)</span>
          </div>
          {frame?.sensors && (
            <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid rgba(255,255,255,0.1)", display: "flex", gap: 10, fontSize: "10.5px" }}>
              <span>EGT: <strong style={{ color: "#ff5500" }}>{frame.sensors.egt_1_c?.toFixed(0) ?? 820}°C</strong></span>
              <span>CHT: <strong style={{ color: "#ffdd00" }}>{frame.sensors.cht_1_c?.toFixed(0) ?? 112}°C</strong></span>
              <span>Oil: <strong style={{ color: "#00ff66" }}>{frame.sensors.oil_t_c?.toFixed(0) ?? 96}°C</strong></span>
            </div>
          )}
        </div>
      )}

      {/* Rotation control button */}
      <button
        type="button"
        onClick={() => setIsRotating((r) => !r)}
        style={{
          position: "absolute",
          top: 14,
          right: 14,
          zIndex: 20,
          background: "rgba(15, 23, 42, 0.85)",
          border: "1px solid rgba(255, 255, 255, 0.12)",
          color: isRotating ? "#38bdf8" : "#94a3b8",
          padding: "6px 10px",
          borderRadius: "6px",
          fontSize: "11px",
          fontWeight: 600,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 5,
        }}
      >
        <span>{isRotating ? "⏸ Pause Rotation" : "▶ Auto-Rotate"}</span>
      </button>

      <div className="holo-instructions" style={{ bottom: 10 }}>
        <span>Left-click + drag: Rotate | Scroll: Zoom | Right-click: Pan</span>
      </div>
    </div>
  );
}
