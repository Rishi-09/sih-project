import * as THREE from "three";

export type HealthGrade = "excellent" | "nominal" | "caution" | "critical";

export function getHealthGrade(score: number): HealthGrade {
  if (score >= 90) return "excellent";
  if (score >= 75) return "nominal";
  if (score >= 50) return "caution";
  return "critical";
}

export const HOLO_COLORS = {
  excellent: 0x54c6d1, // Cyan / Accent
  nominal: 0x4cbc80,   // Green
  caution: 0xe2a44a,   // Amber
  critical: 0xe76f62,  // Red
  grid: 0x183442,      // Dark cyan for floor
  wireframe: 0x8be9fd, // Bright hologram wire
  core: 0x0e2430,       // Deep blue-grey
};

export class HologramMaterialFactory {
  private static instance: HologramMaterialFactory;

  // Cache materials by subsystem and state
  private materials: Map<string, THREE.MeshPhysicalMaterial> = new Map();
  private wireMaterials: Map<string, THREE.MeshBasicMaterial> = new Map();

  public static getInstance(): HologramMaterialFactory {
    if (!HologramMaterialFactory.instance) {
      HologramMaterialFactory.instance = new HologramMaterialFactory();
    }
    return HologramMaterialFactory.instance;
  }

  public getMaterial(subsystem: string, healthScore: number = 100, isFaulted: boolean = false): THREE.MeshPhysicalMaterial {
    const grade = getHealthGrade(healthScore);
    const key = `${subsystem}_${grade}_${isFaulted ? "fault" : "ok"}`;

    if (!this.materials.has(key)) {
      const baseColor = isFaulted ? HOLO_COLORS.critical : HOLO_COLORS[grade];
      const emissiveColor = baseColor;
      
      const mat = new THREE.MeshPhysicalMaterial({
        color: baseColor,
        emissive: emissiveColor,
        emissiveIntensity: isFaulted ? 0.8 : (grade === "critical" ? 0.6 : 0.25),
        roughness: 0.15,
        metalness: 0.1,
        transmission: 0.65, // Holographic glass effect
        ior: 1.2,
        transparent: true,
        opacity: isFaulted ? 0.85 : 0.6,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });

      this.materials.set(key, mat);
    }

    return this.materials.get(key)!;
  }

  public getWireframeMaterial(healthScore: number = 100, isFaulted: boolean = false): THREE.MeshBasicMaterial {
    const grade = getHealthGrade(healthScore);
    const key = `wire_${grade}_${isFaulted ? "fault" : "ok"}`;

    if (!this.wireMaterials.has(key)) {
      const color = isFaulted ? HOLO_COLORS.critical : HOLO_COLORS[grade];
      const mat = new THREE.MeshBasicMaterial({
        color: color,
        wireframe: true,
        transparent: true,
        opacity: isFaulted ? 0.7 : 0.35,
        blending: THREE.AdditiveBlending,
      });
      this.wireMaterials.set(key, mat);
    }

    return this.wireMaterials.get(key)!;
  }
}
