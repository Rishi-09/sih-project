"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpsClient = void 0;
exports.opsMissionProfile = opsMissionProfile;
const ws_1 = __importDefault(require("ws"));
const types_1 = require("../types");
const contract_1 = require("./contract");
const reliability_1 = require("./reliability");
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
const AUTOPILOT_SCHEDULE = [
    { atSimT: 0, input: { throttle: 20, gear: true, autopilot: false } },
    { atSimT: 8, input: { throttle: 95 } }, // taxi -> takeoff roll
    { atSimT: 25, input: { throttle: 88, autopilot: true, ap_target_alt: CRUISE_ALT_M, gear: false } }, // climb out
    {
        // Cruise power on level-off, not on the clock. The atSimT floor only stops
        // it firing during the initial ground roll; the altitude predicate is what
        // actually releases it, and the schedule cannot stall because a step is
        // skipped if the aircraft never gets there (see fireDueAutopilotSteps).
        atSimT: 120,
        when: ({ altM }) => altM >= CRUISE_ALT_M * 0.97,
        input: { throttle: CRUISE_POWER_PCT },
    },
    { atSimT: 1400, input: { ap_target_alt: 150, throttle: 45 } }, // begin descent
    { atSimT: 1650, input: { throttle: 15, gear: true } }, // approach
    { atSimT: 1700, input: { throttle: 0, autopilot: false } }, // shutdown
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
function opsMissionProfile() {
    const NOMINAL_LEVEL_OFF_SIM_T = 300; // typical time to reach CRUISE_ALT_M
    const marks = AUTOPILOT_SCHEDULE.map((step, i) => ({
        atSimT: step.when ? NOMINAL_LEVEL_OFF_SIM_T : step.atSimT,
        throttle: typeof step.input.throttle === "number" ? step.input.throttle : null,
        i,
    }))
        .filter((m) => m.throttle !== null)
        .sort((a, b) => a.atSimT - b.atSimT);
    const legs = [];
    for (let k = 0; k < marks.length; k++) {
        const start = marks[k].atSimT;
        const end = k + 1 < marks.length ? marks[k + 1].atSimT : start;
        const durationSec = Math.max(1, Math.round(end - start));
        if (k + 1 < marks.length)
            legs.push({ durationSec, powerPct: marks[k].throttle });
    }
    return { legs };
}
class OpsClient {
    constructor(runId, seed) {
        this.runId = runId;
        this.seed = seed;
        this.ws = null;
        this.latestMl = null;
        this.latestFrame = null;
        this.lastBuiltSimT = -Infinity;
        this.connected = false;
        // Whether we are currently calling the engine faulted. ONLY this binary
        // verdict is debounced (see the Schmitt band above); the specific class shown
        // then follows the current argmax, so the label always agrees with the
        // probability bars rendered beside it.
        this.faulted = false;
        this.injected = [];
        this.autopilotIndex = 0;
        this.lastAutopilotSimT = -Infinity;
        this.latestSimT = 0;
    }
    /** Pull interface, not push — RunClock already drives a 1Hz timer that
     * calls stepRun() -> this; keeping that shape means clock.ts and
     * routes/runs.ts need zero changes to support this backend. */
    getLatestFrame() {
        return this.latestFrame;
    }
    connect() {
        return new Promise((resolve, reject) => {
            let settled = false;
            const timer = setTimeout(() => {
                if (!settled) {
                    settled = true;
                    reject(new Error(`ops WS connect timeout (${OPS_WS_URL})`));
                }
            }, 5000);
            this.ws = new ws_1.default(OPS_WS_URL);
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
    handleMessage(raw) {
        let msg;
        try {
            msg = JSON.parse(raw);
        }
        catch {
            return;
        }
        if (msg.type === "ml_result") {
            this.latestMl = msg.data;
            this.updateVerdict(this.latestMl);
            return;
        }
        if (msg.type === "telemetry") {
            const tel = msg.data;
            this.latestSimT = Number(tel.t_s ?? 0);
            this.fireDueAutopilotSteps(this.latestSimT, Number(tel.alt_m ?? 0));
            if (tel.t_s - this.lastBuiltSimT < MIN_SIM_DT)
                return;
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
    fireDueAutopilotSteps(simT, altM) {
        while (this.autopilotIndex < AUTOPILOT_SCHEDULE.length) {
            const step = AUTOPILOT_SCHEDULE[this.autopilotIndex];
            if (simT < step.atSimT)
                return;
            if (step.when && !step.when({ altM })) {
                // Not ready yet, but a LATER step whose own time has come must not be
                // blocked behind it — otherwise a climb that never quite reaches target
                // altitude would strand the aircraft at climb power forever.
                const next = AUTOPILOT_SCHEDULE[this.autopilotIndex + 1];
                if (!next || simT < next.atSimT)
                    return;
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
    injectFault(req) {
        if (!this.injected.includes(req.type))
            this.injected.push(req.type);
        this.send({ type: "inject_fault", fault: req.type, severity: req.severity, delay: req.onsetDelay ?? 0 });
    }
    clearFaults() {
        this.injected = [];
        this.faulted = false;
        this.send({ type: "clear_faults" });
    }
    injectedFaults() {
        return [...this.injected];
    }
    setSpeed(multiplier) {
        this.send({ type: "set_speed", speed: multiplier });
    }
    close() {
        this.ws?.close();
    }
    send(obj) {
        if (this.ws && this.connected)
            this.ws.send(JSON.stringify(obj));
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
    isAssessing(phase) {
        if (!this.latestMl)
            return true;
        if (UNSTABLE_PHASES.has(phase.toLowerCase()))
            return true;
        return this.latestSimT - this.lastAutopilotSimT < TRANSITION_GRACE_SEC;
    }
    updateVerdict(ml) {
        const pHealthy = ml.probabilities?.healthy ?? (ml.fault_type === "healthy" ? ml.confidence : 0);
        if (this.faulted) {
            if (pHealthy > FAULT_EXIT_P_HEALTHY)
                this.faulted = false;
            return;
        }
        const inTransitionWindow = this.latestSimT - this.lastAutopilotSimT < TRANSITION_GRACE_SEC;
        if (inTransitionWindow)
            return;
        if (pHealthy < FAULT_ENTER_P_HEALTHY)
            this.faulted = true;
    }
    /**
     * The class actually shown. When faulted, it is the highest-probability
     * NON-healthy class, so the label and the probability bars beside it always
     * describe the same thing.
     */
    currentLabel(ml) {
        if (!this.faulted || !ml?.probabilities)
            return "healthy";
        let best = null;
        let bestP = -1;
        for (const [k, v] of Object.entries(ml.probabilities)) {
            if (k === "healthy")
                continue;
            if (v > bestP) {
                best = k;
                bestP = v;
            }
        }
        // Faulted, but the distribution carries no non-healthy class at all: report
        // the anomaly honestly rather than inventing a classification for it.
        return best ?? "unclassified_anomaly";
    }
    buildTickFrame(tel) {
        const sensors = {};
        for (const ch of types_1.ENGINE_CHANNELS)
            sensors[ch] = Number(tel[ch] ?? 0);
        const context = {
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
        const num = (v) => assessing ? null : typeof v === "number" && Number.isFinite(v) ? v : null;
        const health = {
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
        let sensorFault = { channel: null, mode: null, confidence: 0 };
        for (const part of label.split("+")) {
            const spec = contract_1.SENSOR_FAULT_BY_ID.get(part);
            if (spec) {
                sensorFault = { channel: spec.channel, mode: spec.mode, confidence };
                break;
            }
        }
        const cylMatch = /_cyl(\d)/.exec(label);
        const diagnosis = {
            label,
            confidence,
            probs: assessing || !ml
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
        const prognosis = {
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
            contractVersion: types_1.CONTRACT_VERSION,
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
            mission: reliability_1.PENDING_MISSION, // replaced by ReliabilityEngine in runManager.finishTick()
            alerts: [], // filled in by AlertEngine in runManager, same as the stub path
            injectedFaults: this.injectedFaults(),
        };
    }
}
exports.OpsClient = OpsClient;
//# sourceMappingURL=opsClient.js.map