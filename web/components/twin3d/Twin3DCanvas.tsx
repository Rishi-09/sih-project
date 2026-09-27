import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { EngineModel } from "./EngineModel";
import { AirframeModel } from "./AirframeModel";
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
  const airframeModelRef = useRef<AirframeModel | null>(null);
  const faultHighlighterRef = useRef<FaultHighlighter | null>(null);
  const scanlineRef = useRef<ScanlineEffect | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const frameRef = useRef<TickFrame | null>(frame);
  const isFlightActiveRef = useRef<boolean>(isFlightActive);

  const [isLoaded, setIsLoaded] = useState(false);
  // Default to Complete Airframe view on initial window open as requested
  const [modelView, setModelView] = useState<"engine" | "airframe">("airframe");
  const [renderMode, setRenderMode] = useState<RenderMode>("tactical");
  const [isXRay, setIsXRay] = useState(false);

  // Cinematic Camera Transition State (Spherical Orbital Arc Dolly)
  const transitionRef = useRef<{
    active: boolean;
    progress: number;
    duration: number;
    direction: "to_engine" | "to_airframe";
    startRadius: number;
    endRadius: number;
    startPhi: number;
    endPhi: number;
    startTheta: number;
    endTheta: number;
    startTarget: THREE.Vector3;
    endTarget: THREE.Vector3;
    onComplete?: () => void;
  }>({
    active: false,
    progress: 0,
    duration: 1.5,
    direction: "to_engine",
    startRadius: 8.0,
    endRadius: 5.3,
    startPhi: 1.1,
    endPhi: 1.2,
    startTheta: 0.8,
    endTheta: 0.7,
    startTarget: new THREE.Vector3(),
    endTarget: new THREE.Vector3(),
  });

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

    // 2. Camera setup - default framed for complete airframe
    const width = container.clientWidth || 800;
    const height = container.clientHeight || 550;
    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 100);
    camera.position.set(4.6, 3.2, 5.2);
    cameraRef.current = camera;

    // 3. High Quality Renderer & Neutral Environment
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
    scene.environmentIntensity = 0.45;

    // 4. OrbitControls - keep auto-rotation permanently on with fluid inertial damping
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.04;
    controls.maxDistance = 14;
    controls.minDistance = 1.0;
    controls.rotateSpeed = 0.85;
    controls.zoomSpeed = 0.85;
    controls.target.set(0, 0, 0);
    controls.autoRotate = autoRotate;
    controls.autoRotateSpeed = 0.30;
    controlsRef.current = controls;

    // 5. Tactical Studio Lighting
    const ambientLight = new THREE.AmbientLight(0x222d24, 1.1);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xf4f6f0, 2.2);
    keyLight.position.set(5, 7, 5);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xa3b899, 1.2);
    fillLight.position.set(-5, 4, -4);
    scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0x6b7f64, 1.4);
    rimLight.position.set(-2, -4, -6);
    scene.add(rimLight);

    const corePointLight = new THREE.PointLight(0x38bdf8, 0.5, 8);
    corePointLight.position.set(0, 0.4, 0);
    scene.add(corePointLight);

    // 6. Tactical Ground Plane
    const gridHelper = new THREE.GridHelper(8, 32, 0x384d39, 0x233024);
    gridHelper.position.y = -1.2;
    scene.add(gridHelper);

    // 7. Authentic Rotax 915 iS Engine Model (initially hidden, airframe is primary)
    const engineModel = new EngineModel(() => {
      setIsLoaded(true);
    });
    engineModel.group.visible = false;
    scene.add(engineModel.group);
    engineModelRef.current = engineModel;

    // 7b. Complete 3D UAV Airframe Model (visible by default on initial open)
    const airframeModel = new AirframeModel();
    airframeModel.setVisible(true);
    scene.add(airframeModel.group);
    airframeModelRef.current = airframeModel;

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

    // 5th Order Smootherstep: zero velocity and zero acceleration at t=0 and t=1
    const smootherstep = (t: number): number => {
      const c = Math.max(0, Math.min(1, t));
      return c * c * c * (c * (c * 6 - 15) + 10);
    };

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      const delta = clock.getDelta();

      // Handle Smooth Cinematic Spherical Arc Camera Dolly & Holographic Cross-Dissolve
      if (transitionRef.current.active) {
        const tr = transitionRef.current;
        tr.progress += delta / tr.duration;
        const p = Math.min(1.0, tr.progress);
        const ease = smootherstep(p);

        // Spherical orbital arc calculation for buttery curved camera movement
        const curRadius = THREE.MathUtils.lerp(tr.startRadius, tr.endRadius, ease);
        const curPhi = THREE.MathUtils.lerp(tr.startPhi, tr.endPhi, ease);
        const curTheta = THREE.MathUtils.lerp(tr.startTheta, tr.endTheta, ease);
        const curTarget = new THREE.Vector3().lerpVectors(tr.startTarget, tr.endTarget, ease);

        const camOffset = new THREE.Vector3().setFromSphericalCoords(curRadius, curPhi, curTheta);
        camera.position.copy(curTarget).add(camOffset);
        controls.target.copy(curTarget);
        // Do NOT call controls.update() while manually driving spherical coordinates to avoid jitter

        if (tr.direction === "to_engine") {
          // Smooth cosine cross-fade: airframe dissolves out over p in [0.05, 0.85]
          const airframeT = THREE.MathUtils.clamp((p - 0.05) / 0.80, 0, 1);
          const airframeFade = 0.5 * (1 + Math.cos(Math.PI * airframeT));
          airframeModel.setDissolveFactor(airframeFade);

          // Engine fades in over p in [0.15, 0.95]
          const engineT = THREE.MathUtils.clamp((p - 0.15) / 0.80, 0, 1);
          const engineFade = 0.5 * (1 - Math.cos(Math.PI * engineT));
          engineModel.setOpacity(engineFade);
          engineModel.setRevealScale(0.95 + 0.05 * smootherstep(engineT));
        } else {
          // Symmetrically reverse: engine fades out over p in [0.05, 0.85]
          const engineT = THREE.MathUtils.clamp((p - 0.05) / 0.80, 0, 1);
          const engineFade = 0.5 * (1 + Math.cos(Math.PI * engineT));
          engineModel.setOpacity(engineFade);
          engineModel.setRevealScale(0.95 + 0.05 * smootherstep(1 - engineT));

          // Airframe fades in over p in [0.15, 0.95]
          const airframeT = THREE.MathUtils.clamp((p - 0.15) / 0.80, 0, 1);
          const airframeFade = 0.5 * (1 - Math.cos(Math.PI * airframeT));
          airframeModel.setDissolveFactor(airframeFade);
        }

        if (p >= 1.0) {
          tr.active = false;
          tr.onComplete?.();
        }
      } else {
        // Smoothly accelerate autoRotateSpeed from 0 up to 0.30 over ~1.2s to eliminate rotational jerk
        if (controls.autoRotate && controls.autoRotateSpeed < 0.30) {
          controls.autoRotateSpeed = THREE.MathUtils.lerp(controls.autoRotateSpeed, 0.30, delta * 2.2);
        }
        controls.update();
      }

      // Engine Model scale and dynamics update
      engineModel.update(delta);

      // Scanline update
      scanline.update(delta);

      // Fault highlighter flash update
      faultHighlighter.update(delta, frameRef.current);

      // Airframe update with flight dynamics and telemetry
      airframeModel.update(delta, frameRef.current, isFlightActiveRef.current);

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

  // Smooth cinematic switch between Airframe and Engine Twin
  const handleModelViewChange = (view: "engine" | "airframe") => {
    if (view === modelView) return;
    setModelView(view);

    if (!cameraRef.current || !controlsRef.current) return;
    const camera = cameraRef.current;
    const controls = controlsRef.current;

    // Compute current spherical coordinates relative to current target
    const startTarget = controls.target.clone();
    const startVec = camera.position.clone().sub(startTarget);
    const startSpherical = new THREE.Spherical().setFromVector3(startVec);

    // Target lookAt and parameters
    const targetEndLookAt = view === "engine"
      ? new THREE.Vector3(0, -0.05, 0)
      : new THREE.Vector3(0, 0, 0);

    // Camera radius and polar pitch
    const endRadius = view === "engine" ? 4.9 : 7.4;
    // Maintain a comfortable tactical elevation (~25°-35° above horizontal)
    const endPhi = view === "engine"
      ? THREE.MathUtils.clamp(startSpherical.phi, 0.95, 1.25)
      : THREE.MathUtils.clamp(startSpherical.phi, 1.05, 1.30);

    // Azimuth: Maintain current viewing angle with a subtle, graceful drift (+0.16 rad ~ 9°)
    // in the direction of turntable rotation, completely avoiding harsh 180° camera spins!
    const endTheta = startSpherical.theta + 0.16;

    // Temporarily pause auto-rotate during transition to eliminate trajectory fighting
    controls.autoRotate = false;
    controls.autoRotateSpeed = 0;

    if (view === "engine") {
      // Zoom into engine bay: reveal engine with opacity at 0, prepare airframe for cross-dissolve
      if (airframeModelRef.current && engineModelRef.current) {
        airframeModelRef.current.setVisible(true);
        airframeModelRef.current.setDissolveFactor(1.0);
        engineModelRef.current.group.visible = true;
        engineModelRef.current.setOpacity(0.0);
        engineModelRef.current.setRevealScale(0.95);
        engineModelRef.current.setRenderMode(renderMode);
      }

      transitionRef.current = {
        active: true,
        progress: 0,
        duration: 1.8, // 1.8s luxurious cinematic glide
        direction: "to_engine",
        startRadius: startSpherical.radius,
        endRadius: endRadius,
        startPhi: startSpherical.phi,
        endPhi: endPhi,
        startTheta: startSpherical.theta,
        endTheta: endTheta,
        startTarget: startTarget,
        endTarget: targetEndLookAt,
        onComplete: () => {
          if (airframeModelRef.current) {
            airframeModelRef.current.setVisible(false);
          }
          if (engineModelRef.current) {
            engineModelRef.current.setOpacity(1.0);
            engineModelRef.current.setRevealScale(1.0);
          }
          controls.target.copy(targetEndLookAt);
          controls.autoRotate = autoRotate;
          controls.autoRotateSpeed = 0; // Accelerates smoothly from 0 in animate()
        },
      };
    } else {
      // Zoom out to complete airframe with smooth cross-dissolve
      if (airframeModelRef.current && engineModelRef.current) {
        airframeModelRef.current.setVisible(true);
        airframeModelRef.current.setDissolveFactor(0.0);
        airframeModelRef.current.setRenderMode(renderMode);
        airframeModelRef.current.setXRay(isXRay);
        engineModelRef.current.group.visible = true;
        engineModelRef.current.setOpacity(1.0);
      }

      transitionRef.current = {
        active: true,
        progress: 0,
        duration: 1.8, // 1.8s luxurious cinematic glide
        direction: "to_airframe",
        startRadius: startSpherical.radius,
        endRadius: endRadius,
        startPhi: startSpherical.phi,
        endPhi: endPhi,
        startTheta: startSpherical.theta,
        endTheta: endTheta,
        startTarget: startTarget,
        endTarget: targetEndLookAt,
        onComplete: () => {
          if (engineModelRef.current) {
            engineModelRef.current.group.visible = false;
          }
          if (airframeModelRef.current) {
            airframeModelRef.current.setDissolveFactor(1.0);
          }
          controls.target.copy(targetEndLookAt);
          controls.autoRotate = autoRotate;
          controls.autoRotateSpeed = 0; // Accelerates smoothly from 0 in animate()
        },
      };
    }
  };

  const handleModeChange = (mode: RenderMode) => {
    setRenderMode(mode);
    if (isXRay) {
      setIsXRay(false);
      airframeModelRef.current?.setXRay(false);
    }
    if (engineModelRef.current) {
      engineModelRef.current.setRenderMode(mode);
    }
    if (airframeModelRef.current) {
      airframeModelRef.current.setRenderMode(mode);
    }
  };

  const handleToggleXRay = () => {
    setIsXRay((prev) => {
      const next = !prev;
      if (airframeModelRef.current) {
        airframeModelRef.current.setXRay(next);
      }
      return next;
    });
  };

  const isAirborne = Boolean(
    isFlightActive &&
    frame &&
    frame.phase &&
    frame.phase !== "idle" &&
    frame.phase !== "ground"
  );

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
            LOADING 3D DIGITAL TWIN...
          </div>
        </div>
      )}

      {/* Clean CAD Viewport Controls */}
      <div className="hud-tactical-reticle-overlay">
        {/* Top-Left Acquisition Tag */}
        <div className="hud-corner-tag hud-tl">
          <span className="hud-live-tag" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            {modelView === "airframe" ? "DRDO UAV AIRFRAME TWIN" : "ROTAX 915 iS DIGITAL TWIN"}
            {modelView === "airframe" && (
              <span
                style={{
                  fontSize: "10px",
                  padding: "1px 6px",
                  borderRadius: "2px",
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  backgroundColor: isAirborne ? "rgba(16, 185, 129, 0.2)" : "rgba(245, 158, 11, 0.2)",
                  color: isAirborne ? "#34d399" : "#fbbf24",
                  border: `1px solid ${isAirborne ? "rgba(16, 185, 129, 0.4)" : "rgba(245, 158, 11, 0.4)"}`,
                }}
              >
                {isAirborne ? "● AIRBORNE SORTIE" : "○ GROUND STANDBY"}
              </span>
            )}
          </span>
          <span className="hud-callout">
            {modelView === "airframe"
              ? isAirborne
                ? "ALTITUDE CRUISE // RETRACTED GEAR // OPERATIONAL SORTIE"
                : "LAUNCH PAD REPOS // LANDING GEAR DEPLOYED // PRE-FLIGHT STANDBY"
              : "4-CYL TURBOCHARGED BOXER // FADEC DUAL-CHANNEL"}
          </span>
        </div>

        {/* Top-Right Mode Selector & Shading Tools */}
        <div className="hud-controls-top-right">
          {/* Primary Model Switcher */}
          <div className="render-mode-group">
            <button
              type="button"
              className={`btn-hud-mode btn-hud-asset ${modelView === "airframe" ? "active" : ""}`}
              onClick={() => handleModelViewChange("airframe")}
              title="Inspect Complete Aircraft Airframe"
            >
              UAV AIRFRAME
            </button>
            <button
              type="button"
              className={`btn-hud-mode btn-hud-asset ${modelView === "engine" ? "active" : ""}`}
              onClick={() => handleModelViewChange("engine")}
              title="Inspect Rotax 915 iS Propulsion Twin"
            >
              ENGINE TWIN
            </button>
          </div>

          {/* Shading / Visual Style Group */}
          <div className="render-mode-group">
            <button
              type="button"
              className={`btn-hud-mode ${renderMode === "tactical" && !isXRay ? "active" : ""}`}
              onClick={() => {
                if (isXRay) {
                  setIsXRay(false);
                  airframeModelRef.current?.setXRay(false);
                }
                handleModeChange("tactical");
              }}
            >
              SOLID CAD
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
            {modelView === "airframe" && (
              <button
                type="button"
                className={`btn-hud-mode ${isXRay ? "active" : ""}`}
                style={isXRay ? { borderColor: "#06b6d4", color: "#67e8f9", boxShadow: "0 0 8px rgba(6, 182, 212, 0.4)" } : {}}
                onClick={handleToggleXRay}
                title="Toggle Airframe Internal Subsystems X-Ray View"
              >
                X-RAY INTERNALS
              </button>
            )}
          </div>
        </div>

        {/* Bottom Corner Control Hints */}
        <div className="hud-corner-tag hud-bl">
          <span>
            {modelView === "airframe"
              ? isXRay
                ? "DIAGNOSTIC X-RAY ACTIVE // AVIONICS • FUEL CELL • ROTAX CORE • OIL TANK • RADIATORS • WING SPARS"
                : "COMPOSITE CARBON AIRFRAME // V-TAIL DUAL RUDDERS // ROTAX ENGINE BAY"
              : "DRY-SUMP OIL // INTERCOOLED TURBO // DUAL FADEC"}
          </span>
        </div>
        <div className="hud-corner-tag hud-br">
          <span>ROTATE: DRAG | ZOOM: SCROLL | PAN: RIGHT-CLICK</span>
        </div>
      </div>
    </div>
  );
}
