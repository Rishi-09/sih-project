import { mulberry32, gaussian } from "./rng";
import { sensorContract, SensorSpec, FAULT_CLASS_BY_ID, SENSOR_FAULT_BY_ID, FaultCascadeStep } from "./contract";
import {
  TickFrame, FlightContext, DiagnosisBlock, HealthBlock, PrognosisBlock, MissionBlock,
  MissionProfile, FaultRequest, SUBSYSTEMS, CONTRACT_VERSION,
} from "../types";

export { sensorContract } from "./contract";

/**
 * Rough per-channel residual standard deviation — a modeling parameter, not a
 * citable figure (no real telemetry exists to measure it from). Everything
 * else this file uses for bands/redlines comes from /contract/sensors.json,
 * which is R1's Retribution simulator's sensors.json verbatim (source of
 * truth by team decision, 2026-09-01 — see CONTEXT.md "Revision 4"). R2's
 * real nominal-twin model (ml_procedure.md §7.1-7.2) fits these properly from
 * held-out healthy runs once real or better-simulated data exists.
 */
const RESIDUAL_SIGMA: Record<string, number> = {
  rpm: 40, map_kpa: 4, egt_1: 12, egt_2: 12, egt_3: 12, egt_4: 12,
  cht_1: 3, cht_2: 3, cht_3: 3, cht_4: 3,
  oil_press_bar: 0.2, oil_temp_c: 2.5, coolant_temp_c: 2.5,
  fuel_flow_lph: 1.2, fuel_press_bar: 0.03, inj_timing_deg: 0.8,
  vib_rms_g: 0.05, bus_voltage_v: 0.15, alt_current_a: 1.5,
};

// CHT derivation gains — coolant_temp_c is the real measured heat-removal
// signal; fuel flow is the overall heat-input proxy; per-cylinder EGT
// deviation from the 4-cylinder mean is the heat-input ASYMMETRY that makes
// a single cylinder's CHT diverge from the others. See contract/sensors.json.
const CHT_BASE_OFFSET_C = 25;
const CHT_GAIN_FUEL = 0.3;
const CHT_GAIN_EGT_DEVIATION = 0.15;
const CHT_FUEL_FLOW_REF_LPH = 12;

function deriveCht(coolantTempC: number, fuelFlowLph: number, egtK: number, egtMean: number): number {
  return (
    coolantTempC +
    CHT_BASE_OFFSET_C +
    CHT_GAIN_FUEL * (fuelFlowLph - CHT_FUEL_FLOW_REF_LPH) +
    CHT_GAIN_EGT_DEVIATION * (egtK - egtMean)
  );
}

interface ActiveFault {
  type: string;
  severity: number;
  onsetAt: number;
  cylinder: number | null;
}
interface SensorFaultState {
  faultId: string;
  channel: string;
  mode: "frozen" | "drift";
  onsetAt: number;
  frozenValue?: number;
}

const DEFAULT_MISSION: MissionProfile = {
  legs: [
    { durationSec: 60, powerPct: 20 },
    { durationSec: 30, powerPct: 95 },
    { durationSec: 180, powerPct: 85 },
    { durationSec: 900, powerPct: 70 },
    { durationSec: 300, powerPct: 55 },
    { durationSec: 120, powerPct: 40 },
    { durationSec: 60, powerPct: 25 },
  ],
};
const PHASE_NAMES = ["startup", "takeoff", "climb", "cruise", "loiter", "descent", "approach"];

/**
 * PLACEHOLDER for R1's physics-informed simulator + R2's nominal-twin / classifier /
 * anomaly / sensor-fault / health / RUL / mission-reliability stack.
 *
 * Structurally matches the real contract exactly (same TickFrame shape, same
 * init/step/fault operations — ml_procedure.md §6). Swap this class's internals
 * for a call to the real Python twin-core service and nothing in routes/, ws/,
 * or the frontend needs to change.
 */
export class TwinRun {
  readonly runId: string;
  readonly engineId: string;
  readonly seed: number;
  readonly scenario: string;
  readonly missionProfile: MissionProfile;

  private rng: () => number;
  private t = 0;
  private legIndex = 0;
  private legElapsed = 0;
  private smoothed: Record<string, number> = {};
  private activeFaults: ActiveFault[] = [];
  private ehiHistory: { t: number; ehi: number }[] = [];
  private sensorFault: SensorFaultState | null = null;

  constructor(runId: string, engineId: string, seed: number, scenario: string, missionProfile?: MissionProfile) {
    this.runId = runId;
    this.engineId = engineId;
    this.seed = seed;
    this.scenario = scenario;
    this.missionProfile = missionProfile ?? DEFAULT_MISSION;
    this.rng = mulberry32(seed);
    for (const spec of sensorContract.engine) {
      if (spec.estimated) continue;
      this.smoothed[spec.id] = this.restingValue(spec);
    }
  }

  injectFault(req: FaultRequest) {
    // Sensor faults (contract/faults.json's sensorFaults) each target exactly
    // one fixed channel/mode — Retribution doesn't randomize this, so neither
    // do we. Unknown req.type is silently a no-op engine fault below (falls
    // through FAULT_CLASS_BY_ID.get() returning undefined) rather than a
    // random guess at what the caller meant.
    const sensorFault = SENSOR_FAULT_BY_ID.get(req.type);
    if (sensorFault) {
      this.sensorFault = {
        faultId: sensorFault.id,
        channel: sensorFault.channel,
        mode: sensorFault.mode,
        onsetAt: this.t + (req.onsetDelay ?? 0),
      };
      return;
    }
    // ignition_fault_cyl3 / injector_fault_cyl3 are hardcoded to cylinder 3 in
    // Retribution's simulator today (SIMULATOR_CONTEXT.md §14) — the fault
    // class's own `cylinder` field is authoritative, not a client-supplied one.
    const faultClass = FAULT_CLASS_BY_ID.get(req.type);
    this.activeFaults.push({
      type: req.type,
      severity: clamp(req.severity, 0, 1),
      onsetAt: this.t + (req.onsetDelay ?? 0),
      cylinder: faultClass?.cylinder ?? null,
    });
  }

  clearFaults() {
    this.activeFaults = [];
    this.sensorFault = null;
  }

  get elapsedSec() {
    return this.t;
  }

  step(): TickFrame {
    this.t += 1;
    this.advancePhase();

    const context = this.computeContext();
    const nominal: Record<string, number> = {};
    const sensors: Record<string, number> = {};
    const residualZ: Record<string, number> = {};

    // Pass 1: every independently-sampled channel (everything except cht_1..4)
    for (const spec of sensorContract.engine) {
      if (spec.estimated) continue;
      const target = this.nominalTarget(spec, context);
      const alpha = spec.id.startsWith("egt") || spec.id.includes("temp") ? 0.05 : 0.35;
      this.smoothed[spec.id] = this.smoothed[spec.id] + alpha * (target - this.smoothed[spec.id]);
      nominal[spec.id] = round2(this.smoothed[spec.id]);

      let value = this.smoothed[spec.id] + gaussian(this.rng, 0, (RESIDUAL_SIGMA[spec.id] ?? 1) * 0.3);
      value += this.faultDelta(spec.id);
      value = this.applySensorFaultOverlay(spec.id, value);

      sensors[spec.id] = round2(value);
      const sigma = RESIDUAL_SIGMA[spec.id] ?? 1;
      residualZ[spec.id] = round2((value - nominal[spec.id]) / sigma);
    }

    // Pass 2: cht_1..4 — physics-informed ESTIMATE, not a real sensor (this
    // engine has no factory CHT probe; see contract/sensors.json). Derived
    // from the already-computed real channels above, using the ACTUAL
    // (post-fault, post-noise) values for `sensors` and the pre-fault
    // baseline for `nominal` — which means any fault that moves egt_k or
    // coolant_temp_c propagates into CHT automatically, with no separate
    // fault-cascade code needed for it. The per-cylinder EGT deviation from
    // the 4-cylinder mean — the manual's own "EGT-Split" concept — drives
    // this internally; it's not exposed as its own top-level channel (kept
    // to the original 19-channel count).
    const egts = [sensors.egt_1, sensors.egt_2, sensors.egt_3, sensors.egt_4];
    const nomEgts = [nominal.egt_1, nominal.egt_2, nominal.egt_3, nominal.egt_4];
    const egtMeanActual = (egts[0] + egts[1] + egts[2] + egts[3]) / 4;
    const egtMeanNominal = (nomEgts[0] + nomEgts[1] + nomEgts[2] + nomEgts[3]) / 4;
    for (let k = 1; k <= 4; k++) {
      const chtId = `cht_${k}`;
      sensors[chtId] = round2(deriveCht(sensors.coolant_temp_c, sensors.fuel_flow_lph, egts[k - 1], egtMeanActual));
      nominal[chtId] = round2(deriveCht(nominal.coolant_temp_c, nominal.fuel_flow_lph, nomEgts[k - 1], egtMeanNominal));
      residualZ[chtId] = round2((sensors[chtId] - nominal[chtId]) / (RESIDUAL_SIGMA[chtId] ?? 3));
    }

    const health = this.computeHealth(residualZ);
    this.ehiHistory.push({ t: this.t, ehi: health.ehi });
    if (this.ehiHistory.length > 240) this.ehiHistory.shift();

    return {
      contractVersion: CONTRACT_VERSION,
      runId: this.runId,
      t: this.t,
      ts: new Date().toISOString(),
      phase: PHASE_NAMES[this.legIndex] ?? "cruise",
      sensors,
      context,
      nominal,
      residualZ,
      health,
      diagnosis: this.computeDiagnosis(residualZ),
      prognosis: this.computePrognosis(),
      mission: this.computeMission(health.ehi),
      alerts: [], // filled in by AlertEngine in runManager, kept out of this class deliberately
    };
  }

  // ---- internals -----------------------------------------------------

  private restingValue(spec: SensorSpec): number {
    // A reasonable idle/ground-power starting point per channel, used only to
    // seed the smoothing filter — nominalTarget() takes over immediately.
    // fuel_press_bar and bus_voltage_v are regulated, flat channels — rest at
    // the middle of their normal band rather than near its floor.
    if (spec.id === "fuel_press_bar" || spec.id === "bus_voltage_v") {
      return spec.normalMin !== undefined && spec.normalMax !== undefined
        ? (spec.normalMin + spec.normalMax) / 2
        : 0;
    }
    if (spec.normalMin !== undefined && spec.normalMax !== undefined) {
      return spec.normalMin + (spec.normalMax - spec.normalMin) * 0.2;
    }
    if (spec.max !== undefined) return spec.max * 0.3;
    return 0;
  }

  private advancePhase() {
    this.legElapsed += 1;
    const leg = this.missionProfile.legs[this.legIndex];
    if (leg && this.legElapsed >= leg.durationSec && this.legIndex < this.missionProfile.legs.length - 1) {
      this.legIndex += 1;
      this.legElapsed = 0;
    }
  }

  private computeContext(): FlightContext {
    const leg = this.missionProfile.legs[this.legIndex] ?? this.missionProfile.legs[this.missionProfile.legs.length - 1];
    const phase = PHASE_NAMES[this.legIndex] ?? "cruise";
    const altByPhase: Record<string, number> = { startup: 0, takeoff: 200, climb: 3000, cruise: 4200, loiter: 4200, descent: 1500, approach: 200 };
    const alt = altByPhase[phase] ?? 4200;
    return {
      throttle_pct: leg.powerPct,
      alt_m: alt,
      oat_c: round2(15 - alt / 200 + gaussian(this.rng, 0, 0.3)),
      ias_kt: round2(40 + leg.powerPct * 0.5 + gaussian(this.rng, 0, 1)),
    };
  }

  private nominalTarget(spec: SensorSpec, ctx: FlightContext): number {
    const f = ctx.throttle_pct / 100;
    const lo = spec.normalMin ?? 0;
    const hi = spec.normalMax ?? lo;
    switch (spec.id) {
      case "rpm":
        // Retribution config.py: idle 1400 rpm, max continuous 5500 rpm.
        // 5800/5850 (caution/redline) are limited-duration ceilings, not
        // sustained targets.
        return lo + (hi - lo) * f;
      case "map_kpa": {
        // Retribution: normal 35-135 kPa, redline 154 kPa. Turbo boost held
        // roughly flat up to a critical altitude, then rolls off — the
        // ~4000m figure is a general turbo-engine estimate, not a cited one.
        const base = lo + (hi - lo) * f;
        const criticalAltEstimate = 4000;
        const rolloff = ctx.alt_m > criticalAltEstimate ? (ctx.alt_m - criticalAltEstimate) * 0.015 : 0;
        return Math.max(lo, base - rolloff);
      }
      case "egt_1":
      case "egt_2":
      case "egt_3":
      case "egt_4":
        // Retribution's real sensors.py uses a non-monotonic per-cylinder
        // curve (peaks ~75% throttle, leans out at high power) plus a fixed
        // per-cylinder manufacturing offset. This stub approximates that with
        // a straight interpolation across the normal band (750-850°C) — it's
        // replaced entirely once serve.py calls the real EngineSim.
        return lo + (hi - lo) * f;
      case "oil_press_bar":
        // Oil pressure rises with rpm/oil-pump speed. Retribution's schema
        // has no RPM-conditional floor (flat 2.0-5.0 bar normal band), so a
        // plain throttle-scaled interpolation is enough here.
        return lo + (hi - lo) * f;
      case "oil_temp_c":
        return lo + (hi - lo) * f;
      case "coolant_temp_c":
        return lo + (hi - lo) * f;
      case "fuel_flow_lph":
        return lo + (hi - lo) * f;
      case "fuel_press_bar":
        // Regulated EFI rail pressure — roughly flat regardless of throttle.
        return (lo + hi) / 2;
      case "inj_timing_deg":
        return lo + (hi - lo) * f;
      case "vib_rms_g":
        return lo + (hi - lo) * f;
      case "bus_voltage_v":
        // Alternator-regulated once running — roughly flat, not throttle-scaled.
        return (lo + hi) / 2;
      case "alt_current_a":
        return lo + (hi - lo) * f;
      default:
        return 0;
    }
  }

  /**
   * Sums each active fault's per-channel cascade delta — a direct port of
   * Retribution's FaultManager.apply_faults()/ChannelFaultProfile.compute_effect
   * (faults.py), driven entirely by contract/faults.json's transcribed
   * delaySec/rampSec/delta/shape data, not a per-fault-type switch statement.
   * Retribution sums deltas across concurrent faults on the same channel and
   * never uses a gain multiplier other than the neutral default — see
   * contract/faults.json's _note — so plain addition here is faithful, not a
   * simplification.
   */
  private faultDelta(channel: string): number {
    let delta = 0;
    for (const f of this.activeFaults) {
      if (this.t < f.onsetAt) continue;
      const elapsedSinceOnset = this.t - f.onsetAt;
      const faultClass = FAULT_CLASS_BY_ID.get(f.type);
      for (const step of faultClass?.cascade ?? []) {
        if (step.channel !== channel) continue;
        delta += cascadeEffect(step, elapsedSinceOnset, f.severity);
      }
    }
    return delta;
  }

  private applySensorFaultOverlay(channel: string, value: number): number {
    if (!this.sensorFault || this.sensorFault.channel !== channel || this.t < this.sensorFault.onsetAt) return value;
    if (this.sensorFault.mode === "frozen") {
      if (this.sensorFault.frozenValue === undefined) this.sensorFault.frozenValue = value;
      return this.sensorFault.frozenValue;
    }
    // drift — exact linear rate from this sensor fault's contract/faults.json entry
    const spec = SENSOR_FAULT_BY_ID.get(this.sensorFault.faultId);
    if (!spec || spec.delta === undefined || spec.rampSec === undefined) return value;
    const elapsed = this.t - this.sensorFault.onsetAt;
    return value + Math.min(1, elapsed / spec.rampSec) * spec.delta;
  }

  private computeHealth(residualZ: Record<string, number>): HealthBlock {
    const scoreFor = (channels: readonly string[]) => {
      if (channels.length === 0) return 100;
      const meanAbs = channels.reduce((s, c) => s + Math.abs(residualZ[c] ?? 0), 0) / channels.length;
      return clamp(100 - meanAbs * 18, 0, 100);
    };
    const subsystems = {
      lubrication: round2(scoreFor(SUBSYSTEMS.lubrication)),
      cooling: round2(scoreFor(SUBSYSTEMS.cooling)),
      combustion: round2(scoreFor(SUBSYSTEMS.combustion)),
      fuel: round2(scoreFor(SUBSYSTEMS.fuel)),
      mechanical: round2(scoreFor(SUBSYSTEMS.mechanical)),
      induction: round2(scoreFor(SUBSYSTEMS.induction)),
      electrical: round2(scoreFor(SUBSYSTEMS.electrical)),
      injection: round2(scoreFor(SUBSYSTEMS.injection)),
    };
    const values = Object.values(subsystems);
    const ehi = round2(0.6 * Math.min(...values) + 0.4 * (values.reduce((a, b) => a + b, 0) / values.length));
    return { ehi, subsystems };
  }

  private computeDiagnosis(residualZ: Record<string, number>): DiagnosisBlock {
    let label = "healthy";
    let confidence = 0.9;
    let cylinder: number | null = null;
    const probs: Record<string, number> = { healthy: 1 };

    const active = this.activeFaults
      .filter((f) => this.t >= f.onsetAt)
      .map((f) => ({ f, ramp: Math.min(1, (this.t - f.onsetAt) / 120) }))
      .sort((a, b) => b.f.severity * b.ramp - a.f.severity * a.ramp);

    if (active.length > 0) {
      const top = active[0];
      label = top.f.type;
      confidence = round2(clamp(0.5 + 0.45 * top.f.severity * top.ramp, 0.3, 0.97));
      cylinder = top.f.cylinder;
      probs[label] = confidence;
      probs.healthy = round2(1 - confidence);
      for (let i = 1; i < active.length; i++) {
        const share = round2((1 - confidence) * 0.3);
        probs[active[i].f.type] = (probs[active[i].f.type] ?? 0) + share;
      }
    }

    const zValues = Object.values(residualZ);
    const meanAbsZ = zValues.reduce((s, z) => s + Math.abs(z), 0) / zValues.length;
    const anomalyScore = round2(clamp(meanAbsZ / 5, 0, 1));

    const faultLive = this.sensorFault && this.t >= this.sensorFault.onsetAt;
    return {
      label,
      confidence,
      probs,
      anomalyScore,
      cylinder,
      sensorFault: {
        channel: faultLive ? this.sensorFault!.channel : null,
        mode: faultLive ? this.sensorFault!.mode : null,
        confidence: faultLive ? 0.8 : 0,
      },
    };
  }

  private computePrognosis(): PrognosisBlock {
    if (this.ehiHistory.length < 30) return { rulSec: null, rulLoSec: null, rulHiSec: null, basis: "ehi_trend" };
    const recent = this.ehiHistory.slice(-180);
    const n = recent.length;
    const meanT = recent.reduce((s, p) => s + p.t, 0) / n;
    const meanE = recent.reduce((s, p) => s + p.ehi, 0) / n;
    let num = 0;
    let den = 0;
    for (const p of recent) {
      num += (p.t - meanT) * (p.ehi - meanE);
      den += (p.t - meanT) ** 2;
    }
    const slope = den === 0 ? 0 : num / den;
    if (slope >= -0.001) return { rulSec: null, rulLoSec: null, rulHiSec: null, basis: "ehi_trend" };

    const current = recent[recent.length - 1].ehi;
    const rulSec = Math.round((current - 40) / -slope);
    if (rulSec <= 0) return { rulSec: null, rulLoSec: null, rulHiSec: null, basis: "ehi_trend" };
    return { rulSec, rulLoSec: Math.round(rulSec * 0.7), rulHiSec: Math.round(rulSec * 1.4), basis: "ehi_trend" };
  }

  private computeMission(ehi: number): MissionBlock {
    const pSuccess = round2(clamp(ehi / 100, 0, 1));
    let recommendation: MissionBlock["recommendation"] = "continue";
    if (pSuccess < 0.5) recommendation = "land_immediately";
    else if (pSuccess < 0.8) recommendation = "return_to_base";
    else if (pSuccess < 0.95) recommendation = "derate";
    const remainingLegs = this.missionProfile.legs.slice(this.legIndex + 1);
    const safeEnduranceSec = remainingLegs.reduce((s, l) => s + l.durationSec, 0);
    return { pSuccess, recommendation, safeEnduranceSec, derateTo: recommendation === "derate" ? 85 : null };
  }
}

/**
 * Exact port of faults.py's ChannelFaultProfile.compute_effect — delay, then a
 * linear/exponential/step ramp to full severity over rampSec. "freeze" is not
 * handled here: it only ever appears on sensor faults (contract/faults.json's
 * sensorFaults), which go through applySensorFaultOverlay() instead.
 */
function cascadeEffect(step: FaultCascadeStep, elapsedSinceOnset: number, severity: number): number {
  if (elapsedSinceOnset < step.delaySec) return 0;
  const tActive = elapsedSinceOnset - step.delaySec;
  const progress = Math.min(1, tActive / Math.max(0.1, step.rampSec));
  const factor = step.shape === "step" ? 1 : step.shape === "exponential" ? (Math.exp(3 * progress) - 1) / (Math.exp(3) - 1) : progress;
  return step.delta * factor * clamp(severity, 0, 1);
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}
function round2(v: number) {
  return Math.round(v * 100) / 100;
}
