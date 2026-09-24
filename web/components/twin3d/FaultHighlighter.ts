import { EngineModel } from "./EngineModel";
import { HologramMaterialFactory, HoloMaterial } from "./HologramMaterials";
import { TickFrame } from "@/lib/types";

export class FaultHighlighter {
  private pulseTime: number = 0;
  private engineModel: EngineModel;
  private matFactory: HologramMaterialFactory;

  constructor(engineModel: EngineModel) {
    this.engineModel = engineModel;
    this.matFactory = HologramMaterialFactory.getInstance();
  }

  public update(delta: number, frame: TickFrame | null) {
    this.pulseTime += delta;
    if (!this.engineModel.isLoaded) return;

    // Determine faulted subsystems from:
    // 1. Ground truth injected faults in simulator
    // 2. ML diagnosis prediction
    // 3. Degraded subsystem health scores (< 75)
    const faulted = new Set<string>();

    if (frame?.injectedFaults && Array.isArray(frame.injectedFaults)) {
      for (const f of frame.injectedFaults) {
        for (const sub of EngineModel.faultedSubsystems(f)) {
          faulted.add(sub);
        }
      }
    }

    const diagnosis = frame?.diagnosis;
    if (diagnosis && diagnosis.label && diagnosis.label !== "healthy" && diagnosis.label !== "assessing") {
      for (const sub of EngineModel.faultedSubsystems(diagnosis.label)) {
        faulted.add(sub);
      }
    }

    const health = frame?.health?.subsystems;
    if (health) {
      if (typeof health.lubrication === "number" && health.lubrication < 75) faulted.add("lubrication");
      if (typeof health.cooling === "number" && health.cooling < 75) faulted.add("cooling");
      if (typeof health.combustion === "number" && health.combustion < 75) faulted.add("combustion");
      if (
        (typeof health.induction === "number" && health.induction < 75) ||
        (typeof health.fuel === "number" && health.fuel < 75) ||
        (typeof health.injection === "number" && health.injection < 75)
      ) {
        faulted.add("induction_fuel");
      }
      if (typeof health.mechanical === "number" && health.mechanical < 75) faulted.add("mechanical");
      if (typeof health.electrical === "number" && health.electrical < 75) faulted.add("electrical");
    }

    const isFault = faulted.size > 0;
    const pulse = isFault ? (Math.sin(this.pulseTime * 6.0) + 1.0) * 0.5 : 0;

    const scores: Record<string, number> = {
      lubrication: health?.lubrication ?? 100,
      cooling: health?.cooling ?? 100,
      combustion: health?.combustion ?? 100,
      induction_fuel: Math.min(health?.induction ?? 100, health?.fuel ?? 100, health?.injection ?? 100),
      mechanical: health?.mechanical ?? 100,
      electrical: health?.electrical ?? 100,
    };

    // If subsystem is faulted, guarantee degraded score for visual distinction
    for (const sub of faulted) {
      if (scores[sub] === undefined || scores[sub] > 40) {
        scores[sub] = 25;
      }
    }

    // Drive every hologram material state
    this.matFactory.all().forEach((mat: HoloMaterial) => {
      const subsystem = mat.userData.subsystem;
      this.matFactory.setState(mat, scores[subsystem] ?? 100, faulted.has(subsystem), pulse);
    });
  }
}
