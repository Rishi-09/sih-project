"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TwinRun = exports.sensorContract = void 0;
const rng_1 = require("./rng");
const contract_1 = require("./contract");
const reliability_1 = require("./reliability");
const types_1 = require("../types");
var contract_2 = require("./contract");
Object.defineProperty(exports, "sensorContract", { enumerable: true, get: function () { return contract_2.sensorContract; } });
/**
 * Rough per-channel residual standard deviation — a modeling parameter, not a
 * citable figure (no real telemetry exists to measure it from). Everything
 * else this file uses for bands/redlines comes from /contract/sensors.json,
 * which is R1's Retribution simulator's sensors.json verbatim (source of
 * truth by team decision, 2026-09-01 — see CONTEXT.md "Revision 4"). R2's
 * real nominal-twin model (ml_procedure.md §7.1-7.2) fits these properly from
 * held-out healthy runs once real or better-simulated data exists.
 */
const RESIDUAL_SIGMA = {
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
// Residual z-score at which this stub calls the engine fully anomalous. 5 sigma
// is the conventional "this is not noise" threshold; the anomaly score is the
// mean |z| across all channels expressed as a fraction of it, so the number now
// states what it means instead of being a bare divisor.
const ANOMALY_FULL_SCALE_Z = 5;
// Fault ramps reach full expression this long after onset. Matches the longest
// ramp_duration_s in contract/faults.json, so a fault is called fully developed
// no sooner than its slowest channel actually gets there.
const FAULT_RAMP_FULL_SEC = 120;
// EHI at which this stub's trend-based RUL calls the engine unfit to continue.
// Distinct from a redline: it is the point where the health index itself, not
// any single channel, says the engine should already be on the ground.
const EHI_FAILURE_THRESHOLD = 40;
// Minimum EHI decline (points per second) that counts as a real downward trend
// rather than regression noise on a flat history.
const EHI_TREND_FLOOR = 0.001;
function deriveCht(coolantTempC, fuelFlowLph, egtK, egtMean) {
    return (coolantTempC +
        CHT_BASE_OFFSET_C +
        CHT_GAIN_FUEL * (fuelFlowLph - CHT_FUEL_FLOW_REF_LPH) +
        CHT_GAIN_EGT_DEVIATION * (egtK - egtMean));
}
const DEFAULT_MISSION = {
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
class TwinRun {
    constructor(runId, engineId, seed, scenario, missionProfile) {
        this.t = 0;
        this.legIndex = 0;
        this.legElapsed = 0;
        this.smoothed = {};
        this.activeFaults = [];
        this.faultSeq = 0;
        this.ehiHistory = [];
        this.sensorFaults = [];
        this.runId = runId;
        this.engineId = engineId;
        this.seed = seed;
        this.scenario = scenario;
        this.missionProfile = missionProfile ?? DEFAULT_MISSION;
        this.rng = (0, rng_1.mulberry32)(seed);
        for (const spec of contract_1.sensorContract.engine) {
            if (spec.estimated)
                continue;
            this.smoothed[spec.id] = this.restingValue(spec);
        }
    }
    /**
     * Faults ACCUMULATE — injecting a second one does not replace the first, on
     * either the engine or the sensor side. This matches Retribution's own
     * FaultManager.inject_fault(), which appends to active_faults, and it is what
     * makes compound failures (the whole point of the v3 dataset) reachable from
     * the console.
     *
     * Re-injecting a fault id that is ALREADY active restarts it at the new
     * severity rather than stacking a duplicate — that is what an operator
     * dragging the severity slider and pressing Inject again means.
     */
    injectFault(req) {
        const onsetAt = this.t + (req.onsetDelay ?? 0);
        // Sensor faults (contract/faults.json's sensorFaults) each target exactly
        // one fixed channel/mode — Retribution doesn't randomize this, so neither
        // do we.
        const sensorFault = contract_1.SENSOR_FAULT_BY_ID.get(req.type);
        if (sensorFault) {
            this.sensorFaults = this.sensorFaults.filter((f) => f.faultId !== sensorFault.id);
            this.sensorFaults.push({
                faultId: sensorFault.id,
                channel: sensorFault.channel,
                mode: sensorFault.mode,
                onsetAt,
                seq: this.faultSeq++,
            });
            return;
        }
        // ignition_fault_cyl3 / injector_fault_cyl3 are hardcoded to cylinder 3 in
        // Retribution's simulator today (SIMULATOR_CONTEXT.md §14) — the fault
        // class's own `cylinder` field is authoritative, not a client-supplied one.
        const faultClass = contract_1.FAULT_CLASS_BY_ID.get(req.type);
        // An id matching neither table used to be accepted and then do nothing,
        // which is indistinguishable from "the inject button is broken".
        if (!faultClass)
            throw new Error(`Unknown fault type "${req.type}"`);
        this.activeFaults = this.activeFaults.filter((f) => f.type !== req.type);
        this.activeFaults.push({
            type: req.type,
            severity: clamp(req.severity, 0, 1),
            onsetAt,
            cylinder: faultClass.cylinder ?? null,
            seq: this.faultSeq++,
        });
    }
    clearFaults() {
        this.activeFaults = [];
        this.sensorFaults = [];
    }
    /** Ground truth for the console's "currently injected" readout, in the order
     * they were injected. Empty in real operation — nothing injects faults into a
     * real engine. */
    injectedFaults() {
        const engine = this.activeFaults.map((f) => ({ seq: f.seq, id: f.type }));
        const sensor = this.sensorFaults.map((f) => ({ seq: f.seq, id: f.faultId }));
        return [...engine, ...sensor].sort((a, b) => a.seq - b.seq).map((f) => f.id);
    }
    get elapsedSec() {
        return this.t;
    }
    step() {
        this.t += 1;
        this.advancePhase();
        const context = this.computeContext();
        const nominal = {};
        const sensors = {};
        const residualZ = {};
        // Pass 1: every independently-sampled channel (everything except cht_1..4)
        for (const spec of contract_1.sensorContract.engine) {
            if (spec.estimated)
                continue;
            const target = this.nominalTarget(spec, context);
            const alpha = spec.id.startsWith("egt") || spec.id.includes("temp") ? 0.05 : 0.35;
            this.smoothed[spec.id] = this.smoothed[spec.id] + alpha * (target - this.smoothed[spec.id]);
            nominal[spec.id] = round2(this.smoothed[spec.id]);
            let value = this.smoothed[spec.id] + (0, rng_1.gaussian)(this.rng, 0, (RESIDUAL_SIGMA[spec.id] ?? 1) * 0.3);
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
        // The stub computes health every tick from its own residuals, so it always
        // has a number here — unlike the ops backend, which genuinely has none
        // until the ML reports. Guarded rather than asserted so a future change to
        // computeHealth cannot silently poison the RUL trend with a zero.
        if (health.ehi !== null)
            this.ehiHistory.push({ t: this.t, ehi: health.ehi });
        if (this.ehiHistory.length > 240)
            this.ehiHistory.shift();
        return {
            contractVersion: types_1.CONTRACT_VERSION,
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
            // Mission reliability is computed by twin/reliability.ts and applied in
            // runManager.finishTick(), same as the ops backend — this class used to
            // compute `ehi / 100` here, which measured present degradation rather
            // than whether the sortie will finish. Kept out of this class
            // deliberately, exactly like alerts below.
            mission: reliability_1.PENDING_MISSION,
            alerts: [], // filled in by AlertEngine in runManager, kept out of this class deliberately
            injectedFaults: this.injectedFaults(),
        };
    }
    // ---- internals -----------------------------------------------------
    restingValue(spec) {
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
        if (spec.max !== undefined)
            return spec.max * 0.3;
        return 0;
    }
    advancePhase() {
        this.legElapsed += 1;
        const leg = this.missionProfile.legs[this.legIndex];
        if (leg && this.legElapsed >= leg.durationSec && this.legIndex < this.missionProfile.legs.length - 1) {
            this.legIndex += 1;
            this.legElapsed = 0;
        }
    }
    computeContext() {
        const leg = this.missionProfile.legs[this.legIndex] ?? this.missionProfile.legs[this.missionProfile.legs.length - 1];
        const phase = PHASE_NAMES[this.legIndex] ?? "cruise";
        const altByPhase = { startup: 0, takeoff: 200, climb: 3000, cruise: 4200, loiter: 4200, descent: 1500, approach: 200 };
        const alt = altByPhase[phase] ?? 4200;
        return {
            throttle_pct: leg.powerPct,
            alt_m: alt,
            oat_c: round2(15 - alt / 200 + (0, rng_1.gaussian)(this.rng, 0, 0.3)),
            ias_kt: round2(40 + leg.powerPct * 0.5 + (0, rng_1.gaussian)(this.rng, 0, 1)),
        };
    }
    nominalTarget(spec, ctx) {
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
    faultDelta(channel) {
        let delta = 0;
        for (const f of this.activeFaults) {
            if (this.t < f.onsetAt)
                continue;
            const elapsedSinceOnset = this.t - f.onsetAt;
            const faultClass = contract_1.FAULT_CLASS_BY_ID.get(f.type);
            for (const step of faultClass?.cascade ?? []) {
                if (step.channel !== channel)
                    continue;
                delta += cascadeEffect(step, elapsedSinceOnset, f.severity);
            }
        }
        return delta;
    }
    /**
     * Applies EVERY live sensor fault touching this channel, in injection order.
     * The two sensor faults in contract/faults.json target different channels, so
     * today this only ever composes one — but the previous single-slot overlay
     * silently EVICTED the earlier fault when a second was injected, which is
     * exactly what made a second injection look like it had been ignored.
     */
    applySensorFaultOverlay(channel, value) {
        let out = value;
        for (const sf of this.sensorFaults) {
            if (sf.channel !== channel || this.t < sf.onsetAt)
                continue;
            if (sf.mode === "frozen") {
                // A freeze overrides anything applied before it — the reading is stuck.
                if (sf.frozenValue === undefined)
                    sf.frozenValue = out;
                out = sf.frozenValue;
                continue;
            }
            // drift — exact linear rate from this sensor fault's contract/faults.json entry
            const spec = contract_1.SENSOR_FAULT_BY_ID.get(sf.faultId);
            if (!spec || spec.delta === undefined || spec.rampSec === undefined)
                continue;
            const elapsed = this.t - sf.onsetAt;
            out += Math.min(1, elapsed / spec.rampSec) * spec.delta;
        }
        return out;
    }
    computeHealth(residualZ) {
        const scoreFor = (channels) => {
            if (channels.length === 0)
                return 100;
            const meanAbs = channels.reduce((s, c) => s + Math.abs(residualZ[c] ?? 0), 0) / channels.length;
            return clamp(100 - meanAbs * 18, 0, 100);
        };
        const subsystems = {
            lubrication: round2(scoreFor(types_1.SUBSYSTEMS.lubrication)),
            cooling: round2(scoreFor(types_1.SUBSYSTEMS.cooling)),
            combustion: round2(scoreFor(types_1.SUBSYSTEMS.combustion)),
            fuel: round2(scoreFor(types_1.SUBSYSTEMS.fuel)),
            mechanical: round2(scoreFor(types_1.SUBSYSTEMS.mechanical)),
            induction: round2(scoreFor(types_1.SUBSYSTEMS.induction)),
            electrical: round2(scoreFor(types_1.SUBSYSTEMS.electrical)),
            injection: round2(scoreFor(types_1.SUBSYSTEMS.injection)),
        };
        const values = Object.values(subsystems);
        const ehi = round2(0.6 * Math.min(...values) + 0.4 * (values.reduce((a, b) => a + b, 0) / values.length));
        return { ehi, subsystems };
    }
    /**
     * Builds the COMPOUND label, joined with "+" in injection order — the same
     * format Retribution's FaultManager.get_state() produces and the same format
     * the real 91-class classifier is trained on.
     *
     * This previously reported only the single strongest fault, so injecting a
     * second one changed the physics but never changed the displayed label. The
     * fault was being applied; the console just never said so.
     */
    computeDiagnosis(residualZ) {
        // Engine and sensor faults share one ordering, exactly as they share one
        // active_faults list in the Python.
        const active = [
            ...this.activeFaults.map((f) => ({ seq: f.seq, id: f.type, severity: f.severity, onsetAt: f.onsetAt, cylinder: f.cylinder })),
            ...this.sensorFaults.map((f) => ({ seq: f.seq, id: f.faultId, severity: 1, onsetAt: f.onsetAt, cylinder: null })),
        ]
            .filter((f) => this.t >= f.onsetAt)
            .sort((a, b) => a.seq - b.seq)
            .map((f) => ({ ...f, strength: f.severity * Math.min(1, (this.t - f.onsetAt) / FAULT_RAMP_FULL_SEC) }));
        const zValues = Object.values(residualZ);
        const meanAbsZ = zValues.reduce((s, z) => s + Math.abs(z), 0) / zValues.length;
        const anomalyScore = round2(clamp(meanAbsZ / ANOMALY_FULL_SCALE_Z, 0, 1));
        // The console's sensorFault block stays single-valued (contract 1.1.0); the
        // compound label above is what surfaces a second one. Reports the earliest
        // still-live sensor fault.
        const liveSensor = this.sensorFaults.filter((f) => this.t >= f.onsetAt).sort((a, b) => a.seq - b.seq)[0];
        const sensorFault = {
            channel: liveSensor?.channel ?? null,
            mode: liveSensor?.mode ?? null,
            // Grows as the faulted channel's own residual grows, rather than sitting
            // at a fixed 0.8 from the instant of injection.
            confidence: liveSensor
                ? round2(clamp(Math.abs(residualZ[liveSensor.channel] ?? 0) / ANOMALY_FULL_SCALE_Z, 0.3, 0.99))
                : 0,
        };
        if (active.length === 0) {
            // Confidence in "healthy" falls as the residuals grow — a flat 0.9 claimed
            // the same certainty whether every channel sat on its nominal or the
            // engine was 4 sigma out with no fault yet classified.
            const confidence = round2(clamp(1 - anomalyScore, 0.3, 1));
            return { label: "healthy", confidence, probs: { healthy: confidence }, anomalyScore, cylinder: null, sensorFault };
        }
        const label = active.map((f) => f.id).join("+");
        // A compound diagnosis is only as well-established as its LEAST developed
        // member — a fault injected two seconds ago has barely moved a sensor yet,
        // and claiming high confidence in the pair would be claiming to have seen
        // evidence that does not exist.
        const weakest = Math.min(...active.map((f) => f.strength));
        const confidence = round2(clamp(0.5 + 0.45 * weakest, 0.3, 0.97));
        // Mass is split between the exact compound class, each constituent seen
        // alone, and healthy — mirroring how the real multiclass classifier spreads
        // probability over related labels rather than spiking one.
        const weights = { [label]: confidence, healthy: 1 - Math.max(...active.map((f) => f.strength)) };
        if (active.length > 1) {
            for (const f of active)
                weights[f.id] = (weights[f.id] ?? 0) + f.strength * 0.5;
        }
        const total = Object.values(weights).reduce((a, b) => a + b, 0) || 1;
        const probs = {};
        for (const [k, v] of Object.entries(weights))
            probs[k] = round2(v / total);
        return {
            label,
            confidence,
            probs,
            anomalyScore,
            // First fault carrying a cylinder — only the cyl3 ignition/injector
            // faults do, and only one of them can be active on a given cylinder.
            cylinder: active.find((f) => f.cylinder !== null)?.cylinder ?? null,
            sensorFault,
        };
    }
    /**
     * Trend-based RUL: least-squares slope of the EHI history extrapolated to
     * EHI_FAILURE_THRESHOLD.
     *
     * The uncertainty band comes from the standard error of that slope, not from
     * fixed x0.7 / x1.4 multipliers. A noisy, barely-resolved decline now yields a
     * genuinely wide interval and a confident steady one yields a tight interval,
     * where the old multipliers drew the same shaped interval either way and so
     * carried no information at all.
     */
    computePrognosis() {
        const none = (basis) => ({ rulSec: null, rulLoSec: null, rulHiSec: null, basis });
        if (this.ehiHistory.length < 30)
            return none("insufficient_history");
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
        if (den === 0)
            return none("ehi_trend");
        const slope = num / den;
        if (slope >= -EHI_TREND_FLOOR)
            return none("ehi_trend_stable");
        // Standard error of the slope, from the fit's own residuals.
        const intercept = meanE - slope * meanT;
        let sse = 0;
        for (const p of recent)
            sse += (p.ehi - (intercept + slope * p.t)) ** 2;
        const slopeSe = n > 2 ? Math.sqrt(sse / (n - 2) / den) : 0;
        const current = recent[recent.length - 1].ehi;
        const gap = current - EHI_FAILURE_THRESHOLD;
        if (gap <= 0)
            return { rulSec: 0, rulLoSec: 0, rulHiSec: 0, basis: "ehi_trend_below_threshold" };
        const rulAt = (s) => (s <= 0 ? Math.round(gap / -s) : null);
        const rulSec = rulAt(slope);
        if (rulSec === null || rulSec <= 0)
            return none("ehi_trend");
        // Steeper slope (slope - se) fails sooner; shallower (slope + se) later, and
        // may not reach the threshold at all, in which case the upper bound is open.
        return {
            rulSec,
            rulLoSec: rulAt(slope - slopeSe),
            rulHiSec: rulAt(slope + slopeSe),
            basis: "ehi_trend",
        };
    }
}
exports.TwinRun = TwinRun;
/**
 * Exact port of faults.py's ChannelFaultProfile.compute_effect — delay, then a
 * linear/exponential/step ramp to full severity over rampSec. "freeze" is not
 * handled here: it only ever appears on sensor faults (contract/faults.json's
 * sensorFaults), which go through applySensorFaultOverlay() instead.
 */
function cascadeEffect(step, elapsedSinceOnset, severity) {
    if (elapsedSinceOnset < step.delaySec)
        return 0;
    const tActive = elapsedSinceOnset - step.delaySec;
    const progress = Math.min(1, tActive / Math.max(0.1, step.rampSec));
    const factor = step.shape === "step" ? 1 : step.shape === "exponential" ? (Math.exp(3 * progress) - 1) / (Math.exp(3) - 1) : progress;
    return step.delta * factor * clamp(severity, 0, 1);
}
function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
}
function round2(v) {
    return Math.round(v * 100) / 100;
}
//# sourceMappingURL=stubTwin.js.map