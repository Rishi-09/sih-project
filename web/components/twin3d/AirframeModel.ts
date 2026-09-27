import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { HologramMaterialFactory, HoloMaterial, RenderMode } from "./HologramMaterials";
import { TickFrame } from "@/lib/types";

export interface AirframeComponentRef {
  mesh: THREE.Object3D;
  subsystem: string;
  name: string;
  nominalPos: THREE.Vector3;
}

export class AirframeModel {
  public group: THREE.Group;
  public flightRoot: THREE.Group; // Group that animates elevation, pitch, and roll
  public groundPlatform: THREE.Group; // Static ground launch pad
  public isLoaded: boolean = false;
  public isAirborne: boolean = false;

  private matFactory: HologramMaterialFactory;
  private onLoadedCallbacks: Array<() => void> = [];
  private shellMaterials: HoloMaterial[] = [];
  private internalMaterials: Map<string, HoloMaterial[]> = new Map();
  public components: AirframeComponentRef[] = [];

  // Animated elements
  private navLightLeft: THREE.PointLight | null = null;
  private navLightRight: THREE.PointLight | null = null;
  private strobeLightTail: THREE.PointLight | null = null;
  private strobeMeshTail: THREE.Mesh | null = null;

  // Subsystem fault warning hazard rings
  private faultRings: Map<string, THREE.Mesh> = new Map();

  // Animation & Transition timing
  // Exact ground surface alignment: GLB tires lowest point is y = -0.5015.
  // Pad surface is at y = -1.166. Setting flightRoot to -0.665 places tire contact point at exactly -1.1665!
  private animTime: number = 0;
  private currentElevation: number = -0.665; // Tires resting perfectly on platform surface
  private targetElevation: number = -0.665;
  private currentMode: RenderMode = "tactical";
  private isXRay: boolean = false;

  // Ultra-Smooth Flight & Dissolve Dynamics
  private flightBlend: number = 0; // 0.0 = Ground Standby, 1.0 = Cruising Altitude
  private targetFlightBlend: number = 0;
  private wasAirborne: boolean = false;
  private touchdownTimer: number = 0;
  private currentShellOpacity: number = 0.65;
  private targetShellOpacity: number = 0.65;
  private dissolveMultiplier: number = 1.0;
  private targetDissolveMultiplier: number = 1.0;

  constructor(onLoad?: () => void) {
    this.group = new THREE.Group();
    this.group.name = "UAV_Airframe_System";

    // Flight root for aircraft position/attitude
    this.flightRoot = new THREE.Group();
    this.flightRoot.name = "Airframe_Flight_Root";
    this.flightRoot.position.y = this.currentElevation;
    this.group.add(this.flightRoot);

    // Ground platform pad (fixed to the ground plane)
    this.groundPlatform = this.createGroundPlatform();
    this.group.add(this.groundPlatform);

    this.matFactory = HologramMaterialFactory.getInstance();
    if (onLoad) {
      this.onLoadedCallbacks.push(onLoad);
    }
    this.loadModel();
  }

  public onLoaded(callback: () => void) {
    if (this.isLoaded) {
      callback();
    } else {
      this.onLoadedCallbacks.push(callback);
    }
  }

  private createGroundPlatform(): THREE.Group {
    const pad = new THREE.Group();
    pad.name = "Military_Launch_Platform";
    pad.position.y = -1.2;

    // Heavy reinforced concrete/composite hexagonal pad
    const padGeo = new THREE.CylinderGeometry(2.6, 2.7, 0.06, 6);
    const padMat = new THREE.MeshStandardMaterial({
      color: 0x111914,
      roughness: 0.85,
      metalness: 0.25,
      emissive: 0x08100c,
      emissiveIntensity: 0.2,
      transparent: true,
      depthWrite: true,
      opacity: 1.0,
    });
    const padMesh = new THREE.Mesh(padGeo, padMat);
    padMesh.receiveShadow = true;
    pad.add(padMesh);

    // Inner landing target circle
    const ringGeo = new THREE.RingGeometry(1.6, 1.66, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.45,
    });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.rotation.x = -Math.PI / 2;
    ringMesh.position.y = 0.035;
    pad.add(ringMesh);

    // Centerline runway alignment dashed line
    const lineGeo = new THREE.PlaneGeometry(0.08, 4.0);
    const lineMat = new THREE.MeshBasicMaterial({
      color: 0xd4af37,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.6,
    });
    const lineMesh = new THREE.Mesh(lineGeo, lineMat);
    lineMesh.rotation.x = -Math.PI / 2;
    lineMesh.position.y = 0.036;
    pad.add(lineMesh);

    // Perimeter tactical guidance LED beacons
    for (let i = 0; i < 6; i++) {
      const angle = (i * Math.PI) / 3;
      const x = Math.cos(angle) * 2.45;
      const z = Math.sin(angle) * 2.45;

      const lightGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.05, 12);
      const lightMat = new THREE.MeshBasicMaterial({ color: 0x34d399, transparent: true, opacity: 1.0 });
      const lightMesh = new THREE.Mesh(lightGeo, lightMat);
      lightMesh.position.set(x, 0.04, z);
      pad.add(lightMesh);

      const pLight = new THREE.PointLight(0x34d399, 0.3, 1.2);
      pLight.position.set(x, 0.08, z);
      pLight.userData = { baseIntensity: 0.3 };
      pad.add(pLight);
    }

    return pad;
  }

  private loadModel() {
    const loader = new GLTFLoader();
    loader.load(
      "/models/uav_airframe.glb",
      (gltf) => {
        this.processModel(gltf.scene);
        this.isLoaded = true;
        this.onLoadedCallbacks.forEach((cb) => cb());
      },
      undefined,
      (error) => {
        console.error("Error loading UAV Airframe GLB model:", error);
      }
    );
  }

  private processModel(scene: THREE.Group) {
    // 1. Calculate raw bounding box
    const box = new THREE.Box3().setFromObject(scene);
    const size = new THREE.Vector3();
    box.getSize(size);
    const center = new THREE.Vector3();
    box.getCenter(center);

    // 2. Center geometry
    scene.position.sub(center);

    // 3. Normalise scale (target wingspan ~4.2 units to frame cleanly in the 3D viewport)
    const maxDim = Math.max(size.x, size.y, size.z);
    const targetScale = maxDim > 0 ? 4.2 / maxDim : 1;
    scene.scale.set(targetScale, targetScale, targetScale);

    // 4. Orientation: Y was long axis, Z was height -> pitch -90° around X
    if (size.y > size.z) {
      scene.rotation.x = -Math.PI / 2;
    }

    // 5. Traverse meshes and apply high-definition holographic translucent composite skin
    scene.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        mesh.castShadow = true;
        mesh.receiveShadow = true;

        const holoMat = this.createAirframeShellMaterial(mesh.name);
        mesh.material = holoMat;
        this.shellMaterials.push(holoMat);
      }
    });

    this.flightRoot.add(scene);

    // 6. Build Deep Internal Subsystems inside the airframe
    this.buildInternalSubsystems();

    // 7. Build Navigation & Strobe Lights
    this.buildNavigationLights();

    // 10. Build Subsystem Fault Rings
    this.buildFaultRings();
  }

  private createAirframeShellMaterial(_nodeName: string): HoloMaterial {
    // Translucent holographic carbon composite skin
    const holo = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0x131f18),
      metalness: 0.88,
      roughness: 0.32,
      emissive: new THREE.Color(0x062820),
      emissiveIntensity: 0.22,
      transparent: true,
      opacity: 0.65, // Translucent so internal components are visible inside!
      wireframe: this.currentMode === "wireframe",
      depthWrite: true,
    }) as HoloMaterial;

    holo.userData = {
      subsystem: "airframe_shell",
      baseColor: new THREE.Color(0x131f18),
      baseEmissive: new THREE.Color(0x062820),
      rimColor: { value: new THREE.Color(0x38bdf8) },
      rimStrength: { value: 1.5 },
    };

    holo.onBeforeCompile = (shader) => {
      shader.uniforms.uRimColor = holo.userData.rimColor;
      shader.uniforms.uRimStrength = holo.userData.rimStrength;

      shader.fragmentShader = shader.fragmentShader
        .replace(
          "void main() {",
          `uniform vec3 uRimColor;
           uniform float uRimStrength;
           void main() {`
        )
        .replace(
          "#include <opaque_fragment>",
          `float rimFacing = clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
           outgoingLight += uRimColor * pow(1.0 - rimFacing, 3.0) * uRimStrength;
           #include <opaque_fragment>`
        );
    };

    return holo;
  }

  private createSubsystemMaterial(subsystem: string, baseColor: number, emissiveColor: number): HoloMaterial {
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(baseColor),
      metalness: 0.9,
      roughness: 0.25,
      emissive: new THREE.Color(emissiveColor),
      emissiveIntensity: 0.35,
      wireframe: this.currentMode === "wireframe",
      transparent: true,
      depthWrite: true,
      opacity: 1.0,
    }) as HoloMaterial;

    mat.userData = {
      subsystem,
      baseColor: new THREE.Color(baseColor),
      baseEmissive: new THREE.Color(emissiveColor),
      rimColor: { value: new THREE.Color(baseColor) },
      rimStrength: { value: 1.2 },
    };

    if (!this.internalMaterials.has(subsystem)) {
      this.internalMaterials.set(subsystem, []);
    }
    this.internalMaterials.get(subsystem)!.push(mat);

    return mat;
  }

  private buildInternalSubsystems() {
    // ── 1. AVIONICS BAY & RADOME (subsystem: "electrical") ──
    const avionicsGroup = new THREE.Group();
    avionicsGroup.name = "Avionics_Flight_Control_System";
    avionicsGroup.position.set(0, 0.06, 0.92);

    const rackGeo = new THREE.BoxGeometry(0.24, 0.16, 0.36);
    const avionicsMat = this.createSubsystemMaterial("electrical", 0x38bdf8, 0x0284c7);
    const rackMesh = new THREE.Mesh(rackGeo, avionicsMat);
    avionicsGroup.add(rackMesh);

    // Forward EO/IR payload optical turret underneath the nose
    const turretGeo = new THREE.SphereGeometry(0.11, 16, 16);
    const turretMesh = new THREE.Mesh(turretGeo, avionicsMat);
    turretMesh.position.set(0, -0.16, 0.22);
    avionicsGroup.add(turretMesh);

    // Avionics status light
    const avionicsLight = new THREE.PointLight(0x38bdf8, 0.6, 1.2);
    avionicsLight.position.set(0, 0.08, 0);
    avionicsGroup.add(avionicsLight);

    this.flightRoot.add(avionicsGroup);
    this.components.push({
      mesh: avionicsGroup,
      subsystem: "electrical",
      name: "Avionics & Flight Control (FCS)",
      nominalPos: avionicsGroup.position.clone(),
    });

    // ── 2. INTERNAL FUEL CELL (subsystem: "induction_fuel") ──
    const fuelGroup = new THREE.Group();
    fuelGroup.name = "Internal_Fuselage_Fuel_Cells";
    fuelGroup.position.set(0, 0.04, 0.18);

    const tankGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.64, 16);
    tankGeo.rotateX(Math.PI / 2);
    const fuelMat = this.createSubsystemMaterial("induction_fuel", 0x34d399, 0x059669);
    const tankMesh = new THREE.Mesh(tankGeo, fuelMat);
    fuelGroup.add(tankMesh);

    // Fuel feed lines extending aft toward the engine
    const lineGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.68, 8);
    lineGeo.rotateX(Math.PI / 2);
    const lineMesh = new THREE.Mesh(lineGeo, fuelMat);
    lineMesh.position.set(0.08, -0.04, -0.42);
    fuelGroup.add(lineMesh);

    const fuelLight = new THREE.PointLight(0x34d399, 0.5, 1.2);
    fuelLight.position.set(0, 0.05, 0);
    fuelGroup.add(fuelLight);

    this.flightRoot.add(fuelGroup);
    this.components.push({
      mesh: fuelGroup,
      subsystem: "induction_fuel",
      name: "Fuselage Fuel Cell & Boost Pumps",
      nominalPos: fuelGroup.position.clone(),
    });

    // ── 3. ROTAX 915 iS ENGINE CORE (subsystem: "combustion") ──
    const engineGroup = new THREE.Group();
    engineGroup.name = "Rotax_915_Propulsion_Bay";
    engineGroup.position.set(0, 0.09, -0.66);

    // Boxer 4-cylinder crankcase
    const blockGeo = new THREE.BoxGeometry(0.32, 0.22, 0.36);
    const engineMat = this.createSubsystemMaterial("combustion", 0xf43f5e, 0xbe123c);
    const blockMesh = new THREE.Mesh(blockGeo, engineMat);
    engineGroup.add(blockMesh);

    // Left & Right cylinder heads (Boxer layout)
    const cylGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.14, 12);
    cylGeo.rotateZ(Math.PI / 2);

    const cylL = new THREE.Mesh(cylGeo, engineMat);
    cylL.position.set(-0.21, 0, 0.06);
    engineGroup.add(cylL);

    const cylR = new THREE.Mesh(cylGeo, engineMat);
    cylR.position.set(0.21, 0, 0.06);
    engineGroup.add(cylR);

    // Exhaust headers
    const exhaustGeo = new THREE.TorusGeometry(0.12, 0.022, 8, 16, Math.PI);
    exhaustGeo.rotateX(Math.PI / 2);
    const exhaustMesh = new THREE.Mesh(exhaustGeo, engineMat);
    exhaustMesh.position.set(0, -0.09, 0.08);
    engineGroup.add(exhaustMesh);

    this.flightRoot.add(engineGroup);
    this.components.push({
      mesh: engineGroup,
      subsystem: "combustion",
      name: "Rotax 915 iS Engine Block & Turbo",
      nominalPos: engineGroup.position.clone(),
    });

    // ── 4. DRY SUMP OIL RESERVOIR (subsystem: "lubrication") ──
    const oilGroup = new THREE.Group();
    oilGroup.name = "Dry_Sump_Lubrication_System";
    oilGroup.position.set(-0.19, 0.13, -0.58);

    const oilTankGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.22, 16);
    const oilMat = this.createSubsystemMaterial("lubrication", 0xfbbf24, 0xd97706);
    const oilTank = new THREE.Mesh(oilTankGeo, oilMat);
    oilGroup.add(oilTank);

    const oilLight = new THREE.PointLight(0xfbbf24, 0.4, 0.8);
    oilLight.position.set(0, 0.05, 0);
    oilGroup.add(oilLight);

    this.flightRoot.add(oilGroup);
    this.components.push({
      mesh: oilGroup,
      subsystem: "lubrication",
      name: "Dry Sump Oil Tank & Pump",
      nominalPos: oilGroup.position.clone(),
    });

    // ── 5. COOLING RADIATOR & INTERCOOLER (subsystem: "cooling") ──
    const coolingGroup = new THREE.Group();
    coolingGroup.name = "Cooling_Matrix_Intercooler";
    coolingGroup.position.set(0, -0.08, -0.48);

    const radiatorGeo = new THREE.BoxGeometry(0.28, 0.08, 0.18);
    const coolingMat = this.createSubsystemMaterial("cooling", 0x38bdf8, 0x0284c7);
    const radiatorMesh = new THREE.Mesh(radiatorGeo, coolingMat);
    coolingGroup.add(radiatorMesh);

    // Underbelly air scoop duct
    const scoopGeo = new THREE.ConeGeometry(0.12, 0.22, 4);
    scoopGeo.rotateX(Math.PI / 2);
    const scoopMesh = new THREE.Mesh(scoopGeo, coolingMat);
    scoopMesh.position.set(0, -0.05, 0.1);
    coolingGroup.add(scoopMesh);

    this.flightRoot.add(coolingGroup);
    this.components.push({
      mesh: coolingGroup,
      subsystem: "cooling",
      name: "Intercooler & Liquid Radiators",
      nominalPos: coolingGroup.position.clone(),
    });

    // ── 6. CARBON WING SPARS & FLIGHT ACTUATORS (subsystem: "mechanical") ──
    const wingSparGroup = new THREE.Group();
    wingSparGroup.name = "Wing_Carbon_Spars_Actuators";
    wingSparGroup.position.set(0, 0.03, -0.05);

    // Left and Right main composite spars
    const sparGeo = new THREE.CylinderGeometry(0.024, 0.016, 3.8, 12);
    sparGeo.rotateZ(Math.PI / 2);
    const mechMat = this.createSubsystemMaterial("mechanical", 0xa3e635, 0x65a30d);
    const sparMesh = new THREE.Mesh(sparGeo, mechMat);
    wingSparGroup.add(sparMesh);

    // Left & Right aileron/flap servo actuators
    const servoGeo = new THREE.BoxGeometry(0.06, 0.03, 0.08);
    const servoL = new THREE.Mesh(servoGeo, mechMat);
    servoL.position.set(-1.45, 0, -0.08);
    wingSparGroup.add(servoL);

    const servoR = new THREE.Mesh(servoGeo, mechMat);
    servoR.position.set(1.45, 0, -0.08);
    wingSparGroup.add(servoR);

    this.flightRoot.add(wingSparGroup);
    this.components.push({
      mesh: wingSparGroup,
      subsystem: "mechanical",
      name: "Wing Spar Structure & Aileron Servos",
      nominalPos: wingSparGroup.position.clone(),
    });
  }

  private buildNavigationLights() {
    // Port (Left) wingtip navigation light (RED)
    const navRed = new THREE.PointLight(0xef4444, 0.8, 1.5);
    navRed.position.set(-2.05, 0.06, -0.12);
    navRed.userData = { baseIntensity: 0.8 };
    this.flightRoot.add(navRed);
    this.navLightLeft = navRed;

    // Starboard (Right) wingtip navigation light (GREEN)
    const navGreen = new THREE.PointLight(0x22c55e, 0.8, 1.5);
    navGreen.position.set(2.05, 0.06, -0.12);
    navGreen.userData = { baseIntensity: 0.8 };
    this.flightRoot.add(navGreen);
    this.navLightRight = navGreen;

    // Tail fin anti-collision strobe (WHITE flashing)
    const strobeLight = new THREE.PointLight(0xffffff, 0, 3.0);
    strobeLight.position.set(0, -0.28, -1.05);
    strobeLight.userData = { baseIntensity: 3.5 };
    this.flightRoot.add(strobeLight);
    this.strobeLightTail = strobeLight;

    const strobeGeo = new THREE.SphereGeometry(0.035, 12, 12);
    const strobeMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.2 });
    const strobeMesh = new THREE.Mesh(strobeGeo, strobeMat);
    strobeMesh.position.copy(strobeLight.position);
    this.flightRoot.add(strobeMesh);
    this.strobeMeshTail = strobeMesh;
  }

  private buildFaultRings() {
    // Create glowing tactical hazard rings for each subsystem to pulse when a fault strikes
    const subsystems = ["combustion", "cooling", "lubrication", "induction_fuel", "electrical", "mechanical"];
    const ringGeo = new THREE.RingGeometry(0.18, 0.22, 24);

    for (const sub of subsystems) {
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0xef4444,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.visible = false;

      // Position near corresponding subsystem
      if (sub === "electrical") ring.position.set(0, 0.22, 0.92);
      else if (sub === "induction_fuel") ring.position.set(0, 0.20, 0.18);
      else if (sub === "combustion") ring.position.set(0, 0.25, -0.66);
      else if (sub === "lubrication") ring.position.set(-0.19, 0.26, -0.58);
      else if (sub === "cooling") ring.position.set(0, -0.22, -0.48);
      else if (sub === "mechanical") ring.position.set(0, 0.22, -1.06);

      this.flightRoot.add(ring);
      this.faultRings.set(sub, ring);
    }
  }

  /**
   * Set dissolve factor for smooth cinematic cross-fades (0.0 = fully dissolved, 1.0 = fully visible)
   */
  public setDissolveFactor(factor: number) {
    const clamped = THREE.MathUtils.clamp(factor, 0.0, 1.0);
    this.dissolveMultiplier = clamped;
    this.targetDissolveMultiplier = clamped;

    const effectiveOpacity = this.currentShellOpacity * clamped;
    this.shellMaterials.forEach((mat) => {
      mat.opacity = effectiveOpacity;
      mat.wireframe = this.currentMode === "wireframe" || (this.isXRay && effectiveOpacity < 0.35);
    });

    this.internalMaterials.forEach((mats) => {
      mats.forEach((mat) => {
        mat.opacity = clamped;
      });
    });

    // Dim navigation lights in sync with dissolve
    if (this.navLightLeft) {
      const base = this.navLightLeft.userData.baseIntensity ?? 0.8;
      this.navLightLeft.intensity = base * clamped;
    }
    if (this.navLightRight) {
      const base = this.navLightRight.userData.baseIntensity ?? 0.8;
      this.navLightRight.intensity = base * clamped;
    }
    if (this.strobeLightTail) {
      const base = this.strobeLightTail.userData.baseIntensity ?? 3.5;
      this.strobeLightTail.intensity = base * clamped;
    }

    // Dim ground platform meshes and perimeter guidance lights
    this.groundPlatform.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const m = (child as THREE.Mesh).material as THREE.MeshStandardMaterial | THREE.MeshBasicMaterial;
        if (m) {
          m.opacity = clamped;
        }
      } else if ((child as THREE.PointLight).isPointLight) {
        const pl = child as THREE.PointLight;
        const base = pl.userData.baseIntensity ?? 0.3;
        pl.intensity = base * clamped;
      }
    });
  }

  /**
   * Main animation and telemetry update called every render frame
   */
  public update(delta: number, frame: TickFrame | null, isFlightActive: boolean = false) {
    this.animTime += delta;

    // 1. Determine Flight State (Sortie Active / Airborne vs. Platform Parked)
    const isSortieLive = Boolean(isFlightActive && frame && frame.phase && frame.phase !== "idle" && frame.phase !== "ground");
    this.isAirborne = isSortieLive;
    this.targetFlightBlend = isSortieLive ? 1.0 : 0.0;

    // 2. Smooth Flight Phase Transition (Takeoff Climb / Approach Flare / Touchdown)
    // S-curve rate (~3.3s takeoff climb, ~3.5s landing approach)
    const blendRate = isSortieLive ? 0.30 : 0.28;
    if (this.flightBlend < this.targetFlightBlend) {
      this.flightBlend = Math.min(this.targetFlightBlend, this.flightBlend + delta * blendRate);
    } else if (this.flightBlend > this.targetFlightBlend) {
      this.flightBlend = Math.max(this.targetFlightBlend, this.flightBlend - delta * blendRate);
    }

    // Smootherstep (Ken Perlin's 5th order polynomial for zero start & end jerk)
    const t = this.flightBlend;
    const smoothB = t * t * t * (t * (t * 6 - 15) + 10);
    const groundElevation = -0.665;
    const cruiseElevation = 0.35;
    let targetY = groundElevation + (cruiseElevation - groundElevation) * smoothB;

    // Aerodynamic Pitch Dynamics during climb & flare
    let aerodynamicPitch = 0;
    if (isSortieLive && this.flightBlend < 0.95) {
      // Takeoff climb-out: realistic nose-up pitch (+2.8° = +0.048 rad)
      const climbCurve = Math.sin(this.flightBlend * Math.PI);
      aerodynamicPitch = climbCurve * 0.048;
    } else if (!isSortieLive && this.flightBlend > 0.05) {
      // Approach & landing flare: gentle nose-up cushion (+1.5° = +0.026 rad)
      const flareCurve = Math.sin((1.0 - this.flightBlend) * Math.PI);
      aerodynamicPitch = flareCurve * 0.026;
    }

    // Touchdown pneumatic suspension settle (critically damped shock absorber)
    if (!isSortieLive && this.flightBlend <= 0.001) {
      if (this.wasAirborne) {
        this.touchdownTimer += delta;
        if (this.touchdownTimer < 0.75) {
          const bounce = Math.exp(-this.touchdownTimer * 6.5) * Math.sin(this.touchdownTimer * 16.0) * 0.004;
          targetY += bounce;
        } else {
          this.wasAirborne = false;
          this.touchdownTimer = 0;
        }
      }
    } else if (isSortieLive) {
      this.wasAirborne = true;
      this.touchdownTimer = 0;
    }

    this.currentElevation = targetY;
    this.flightRoot.position.y = targetY;

    // 3. Flight Turbulence / Aerodynamic Micro-banking (smoothly scales with altitude)
    const turbFactor = Math.pow(this.flightBlend, 1.8);
    if (turbFactor > 0.001) {
      const roll = Math.sin(this.animTime * 1.25) * 0.022 * turbFactor;
      const pitch = aerodynamicPitch + Math.cos(this.animTime * 0.75) * 0.010 * turbFactor;
      const yaw = Math.sin(this.animTime * 0.45) * 0.007 * turbFactor;

      this.flightRoot.rotation.z = roll;
      this.flightRoot.rotation.x = pitch;
      this.flightRoot.rotation.y = yaw;
    } else {
      this.flightRoot.rotation.set(aerodynamicPitch, 0, 0);
    }

    // 4. Smooth Shell Opacity
    this.currentShellOpacity = THREE.MathUtils.damp(this.currentShellOpacity, this.targetShellOpacity, 7.0, delta);
    const effectiveOpacity = this.currentShellOpacity * this.dissolveMultiplier;

    this.shellMaterials.forEach((mat) => {
      mat.opacity = effectiveOpacity;
      mat.wireframe = this.currentMode === "wireframe" || (this.isXRay && effectiveOpacity < 0.35);
    });

    this.internalMaterials.forEach((mats) => {
      mats.forEach((mat) => {
        mat.opacity = this.dissolveMultiplier;
      });
    });

    // 5. Navigation & Strobe Lights
    if (this.dissolveMultiplier > 0.05) {
      if (this.navLightLeft && this.navLightRight) {
        const lightTarget = (isSortieLive ? 0.9 : 0.2) * this.dissolveMultiplier;
        this.navLightLeft.intensity = THREE.MathUtils.lerp(this.navLightLeft.intensity, lightTarget, delta * 3.0);
        this.navLightRight.intensity = THREE.MathUtils.lerp(this.navLightRight.intensity, lightTarget, delta * 3.0);
      }
      if (this.strobeLightTail && this.strobeMeshTail) {
        // 1.2s flash strobe
        const strobeCycle = this.animTime % 1.2;
        const isFlash = isSortieLive && strobeCycle < 0.08;
        this.strobeLightTail.intensity = (isFlash ? 3.5 : 0) * this.dissolveMultiplier;
        (this.strobeMeshTail.material as THREE.MeshBasicMaterial).opacity = (isFlash ? 1.0 : 0.1) * this.dissolveMultiplier;
      }
    }

    // 6. Subsystem Fault Warnings & Hazardous Component Pulsing
    this.updateFaultWarnings(frame);
  }

  private updateFaultWarnings(frame: TickFrame | null) {
    const faultedSubsystems = new Set<string>();

    if (frame?.injectedFaults && Array.isArray(frame.injectedFaults)) {
      for (const f of frame.injectedFaults) {
        if (f.includes("cool")) faultedSubsystems.add("cooling");
        if (f.includes("lubric") || f.includes("oil")) faultedSubsystems.add("lubrication");
        if (f.includes("fuel") || f.includes("inject")) faultedSubsystems.add("induction_fuel");
        if (f.includes("ignit") || f.includes("cyl")) faultedSubsystems.add("combustion");
        if (f.includes("induct")) faultedSubsystems.add("induction_fuel");
        if (f.includes("bear") || f.includes("mech")) faultedSubsystems.add("mechanical");
        if (f.includes("elect") || f.includes("sensor")) faultedSubsystems.add("electrical");
      }
    }

    // Check sensor thresholds
    if (frame?.sensors) {
      if (frame.sensors.coolant_temp_c > 115) faultedSubsystems.add("cooling");
      if (frame.sensors.oil_temp_c > 125 || frame.sensors.oil_pressure_bar < 1.2) faultedSubsystems.add("lubrication");
    }

    const isAnyFault = faultedSubsystems.size > 0;
    const pulse = isAnyFault ? (Math.sin(this.animTime * 7.0) + 1.0) * 0.5 : 0;

    // Pulse hazard rings
    this.faultRings.forEach((ring, sub) => {
      const isFault = faultedSubsystems.has(sub);
      ring.visible = isFault;
      if (isFault) {
        (ring.material as THREE.MeshBasicMaterial).opacity = 0.4 + pulse * 0.6;
        ring.scale.setScalar(1.0 + pulse * 0.25);
      }
    });

    // Pulse internal subsystem materials
    this.internalMaterials.forEach((mats, sub) => {
      const isFault = faultedSubsystems.has(sub);
      mats.forEach((mat) => {
        if (isFault) {
          mat.emissive.setHex(0xef4444);
          mat.emissiveIntensity = 0.4 + pulse * 0.6;
        } else {
          mat.emissive.copy(mat.userData.baseEmissive);
          mat.emissiveIntensity = 0.35;
        }
      });
    });
  }

  public setXRay(enabled: boolean) {
    this.isXRay = enabled;
    this.targetShellOpacity = enabled ? 0.20 : 0.65;
  }

  public setRenderMode(mode: RenderMode) {
    this.currentMode = mode;
    this.shellMaterials.forEach((mat) => {
      if (mode === "wireframe") {
        mat.wireframe = true;
        mat.emissive.setHex(0x38bdf8);
        mat.emissiveIntensity = 0.5;
      } else if (mode === "flir_thermal") {
        mat.wireframe = false;
        mat.color.setHex(0x1e3a8a);
        mat.emissive.setHex(0x0284c7);
        mat.emissiveIntensity = 0.4;
      } else {
        mat.wireframe = this.isXRay;
        mat.color.setHex(0x131f18);
        mat.emissive.setHex(0x062820);
        mat.emissiveIntensity = 0.22;
      }
    });

    this.internalMaterials.forEach((mats) => {
      mats.forEach((mat) => {
        mat.wireframe = mode === "wireframe";
      });
    });
  }

  public setVisible(visible: boolean) {
    this.group.visible = visible;
  }

  public dispose() {
    this.shellMaterials.forEach((m) => m.dispose());
    this.internalMaterials.forEach((mats) => mats.forEach((m) => m.dispose()));
  }
}
