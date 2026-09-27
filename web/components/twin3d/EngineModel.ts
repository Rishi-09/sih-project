import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { HologramMaterialFactory, HoloMaterial, RenderMode } from "./HologramMaterials";
import { TickFrame } from "@/lib/types";

export interface EngineComponentRef {
  mesh: THREE.Mesh;
  subsystem: string;
  componentName: string;
  cylinderIndex?: number;
}

interface Mapping {
  subsystem: string;
  name: string;
}

/**
 * Node-level mapping. Keys are normalised (lowercase, non-alphanumerics stripped)
 * so they survive the FBX -> glTF round trip, which turns "Air baffles" into
 * "Air_baffles" or "Air baffles" depending on the exporter.
 */
const NODE_MAP: Record<string, Mapping> = {
  mainengine: { subsystem: "combustion", name: "Crankcase & Cylinder Assembly" },
  tranny: { subsystem: "mechanical", name: "Propeller Reduction Gearbox" },
  oiltank: { subsystem: "lubrication", name: "Dry Sump Oil Tank" },
  airbaffles: { subsystem: "cooling", name: "Cylinder Air Cooling Baffles" },
  intercooler: { subsystem: "cooling", name: "Turbo Intercooler Matrix" },
  overboostvalve: { subsystem: "induction_fuel", name: "Turbo Overboost Wastegate" },
  magnetovalve: { subsystem: "induction_fuel", name: "Solenoid Magneto Valve" },
  ecu: { subsystem: "electrical", name: "Dual FADEC ECU Module" },
  fusebox: { subsystem: "electrical", name: "Electrical Fuse & Power Box" },
  ambientsensor: { subsystem: "electrical", name: "Ambient MAP / MAT Sensor" },
};

/**
 * The "Main engine" node is a single 1.6M-triangle mesh split only by material,
 * so material name is the only handle on what each surface actually is. Applied
 * to that node alone: "Metal shinier" means the gearbox housing inside Tranny,
 * but a rocker cover inside the block.
 */
const MAIN_ENGINE_MATERIAL_MAP: Array<[RegExp, Mapping]> = [
  [/exhaust/i, { subsystem: "combustion", name: "Exhaust Manifold Headers" }],
  [/enamel blue/i, { subsystem: "combustion", name: "Ignition Coil Covers" }],
  [/hose|hoes/i, { subsystem: "induction_fuel", name: "Coolant & Intake Hoses" }],
  [/sheath/i, { subsystem: "electrical", name: "Engine Wiring Harness" }],
  [/bearing/i, { subsystem: "mechanical", name: "Crankshaft Bearings" }],
  [/bolt|clamp/i, { subsystem: "mechanical", name: "Fasteners & Clamps" }],
  [/plastic black soft/i, { subsystem: "induction_fuel", name: "Intake Ducting" }],
];

export class EngineModel {
  public group: THREE.Group;
  public components: EngineComponentRef[] = [];
  public isLoaded: boolean = false;
  private matFactory: HologramMaterialFactory;
  private onLoadedCallbacks: Array<() => void> = [];
  private lastFrame: TickFrame | null = null;
  private mountStruts: THREE.Mesh[] = [];
  private strutMaterial: THREE.MeshStandardMaterial | null = null;

  constructor(onLoad?: () => void) {
    this.group = new THREE.Group();
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

  private loadModel() {
    const loader = new GLTFLoader();
    // Asset ships meshopt-compressed (EXT_meshopt_compression); see
    // tools/build-engine-model.mjs for the FBX -> GLB pipeline.
    loader.setMeshoptDecoder(MeshoptDecoder);

    loader.load(
      "/models/Rotax_915.glb",
      (gltf) => {
        this.processModel(gltf.scene);
        this.isLoaded = true;
        if (this.lastFrame) {
          this.updateFromFrame(this.lastFrame);
        }
        this.onLoadedCallbacks.forEach((cb) => cb());
      },
      undefined,
      (error) => {
        console.error("Error loading Rotax 915 GLB model:", error);
      }
    );
  }

  private processModel(scene: THREE.Group) {
    const disposable: THREE.Material[] = [];

    scene.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;

      const nodeName = this.resolveNodeName(child);
      const srcMaterial = child.material as THREE.MeshStandardMaterial;
      const mapping = this.mapMesh(nodeName, srcMaterial?.name ?? "");

      child.material = this.matFactory.fromSource(srcMaterial, mapping.subsystem);
      child.castShadow = false;
      child.receiveShadow = false;
      if (srcMaterial) disposable.push(srcMaterial);

      this.registerComponent(child, mapping.subsystem, mapping.name);
    });

    // Source materials are replaced wholesale; release their GPU handles.
    disposable.forEach((m) => m.dispose());

    // Bridge the accessories the asset ships unattached (see addMountStruts).
    this.addMountStruts(scene);

    // Centre and normalise scale
    const bbox = new THREE.Box3().setFromObject(scene);
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    bbox.getCenter(center);
    bbox.getSize(size);

    scene.position.x = -center.x;
    scene.position.y = -center.y;
    scene.position.z = -center.z;

    const pivot = new THREE.Group();
    pivot.add(scene);

    const maxDim = Math.max(size.x, size.y, size.z);
    const scaleFactor = maxDim > 0 ? 3.0 / maxDim : 1.0;
    pivot.scale.setScalar(scaleFactor);

    // Front-quarter presentation angle, matching the reference photo
    pivot.rotation.y = -Math.PI / 4;

    this.group.add(pivot);
  }

  /**
   * Four accessories ship detached from the block: the fuse box (gap 0.039),
   * the overboost wastegate (0.057), the magneto valve (0.122) and the oil tank
   * (0.037) — 4% to 11% of the model's span, which is why they read as parts
   * floating in space rather than as an engine.
   *
   * Those standoffs are real: on a 915 iS installation each of these mounts off
   * the block on a bracket, with hoses or a loom running back to it. What the
   * asset omits is the bracket, so this draws it — a strut from each detached
   * group to the nearest face of the block. It adds the missing mount; it does
   * not move any component, so every part stays where the CAD puts it.
   */
  private addMountStruts(scene: THREE.Group) {
    scene.updateMatrixWorld(true);

    const groups = new Map<string, THREE.Box3>();
    scene.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const key = child.parent?.name || child.name || "?";
      const box = new THREE.Box3().setFromObject(child);
      if (box.isEmpty()) return;
      const existing = groups.get(key);
      if (existing) existing.union(box);
      else groups.set(key, box);
    });

    if (groups.size < 2) return;

    const volume = (b: THREE.Box3) => {
      const s = b.getSize(new THREE.Vector3());
      return s.x * s.y * s.z;
    };
    const sorted = [...groups.entries()].sort((a, b) => volume(b[1]) - volume(a[1]));
    const [, block] = sorted[0];

    const span = block.getSize(new THREE.Vector3()).length();
    const radius = span * 0.006;

    const material = new THREE.MeshStandardMaterial({
      color: 0x55646f,
      metalness: 0.85,
      roughness: 0.45,
    });
    this.strutMaterial = material;

    for (const [name, box] of sorted.slice(1)) {
      if (box.intersectsBox(block)) continue;

      const from = box.getCenter(new THREE.Vector3());
      const to = block.clampPoint(from, new THREE.Vector3());
      const length = from.distanceTo(to);
      if (length <= 1e-4) continue;

      const strut = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 10), material);
      strut.name = `mount_strut_${name}`;
      strut.position.copy(from).lerp(to, 0.5);
      strut.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        to.clone().sub(from).normalize()
      );

      scene.add(strut);
      this.mountStruts.push(strut);
    }
  }

  /** Hide the drawn mounts, for anyone who wants the CAD exactly as shipped. */
  public setMountsVisible(visible: boolean) {
    this.mountStruts.forEach((m) => (m.visible = visible));
  }

  /**
   * glTF gives each material-split primitive its own Mesh under a named parent,
   * so the owning component name lives on an ancestor, not the mesh itself.
   */
  private resolveNodeName(mesh: THREE.Object3D): string {
    let node: THREE.Object3D | null = mesh;
    while (node) {
      if (NODE_MAP[normalize(node.name)]) return node.name;
      node = node.parent;
    }
    return mesh.name;
  }

  private mapMesh(nodeName: string, materialName: string): Mapping {
    const node = NODE_MAP[normalize(nodeName)];

    if (node && normalize(nodeName) === "mainengine") {
      for (const [pattern, mapping] of MAIN_ENGINE_MATERIAL_MAP) {
        if (pattern.test(materialName)) return mapping;
      }
    }

    if (node) return node;

    // Numbered hardware nodes (5608_@OIS@_5081 and friends) are brackets and clamps.
    return { subsystem: "mechanical", name: "Engine Hardware" };
  }

  private registerComponent(
    mesh: THREE.Mesh,
    subsystem: string,
    componentName: string,
    cylinderIndex?: number
  ) {
    this.components.push({
      mesh,
      subsystem,
      componentName,
      cylinderIndex,
    });
  }

  /**
   * Subsystems implicated by a diagnosis label. The exact table covers the fault
   * vocabulary the simulator emits (see FAULT_TYPES in ControlBar); the
   * substring fallback keeps unknown labels from silently highlighting nothing.
   */
  public static faultedSubsystems(rawLabel: string): Set<string> {
    if (!rawLabel) return new Set();
    const label = rawLabel.toLowerCase();

    const exact: Record<string, string[]> = {
      // twin2 catalog (live physics twin)
      turbo_degradation: ["induction_fuel"],
      induction_leak: ["induction_fuel"],
      coolant_restriction: ["cooling"],
      oil_restriction: ["lubrication"],
      weak_cylinder_cyl1: ["combustion", "mechanical"],
      weak_cylinder_cyl2: ["combustion", "mechanical"],
      weak_cylinder_cyl3: ["combustion", "mechanical"],
      weak_cylinder_cyl4: ["combustion", "mechanical"],
      sensor_fault: ["electrical"],
      // older labels (stub fallback compound ids, recorded runs)
      lubrication_degradation: ["lubrication"],
      cooling_failure: ["cooling"],
      ignition_fault_cyl3: ["combustion"],
      induction_loss: ["induction_fuel"],
      fuel_system_degradation: ["induction_fuel"],
      bearing_wear: ["mechanical"],
      injector_fault_cyl3: ["induction_fuel", "combustion"],
      electrical_degradation: ["electrical"],
      sensor_freeze_coolant: ["electrical", "cooling"],
      sensor_drift_oilpress: ["electrical", "lubrication"],
    };

    if (exact[label]) return new Set(exact[label]);

    const out = new Set<string>();

    const parts = rawLabel.toLowerCase().split(/[+,;&]/);
    for (const part of parts) {
      const label = part.trim();
      if (!label || label === "healthy" || label === "nominal" || label === "assessing") continue;

      const exact: Record<string, string[]> = {
        lubrication_degradation: ["lubrication"],
        oil_leak: ["lubrication"],
        oil_pump_wear: ["lubrication"],
        cooling_failure: ["cooling"],
        cooling_leak: ["cooling"],
        radiator_blockage: ["cooling"],
        overheat: ["cooling"],
        ignition_fault_cyl3: ["combustion"],
        spark_plug_wear: ["combustion"],
        misfire: ["combustion"],
        induction_loss: ["induction_fuel"],
        manifold_leak: ["induction_fuel"],
        turbo_wastegate_stuck: ["induction_fuel"],
        fuel_system_degradation: ["induction_fuel"],
        fuel_pump_wear: ["induction_fuel"],
        fuel_filter_clog: ["induction_fuel"],
        bearing_wear: ["mechanical"],
        mechanical_wear: ["mechanical"],
        injector_fault_cyl3: ["induction_fuel", "combustion"],
        injector_clog: ["induction_fuel", "combustion"],
        electrical_degradation: ["electrical"],
        alternator_failure: ["electrical"],
        battery_drain: ["electrical"],
        sensor_freeze_coolant: ["electrical", "cooling"],
        sensor_drift_oilpress: ["electrical", "lubrication"],
      };

      if (exact[label]) {
        exact[label].forEach((s) => out.add(s));
      } else {
        if (label.includes("lubricat") || label.includes("oil")) out.add("lubrication");
        if (label.includes("cool") || label.includes("radiat") || label.includes("temp")) out.add("cooling");
        if (label.includes("ignit") || label.includes("combust") || label.includes("misfire") || label.includes("spark") || label.includes("egt")) out.add("combustion");
        if (label.includes("induct") || label.includes("fuel") || label.includes("inject") || label.includes("boost") || label.includes("map") || label.includes("flow")) out.add("induction_fuel");
        if (label.includes("bear") || label.includes("mechan") || label.includes("vib") || label.includes("tranny") || label.includes("gear")) out.add("mechanical");
        if (label.includes("electr") || label.includes("volt") || label.includes("alt") || label.includes("sensor") || label.includes("ecu")) out.add("electrical");
      }
    }
    return out;
  }

  private currentScale: number = 1.0;
  private targetScale: number = 1.0;

  public setRevealScale(scale: number) {
    this.targetScale = scale;
  }

  public setOpacity(opacity: number) {
    this.matFactory.setGlobalOpacity(opacity);
  }

  public update(delta: number) {
    if (Math.abs(this.currentScale - this.targetScale) > 0.0005) {
      this.currentScale = THREE.MathUtils.damp(this.currentScale, this.targetScale, 8.0, delta);
      this.group.scale.setScalar(this.currentScale);
    }
  }

  public setRenderMode(mode: RenderMode) {
    this.matFactory.setRenderMode(mode);
    if (this.strutMaterial) {
      this.strutMaterial.wireframe = mode === "wireframe";
      this.strutMaterial.color.setHex(mode === "wireframe" ? 0xc9d6de : 0x55646f);
    }
  }

  public updateFromFrame(frame: TickFrame | null) {
    this.lastFrame = frame;
    if (!frame || !this.isLoaded) return;

    const { health, diagnosis, injectedFaults } = frame;
    const faulted = new Set<string>();
    if (injectedFaults && Array.isArray(injectedFaults)) {
      for (const f of injectedFaults) {
        for (const sub of EngineModel.faultedSubsystems(f)) {
          faulted.add(sub);
        }
      }
    }
    if (diagnosis && diagnosis.label && diagnosis.label !== "healthy" && diagnosis.label !== "assessing") {
      for (const sub of EngineModel.faultedSubsystems(diagnosis.label)) {
        faulted.add(sub);
      }
    }

    // health.subsystems has 8 categories (matches the real ML pipeline);
    // the 3D asset's mesh regions were built with 6 — induction/fuel/injection
    // all live on the same physical "induction_fuel" mesh group (turbo
    // wastegate, magneto valve, intake/coolant hoses), so its visual score is
    // the worst of the three, same "min drags it down" convention as EHI.
    const scores: Record<string, number> = {
      lubrication: health.subsystems.lubrication ?? 100,
      cooling: health.subsystems.cooling ?? 100,
      combustion: health.subsystems.combustion ?? 100,
      induction_fuel: Math.min(
        health.subsystems.induction ?? 100,
        health.subsystems.fuel ?? 100,
        health.subsystems.injection ?? 100,
      ),
      mechanical: health.subsystems.mechanical ?? 100,
      electrical: health.subsystems.electrical ?? 100,
    };

    // Materials are shared per subsystem, so state is driven once per material
    // rather than once per mesh (~40 updates instead of ~150).
    this.matFactory.all().forEach((mat: HoloMaterial) => {
      const subsystem = mat.userData.subsystem;
      this.matFactory.setState(mat, scores[subsystem] ?? 100, faulted.has(subsystem), 0);
    });
  }
}

function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}
