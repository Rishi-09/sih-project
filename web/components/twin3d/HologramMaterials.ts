import * as THREE from "three";

export type HealthGrade = "excellent" | "nominal" | "caution" | "critical";
export type ViewMode = "hologram" | "solid" | "thermal";

export function getHealthGrade(score: number): HealthGrade {
  if (score >= 90) return "excellent";
  if (score >= 75) return "nominal";
  if (score >= 50) return "caution";
  return "critical";
}

export const HOLO_COLORS = {
  excellent: 0x54c6d1, // Cyberpunk Cyan
  nominal: 0x4cbc80,   // Emerald Green
  caution: 0xe2a44a,   // Warning Amber
  critical: 0xe76f62,  // Critical Crimson
  grid: 0x183442,      // Grid cyan
  wireframe: 0x8be9fd, // Wireframe cyan
};

// Subsystem accent colors for Hologram mode
const SUBSYSTEM_HINTS: Record<string, number> = {
  combustion: 0x54c6d1,
  mechanical: 0x3aa7ba,
  lubrication: 0x3ebda8,
  cooling: 0x4aa0d8,
  induction_fuel: 0x54c6d1,
  electrical: 0x6ed4df,
};

// Thermal mapping colors (Blue -> Cyan -> Green -> Yellow -> Orange -> Red)
export function getThermalColor(tempC: number): THREE.Color {
  // Range: 20°C (ambient cold) to 950°C (max EGT)
  const norm = THREE.MathUtils.clamp((tempC - 20) / (950 - 20), 0, 1);
  const color = new THREE.Color();

  if (norm < 0.2) {
    // 20°C - 200°C: Dark Blue to Cyan
    color.setRGB(0.05, 0.2 + norm * 3.5, 0.6 + norm * 2.0);
  } else if (norm < 0.4) {
    // 200°C - 390°C: Cyan to Emerald Green
    const t = (norm - 0.2) / 0.2;
    color.setRGB(0.1 * (1 - t), 0.9, 0.8 * (1 - t) + 0.1);
  } else if (norm < 0.65) {
    // 390°C - 620°C: Green to Yellow
    const t = (norm - 0.4) / 0.25;
    color.setRGB(0.2 + 0.8 * t, 0.9, 0.1);
  } else if (norm < 0.85) {
    // 620°C - 810°C: Yellow to Bright Orange
    const t = (norm - 0.65) / 0.2;
    color.setRGB(1.0, 0.9 - 0.5 * t, 0.05);
  } else {
    // 810°C - 950°C: Orange to Hot Incandescent Red/White
    const t = (norm - 0.85) / 0.15;
    color.setRGB(1.0, 0.4 * (1 - t) + 0.3 * t, 0.2 * t);
  }
  return color;
}

// Authentic Solid CAD physical engine materials (fixes Point 5 component separation feel)
function getSolidCADProps(srcName: string): {
  color: THREE.Color;
  metalness: number;
  roughness: number;
} {
  const n = srcName.toLowerCase();

  // Rotax 915 iS Signature Blue cylinder head covers
  if (n.includes("enamel") || n.includes("blue") || n.includes("cover")) {
    return {
      color: new THREE.Color(0x0f52ba), // Rotax Signature Sapphire Blue
      metalness: 0.3,
      roughness: 0.35,
    };
  }
  // Exhaust manifold & turbo headers (heat-treated steel)
  if (n.includes("exhaust")) {
    return {
      color: new THREE.Color(0x5c504a), // Bronzed stainless steel
      metalness: 0.85,
      roughness: 0.35,
    };
  }
  // Bearings & polished shafts
  if (n.includes("bearing") || n.includes("shinier")) {
    return {
      color: new THREE.Color(0xd0d5dd), // Polished chrome steel
      metalness: 0.95,
      roughness: 0.15,
    };
  }
  // Engine Block & Crankcase (cast aluminum alloy)
  if (n.includes("metal") || n.includes("case") || n.includes("block")) {
    return {
      color: new THREE.Color(0x78848f), // Matte cast aluminum
      metalness: 0.75,
      roughness: 0.45,
    };
  }
  // Coolant & Intake Hoses (durable black vulcanized rubber)
  if (n.includes("hose") || n.includes("hoes") || n.includes("sheath") || n.includes("soft")) {
    return {
      color: new THREE.Color(0x1a1d20), // Dark rubber
      metalness: 0.05,
      roughness: 0.85,
    };
  }
  // Plastic baffles & air intake ducting
  if (n.includes("plastic") || n.includes("baffle")) {
    return {
      color: new THREE.Color(0x282c30), // Reinforced composite
      metalness: 0.1,
      roughness: 0.6,
    };
  }
  // Fasteners & bolts (galvanized zinc / brass)
  if (n.includes("bolt") || n.includes("clamp")) {
    return {
      color: new THREE.Color(0xb0a890), // Zinc/gold coated steel
      metalness: 0.9,
      roughness: 0.25,
    };
  }

  // Default mechanical components
  return {
    color: new THREE.Color(0x6b7782),
    metalness: 0.7,
    roughness: 0.4,
  };
}

export interface HoloMaterial extends THREE.MeshStandardMaterial {
  userData: {
    subsystem: string;
    srcName: string;
    baseEmissive: THREE.Color;
    solidColor: THREE.Color;
    solidMetalness: number;
    solidRoughness: number;
    holoColor: THREE.Color;
    rimColor: { value: THREE.Color };
    rimStrength: { value: number };
  };
}

export class HologramMaterialFactory {
  private static instance: HologramMaterialFactory;
  private materials: Map<string, HoloMaterial> = new Map();
  public currentMode: ViewMode = "solid"; // Default to Solid CAD as requested

  public static getInstance(): HologramMaterialFactory {
    if (!HologramMaterialFactory.instance) {
      HologramMaterialFactory.instance = new HologramMaterialFactory();
    }
    return HologramMaterialFactory.instance;
  }

  public all(): HoloMaterial[] {
    return Array.from(this.materials.values());
  }

  public setViewMode(mode: ViewMode) {
    this.currentMode = mode;
    this.materials.forEach((mat) => {
      this.applyModeToMaterial(mat);
    });
  }

  private applyModeToMaterial(mat: HoloMaterial) {
    if (this.currentMode === "solid") {
      // Solid CAD Mode: Authentic mechanical assembly without gaps
      mat.color.copy(mat.userData.solidColor);
      mat.metalness = mat.userData.solidMetalness;
      mat.roughness = mat.userData.solidRoughness;
      mat.userData.rimStrength.value = 0.08; // Very subtle edge contour, no harsh glowing gaps
      mat.emissiveIntensity = 0.0;
      mat.wireframe = false;
    } else if (this.currentMode === "thermal") {
      // Thermal FLIR Mode: Sensor temperature colors
      mat.metalness = 0.1;
      mat.roughness = 0.7;
      mat.userData.rimStrength.value = 0.0;
      mat.wireframe = false;
    } else {
      // Hologram Mode: Cybernetic twin
      mat.color.copy(mat.userData.holoColor);
      mat.metalness = 0.6;
      mat.roughness = 0.4;
      mat.userData.rimStrength.value = 0.45;
      mat.wireframe = false;
    }
    mat.needsUpdate = true;
  }

  public dispose() {
    this.materials.forEach((m) => m.dispose());
    this.materials.clear();
  }

  public fromSource(src: THREE.MeshStandardMaterial, subsystem: string): HoloMaterial {
    const srcName = src.name || "generic";
    const key = `${srcName}::${subsystem}`;

    const cached = this.materials.get(key);
    if (cached) return cached;

    const accent = new THREE.Color(SUBSYSTEM_HINTS[subsystem] ?? HOLO_COLORS.excellent);
    const solidProps = getSolidCADProps(srcName);

    const mat = new THREE.MeshStandardMaterial({
      color: solidProps.color.clone(),
      metalness: solidProps.metalness,
      roughness: solidProps.roughness,
      emissive: accent.clone(),
      emissiveIntensity: 0.0,
      side: THREE.FrontSide,
      transparent: false,
    }) as HoloMaterial;

    mat.name = key;
    mat.userData = {
      subsystem,
      srcName,
      baseEmissive: accent.clone(),
      solidColor: solidProps.color.clone(),
      solidMetalness: solidProps.metalness,
      solidRoughness: solidProps.roughness,
      holoColor: accent.clone().multiplyScalar(0.7),
      rimColor: { value: accent.clone() },
      rimStrength: { value: 0.1 },
    };

    this.applyRim(mat);
    this.applyModeToMaterial(mat);
    this.materials.set(key, mat);
    return mat;
  }

  private applyRim(mat: HoloMaterial) {
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uRimColor = mat.userData.rimColor;
      shader.uniforms.uRimStrength = mat.userData.rimStrength;

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

    mat.customProgramCacheKey = () => "engine-multi-mode-v2";
  }

  public setState(
    mat: HoloMaterial,
    healthScore: number,
    isFaulted: boolean,
    pulse: number,
    tempC?: number
  ) {
    const grade = getHealthGrade(healthScore);

    // In Thermal Mode, color is driven by actual thermal telemetry!
    if (this.currentMode === "thermal") {
      let partTemp = tempC;
      if (partTemp === undefined) {
        // Realistic nominal temperatures per subsystem if live sensor not yet wired
        if (mat.userData.subsystem === "combustion") partTemp = 820; // Exhaust & combustion
        else if (mat.userData.subsystem === "cooling") partTemp = 92;  // Coolant
        else if (mat.userData.subsystem === "lubrication") partTemp = 105; // Oil
        else partTemp = 65; // Ambient / mechanical
      }

      if (isFaulted) partTemp += 120; // Fault thermal surge

      const thermalColor = getThermalColor(partTemp);
      mat.color.copy(thermalColor);
      mat.emissive.copy(thermalColor);
      mat.emissiveIntensity = 0.45 + pulse * 0.3;
      return;
    }

    // In Solid CAD Mode
    if (this.currentMode === "solid") {
      if (isFaulted) {
        mat.emissive.setHex(HOLO_COLORS.critical);
        mat.emissiveIntensity = 0.5 + pulse * 0.4;
        mat.userData.rimColor.value.setHex(HOLO_COLORS.critical);
        mat.userData.rimStrength.value = 0.8 + pulse * 0.5;
        return;
      }

      if (grade === "critical" || grade === "caution") {
        const warn = grade === "critical" ? HOLO_COLORS.critical : HOLO_COLORS.caution;
        mat.emissive.setHex(warn);
        mat.emissiveIntensity = grade === "critical" ? 0.3 : 0.15;
        mat.userData.rimColor.value.setHex(warn);
        mat.userData.rimStrength.value = 0.5;
        return;
      }

      // Normal solid mechanical appearance
      mat.color.copy(mat.userData.solidColor);
      mat.emissiveIntensity = 0.0;
      mat.userData.rimStrength.value = 0.08;
      return;
    }

    // In Hologram Mode
    if (isFaulted) {
      mat.emissive.setHex(HOLO_COLORS.critical);
      mat.emissiveIntensity = 0.4 + pulse * 0.5;
      mat.userData.rimColor.value.setHex(HOLO_COLORS.critical);
      mat.userData.rimStrength.value = 1.0 + pulse * 0.8;
      return;
    }

    if (grade === "critical" || grade === "caution") {
      const warn = grade === "critical" ? HOLO_COLORS.critical : HOLO_COLORS.caution;
      mat.emissive.setHex(warn);
      mat.emissiveIntensity = grade === "critical" ? 0.25 : 0.15;
      mat.userData.rimColor.value.setHex(warn);
      mat.userData.rimStrength.value = 0.8;
      return;
    }

    mat.color.copy(mat.userData.holoColor);
    mat.emissive.copy(mat.userData.baseEmissive);
    mat.emissiveIntensity = 0.06;
    mat.userData.rimColor.value.copy(mat.userData.baseEmissive);
    mat.userData.rimStrength.value = 0.45;
  }
}
