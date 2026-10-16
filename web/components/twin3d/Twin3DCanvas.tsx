import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { EngineModel } from "./EngineModel";
import { FaultHighlighter } from "./FaultHighlighter";
import { RenderMode } from "./HologramMaterials";
import { TickFrame } from "@/lib/types";

interface Props {
  frame: TickFrame | null;
  autoRotate?: boolean;
  isFlightActive?: boolean;
}

/**
 * The viewport shows the Rotax 915 iS twin and nothing else. The airframe model
 * that used to open here was a separate asset with its own subsystem markers,
 * and those markers floated away from the hull — it also answered a question
 * ("what does the aircraft look like") that this page is not asked.
 */
export function Twin3DCanvas({ frame, autoRotate = true, isFlightActive = false }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineModelRef = useRef<EngineModel | null>(null);
  const faultHighlighterRef = useRef<FaultHighlighter | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const frameRef = useRef<TickFrame | null>(frame);
  const isFlightActiveRef = useRef<boolean>(isFlightActive);

  const [isLoaded, setIsLoaded] = useState(false);
  const [renderMode, setRenderMode] = useState<RenderMode>("tactical");

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

    // 1. Scene
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x080b0f, 0.035);

    // 2. Camera, framed on the engine
    const width = container.clientWidth || 800;
    const height = container.clientHeight || 550;
    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 100);
    camera.position.set(3.4, 2.1, 3.7);
    cameraRef.current = camera;

    // 3. Renderer and neutral environment
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);

    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    const envRT = pmrem.fromScene(new RoomEnvironment());
    scene.environment = envRT.texture;
    scene.environmentIntensity = 0.62;

    // 4. Orbit controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.04;
    controls.maxDistance = 12;
    controls.minDistance = 1.2;
    controls.rotateSpeed = 0.85;
    controls.zoomSpeed = 0.85;
    controls.target.set(0, -0.05, 0);
    controls.autoRotate = autoRotate;
    controls.autoRotateSpeed = 0.3;
    controlsRef.current = controls;

    // 5. Neutral studio lighting — the olive key/fill that used to tint the
    //    whole engine green is gone.
    scene.add(new THREE.AmbientLight(0x2a323a, 1.35));

    const keyLight = new THREE.DirectionalLight(0xf2f6fa, 2.2);
    keyLight.position.set(5, 7, 5);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xaebac5, 1.2);
    fillLight.position.set(-5, 4, -4);
    scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0x6f7d89, 1.3);
    rimLight.position.set(-2, -4, -6);
    scene.add(rimLight);

    // 6. Ground grid
    const gridHelper = new THREE.GridHelper(8, 32, 0x2b3945, 0x1a232d);
    gridHelper.position.y = -1.2;
    scene.add(gridHelper);

    // 7. The engine twin
    const engineModel = new EngineModel(() => setIsLoaded(true));
    engineModel.group.visible = true;
    scene.add(engineModel.group);
    engineModelRef.current = engineModel;

    // 8. Fault highlighting
    const faultHighlighter = new FaultHighlighter(engineModel);
    faultHighlighterRef.current = faultHighlighter;

    // 9. Animation loop
    let animationFrameId: number;
    const clock = new THREE.Clock();

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      const delta = clock.getDelta();

      if (controls.autoRotate && controls.autoRotateSpeed < 0.3) {
        controls.autoRotateSpeed = THREE.MathUtils.lerp(controls.autoRotateSpeed, 0.3, delta * 2.2);
      }
      controls.update();

      engineModel.update(delta);
      faultHighlighter.update(delta, frameRef.current);

      renderer.render(scene, camera);
    };

    animate();

    // 10. Resize
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
    engineModelRef.current?.setRenderMode(mode);
  };

  return (
    <div className="holo-canvas-wrapper" style={{ position: "relative", width: "100%", height: "100%", minHeight: "450px" }}>
      <div ref={containerRef} style={{ width: "100%", height: "100%", position: "absolute", top: 0, left: 0 }} />

      {!isLoaded && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(8, 11, 15, 0.85)",
            zIndex: 10,
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              width: "32px",
              height: "32px",
              border: "2px solid var(--rule)",
              borderTop: "2px solid var(--accent)",
              borderRadius: "50%",
              animation: "spin 1s linear infinite",
              marginBottom: "14px",
            }}
          />
          <div style={{ color: "var(--ink-3)", fontSize: "11px", fontFamily: "var(--font-mono)", letterSpacing: "0.14em" }}>
            LOADING ENGINE TWIN
          </div>
        </div>
      )}

      <div className="hud-tactical-reticle-overlay">
        <div className="hud-corner-tag hud-tl">
          <span className="hud-live-tag">ROTAX 915 iS</span>
          <span className="hud-callout">4-CYL TURBOCHARGED BOXER // FADEC DUAL-CHANNEL</span>
        </div>

        <div className="hud-controls-top-right">
          <div className="render-mode-group">
            <button
              type="button"
              className={`btn-hud-mode ${renderMode === "tactical" ? "active" : ""}`}
              onClick={() => handleModeChange("tactical")}
            >
              SOLID
            </button>
            <button
              type="button"
              className={`btn-hud-mode ${renderMode === "wireframe" ? "active" : ""}`}
              onClick={() => handleModeChange("wireframe")}
            >
              WIREFRAME
            </button>
            <button
              type="button"
              className={`btn-hud-mode ${renderMode === "flir_thermal" ? "active" : ""}`}
              onClick={() => handleModeChange("flir_thermal")}
            >
              THERMAL
            </button>
          </div>
        </div>

        {renderMode === "flir_thermal" && (
          <div className="thermal-legend">
            <div className="thermal-legend-head">
              <span>THERMAL SCALE</span>
              <span>{frame?.sensors ? `EGT ${frame.sensors.egt_1?.toFixed(0) ?? "—"} °C` : "NO FRAME"}</span>
            </div>
            <div className="thermal-legend-ramp" />
            <div className="thermal-legend-axis">
              <span>20 °C</span>
              <span>450 °C</span>
              <span>950 °C</span>
            </div>
          </div>
        )}

        <div className="hud-corner-tag hud-br">
          <span>DRAG ROTATE · SCROLL ZOOM · RIGHT-CLICK PAN</span>
        </div>
      </div>
    </div>
  );
}
