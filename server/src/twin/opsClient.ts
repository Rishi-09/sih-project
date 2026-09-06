import WebSocket from "ws";
import {
  TickFrame, FlightContext, HealthBlock, DiagnosisBlock, PrognosisBlock, MissionBlock,
  FaultRequest, ENGINE_CHANNELS, CONTRACT_VERSION,
} from "../types";
import { SENSOR_FAULT_BY_ID } from "./contract";

/**
 * WebSocket CLIENT for Retribution's server_ops (retribution/run_ws_only.py,
 * ws://localhost:8766 by default) — the real physics simulator + real,
 * today-retrained ML pipeline, replacing the TwinRun stub for live runs.
 * Node no longer computes physics or diagnosis itself for this path; it
 * relays server_ops's frames into our TickFrame contract, then everything
 * downstream (persistence, alerts, AI advisory, broadcast) is unchanged.
 *
 * Two real translation decisions, not oversights:
 * 1. server_ops streams telemetry at 20Hz; we downsample to ~1Hz here to
 *    match this whole system's one-tick-per-second contract (Prisma writes,
 *    AlertEngine debounce counts, RunClock elsewhere all assume this).
 * 2. server_ops's ml_result only arrives once every 5 simulated seconds
 *    (deliberate, on their side) — we cache the latest and reuse it across
 *    telemetry ticks until a new one arrives. That's what keeps the
 *    displayed diagnosis from visibly flickering tick to tick; see
 *    CONTEXT.md / the chat log for why this was the point.
 */

const OPS_WS_URL = process.env.OPS_WS_URL || "ws://localhost:8766";
const MIN_SIM_DT = 1.0; // seconds — downsample threshold
const TRANSITION_GRACE_SEC = 20; // hold the displayed label through our own scripted throttle/altitude steps
const LABEL_CONFIDENCE_FLOOR = 0.55; // a weak argmax doesn't get to spend hysteresis votes

/**
 * OpsEngineSim is player-flown — throttle starts at 0% and only moves when a
 * flight_input WS message says so (built for a human at a joystick in
 * Rohan's own browser game). Our console has no flight controls, so without
 * this, the aircraft just sits at idle on the ground indefinitely: still
 * "startup," 0% throttle, 0 altitude, no matter how long a run has been
 * live — a real, confirmed failure mode, not a hypothetical one.
 *
 * This is a scripted "virtual pilot": fires a fixed throttle/autopilot
 * schedule keyed to simulated seconds (not real seconds — independent of the
 * --speed multiplier). Cruise altitude/power are round numbers, not cited
 * figures; the ap_target_alt PID loop and throttle-driven airspeed in
 * ops_context.py do the rest each tick, so this only needs to fire a handful
 * of times per flight, not every tick.
 */
const AUTOPILOT_SCHEDULE: { atSimT: number; input: Record<string, unknown> }[] = [
  { atSimT: 0, input: { throttle: 20, gear: true, autopilot: false } },
  { atSimT: 8, input: { throttle: 95 } }, // taxi -> takeoff roll
  { atSimT: 25, input: { throttle: 88, autopilot: true, ap_target_alt: 3000, gear: false } }, // climb out
  { atSimT: 500, input: { throttle: 68 } }, // cruise power once near target altitude
  { atSimT: 1400, input: { ap_target_alt: 150, throttle: 45 } }, // begin descent
  { atSimT: 1650, input: { throttle: 15, gear: true } }, // approach
  { atSimT: 1700, input: { throttle: 0, autopilot: false } }, // shutdown
];

interface OpsTelemetry {
  t_s: number;
  throttle_pct: number;
  alt_m: number;
  oat_c: number;
  ias_kt: number;
  phase: string;
  [key: string]: unknown; // 19 sensor channels + game-only fields (pitch_norm, biome_id, ...) we ignore
}

interface OpsMlResult {
  health_score: number;
  subsystem_scores: Record<string, number>;
  fault_type: string;
  confidence: number;
  anomaly: boolean;
  anomaly_score: number;
  remaining_useful_life: number | null;
  probabilities: Record<string, number>;
}

export class OpsClient {
  private ws: WebSocket | null = null;
  private latestMl: OpsMlResult | null = null;
  private latestFrame: TickFrame | null = null;
  private lastBuiltSimT = -Infinity;
  private connected = false;

  // Label hysteresis: the real classifier re-evaluates every 5 simulated
  // seconds and isn't perfect — a single evaluation can briefly show a
  // different (sometimes compound) label before settling. Only commit a new
  // *displayed* label once it wins two evaluations in a row, so the console
  // doesn't visibly flip on a single noisy reading. health_score,
  // subsystem_scores, and the probability bars still update every
  // evaluation — only diagnosis.label (and what's derived from it: cylinder,
  // sensorFault) goes through this gate.
  private displayedLabel = "healthy";
  private pendingLabel: string | null = null;
  private pendingCount = 0;
  private autopilotIndex = 0;
  private lastAutopilotSimT = -Infinity;
  private latestSimT = 0;

  constructor(private runId: string, private seed: number) {}

  /** Pull interface, not push — RunClock already drives a 1Hz timer that
   * calls stepRun() -> this; keeping that shape means clock.ts and
   * routes/runs.ts need zero changes to support this backend. */
  getLatestFrame(): TickFrame | null {
    return this.latestFrame;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error(`ops WS connect timeout (${OPS_WS_URL})`));
        }
      }, 5000);

      this.ws = new WebSocket(OPS_WS_URL);
      this.ws.on("open", () => {
        this.connected = true;
        // server_ops runs ONE shared simulation continuously (not one
        // instance per connection) — reset it to this run's seed so "start
        // sortie" actually means a fresh flight, not "join whatever's
        // already in progress." Fine for one demo/presenter at a time,
        // which is the actual usage pattern here.
        this.send({ type: "reset", seed: this.seed });
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve();
        }
      });
      this.ws.on("message", (raw) => this.handleMessage(raw.toString()));
      this.ws.on("close", () => {
        this.connected = false;
      });
      this.ws.on("error", (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(err);
        }
      });
    });
  }

  private handleMessage(raw: string) {
    let msg: { type?: string; data?: unknown };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.type === "ml_result") {
      this.latestMl = msg.data as OpsMlResult;
      this.updateDisplayedLabel(this.latestMl.fault_type, this.latestMl.confidence);
      return;
    }
    if (msg.type === "telemetry") {
      const tel = msg.data as OpsTelemetry;
      this.latestSimT = Number(tel.t_s ?? 0);
      this.fireDueAutopilotSteps(this.latestSimT);
      if (tel.t_s - this.lastBuiltSimT < MIN_SIM_DT) return;
      this.lastBuiltSimT = tel.t_s;
      this.latestFrame = this.buildTickFrame(tel);
    }
    // "init_state" and other message types are ignored deliberately — init_state
    // carries whatever the shared sim was doing before our reset landed.
  }

  /** Fires every AUTOPILOT_SCHEDULE entry whose atSimT has been reached —
   * checked on every telemetry message (20Hz), so a step never gets missed
   * even if simulated time jumps past it between checks at high speed
   * multipliers. */
  private fireDueAutopilotSteps(simT: number) {
    while (this.autopilotIndex < AUTOPILOT_SCHEDULE.length && simT >= AUTOPILOT_SCHEDULE[this.autopilotIndex].atSimT) {
      this.send({ type: "flight_input", controls: AUTOPILOT_SCHEDULE[this.autopilotIndex].input });
      this.lastAutopilotSimT = simT;
      this.autopilotIndex += 1;
    }
  }

  injectFault(req: FaultRequest) {
    this.send({ type: "inject_fault", fault: req.type, severity: req.severity, delay: req.onsetDelay ?? 0 });
  }

  clearFaults() {
    this.send({ type: "clear_faults" });
  }

  setSpeed(multiplier: number) {
    this.send({ type: "set_speed", speed: multiplier });
  }

  close() {
    this.ws?.close();
  }

  private send(obj: unknown) {
    if (this.ws && this.connected) this.ws.send(JSON.stringify(obj));
  }

  private updateDisplayedLabel(candidate: string, confidence: number) {
    if (candidate === this.displayedLabel) {
      this.pendingLabel = null;
      this.pendingCount = 0;
      return;
    }
    // Two targeted filters, both aimed at what a real test run actually
    // showed (a momentary "induction_loss" reading during a scripted
    // throttle step, not a real fault) rather than blanket dampening:
    //
    // 1. Transition grace window — we drive the throttle/altitude schedule
    //    ourselves (fireDueAutopilotSteps), so we know exactly when a
    //    legitimate, expected transient starts. The classifier's 60-second
    //    feature window is guaranteed to be a pre/post-transition mix for a
    //    while after one of our own scripted steps — don't let a new label
    //    even start accumulating hysteresis votes during that window.
    // 2. Confidence floor — a candidate that's only weakly ahead in a near-flat
    //    distribution shouldn't get to spend hysteresis votes either.
    const inTransitionWindow = this.latestSimT - this.lastAutopilotSimT < TRANSITION_GRACE_SEC;
    if (inTransitionWindow || confidence < LABEL_CONFIDENCE_FLOOR) {
      this.pendingLabel = null;
      this.pendingCount = 0;
      return;
    }
    if (this.pendingLabel === candidate) {
      this.pendingCount += 1;
    } else {
      this.pendingLabel = candidate;
      this.pendingCount = 1;
    }
    if (this.pendingCount >= 2) {
      this.displayedLabel = candidate;
      this.pendingLabel = null;
      this.pendingCount = 0;
    }
  }

  private buildTickFrame(tel: OpsTelemetry): TickFrame {
    const sensors: Record<string, number> = {};
    for (const ch of ENGINE_CHANNELS) sensors[ch] = Number(tel[ch] ?? 0);

    const context: FlightContext = {
      alt_m: Number(tel.alt_m ?? 0),
      ias_kt: Number(tel.ias_kt ?? 0),
      oat_c: Number(tel.oat_c ?? 0),
      throttle_pct: Number(tel.throttle_pct ?? 0),
    };

    const ml = this.latestMl;
    const s = ml?.subsystem_scores ?? {};
    const health: HealthBlock = {
      ehi: ml?.health_score ?? 100,
      subsystems: {
        lubrication: s.lubrication ?? 100,
        cooling: s.cooling ?? 100,
        combustion: s.combustion ?? 100,
        fuel: s.fuel ?? 100,
        mechanical: s.mechanical ?? 100,
        induction: s.induction ?? 100,
        electrical: s.electrical ?? 100,
        injection: s.injection ?? 100,
      },
    };

    // label is the hysteresis-committed one (updateDisplayedLabel), not the
    // raw per-evaluation ml.fault_type — see the field comment on
    // displayedLabel above for why. confidence follows suit: show the
    // probability mass for the label we're actually displaying, not
    // ml.confidence (which is the raw top class's confidence and may refer
    // to a different, not-yet-committed label).
    const label = this.displayedLabel;
    let sensorFault: DiagnosisBlock["sensorFault"] = { channel: null, mode: null, confidence: 0 };
    for (const part of label.split("+")) {
      const spec = SENSOR_FAULT_BY_ID.get(part);
      if (spec) {
        sensorFault = { channel: spec.channel, mode: spec.mode, confidence: ml?.probabilities[label] ?? 0.8 };
        break;
      }
    }
    const cylMatch = /_cyl(\d)/.exec(label);

    const diagnosis: DiagnosisBlock = {
      label,
      confidence: ml?.probabilities[label] ?? (label === "healthy" ? 1 : 0.5),
      probs: ml ? Object.fromEntries(Object.entries(ml.probabilities).sort((a, b) => b[1] - a[1]).slice(0, 8)) : { healthy: 1 },
      anomalyScore: ml ? Math.max(0, Math.min(1, ml.anomaly_score)) : 0,
      cylinder: cylMatch ? Number(cylMatch[1]) : null,
      sensorFault,
    };

    const rul = ml?.remaining_useful_life ?? null;
    const prognosis: PrognosisBlock = {
      rulSec: rul,
      rulLoSec: rul !== null ? Math.round(rul * 0.7) : null,
      rulHiSec: rul !== null ? Math.round(rul * 1.4) : null,
      basis: "ml_rul_extrapolation",
    };

    // server_ops has its own player-mission scoring (grade/score/fail_reason)
    // built for the flown game, not this advisory framework — we don't use
    // it. pSuccess/recommendation reuse the exact same thresholds as the
    // stub's computeMission(). safeEnduranceSec has no real fuel-remaining
    // telemetry to base itself on (fuel FLOW is sampled, fuel QUANTITY isn't)
    // — falls back to the RUL estimate where one exists, else a generic
    // placeholder reserve. Flagged here, not hidden.
    //
    // Ground phases are excluded from the recommendation ladder on purpose:
    // "land immediately" for an aircraft that hasn't taken off is nonsensical
    // advice, and the health/anomaly models score STARTUP oddly anyway (see
    // the long comment above health) — an in-flight-only gate keeps the
    // advisory meaningful and avoids exactly that contradiction.
    const phase = String(tel.phase ?? "cruise").toLowerCase();
    const airborne = phase !== "startup" && phase !== "taxi" && phase !== "shutdown";
    const pSuccess = Math.max(0, Math.min(1, health.ehi / 100));
    let recommendation: MissionBlock["recommendation"] = "continue";
    if (airborne) {
      if (pSuccess < 0.5) recommendation = "land_immediately";
      else if (pSuccess < 0.8) recommendation = "return_to_base";
      else if (pSuccess < 0.95) recommendation = "derate";
    }
    const mission: MissionBlock = {
      pSuccess: Math.round(pSuccess * 100) / 100,
      recommendation,
      safeEnduranceSec: rul ?? 1800,
      derateTo: recommendation === "derate" ? 85 : null,
    };

    return {
      contractVersion: CONTRACT_VERSION,
      runId: this.runId,
      t: Math.round(tel.t_s),
      ts: new Date().toISOString(),
      phase,
      sensors,
      context,
      // Not exposed by the real predict() contract (ML_BACKEND_HANDOFF.md
      // §4) — it returns health/diagnosis/prognosis, not per-channel
      // predicted values or z-scores. SensorGrid already renders "no data"
      // for a missing residualZ entry rather than breaking.
      nominal: {},
      residualZ: {},
      health,
      diagnosis,
      prognosis,
      mission,
      alerts: [], // filled in by AlertEngine in runManager, same as the stub path
    };
  }
}
