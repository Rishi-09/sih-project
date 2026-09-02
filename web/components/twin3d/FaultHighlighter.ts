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

    const diagnosis = frame?.diagnosis;
    const isFault = !!diagnosis && diagnosis.label !== "healthy";
    const faulted = isFault ? EngineModel.faultedSubsystems(diagnosis.label) : new Set<string>();
    const pulse = isFault ? (Math.sin(this.pulseTime * 6.0) + 1.0) * 0.5 : 0;

    const health = frame?.health.subsystems;
    const scores: Record<string, number> = {
      lubrication: health?.lubrication ?? 100,
      cooling: health?.cooling ?? 100,
      combustion: health?.combustion ?? 100,
      induction_fuel: health?.inductionFuel ?? 100,
      mechanical: health?.mechanical ?? 100,
      electrical: health?.electrical ?? 100,
    };

    // Every material is driven every frame, healthy ones included — that is what
    // makes a cleared fault actually stop glowing.
    this.matFactory.all().forEach((mat: HoloMaterial) => {
      const subsystem = mat.userData.subsystem;
      this.matFactory.setState(mat, scores[subsystem] ?? 100, faulted.has(subsystem), pulse);
    });
  }
}
