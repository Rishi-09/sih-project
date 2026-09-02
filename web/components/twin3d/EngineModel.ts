import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { HologramMaterialFactory, HoloMaterial } from "./HologramMaterials";
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
    const label = rawLabel.toLowerCase();

    const exact: Record<string, string[]> = {
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
    if (label.includes("lubrication") || label.includes("oil")) out.add("lubrication");
    if (label.includes("cooling") || label.includes("coolant") || label.includes("overheat")) out.add("cooling");
    if (label.includes("ignition") || label.includes("combustion") || label.includes("misfire")) out.add("combustion");
    if (label.includes("induction") || label.includes("fuel") || label.includes("injector") || label.includes("boost")) out.add("induction_fuel");
    if (label.includes("bearing") || label.includes("mechanical") || label.includes("vib")) out.add("mechanical");
    if (label.includes("electrical") || label.includes("sensor")) out.add("electrical");
    return out;
  }

  public updateFromFrame(frame: TickFrame | null) {
    this.lastFrame = frame;
    if (!frame || !this.isLoaded) return;

    const { health, diagnosis } = frame;
    const isFaultActive = !!diagnosis && diagnosis.label !== "healthy";
    const faulted = isFaultActive ? EngineModel.faultedSubsystems(diagnosis.label) : new Set<string>();

    const scores: Record<string, number> = {
      lubrication: health.subsystems.lubrication ?? 100,
      cooling: health.subsystems.cooling ?? 100,
      combustion: health.subsystems.combustion ?? 100,
      induction_fuel: health.subsystems.inductionFuel ?? 100,
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
