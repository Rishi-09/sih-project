import * as THREE from "three";

export type HealthGrade = "excellent" | "nominal" | "caution" | "critical";
export type RenderMode = "tactical" | "wireframe" | "flir_thermal";

export function getHealthGrade(score: number): HealthGrade {
  if (score >= 90) return "excellent";
  if (score >= 75) return "nominal";
  if (score >= 50) return "caution";
  return "critical";
}

export const HOLO_COLORS = {
  excellent: 0x38bdf8, // Cyberpunk Cyan
  nominal: 0x22c55e,   // Emerald Green
  caution: 0xeab308,   // Warning Amber
  critical: 0xef4444,  // Critical Crimson
  grid: 0x1e293b,      // Grid cyan
  wireframe: 0x64748b, // Wireframe cyan
};

// Subsystem accent colors, used to tint neutral metal and to key the rim glow.
const SUBSYSTEM_HINTS: Record<string, number> = {
  combustion: 0x54c6d1,
  mechanical: 0x3aa7ba,
  lubrication: 0x3ebda8,
  cooling: 0x4aa0d8,
  induction_fuel: 0x54c6d1,
  electrical: 0x6ed4df,
};

// The darkest the source model goes is near-black (0.004 linear); lifting it to a
// slate floor is what keeps 700k triangles of engine from reading as a silhouette.
const SLATE_DARK = new THREE.Color(0x1b2b35);
const SLATE_LIGHT = new THREE.Color(0x7d94a0);

/**
 * Surface response inferred from the source material name. `tone` is a floor on
 * the slate ramp: 34 of the model's 36 materials ship the same near-black base
 * colour, so source luminance alone cannot tell a braided hose from an exhaust
 * header — the material name is the only signal there is.
 */
function surfaceProps(srcName: string): { metalness: number; roughness: number; tone: number } {
  const n = srcName.toLowerCase();
  if (n.includes("exhaust")) return { metalness: 0.95, roughness: 0.42, tone: 0.46 };
  if (n.includes("bearing")) return { metalness: 1.0, roughness: 0.18, tone: 0.62 };
  if (n.includes("shinier") || n.includes("bolt")) return { metalness: 0.95, roughness: 0.25, tone: 0.55 };
  if (n.includes("metal")) return { metalness: 0.9, roughness: 0.38, tone: 0.44 };
  if (n.includes("hose") || n.includes("hoes") || n.includes("sheath")) return { metalness: 0.0, roughness: 0.85, tone: 0.08 };
  if (n.includes("soft")) return { metalness: 0.0, roughness: 0.8, tone: 0.11 };
  if (n.includes("plastic") || n.includes("baffle")) return { metalness: 0.05, roughness: 0.65, tone: 0.14 };
  if (n.includes("enamel")) return { metalness: 0.35, roughness: 0.35, tone: 0.5 };
  if (n.includes("paint")) return { metalness: 0.55, roughness: 0.5, tone: 0.2 };
  return { metalness: 0.7, roughness: 0.45, tone: 0.35 };
}

/**
 * Grade a source colour into the holographic palette. Saturated colours (the
 * ROTAX blue covers, yellow markers) keep their hue so the engine stays
 * recognisable; neutrals ride a slate ramp tinted toward the subsystem accent.
 */
function gradeColor(src: THREE.Color, accent: THREE.Color, tone: number): THREE.Color {
  const hsl = { h: 0, s: 0, l: 0 };
  src.getHSL(hsl);

  if (hsl.s > 0.25) {
    // Keep identity colours — the blue ROTAX covers and yellow markers are how
    // the engine stays recognisable as a 915 iS.
    const out = new THREE.Color();
    out.setHSL(hsl.h, Math.min(1, hsl.s * 1.05), THREE.MathUtils.clamp(hsl.l * 1.15 + 0.08, 0.12, 0.72));
    return out;
  }

  // Neutral: ride the slate ramp, floored by the material class.
  const t = Math.max(Math.pow(THREE.MathUtils.clamp(hsl.l, 0, 1), 0.45), tone);
  const out = SLATE_DARK.clone().lerp(SLATE_LIGHT, t);
  return out.lerp(accent, 0.12);
}

export interface HoloMaterial extends THREE.MeshStandardMaterial {
  userData: {
    subsystem: string;
    baseColor: THREE.Color;
    baseEmissive: THREE.Color;
    rimColor: { value: THREE.Color };
    rimStrength: { value: number };
  };
}

export class HologramMaterialFactory {
  private static instance: HologramMaterialFactory;

  private materials: Map<string, HoloMaterial> = new Map();

  public static getInstance(): HologramMaterialFactory {
    if (!HologramMaterialFactory.instance) {
      HologramMaterialFactory.instance = new HologramMaterialFactory();
    }
    return HologramMaterialFactory.instance;
  }

  /** Every material built so far, so per-frame state can be applied in one pass. */
  private currentRenderMode: RenderMode = "tactical";

  public setRenderMode(mode: RenderMode) {
    this.currentRenderMode = mode;
    this.materials.forEach((mat) => {
      if (mode === "wireframe") {
        mat.wireframe = true;
        if (mat.userData.baseColor) mat.color.copy(mat.userData.baseColor);
        mat.emissive.setHex(0x38bdf8);
        mat.emissiveIntensity = 0.45;
      } else if (mode === "flir_thermal") {
        mat.wireframe = false;
        const sub = mat.userData.subsystem;
        if (sub === "combustion") {
          mat.color.setHex(0xf87171);
          mat.emissive.setHex(0xef4444);
          mat.emissiveIntensity = 0.55;
        } else if (sub === "cooling") {
          mat.color.setHex(0x38bdf8);
          mat.emissive.setHex(0x0284c7);
          mat.emissiveIntensity = 0.4;
        } else if (sub === "lubrication") {
          mat.color.setHex(0xfbbf24);
          mat.emissive.setHex(0xd97706);
          mat.emissiveIntensity = 0.45;
        } else {
          mat.color.setHex(0x22c55e);
          mat.emissive.setHex(0x15803d);
          mat.emissiveIntensity = 0.25;
        }
      } else {
        // Tactical Solid CAD: Restore clean authentic uniform blueprint/metal color with cyan accents
        mat.wireframe = false;
        if (mat.userData.baseColor) mat.color.copy(mat.userData.baseColor);
        mat.emissive.copy(mat.userData.baseEmissive);
        mat.emissiveIntensity = 0.04;
        mat.userData.rimColor.value.copy(mat.userData.baseEmissive);
        mat.userData.rimStrength.value = 0.4;
      }
    });
  }

  public getRenderMode(): RenderMode {
    return this.currentRenderMode;
  }

  public setGlobalOpacity(opacity: number) {
    const clamped = THREE.MathUtils.clamp(opacity, 0.0, 1.0);
    this.materials.forEach((mat) => {
      mat.opacity = clamped;
      mat.depthWrite = clamped > 0.4;
    });
  }

  public all(): HoloMaterial[] {
    return Array.from(this.materials.values());
  }

  public dispose() {
    this.materials.forEach((m) => m.dispose());
    this.materials.clear();
  }

  /**
   * Build (or reuse) the holographic counterpart of a source glTF material.
   * Cached per source-material + subsystem, so the whole engine is ~40 materials
   * sharing one shader program rather than one material per mesh.
   */
  public fromSource(src: THREE.MeshStandardMaterial, subsystem: string): HoloMaterial {
    const srcName = src.name || "generic";
    const key = `${srcName}::${subsystem}`;

    const cached = this.materials.get(key);
    if (cached) return cached;

    const accent = new THREE.Color(SUBSYSTEM_HINTS[subsystem] ?? HOLO_COLORS.excellent);
    const { metalness, roughness, tone } = surfaceProps(srcName);
    const finalColor = gradeColor(src.color, accent, tone);

    const mat = new THREE.MeshStandardMaterial({
      color: finalColor,
      metalness,
      roughness,
      emissive: accent.clone(),
      emissiveIntensity: 0.0,
      side: THREE.FrontSide,
      transparent: true,
      depthWrite: true,
      opacity: 1.0,
    }) as HoloMaterial;

    mat.name = key;
    mat.userData = {
      subsystem,
      baseColor: finalColor.clone(),
      baseEmissive: accent.clone(),
      rimColor: { value: accent.clone() },
      rimStrength: { value: 0.4 },
    };

    this.applyRim(mat);
    this.materials.set(key, mat);
    return mat;
  }

  /**
   * Fresnel rim glow injected into the standard shader. This is what carries the
   * hologram read: edges light up, interior surfaces stay legible as metal.
   */
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

    // Constant key: all holo materials share one compiled program.
    mat.customProgramCacheKey = () => "holo-rim-v1";
  }

  /**
   * Drive a material's health/fault state. Called for every material each frame,
   * including healthy ones, so a cleared fault always resets.
   */
  public setState(mat: HoloMaterial, healthScore: number, isFaulted: boolean, pulse: number) {
    // If we're currently in thermal mode, let thermal colors dominate unless faulted
    if (this.currentRenderMode === "flir_thermal" && !isFaulted) {
      return;
    }

    const grade = getHealthGrade(healthScore);

    if (isFaulted) {
      mat.emissive.setHex(HOLO_COLORS.critical);
      mat.emissiveIntensity = 0.35 + pulse * 0.55;
      mat.userData.rimColor.value.setHex(HOLO_COLORS.critical);
      mat.userData.rimStrength.value = 1.1 + pulse * 0.9;
      return;
    }

    if (grade === "critical" || grade === "caution") {
      const warn = grade === "critical" ? HOLO_COLORS.critical : HOLO_COLORS.caution;
      mat.emissive.setHex(warn);
      mat.emissiveIntensity = grade === "critical" ? 0.22 : 0.12;
      mat.userData.rimColor.value.setHex(warn);
      mat.userData.rimStrength.value = 0.85;
      return;
    }

    mat.emissive.copy(mat.userData.baseEmissive);
    mat.emissiveIntensity = 0.04;
    mat.userData.rimColor.value.copy(mat.userData.baseEmissive);
    mat.userData.rimStrength.value = 0.4;
  }

  /** Legacy entry point: flat-colour material with no source to grade from. */
  public getMaterial(subsystem: string, healthScore: number = 100, isFaulted: boolean = false): HoloMaterial {
    const proxy = new THREE.MeshStandardMaterial({ color: 0x2b3b45 });
    proxy.name = `legacy_${getHealthGrade(healthScore)}`;
    const mat = this.fromSource(proxy, subsystem);
    proxy.dispose();
    this.setState(mat, healthScore, isFaulted, 0);
    return mat;
  }
}
