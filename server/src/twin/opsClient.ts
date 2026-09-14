import WebSocket from "ws";
import {
  TickFrame, FlightContext, HealthBlock, DiagnosisBlock, PrognosisBlock,
  FaultRequest, MissionProfile, ENGINE_CHANNELS, CONTRACT_VERSION,
} from "../types";
import { SENSOR_FAULT_BY_ID } from "./contract";
import { PENDING_MISSION } from "./reliability";

/**
 * WebSocket CLIENT for Retribution's server_ops (retribution/run_ws_only.py)
 * — the real physics simulator + real, today-retrained ML pipeline,
 * replacing the TwinRun stub for live runs. Node no longer computes physics
 * or diagnosis itself for this path; it relays server_ops's frames into our
 * TickFrame contract, then everything downstream (persistence, alerts, AI
 * advisory, broadcast) is unchanged.
 *
 * No hardcoded remote default on purpose: if OPS_WS_URL isn't set, this falls
 * back to localhost so a machine without that env var (a fresh clone, a CI
 * box, a contributor who hasn't set up Railway) fails to connect fast and
 * cleanly rather than silently dialing someone else's deployed simulator.
 * runManager.ts's connect() try/catch then routes the run to the stub twin.
 * Set OPS_WS_URL to the deployed instance (e.g. the Railway wss:// domain)
 * to use the real backend.
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
const TRANSITION_GRACE_SEC = 20; // hold the displayed verdict through our own scripted throttle/altitude steps

/**
 * Schmitt-trigger band on P(healthy) — the two thresholds that decide whether
 * the engine is being called FAULTED or HEALTHY.
 *
 * Hysteresis belongs on this binary verdict, not on the exact class string.
 * The previous version required the identical 91-class label — compound labels
 * included — to win two consecutive evaluations before it would commit. With
 * dozens of compound classes the argmax legitimately alternates between
 * neighbouring ones (injector+lubrication on one evaluation, injector+cooling
 * on the next), so the vote never carried and the display stayed pinned at
 * "healthy" indefinitely, reporting "Healthy, confidence 0%" while the
 * classifier was 100% sure a compound injector fault was present. WHICH
 * compound class wins is a detail; whether ANY fault is present is the
 * decision, and that is stable.
 */
const FAULT_ENTER_P_HEALTHY = 0.4; // P(healthy) below this -> declare faulted
const FAULT_EXIT_P_HEALTHY = 0.6; // ...and it must climb back above this to clear

/**
 * Phases in which no health or diagnosis is published at all.
 *
 * The models are trained on a running, settled engine. Through start and taxi
 * the engine is going from stationary to idle to full power, every thermal
 * channel is far from its steady state, and the twin's prediction is
 * meaningless — measured live, it reported EHI 13.4 on a perfectly healthy
 * takeoff. That is not a health assessment, it is the model being asked a
 * question it cannot answer.
 *
 * Real engine monitors inhibit predictive diagnostics through start and
 * take-off for exactly this reason. Reporting "assessing" is the honest
 * output; a fabricated 13.4 trains the operator to ignore the display.
 */
const UNSTABLE_PHASES = new Set(["startup", "taxi"]);
const ASSESSING_LABEL = "assessing";

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
const CRUISE_ALT_M = 3000;
const CRUISE_POWER_PCT = 68;

/**
 * A step fires once `atSimT` is reached AND its optional `when` predicate holds.
 *
 * The level-off step needs the predicate. It used to fire at a fixed simulated
 * time (500 s) picked to be "once near target altitude", which left the
 * aircraft holding 88% climb power in level flight for roughly 200 seconds. The
 * phase machine labels level flight CRUISE, so that produced a sustained
 * CRUISE-at-88%-throttle state — an operating point that appears NOWHERE in the
 * nominal twin's training data, where CRUISE always meant 65-70%. The twin then
 * extrapolates, its residuals go to several sigma on a perfectly healthy
 * engine, and the health score collapses. Reducing power when the aircraft is
 * actually level keeps the flight inside the envelope the model was trained on.
 */
interface AutopilotStep {
  atSimT: number;
  when?: (state: { altM: number }) => boolean;
  input: Record<string, unknown>;
}

const AUTOPILOT_SCHEDULE: AutopilotStep[] = [
  { atSimT: 0, input: { throttle: 20, gear: true, autopilot: false } },
  { atSimT: 4, input: { throttle: 95 } }, // taxi -> takeoff roll (reduced from 8s to 4s)
  { atSimT: 15, input: { throttle: 88, autopilot: true, ap_target_alt: CRUISE_ALT_M, gear: false } }, // climb out (reduced from 25s to 15s)
  {
    // Cruise power on level-off, not on the clock. The atSimT floor only stops
    // it firing during the initial ground roll; the altitude predicate is what
    // actually releases it, and the schedule cannot stall because a step is
    // skipped if the aircraft never gets there (see fireDueAutopilotSteps).
    atSimT: 110,
    when: ({ altM }) => altM >= CRUISE_ALT_M * 0.97,
    input: { throttle: CRUISE_POWER_PCT },
  },
  { atSimT: 1285, input: { ap_target_alt: 150, throttle: 45 } }, // begin descent (adjusted ~115s earlier)
  { atSimT: 1450, input: { throttle: 15, gear: true } }, // approach (adjusted ~200s earlier)
  { atSimT: 1500, input: { throttle: 0, autopilot: false } }, // shutdown (adjusted ~200s earlier, ~25 min total flight)
];

/**
 * The autopilot schedule expressed as a MissionProfile, for the reliability
 * engine to project against.
 *
 * Without this the engine projected the ops flight against its own
 * DEFAULT_MISSION — legs at 20/95/85/70/55/40/25% totalling 1650 s — while the
 * aircraft was actually flying the schedule above. Every leg's power was wrong,
 * so was the time remaining, and the projection duly extrapolated healthy
 * channels to power settings the sortie would never visit and called
 * "land immediately" on a healthy engine.
 *
 * Derived from AUTOPILOT_SCHEDULE rather than restated, so the two cannot drift
 * apart. The altitude-gated level-off is placed at its nominal time, which is
 * the best available estimate before the climb has happened.
 */
export function opsMissionProfile(): MissionProfile {
  const NOMINAL_LEVEL_OFF_SIM_T = 300; // typical time to reach CRUISE_ALT_M
  const marks = AUTOPILOT_SCHEDULE.map((step, i) => ({
    atSimT: step.when ? NOMINAL_LEVEL_OFF_SIM_T : step.atSimT,
    throttle: typeof step.input.throttle === "number" ? (step.input.throttle as number) : null,
    i,
  }))
    .filter((m) => m.throttle !== null)
    .sort((a, b) => a.atSimT - b.atSimT);

  const legs = [];
  for (let k = 0; k < marks.length; k++) {
    const start = marks[k].atSimT;
    const end = k + 1 < marks.length ? marks[k + 1].atSimT : start;
    const durationSec = Math.max(1, Math.round(end - start));
    if (k + 1 < marks.length) legs.push({ durationSec, powerPct: marks[k].throttle as number });
  }
  return { legs };
}

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

  // Whether we are currently calling the engine faulted. ONLY this binary
  // verdict is debounced (see the Schmitt band above); the specific class shown
  // then follows the current argmax, so the label always agrees with the
  // probability bars rendered beside it.
  private faulted = false;
  private injected: string[] = [];
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
      this.updateVerdict(this.latestMl);
      return;
    }
    if (msg.type === "telemetry") {
      const tel = msg.data as OpsTelemetry;
      this.latestSimT = Number(tel.t_s ?? 0);
      this.fireDueAutopilotSteps(this.latestSimT, Number(tel.alt_m ?? 0));
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
   * multipliers. Altitude-gated steps additionally wait on the aircraft
   * actually getting there — see AutopilotStep. */
  private fireDueAutopilotSteps(simT: number, altM: number) {
    while (this.autopilotIndex < AUTOPILOT_SCHEDULE.length) {
      const step = AUTOPILOT_SCHEDULE[this.autopilotIndex];
      if (simT < step.atSimT) return;
      if (step.when && !step.when({ altM })) {
        // Not ready yet, but a LATER step whose own time has come must not be
        // blocked behind it — otherwise a climb that never quite reaches target
        // altitude would strand the aircraft at climb power forever.
        const next = AUTOPILOT_SCHEDULE[this.autopilotIndex + 1];
        if (!next || simT < next.atSimT) return;
        this.autopilotIndex += 1;
        continue;
      }
      this.send({ type: "flight_input", controls: step.input });
      this.lastAutopilotSimT = simT;
      this.autopilotIndex += 1;
    }
  }

  /**
   * server_ops's FaultManager APPENDS to active_faults, so faults stack there
   * exactly as they do in the stub — injecting a second one does not cancel the
   * first. We keep our own ledger of what has been commanded because the
   * classifier's label is a PREDICTION and may legitimately lag or disagree
   * with it; showing both is what lets an operator tell "the model hasn't
   * caught it yet" apart from "my injection didn't land".
   */
  injectFault(req: FaultRequest) {
    if (!this.injected.includes(req.type)) this.injected.push(req.type);
    this.send({ type: "inject_fault", fault: req.type, severity: req.severity, delay: req.onsetDelay ?? 0 });
  }

  clearFaults() {
    this.injected = [];
    this.faulted = false;
    this.send({ type: "clear_faults" });
  }

  injectedFaults(): string[] {
    return [...this.injected];
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

  /**
   * Updates the faulted/healthy verdict from the classifier's own P(healthy).
   *
   * The transition grace window still applies to ENTERING the faulted state:
   * we drive the throttle schedule ourselves, so we know when a legitimate
   * transient is underway and the classifier's 60-second feature window is a
   * pre/post-transition mix. It deliberately does NOT gate CLEARING a fault —
   * delaying good news is safe, delaying bad news is not.
   */
  /**
   * True while nothing publishable can be said: no classifier evaluation yet,
   * an unsettled phase, or inside the grace window after one of our own
   * scripted power changes.
   */
  private isAssessing(phase: string): boolean {
    if (!this.latestMl) return true;
    if (UNSTABLE_PHASES.has(phase.toLowerCase())) return true;
    return this.latestSimT - this.lastAutopilotSimT < TRANSITION_GRACE_SEC;
  }

  private updateVerdict(ml: OpsMlResult) {
    const pHealthy = ml.probabilities?.healthy ?? (ml.fault_type === "healthy" ? ml.confidence : 0);
    if (this.faulted) {
      if (pHealthy > FAULT_EXIT_P_HEALTHY) this.faulted = false;
      return;
    }
    const inTransitionWindow = this.latestSimT - this.lastAutopilotSimT < TRANSITION_GRACE_SEC;
    if (inTransitionWindow) return;
    if (pHealthy < FAULT_ENTER_P_HEALTHY) this.faulted = true;
  }

  /**
   * The class actually shown. When faulted, it is the highest-probability
   * NON-healthy class, so the label and the probability bars beside it always
   * describe the same thing.
   */
  private currentLabel(ml: OpsMlResult | null): string {
    if (!this.faulted || !ml?.probabilities) return "healthy";
    let best: string | null = null;
    let bestP = -1;
    for (const [k, v] of Object.entries(ml.probabilities)) {
      if (k === "healthy") continue;
      if (v > bestP) {
        best = k;
        bestP = v;
      }
    }
    // Faulted, but the distribution carries no non-healthy class at all: report
    // the anomaly honestly rather than inventing a classification for it.
    return best ?? "unclassified_anomaly";
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
    // null, not 100. Before the first ml_result arrives there is no health
    // assessment at all, and defaulting to a perfect score announced a healthy
    // engine on the strength of zero evidence.
    const assessing = this.isAssessing(String(tel.phase ?? ""));
    const num = (v: unknown): number | null =>
      assessing ? null : typeof v === "number" && Number.isFinite(v) ? v : null;
    const health: HealthBlock = {
      ehi: num(ml?.health_score),
      subsystems: {
        lubrication: num(s.lubrication),
        cooling: num(s.cooling),
        combustion: num(s.combustion),
        fuel: num(s.fuel),
        mechanical: num(s.mechanical),
        induction: num(s.induction),
        electrical: num(s.electrical),
        injection: num(s.injection),
      },
    };

    // label is the hysteresis-committed one (updateDisplayedLabel), not the
    // raw per-evaluation ml.fault_type — see the field comment on
    // displayedLabel above for why. confidence follows suit: show the
    // probability mass for the label we're actually displaying, not
    // ml.confidence (which is the raw top class's confidence and may refer
    // to a different, not-yet-committed label).
    // While assessing we assert nothing. Publishing "healthy" here would be a
    // claim the evidence does not support: during the takeoff grace window the
    // classifier had P(healthy) = 0.00014 while the verdict was still being
    // withheld, which would have rendered as "healthy, confidence 0%" — the
    // very contradiction the verdict logic exists to prevent.
    const label = assessing ? ASSESSING_LABEL : this.currentLabel(ml);
    // Confidence is ALWAYS the probability mass of the label being displayed,
    // never a stand-in constant.
    const labelP = ml?.probabilities?.[label];
    const confidence = assessing ? 0 : typeof labelP === "number" ? labelP : label === "healthy" ? 1 : 0;

    let sensorFault: DiagnosisBlock["sensorFault"] = { channel: null, mode: null, confidence: 0 };
    for (const part of label.split("+")) {
      const spec = SENSOR_FAULT_BY_ID.get(part);
      if (spec) {
        sensorFault = { channel: spec.channel, mode: spec.mode, confidence };
        break;
      }
    }
    const cylMatch = /_cyl(\d)/.exec(label);

    const diagnosis: DiagnosisBlock = {
      label,
      confidence,
      probs:
        assessing || !ml
          ? {}
          : Object.fromEntries(Object.entries(ml.probabilities).sort((a, b) => b[1] - a[1]).slice(0, 8)),
      anomalyScore: ml ? Math.max(0, Math.min(1, ml.anomaly_score)) : 0,
      cylinder: cylMatch ? Number(cylMatch[1]) : null,
      sensorFault,
    };

    // The ML returns a point estimate with no uncertainty attached, so the band
    // is left null here rather than manufactured from it. The old x0.7 / x1.4
    // multipliers were not derived from anything — they drew an interval around
    // the number and presented it as though it had been measured. runManager
    // fills the band in from the reliability engine's Monte Carlo crossing-time
    // distribution, which is an actual distribution.
    const rul = ml?.remaining_useful_life ?? null;
    const prognosis: PrognosisBlock = {
      rulSec: rul,
      rulLoSec: null,
      rulHiSec: null,
      basis: rul !== null ? "ml_rul_extrapolation" : "no_projection",
    };

    // server_ops has its own player-mission scoring (grade/score/fail_reason)
    // built for the flown game, not this advisory framework — we don't use it.
    //
    // Mission reliability used to be computed here as `ehi / 100` with a
    // hardcoded 1800 s endurance reserve. That is now twin/reliability.ts's
    // job, applied by runManager for BOTH backends from the trend history and
    // the mission's own remaining power schedule — so this path no longer
    // guesses at it. See PENDING_MISSION.
    const phase = String(tel.phase ?? "cruise").toLowerCase();

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
      mission: PENDING_MISSION, // replaced by ReliabilityEngine in runManager.finishTick()
      alerts: [], // filled in by AlertEngine in runManager, same as the stub path
      injectedFaults: this.injectedFaults(),
    };
  }
}
