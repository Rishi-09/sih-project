import * as THREE from "three";
import { HologramMaterialFactory } from "./HologramMaterials";
import { TickFrame } from "@/lib/types";

export interface EngineComponentRef {
  mesh: THREE.Mesh | THREE.Group;
  subsystem: string;
  componentName: string;
  cylinderIndex?: number; // 1, 2, 3, 4
}

export class EngineModel {
  public group: THREE.Group;
  public components: EngineComponentRef[] = [];
  private matFactory: HologramMaterialFactory;

  // Track key reference points for particle emitters
  public cylinderExhaustPorts: THREE.Vector3[] = [];
  public oilLineNodes: THREE.Vector3[] = [];
  public coolantNodes: THREE.Vector3[] = [];

  constructor() {
    this.group = new THREE.Group();
    this.matFactory = HologramMaterialFactory.getInstance();
    this.buildModel();
  }

  private buildModel() {
    // Rotax 915 iS is a 4-cylinder horizontally opposed (boxer) engine with top turbocharger,
    // rear gearbox / prop hub, bottom oil sump, dual ignition, and intercooled intake plenum.

    // 1. Crankcase / Core Engine Block (Mechanical)
    const blockGeo = new THREE.BoxGeometry(2.2, 1.2, 2.0);
    const blockMat = this.matFactory.getMaterial("mechanical", 100);
    const blockMesh = new THREE.Mesh(blockGeo, blockMat);
    blockMesh.position.set(0, 0, 0);
    this.group.add(blockMesh);
    this.registerComponent(blockMesh, "mechanical", "Crankcase");

    // Wireframe overlay for block
    const blockWire = new THREE.Mesh(blockGeo, this.matFactory.getWireframeMaterial(100));
    blockMesh.add(blockWire);

    // 2. Propeller Drive Shaft & Reduction Gearbox (Mechanical)
    const gearboxGeo = new THREE.CylinderGeometry(0.55, 0.65, 0.9, 16);
    const gearboxMesh = new THREE.Mesh(gearboxGeo, this.matFactory.getMaterial("mechanical", 100));
    gearboxMesh.rotation.x = Math.PI / 2;
    gearboxMesh.position.set(0, 0.1, 1.45);
    this.group.add(gearboxMesh);
    this.registerComponent(gearboxMesh, "mechanical", "Gearbox");

    const shaftGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.8, 16);
    const shaftMesh = new THREE.Mesh(shaftGeo, this.matFactory.getMaterial("mechanical", 100));
    shaftMesh.rotation.x = Math.PI / 2;
    shaftMesh.position.set(0, 0.1, 2.0);
    this.group.add(shaftMesh);
    this.registerComponent(shaftMesh, "mechanical", "Propeller Flange");

    // 3. Four Boxer Cylinders (Combustion + Cooling)
    // Cylinders 1 & 3 on Right (+X), Cylinders 2 & 4 on Left (-X)
    const cylinderPositions = [
      { id: 1, x: 1.5, y: 0.1, z: 0.6, name: "Cylinder 1" },
      { id: 3, x: 1.5, y: 0.1, z: -0.6, name: "Cylinder 3" },
      { id: 2, x: -1.5, y: 0.1, z: 0.6, name: "Cylinder 2" },
      { id: 4, x: -1.5, y: 0.1, z: -0.6, name: "Cylinder 4" },
    ];

    cylinderPositions.forEach((pos) => {
      const cylGroup = new THREE.Group();
      cylGroup.position.set(pos.x, pos.y, pos.z);

      // Cylinder Head barrel
      const barrelGeo = new THREE.CylinderGeometry(0.48, 0.48, 0.9, 16);
      const cylMat = this.matFactory.getMaterial("combustion", 100);
      const barrelMesh = new THREE.Mesh(barrelGeo, cylMat);
      barrelMesh.rotation.z = Math.PI / 2;
      cylGroup.add(barrelMesh);

      // Cooling fins ring
      for (let f = -0.3; f <= 0.3; f += 0.15) {
        const finGeo = new THREE.CylinderGeometry(0.55, 0.55, 0.04, 16);
        const finMesh = new THREE.Mesh(finGeo, this.matFactory.getMaterial("cooling", 100));
        finMesh.rotation.z = Math.PI / 2;
        finMesh.position.x = f;
        cylGroup.add(finMesh);
      }

      // Spark plug / Fuel Injector top cap (Induction / Electrical)
      const capGeo = new THREE.ConeGeometry(0.15, 0.3, 8);
      const capMesh = new THREE.Mesh(capGeo, this.matFactory.getMaterial("induction_fuel", 100));
      capMesh.position.set(pos.x > 0 ? 0.45 : -0.45, 0.4, 0);
      capMesh.rotation.z = pos.x > 0 ? -Math.PI / 4 : Math.PI / 4;
      cylGroup.add(capMesh);

      this.group.add(cylGroup);
      this.registerComponent(cylGroup, "combustion", pos.name, pos.id);

      // Exhaust port coordinates
      const portX = pos.x > 0 ? pos.x + 0.5 : pos.x - 0.5;
      this.cylinderExhaustPorts.push(new THREE.Vector3(portX, pos.y - 0.2, pos.z));
    });

    // 4. Exhaust Headers & Collector (Combustion)
    cylinderPositions.forEach((pos) => {
      const isRight = pos.x > 0;
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(isRight ? 1.5 : -1.5, pos.y - 0.2, pos.z),
        new THREE.Vector3(isRight ? 0.8 : -0.8, -0.6, pos.z * 0.7),
        new THREE.Vector3(0, -0.8, -1.2), // Exhaust collector junction
      ]);
      const pipeGeo = new THREE.TubeGeometry(curve, 16, 0.08, 8, false);
      const pipeMesh = new THREE.Mesh(pipeGeo, this.matFactory.getMaterial("combustion", 100));
      this.group.add(pipeMesh);
      this.registerComponent(pipeMesh, "combustion", `Exhaust Header ${pos.id}`, pos.id);
    });

    // 5. Turbocharger & Intercooler Plenum (Induction / Fuel)
    const turboGroup = new THREE.Group();
    turboGroup.position.set(0, 0.9, -0.8);

    // Turbine Housing (Scroll)
    const turbineGeo = new THREE.TorusGeometry(0.35, 0.15, 12, 24);
    const turboMat = this.matFactory.getMaterial("induction_fuel", 100);
    const turbineMesh = new THREE.Mesh(turbineGeo, turboMat);
    turbineMesh.rotation.y = Math.PI / 2;
    turboGroup.add(turbineMesh);

    // Compressor Core
    const compGeo = new THREE.CylinderGeometry(0.25, 0.25, 0.45, 16);
    const compMesh = new THREE.Mesh(compGeo, turboMat);
    compMesh.rotation.z = Math.PI / 2;
    turboGroup.add(compMesh);

    // Intake Plenum Runners to Cylinders
    const plenumGeo = new THREE.BoxGeometry(1.6, 0.2, 0.6);
    const plenumMesh = new THREE.Mesh(plenumGeo, turboMat);
    plenumMesh.position.set(0, -0.25, 0.4);
    turboGroup.add(plenumMesh);

    this.group.add(turboGroup);
    this.registerComponent(turboGroup, "induction_fuel", "Turbocharger System");

    // 6. Lubrication System (Oil Sump + Pump + Lines)
    const sumpGeo = new THREE.BoxGeometry(1.6, 0.45, 1.4);
    const oilMat = this.matFactory.getMaterial("lubrication", 100);
    const sumpMesh = new THREE.Mesh(sumpGeo, oilMat);
    sumpMesh.position.set(0, -0.8, 0);
    this.group.add(sumpMesh);
    this.registerComponent(sumpMesh, "lubrication", "Oil Sump");

    const oilFilterGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.4, 12);
    const oilFilterMesh = new THREE.Mesh(oilFilterGeo, oilMat);
    oilFilterMesh.position.set(0.9, -0.7, 0.6);
    this.group.add(oilFilterMesh);
    this.registerComponent(oilFilterMesh, "lubrication", "Oil Filter & Pump");

    this.oilLineNodes = [
      new THREE.Vector3(0.9, -0.7, 0.6),
      new THREE.Vector3(0.9, 0.3, 0.0),
      new THREE.Vector3(-0.9, 0.3, 0.0),
      new THREE.Vector3(0, -0.7, -0.5),
    ];

    // 7. Liquid Cooling Circuit (Coolant Expansion Tank + Radiator Pipes)
    const tankGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.6, 12);
    const coolantMat = this.matFactory.getMaterial("cooling", 100);
    const tankMesh = new THREE.Mesh(tankGeo, coolantMat);
    tankMesh.position.set(-0.9, 0.8, 0.2);
    this.group.add(tankMesh);
    this.registerComponent(tankMesh, "cooling", "Coolant Expansion Tank");

    this.coolantNodes = [
      new THREE.Vector3(-0.9, 0.8, 0.2),
      new THREE.Vector3(-1.3, 0.2, 0.5),
      new THREE.Vector3(1.3, 0.2, 0.5),
      new THREE.Vector3(0.0, 0.5, -0.6),
    ];

    // 8. Electrical System (Alternator + Dual ECU / Wiring Loom)
    const altGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.4, 16);
    const elecMat = this.matFactory.getMaterial("electrical", 100);
    const altMesh = new THREE.Mesh(altGeo, elecMat);
    altMesh.rotation.x = Math.PI / 2;
    altMesh.position.set(0, 0.7, 0.9);
    this.group.add(altMesh);
    this.registerComponent(altMesh, "electrical", "Alternator & Generator");

    const ecuGeo = new THREE.BoxGeometry(0.5, 0.3, 0.4);
    const ecuMesh = new THREE.Mesh(ecuGeo, elecMat);
    ecuMesh.position.set(-0.7, 0.7, -0.7);
    this.group.add(ecuMesh);
    this.registerComponent(ecuMesh, "electrical", "FADEC ECU A/B");

    // Rotate the overall group slightly for optimal initial presentation
    this.group.rotation.y = -Math.PI / 6;
  }

  private registerComponent(mesh: THREE.Mesh | THREE.Group, subsystem: string, componentName: string, cylinderIndex?: number) {
    this.components.push({
      mesh,
      subsystem,
      componentName,
      cylinderIndex,
    });
  }

  public updateFromFrame(frame: TickFrame | null) {
    if (!frame) return;

    const { health, diagnosis } = frame;
    const isFaultActive = diagnosis && diagnosis.label !== "healthy";
    const faultedSubsystems = new Set<string>();

    if (isFaultActive) {
      if (diagnosis.label.includes("lubrication")) faultedSubsystems.add("lubrication");
      if (diagnosis.label.includes("cooling")) faultedSubsystems.add("cooling");
      if (diagnosis.label.includes("ignition") || diagnosis.label.includes("combustion")) faultedSubsystems.add("combustion");
      if (diagnosis.label.includes("induction") || diagnosis.label.includes("fuel")) faultedSubsystems.add("induction_fuel");
      if (diagnosis.label.includes("bearing") || diagnosis.label.includes("mechanical")) faultedSubsystems.add("mechanical");
      if (diagnosis.label.includes("electrical")) faultedSubsystems.add("electrical");
    }

    // Subsystem score map
    const scores: Record<string, number> = {
      lubrication: health.subsystems.lubrication ?? 100,
      cooling: health.subsystems.cooling ?? 100,
      combustion: health.subsystems.combustion ?? 100,
      induction_fuel: health.subsystems.inductionFuel ?? 100,
      mechanical: health.subsystems.mechanical ?? 100,
      electrical: health.subsystems.electrical ?? 100,
    };

    // Update materials for all component meshes
    this.components.forEach((comp) => {
      const score = scores[comp.subsystem] ?? 100;
      let isCompFaulted = faultedSubsystems.has(comp.subsystem);

      // Handle per-cylinder specificity (e.g. ignition_fault_cyl3 / injector_fault_cyl3)
      if (diagnosis?.cylinder && comp.cylinderIndex !== undefined) {
        if (comp.cylinderIndex !== diagnosis.cylinder) {
          isCompFaulted = false; // Only target the affected cylinder
        }
      }

      const mat = this.matFactory.getMaterial(comp.subsystem, score, isCompFaulted);

      if (comp.mesh instanceof THREE.Mesh) {
        comp.mesh.material = mat;
      } else if (comp.mesh instanceof THREE.Group) {
        comp.mesh.traverse((child) => {
          if (child instanceof THREE.Mesh && !child.material.wireframe) {
            child.material = mat;
          }
        });
      }
    });
  }
}
