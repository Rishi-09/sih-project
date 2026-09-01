"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EngineModel } from "./EngineModel";
import { ParticleEffectsManager } from "./ParticleEffects";
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
  const particlesRef = useRef<ParticleEffectsManager | null>(null);
  const faultHighlighterRef = useRef<FaultHighlighter | null>(null);
  const scanlineRef = useRef<ScanlineEffect | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);

  // Update engine model materials when frame changes
  useEffect(() => {
    if (engineModelRef.current) {
      engineModelRef.current.updateFromFrame(frame);
    }
  }, [frame]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // 1. Scene setup
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0e1418, 0.08);

    // 2. Camera setup
    const width = container.clientWidth || 800;
    const height = container.clientHeight || 500;
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    camera.position.set(4.5, 2.5, 4.5);

    // 3. WebGL Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    container.appendChild(renderer.domElement);

    // 4. OrbitControls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxDistance = 15;
    controls.minDistance = 2;
    controls.autoRotate = autoRotate;
    controls.autoRotateSpeed = 0.5;
    controlsRef.current = controls;

    // 5. Lighting (Holographic Cyberpunk aesthetic)
    const ambientLight = new THREE.AmbientLight(0x183442, 1.5);
    scene.add(ambientLight);

    const cyanLight = new THREE.DirectionalLight(0x54c6d1, 2.5);
    cyanLight.position.set(5, 8, 5);
    scene.add(cyanLight);

    const blueBackLight = new THREE.DirectionalLight(0x1e5077, 2.0);
    blueBackLight.position.set(-5, -3, -5);
    scene.add(blueBackLight);

    const centerPointLight = new THREE.PointLight(0x54c6d1, 1.5, 6);
    centerPointLight.position.set(0, 0, 0);
    scene.add(centerPointLight);

    // 6. Holographic Floor Grid
    const gridHelper = new THREE.GridHelper(8, 24, 0x54c6d1, 0x162c38);
    gridHelper.position.y = -1.5;
    scene.add(gridHelper);

    // 7. Engine Model
    const engineModel = new EngineModel();
    scene.add(engineModel.group);
    engineModelRef.current = engineModel;

    // 8. Particle Effects Manager
    const particles = new ParticleEffectsManager(
      engineModel.cylinderExhaustPorts,
      engineModel.oilLineNodes,
      engineModel.coolantNodes
    );
    scene.add(particles.group);
    particlesRef.current = particles;

    // 9. Fault Highlighter
    const faultHighlighter = new FaultHighlighter(engineModel.components);
    faultHighlighterRef.current = faultHighlighter;

    // 10. Scanline Effect
    const scanline = new ScanlineEffect();
    scene.add(scanline.mesh);
    scanlineRef.current = scanline;

    // 11. Animation loop
    const clock = new THREE.Clock();
    let animationFrameId: number;

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      const delta = clock.getDelta();

      controls.update();

      if (particlesRef.current) {
        particlesRef.current.update(delta, frame);
      }
      if (faultHighlighterRef.current) {
        faultHighlighterRef.current.update(delta, frame);
      }
      if (scanlineRef.current) {
        scanlineRef.current.update(delta);
      }

      renderer.render(scene, camera);
    };

    animate();

    // 12. Responsive Resize
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
      renderer.dispose();
    };
  }, []);

  return (
    <div className="holo-canvas-wrapper" style={{ position: "relative", width: "100%", height: "100%", minHeight: "450px" }}>
      <div ref={containerRef} style={{ width: "100%", height: "100%", position: "absolute", top: 0, left: 0 }} />
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
