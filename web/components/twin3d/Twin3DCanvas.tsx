import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { EngineModel } from "./EngineModel";
import { FaultHighlighter } from "./FaultHighlighter";
import { ScanlineEffect } from "./ScanlineEffect";
import { RenderMode } from "./HologramMaterials";
import { TickFrame } from "@/lib/types";

interface Props {
  frame: TickFrame | null;
  autoRotate?: boolean;
  isFlightActive?: boolean;
}

export function Twin3DCanvas({ frame, autoRotate = true, isFlightActive = false }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineModelRef = useRef<EngineModel | null>(null);
  const faultHighlighterRef = useRef<FaultHighlighter | null>(null);
  const scanlineRef = useRef<ScanlineEffect | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const frameRef = useRef<TickFrame | null>(frame);
  const isFlightActiveRef = useRef<boolean>(isFlightActive);

  const [isLoaded, setIsLoaded] = useState(false);
  const [renderMode, setRenderMode] = useState<RenderMode>("tactical");

  // Keep refs up to date
  useEffect(() => {
    frameRef.current = frame;
    isFlightActiveRef.current = isFlightActive;
    if (engineModelRef.current) {
      engineModelRef.current.updateFromFrame(frame);
    }
  }, [frame, isFlightActive]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // 1. Scene setup
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0e120f, 0.035);

    // 2. Camera setup - framed directly on the Rotax 915 iS Engine
    const width = container.clientWidth || 800;
    const height = container.clientHeight || 550;
    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
    camera.position.set(2.8, 1.9, 3.4);
    cameraRef.current = camera;

    // 3. High Quality Renderer & Neutral Environment
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);

    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    const envRT = pmrem.fromScene(new RoomEnvironment());
    scene.environment = envRT.texture;
    scene.environmentIntensity = 0.5;

    // 4. OrbitControls - focused on the engine center
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxDistance = 10;
    controls.minDistance = 1.2;
    controls.rotateSpeed = 0.85;
    controls.zoomSpeed = 0.85;
    controls.target.set(0, -0.05, 0);
    controls.autoRotate = autoRotate;
    controls.autoRotateSpeed = 0.35;
    controlsRef.current = controls;

    // 5. Tactical Studio Lighting
    const ambientLight = new THREE.AmbientLight(0x222d24, 1.2);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xf4f6f0, 2.4);
    keyLight.position.set(5, 7, 5);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xa3b899, 1.4);
    fillLight.position.set(-5, 4, -4);
    scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0x6b7f64, 1.5);
    rimLight.position.set(-2, -4, -6);
    scene.add(rimLight);

    const corePointLight = new THREE.PointLight(0x38bdf8, 0.6, 8);
    corePointLight.position.set(0, 0.3, 0);
    scene.add(corePointLight);

    // 6. Tactical Ground Plane
    const gridHelper = new THREE.GridHelper(8, 32, 0x384d39, 0x233024);
    gridHelper.position.y = -1.1;
    scene.add(gridHelper);

    // 7. Authentic Rotax 915 iS Engine Model (Primary & Only 3D Twin)
    const engineModel = new EngineModel(() => {
      setIsLoaded(true);
    });
    engineModel.group.visible = true;
    engineModel.setOpacity(1.0);
    engineModel.setRevealScale(1.0);
    engineModel.setRenderMode(renderMode);
    scene.add(engineModel.group);
    engineModelRef.current = engineModel;

    // 8. Fault Highlighter
    const faultHighlighter = new FaultHighlighter(engineModel);
    faultHighlighterRef.current = faultHighlighter;

    // 9. Scanline Sweep Effect
    const scanline = new ScanlineEffect();
    scene.add(scanline.mesh);
    scanlineRef.current = scanline;

    // 10. Animation Loop
    let animationFrameId: number;
    const clock = new THREE.Clock();

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      const delta = clock.getDelta();

      controls.update();

      // Engine Model scale and dynamics update
      engineModel.update(delta);

      // Scanline update
      scanline.update(delta);

      // Fault highlighter flash update
      faultHighlighter.update(delta, frameRef.current);

      renderer.render(scene, camera);
    };

    animate();

    // 11. Handle Resize
    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      cancelAnimationFrame(animationFrameId);
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      envRT.dispose();
      pmrem.dispose();
      controls.dispose();
      renderer.dispose();
    };
  }, [autoRotate]);

  const handleModeChange = (mode: RenderMode) => {
    setRenderMode(mode);
    if (engineModelRef.current) {
      engineModelRef.current.setRenderMode(mode);
    }
  };

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
            background: "rgba(11, 15, 20, 0.85)",
            backdropFilter: "blur(6px)",
            zIndex: 10,
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              width: "36px",
              height: "36px",
              border: "3px solid #1e293b",
              borderTop: "3px solid #38bdf8",
              borderRadius: "50%",
              animation: "spin 1s linear infinite",
              marginBottom: "14px",
            }}
          />
          <div style={{ color: "var(--ink-2)", fontSize: "12px", fontFamily: "var(--font-mono)" }}>
            LOADING ROTAX 915 iS ENGINE TWIN...
          </div>
        </div>
      )}

      {/* Clean CAD Viewport Controls */}
      <div className="hud-tactical-reticle-overlay">
        {/* Top-Left Acquisition Tag */}
        <div className="hud-corner-tag hud-tl">
          <span className="hud-live-tag" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            ROTAX 915 iS DIGITAL TWIN
            <span
              style={{
                fontSize: "10px",
                padding: "1px 6px",
                borderRadius: "2px",
                fontWeight: 700,
                letterSpacing: "0.08em",
                backgroundColor: "rgba(16, 185, 129, 0.2)",
                color: "#34d399",
                border: "1px solid rgba(16, 185, 129, 0.4)",
              }}
            >
              ● PROPULSION ACTIVE
            </span>
          </span>
          <span className="hud-callout">
            4-CYL TURBOCHARGED BOXER // FADEC DUAL-CHANNEL // DRY-SUMP OIL
          </span>
        </div>

        {/* Top-Right Shading Tools */}
        <div className="hud-controls-top-right">
          <div className="render-mode-group">
            <button
              type="button"
              className={`btn-hud-mode ${renderMode === "tactical" ? "active" : ""}`}
              onClick={() => handleModeChange("tactical")}
              title="Solid CAD Inspection"
            >
              SOLID CAD
            </button>
            <button
              type="button"
              className={`btn-hud-mode ${renderMode === "wireframe" ? "active" : ""}`}
              onClick={() => handleModeChange("wireframe")}
              title="Wireframe Mesh Mode"
            >
              WIREFRAME
            </button>
            <button
              type="button"
              className={`btn-hud-mode ${renderMode === "flir_thermal" ? "active" : ""}`}
              onClick={() => handleModeChange("flir_thermal")}
              title="FLIR Infrared Subsystem Thermal Heatmap"
            >
              THERMAL
            </button>
          </div>
        </div>

        {/* Bottom Corner Control Hints */}
        <div className="hud-corner-tag hud-bl">
          <span>DRY-SUMP OIL // INTERCOOLED TURBO // DUAL FADEC // 19 SENSOR CHANNELS</span>
        </div>
        <div className="hud-corner-tag hud-br">
          <span>ROTATE: DRAG | ZOOM: SCROLL | PAN: RIGHT-CLICK</span>
        </div>
      </div>
    </div>
  );
}
