import * as THREE from "three";
import { EngineComponentRef } from "./EngineModel";
import { TickFrame } from "@/lib/types";

export class FaultHighlighter {
  private pulseTime: number = 0;
  private components: EngineComponentRef[];

  constructor(components: EngineComponentRef[]) {
    this.components = components;
  }

  public update(delta: number, frame: TickFrame | null) {
    this.pulseTime += delta;
    if (!frame) return;

    const { diagnosis } = frame;
    const isFault = diagnosis && diagnosis.label !== "healthy";
    const pulseFactor = isFault ? (Math.sin(this.pulseTime * 6.0) + 1.0) * 0.5 : 0; // 0 to 1 pulse

    // Animate emissive intensity of faulted meshes
    this.components.forEach((comp) => {
      let isCompFaulted = false;

      if (isFault) {
        if (diagnosis.label.includes("lubrication") && comp.subsystem === "lubrication") isCompFaulted = true;
        if (diagnosis.label.includes("cooling") && comp.subsystem === "cooling") isCompFaulted = true;
        if ((diagnosis.label.includes("ignition") || diagnosis.label.includes("combustion")) && comp.subsystem === "combustion") isCompFaulted = true;
        if ((diagnosis.label.includes("induction") || diagnosis.label.includes("fuel")) && comp.subsystem === "induction_fuel") isCompFaulted = true;
        if ((diagnosis.label.includes("bearing") || diagnosis.label.includes("mechanical")) && comp.subsystem === "mechanical") isCompFaulted = true;
        if (diagnosis.label.includes("electrical") && comp.subsystem === "electrical") isCompFaulted = true;

        // Isolate cylinder 3 if cylinder is explicitly diagnosed
        if (diagnosis.cylinder && comp.cylinderIndex !== undefined && comp.cylinderIndex !== diagnosis.cylinder) {
          isCompFaulted = false;
        }
      }

      if (isCompFaulted) {
        const targetEmissive = 0.5 + pulseFactor * 0.9;
        this.setEmissiveIntensity(comp.mesh, targetEmissive);
      }
    });
  }

  private setEmissiveIntensity(meshOrGroup: THREE.Mesh | THREE.Group, intensity: number) {
    if (meshOrGroup instanceof THREE.Mesh) {
      const mat = meshOrGroup.material as THREE.MeshPhysicalMaterial;
      if (mat && "emissiveIntensity" in mat) {
        mat.emissiveIntensity = intensity;
      }
    } else if (meshOrGroup instanceof THREE.Group) {
      meshOrGroup.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          const mat = child.material as THREE.MeshPhysicalMaterial;
          if (mat && "emissiveIntensity" in mat) {
            mat.emissiveIntensity = intensity;
          }
        }
      });
    }
  }
}
