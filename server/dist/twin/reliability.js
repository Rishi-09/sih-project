"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReliabilityEngine = exports.PENDING_MISSION = void 0;
exports.prettyChannel = prettyChannel;
const contract_1 = require("./contract");
const rng_1 = require("./rng");
/**
 * MISSION RELIABILITY ENGINE
 * ==========================
 *
 * Replaces the old one-liner `pSuccess = ehi / 100`, which was health wearing a
 * reliability costume: it answered "how degraded is the engine right now" and
 * called it "will this sortie finish." Those are different questions. An engine
 * at EHI 82 with every channel flat is a safe 40-minute loiter; an engine at
 * EHI 82 with coolant climbing 0.4 °C/min is 11 minutes from a redline. The old
 * number scored them identically.
 *
 * This engine answers the actual question: given where each channel is now, how
 * fast it is moving, and what power the REST of the mission demands, what is the
 * probability every channel stays inside its limits until the mission ends?
 *
 * ── The five steps ────────────────────────────────────────────────────────────
 *
 * 1. THROTTLE-CONDITIONED TREND. For each channel we fit, over a rolling window,
 *
 *        value ≈ b0 + b1·t + b2·throttle + b3·throttle_lagged
 *
 *    b1 is the drift rate WITH POWER HELD CONSTANT — i.e. degradation, not the
 *    operator advancing the throttle. This matters because the raw slope of
 *    coolant temp during a climb is huge and completely benign. b2/b3 are
 *    measured, not assumed: this specific engine's observed sensitivity to
 *    power, which is what makes the derate advice below data-driven rather than
 *    a guess. It is also why this engine works on the ops/ML backend, which
 *    does not expose the nominal-twin predictions or residuals (opsClient.ts
 *    sends `nominal: {}` / `residualZ: {}`) — we recover the same "net of
 *    operating point" signal from the telemetry itself.
 *
 *    The LAGGED throttle term is not decoration. Thermal channels trail the
 *    throttle by their own time constant (coolant ~25 s, oil sump ~45 s), so
 *    after a power change they keep climbing while the throttle sits still. A
 *    fit with only instantaneous throttle has no way to express that and books
 *    the whole rise as degradation — which made the first cut of this engine
 *    call "land immediately" during a perfectly healthy climb, every single
 *    time. Regressing on a smoothed throttle history as well gives the fit a
 *    place to put thermal lag, leaving b1 for what actually is not explained by
 *    how the engine is being flown.
 *
 * 2. SLOPE SHRINKAGE. A slope measured from noise is the main source of false
 *    "engine is dying" alarms. Each b1 is shrunk toward zero by its own
 *    signal-to-noise ratio:  b1' = b1 · b1²/(b1² + se²).  A slope 3× its
 *    standard error keeps ~90% of its magnitude; a slope buried in noise
 *    collapses to ~0. Real degradation survives, noise does not.
 *
 * 3. ANALYTIC CROSSING TIMES. The remaining mission is a sequence of legs, each
 *    at a known power setting. Within a leg the projection is linear, so the
 *    limit crossing is solved in closed form per leg — no time-stepping. That
 *    keeps a 3× Monte Carlo affordable at 1 Hz.
 *
 * 4. MONTE CARLO, PLUS STANDING RISK. Each trial samples a slope from N(b1', se)
 *    and a level offset from the fit's own residual scatter, then asks whether
 *    ANY channel crosses a REDLINE before the mission ends. Channels share a
 *    common-mode factor (CROSS_CHANNEL_RHO) because real faults cascade —
 *    lubrication loss drives oil temp AND coolant AND vibration together, so
 *    treating them as independent would understate the joint tail.
 *
 *    Redline crossing alone is not the whole risk, though. A channel parked
 *    just inside its caution band with a flat trend has no projected crossing
 *    at all, and a trend-only model scores it 100% safe — which is how the
 *    first cut of this engine reported "100% chance of completing the sortie"
 *    for an engine sitting at oil temp 126 °C against a 125 °C caution and a
 *    130 °C redline. Aero limits beyond caution are time-limited for a reason,
 *    so sustained operation past caution accrues hazard at a rate scaled by how
 *    far into the band the channel sits (CAUTION_HAZARD_HALFLIFE_SEC), and that
 *    survival term multiplies the Monte Carlo result.
 *
 * 5. DECISION. pSuccess plus the binding channel drives the recommendation
 *    ladder, and a search over power settings finds the LOWEST derate that
 *    restores an acceptable pSuccess — so "derate to 85%" is a computed answer
 *    instead of the hardcoded 85 it used to be.
 *
 *    During a power transition the trend is not measurable, so it is not used:
 *    if the throttle moved more than TRANSIENT_THROTTLE_RANGE_PCT across the
 *    window, slopes are suppressed and the assessment falls back to standing
 *    margin alone, flagged as such in `basis`. Real engine monitors inhibit
 *    predictive advisories through transitions for exactly this reason. A
 *    channel that is ACTUALLY past a limit still escalates — inhibiting a
 *    projection is not the same as ignoring a breach.
 *
 * Everything here is a projection from limited telemetry, so the output carries
 * its own uncertainty: pSuccessLo/Hi come from re-running the Monte Carlo with
 * every slope biased ±1 standard error, and `confidence` degrades honestly when
 * the window is short or the trends are ambiguous.
 */
// ── Tuning constants ─────────────────────────────────────────────────────────
// Rolling regression window. 180 s at 1 Hz: long enough to resolve a slow
// thermal drift against sensor noise, short enough to react to a fault that
// started a couple of minutes ago rather than averaging it away.
const WINDOW_SEC = 180;
// Below this we do not pretend to have a trend at all — the engine reports
// `insufficient_history` and falls back to a health-derived estimate.
const MIN_SAMPLES = 45;
// How far a slope measured over WINDOW_SEC may be extrapolated before the
// projection stops trusting it and holds level. Three minutes of observation
// does not license a twenty-three minute forecast: without this bound, an
// ordinary climb produced enough measured drift to project a healthy engine
// past its oil-pressure floor before landing. Past the bound a channel is held
// at its last projected value rather than marched onward, so a slow trend
// reads as "not visible from here" instead of a confident distant failure.
const SLOPE_HORIZON_SEC = WINDOW_SEC * 6;
// Time constant of the lagged-throttle regressor. Sits between the engine's
// fastest thermal node (EGT, sub-second) and its slowest (oil sump, ~45 s), so
// one shared regressor can stand in for the whole thermal train rather than
// needing a per-channel time constant.
const THROTTLE_SLOW_TAU_SEC = 60;
// If throttle spanned more than this many points across the window, treat the
// window as a transient and stop trusting slopes (step 5).
const TRANSIENT_THROTTLE_RANGE_PCT = 15;
// Sustained operation beyond a caution threshold: time to even odds of a
// reliability event, at the top of the caution band. Scaled down for a channel
// only just past caution — see cautionHazard().
// Reduced from 1800s to 1200s to penalize sustained operation in the caution band
// more aggressively and improve early detection of marginal conditions.
const CAUTION_HAZARD_HALFLIFE_SEC = 1200;
// A confirmed fault whose signature has stopped moving is still a fault. Time
// to even odds that a fully-confident, actively-classified failure mode
// progresses past its current plateau. Scaled by classifier confidence —
// see faultProgressionHazard().
const FAULT_PROGRESSION_HALFLIFE_SEC = 3600;
// Power below which LOW-side limits are not treated as applicable.
//
// contract/sensors.json states flat limits, but the low-side ones are
// operating-power minima, not idle minima. The simulator settles oil pressure
// at 4.7 bar at 88% power, 2.1 at 25%, 1.68 at 15% and 0.88 at idle — so a flat
// 1.5 bar floor is crossed by every normal approach and shutdown. Projecting
// that as a mission-ending breach made the console advise "land immediately"
// on a healthy engine at EHI 100, ~22 minutes ahead of a descent it was
// scheduled to fly anyway.
//
// alerts.ts already carries the same understanding for the other end of the
// flight (STARTUP_SUPPRESSED_LOW: oil pressure is legitimately below its
// operating floor before the pump has spun up). This is that reasoning applied
// to the projection, and it is deliberately narrow: HIGH-side limits still
// apply at every power setting, and a low-side breach at cruise power is still
// a breach.
const LOW_LIMIT_MIN_POWER_PCT = 30;
// How far outside the throttle range actually observed in the window we are
// willing to apply a channel's measured power sensitivity. Beyond this the
// gain is held flat: a sensitivity measured across 85–95% power says nothing
// trustworthy about 25% power, and extrapolating it there produced confident
// nonsense (a healthy engine projected to lose oil pressure on approach).
const THROTTLE_EXTRAPOLATION_MARGIN_PCT = 15;
const MC_TRIALS = 400;
// Fraction of each trial's random draw that is shared across all channels —
// the cascade term (step 4). 0 = fully independent channels, 1 = every channel
// moves in lockstep. 0.5 is a modeling choice, not a measured figure.
const CROSS_CHANNEL_RHO = 0.5;
// How far to project when measuring safe endurance. pSuccess only ever looks
// as far as the mission's own end, but "safe endurance" is meaningless if it
// can never exceed the time left, so it gets a longer horizon.
const ENDURANCE_HORIZON_SEC = 5400;
// Safe endurance is the time by which this fraction of trials are still inside
// every limit — a P90 survival time, not a mean.
const ENDURANCE_SURVIVAL = 0.9;
// Recommendation ladder thresholds, on pSuccess over the remaining mission.
// Tuned for improved early detection of degradation: stricter pass (0.96), wider derate zone (0.88), tighter RTB (0.65).
const P_CONTINUE = 0.96;
const P_DERATE = 0.88;
const P_RTB = 0.65;
// Derate search grid, richest reduction last. The first entry that clears
// P_CONTINUE wins, so the advice is always the mildest sufficient one.
const DERATE_GRID = [95, 90, 85, 80, 75, 70, 65, 60, 55, 50];
// Power-law exponent relating power setting to degradation RATE. The LEVEL
// response to throttle is measured per-channel (the fitted gain); this covers
// effect that running cooler also degrades more slowly. Superlinear because
// thermal and wear loading rise faster than power does. A modeling assumption,
// stated rather than buried.
const DERATE_RATE_EXPONENT = 1.5;
// Mission profile used when a run does not supply one. Mirrors stubTwin's
// DEFAULT_MISSION so both backends project against the same sortie.
// Optimized: reduced startup (60s→30s) and takeoff roll (30s→15s) to lower
// cumulative thermal/wear exposure on the early flight.
const DEFAULT_MISSION = {
    legs: [
        { durationSec: 30, powerPct: 20 }, // startup, reduced from 60s
        { durationSec: 15, powerPct: 95 }, // takeoff roll, reduced from 30s
        { durationSec: 120, powerPct: 85 }, // climb, reduced from 180s (tighter timing)
        { durationSec: 900, powerPct: 70 }, // cruise
        { durationSec: 300, powerPct: 55 }, // start descent
        { durationSec: 120, powerPct: 40 }, // descent
        { durationSec: 60, powerPct: 25 }, // approach
    ],
};
const GROUND_PHASES = new Set(["startup", "taxi", "shutdown"]);
/**
 * What a telemetry backend puts in TickFrame.mission before runManager's
 * finishTick() replaces it with a real assessment. Neither backend has the
 * mission profile, the trend window, or the limit set to compute reliability,
 * so neither should try — this is an explicit "not computed yet" rather than a
 * plausible-looking number nobody can trace.
 */
exports.PENDING_MISSION = {
    pSuccess: null,
    pSuccessLo: null,
    pSuccessHi: null,
    recommendation: "assessing",
    reason: "Awaiting reliability assessment.",
    safeEnduranceSec: null,
    missionRemainingSec: 0,
    derateTo: null,
    confidence: "low",
    basis: "pending",
    limiters: [],
};
class ReliabilityEngine {
    constructor(missionProfile) {
        this.history = [];
        this.rng = (0, rng_1.mulberry32)(0x5eed);
        this.cache = null;
        this.throttleSlow = null;
        this.missionProfile =
            missionProfile && missionProfile.legs && missionProfile.legs.length > 0 ? missionProfile : DEFAULT_MISSION;
    }
    /** Total scheduled sortie length — the denominator for "mission remaining." */
    get missionDurationSec() {
        return this.missionProfile.legs.reduce((s, l) => s + l.durationSec, 0);
    }
    ingest(frame) {
        const values = {};
        for (const spec of contract_1.sensorContract.engine) {
            const v = frame.sensors[spec.id];
            if (typeof v === "number" && Number.isFinite(v))
                values[spec.id] = v;
        }
        const throttle = frame.context.throttle_pct;
        // Lagged-throttle regressor, carried across the whole run rather than
        // recomputed per window — so it still reflects the power history that a
        // slow thermal node is currently responding to even when that history has
        // already scrolled out of the regression window.
        const alpha = 1 - Math.exp(-1 / THROTTLE_SLOW_TAU_SEC);
        this.throttleSlow = this.throttleSlow === null ? throttle : this.throttleSlow + alpha * (throttle - this.throttleSlow);
        this.history.push({ t: frame.t, throttle, throttleSlow: this.throttleSlow, values });
        if (this.history.length > WINDOW_SEC)
            this.history.shift();
        this.cache = null;
    }
    /**
     * True when the throttle moved enough across the window that no slope from it
     * can be trusted (step 5). Checked against the raw throttle, not the lagged
     * one, because it is the maneuver itself we are detecting.
     */
    inTransient() {
        if (this.history.length < 2)
            return true;
        let lo = Infinity;
        let hi = -Infinity;
        for (const s of this.history) {
            if (s.throttle < lo)
                lo = s.throttle;
            if (s.throttle > hi)
                hi = s.throttle;
        }
        return hi - lo > TRANSIENT_THROTTLE_RANGE_PCT;
    }
    /**
     * Full reliability assessment for the current tick. Cached per tick because
     * both the frame path and the /whatif route ask for it.
     */
    evaluate(frame) {
        if (this.cache && this.cache.t === frame.t)
            return this.cache.block;
        const block = this.compute(frame);
        this.cache = { t: frame.t, block };
        return block;
    }
    /**
     * "What if we pulled power back to X%?" — re-runs the same Monte Carlo with
     * every remaining leg capped at X% power. Both effects apply: the measured
     * per-channel throttle sensitivity lowers where each channel settles,
     * and DERATE_RATE_EXPONENT slows how fast it drifts from there.
     */
    whatIf(frame, powerPct) {
        const models = this.fitAll(frame);
        const remainingSec = this.remainingSec(frame.t);
        if (models.length === 0) {
            const fallback = this.evaluate(frame);
            return {
                powerPct,
                pSuccess: fallback.pSuccess,
                safeEnduranceSec: fallback.safeEnduranceSec,
                basis: fallback.basis,
            };
        }
        const legs = this.projectLegs(frame.t, ENDURANCE_HORIZON_SEC, powerPct);
        const derated = this.deratedModels(models, powerPct, frame.context.throttle_pct);
        const mc = this.monteCarlo(derated, legs, frame.t, remainingSec, 0, this.faultProgressionHazard(frame));
        return {
            powerPct,
            pSuccess: round2(mc.pSuccess),
            safeEnduranceSec: mc.safeEnduranceSec,
            basis: "monte_carlo_limit_projection",
        };
    }
    // ── core ───────────────────────────────────────────────────────────────────
    compute(frame) {
        const remainingSec = this.remainingSec(frame.t);
        const airborne = !GROUND_PHASES.has(frame.phase.toLowerCase());
        const models = this.fitAll(frame);
        // Not enough history to project anything. Say so rather than emitting a
        // confident-looking number built on 20 seconds of data.
        if (models.length === 0) {
            // No projection is possible yet, so no probability is reported. The old
            // code returned ehi/100 with a "continue" recommendation here, which is
            // the same health-as-reliability conflation this engine exists to remove
            // — and it presented a recommendation nothing had actually assessed.
            return {
                pSuccess: null,
                pSuccessLo: null,
                pSuccessHi: null,
                recommendation: "assessing",
                reason: "Building the trend baseline — the reliability projection needs about a minute of telemetry.",
                safeEnduranceSec: null,
                missionRemainingSec: remainingSec,
                derateTo: null,
                confidence: "low",
                basis: "insufficient_history",
                limiters: [],
            };
        }
        const legs = this.projectLegs(frame.t, ENDURANCE_HORIZON_SEC, null);
        const faultHazard = this.faultProgressionHazard(frame);
        const nominal = this.monteCarlo(models, legs, frame.t, remainingSec, 0, faultHazard);
        // Band: bias every slope by ±1 standard error toward / away from its limit.
        // This is model uncertainty (are we reading the trend right?), which is what
        // an operator actually needs, not Monte Carlo sampling error.
        const pessimistic = this.monteCarlo(models, legs, frame.t, remainingSec, +1, faultHazard);
        const optimistic = this.monteCarlo(models, legs, frame.t, remainingSec, -1, faultHazard);
        const limiters = this.buildLimiters(models, legs, frame.t);
        // The BINDING constraint is the one an operator should be watching: either
        // something is projected to hit a limit, or something has already given up
        // most of its margin. A channel with full headroom and no trend is not a
        // constraint at all, and naming one anyway (the old behaviour surfaced
        // "rpm" on a perfectly healthy engine) trains operators to ignore the field.
        const binding = limiters.find((l) => l.secondsToLimit !== null) ??
            limiters.find((l) => l.beyondCaution || l.headroomPct < 40) ??
            null;
        const alreadyBreached = limiters.find((l) => l.secondsToLimit === 0);
        const criticalAlert = frame.alerts.some((a) => a.severity === "critical");
        const { recommendation, derateTo, reason } = this.decide({
            pSuccess: nominal.pSuccess,
            airborne,
            binding,
            alreadyBreached: alreadyBreached ?? null,
            criticalAlert,
            remainingSec,
            safeEnduranceSec: nominal.safeEnduranceSec,
            frame,
            models,
        });
        return {
            pSuccess: round2(nominal.pSuccess),
            pSuccessLo: round2(Math.min(pessimistic.pSuccess, nominal.pSuccess)),
            pSuccessHi: round2(Math.max(optimistic.pSuccess, nominal.pSuccess)),
            recommendation,
            reason,
            safeEnduranceSec: nominal.safeEnduranceSec,
            missionRemainingSec: remainingSec,
            derateTo,
            confidence: this.inTransient() ? "low" : this.confidenceRating(models),
            basis: this.inTransient() ? "standing_margin_transient" : "monte_carlo_limit_projection",
            limiters: limiters.slice(0, 4),
        };
    }
    /** Seconds of scheduled sortie left, floored at zero. */
    remainingSec(t) {
        return Math.max(0, this.missionDurationSec - t);
    }
    /**
     * The remaining mission as absolute-time legs. `capPowerPct` clamps every
     * leg's power for what-if runs; the final leg is stretched to the horizon so
     * endurance projection does not simply stop at the scheduled landing.
     */
    projectLegs(nowT, horizonSec, capPowerPct) {
        const legs = [];
        const horizonEnd = nowT + horizonSec;
        let cursor = 0;
        for (const leg of this.missionProfile.legs) {
            const start = cursor;
            const end = cursor + leg.durationSec;
            cursor = end;
            if (end <= nowT)
                continue;
            const power = capPowerPct === null ? leg.powerPct : Math.min(leg.powerPct, capPowerPct);
            legs.push({ startT: Math.max(start, nowT), endT: end, throttle: power });
        }
        const lastPower = this.missionProfile.legs[this.missionProfile.legs.length - 1].powerPct;
        const tailPower = capPowerPct === null ? lastPower : Math.min(lastPower, capPowerPct);
        if (legs.length === 0) {
            legs.push({ startT: nowT, endT: horizonEnd, throttle: tailPower });
        }
        else if (legs[legs.length - 1].endT < horizonEnd) {
            legs[legs.length - 1] = { ...legs[legs.length - 1], endT: horizonEnd };
        }
        return legs;
    }
    /** Fits every channel that has a usable limit and enough clean history. */
    fitAll(frame) {
        if (this.history.length < MIN_SAMPLES)
            return [];
        // A frozen or drifting SENSOR is not a degrading ENGINE. Projecting a
        // drifting oil-pressure transducer to its redline would produce a confident
        // "land immediately" for a $40 sensor — exactly the false alarm the
        // diagnosis block exists to prevent. Drop that channel from the projection.
        const excluded = sensorFaultChannels(frame);
        const transient = this.inTransient();
        let uMin = Infinity;
        let uMax = -Infinity;
        for (const s of this.history) {
            if (s.throttle < uMin)
                uMin = s.throttle;
            if (s.throttle > uMax)
                uMax = s.throttle;
        }
        const models = [];
        for (const spec of contract_1.sensorContract.engine) {
            if (excluded.has(spec.id))
                continue;
            const limits = (0, contract_1.resolveLimits)(spec);
            if (limits.max === undefined && limits.min === undefined)
                continue;
            const fit = this.fitChannel(spec.id);
            if (!fit)
                continue;
            // Through a power transition the trend is not measurable, so it is not
            // used — see step 5. Zeroing the standard error too matters: a retained
            // se would let the Monte Carlo keep sampling the very slopes we just
            // decided we cannot measure.
            const suppress = transient;
            models.push({
                spec,
                value: fit.value,
                b0: fit.b0,
                b1: suppress ? 0 : fit.b1,
                // The gain is suppressed through a transient too, not just the slope.
                // A power sensitivity fitted across the takeoff ramp came out roughly
                // 2.5x too steep (0.075 bar/% against a true 0.030), and extrapolating
                // it 43 throttle-points down to the descent leg projected healthy oil
                // pressure straight through its floor — "land immediately" on an engine
                // reading EHI 100. The "standing_margin_transient" basis is supposed to
                // mean the assessment rests on where the channels ARE right now, so
                // leaving the gain live through a transient made that basis a
                // half-truth.
                gain: suppress ? 0 : fit.gain,
                se: suppress ? 0 : fit.se,
                // Uncertainty in WHERE THE CHANNEL IS, which is the standard error of
                // the fitted level — sigma/sqrt(n) — not the residual scatter itself.
                // Using raw scatter meant every trial held a one-off noise excursion
                // for the entire projection, as though a channel that read 3σ high for
                // one second would stay there for twenty minutes. Across 19 channels
                // those phantom tails unioned into a ~9% failure rate on a perfectly
                // healthy engine. A momentary spike is the alert engine's job; this
                // engine only cares whether the channel's LEVEL is where it looks.
                levelSe: this.cappedSigma(fit.sigma, spec) / Math.sqrt(Math.max(1, this.history.length)),
                uMin: uMin - THROTTLE_EXTRAPOLATION_MARGIN_PCT,
                uMax: uMax + THROTTLE_EXTRAPOLATION_MARGIN_PCT,
                uNow: frame.context.throttle_pct,
                limitHigh: limits.max,
                limitLow: limits.min,
                cautionHigh: limits.cautionMax,
                cautionLow: limits.cautionMin,
            });
        }
        return models;
    }
    /**
     * Standing hazard rate (per second) from channels currently operating beyond
     * a caution threshold — the term that stops a plateaued fault from reading as
     * a healthy engine. Zero for a channel inside caution.
     *
     * Scaled by depth into the caution band so that "just past caution" is a mild
     * penalty and "one step from redline" is a severe one.
     */
    cautionHazard(m) {
        const depth = this.cautionDepth(m);
        if (depth <= 0)
            return 0;
        const base = Math.LN2 / CAUTION_HAZARD_HALFLIFE_SEC;
        return base * (0.35 + 1.65 * depth);
    }
    /**
     * The Monte Carlo treats the fit's residual scatter as the channel's noise
     * level. That reading only holds while the fit actually describes the data —
     * through a maneuver the residual is dominated by the un-modeled ramp, not by
     * noise, and feeding that inflated figure back in as noise manufactures limit
     * crossings out of nothing. (It is what left a healthy engine reading 91% and
     * advising a power reduction through every takeoff.)
     *
     * Capping at a fraction of the channel's own normal band keeps the term
     * dimensionally correct across units that span bar to rpm, and bounds how
     * badly a poor fit can distort the projection.
     */
    cappedSigma(sigma, spec) {
        const lo = spec.normalMin;
        const hi = spec.normalMax;
        if (lo === undefined || hi === undefined || hi <= lo)
            return sigma;
        return Math.min(sigma, 0.2 * (hi - lo));
    }
    /**
     * Hazard contributed by the diagnosis itself, independent of any trend.
     *
     * A fault ramp that has finished leaves every channel parked at a new steady
     * state: flat slopes, nothing projected to cross, and — before this term — a
     * reported 100% chance of mission success for an engine with a confirmed
     * lubrication fault. That is the wrong answer. A classified, active failure
     * mode carries a real probability of progressing past its current plateau
     * within the mission, so it accrues hazard in proportion to how confident the
     * classification is.
     *
     * Sensor faults are excluded: a drifting transducer is not a degrading
     * engine, which is the same reasoning that drops its channel from the
     * projection in fitAll().
     */
    faultProgressionHazard(frame) {
        const label = frame.diagnosis.label;
        if (!label || label === "healthy")
            return 0;
        // Compound labels can be entirely sensor faults ("drift+freeze"), which is
        // still not a degrading engine — test every part, not just whether the
        // label happens to contain a "+".
        const hasEngineFault = label.split("+").some((part) => part && !contract_1.SENSOR_FAULT_BY_ID.has(part));
        if (!hasEngineFault)
            return 0;
        const confidence = clamp(frame.diagnosis.confidence, 0, 1);
        if (confidence <= 0)
            return 0;
        return (Math.LN2 / FAULT_PROGRESSION_HALFLIFE_SEC) * confidence;
    }
    /** 0 at the caution threshold, 1 at the redline. */
    cautionDepth(m) {
        if (m.limitHigh !== undefined && m.cautionHigh !== undefined && m.limitHigh > m.cautionHigh) {
            return clamp((m.value - m.cautionHigh) / (m.limitHigh - m.cautionHigh), 0, 1);
        }
        if (m.limitLow !== undefined && m.cautionLow !== undefined && m.cautionLow > m.limitLow) {
            return clamp((m.cautionLow - m.value) / (m.cautionLow - m.limitLow), 0, 1);
        }
        return 0;
    }
    /**
     * OLS of value on [1, t, throttle], centered for conditioning. Returns the
     * SHRUNK time coefficient (step 2 of the header) alongside its standard error
     * and the fit's residual scatter.
     *
     * If throttle barely moved across the window the two regressors are
     * collinear and the 2x2 system is ill-conditioned — we drop the throttle term
     * and fit value on t alone, which is the correct model in that case anyway
     * (constant power means raw drift IS degradation).
     */
    fitChannel(channel) {
        const pts = [];
        for (const s of this.history) {
            const y = s.values[channel];
            if (typeof y === "number" && Number.isFinite(y))
                pts.push({ x: [s.t, s.throttle, s.throttleSlow], y });
        }
        const n = pts.length;
        if (n < MIN_SAMPLES)
            return null;
        // Center everything: the intercept drops out of the normal equations and
        // the moment matrix conditions far better (raw t is in the thousands while
        // oil pressure is around 3).
        const k = 3;
        const mx = [0, 0, 0];
        let my = 0;
        for (const p of pts) {
            for (let j = 0; j < k; j++)
                mx[j] += p.x[j];
            my += p.y;
        }
        for (let j = 0; j < k; j++)
            mx[j] /= n;
        my /= n;
        const M = [
            [0, 0, 0],
            [0, 0, 0],
            [0, 0, 0],
        ];
        const c = [0, 0, 0];
        for (const p of pts) {
            const d = [p.x[0] - mx[0], p.x[1] - mx[1], p.x[2] - mx[2]];
            const dy = p.y - my;
            for (let i = 0; i < k; i++) {
                c[i] += d[i] * dy;
                for (let j = 0; j < k; j++)
                    M[i][j] += d[i] * d[j];
            }
        }
        if (M[0][0] <= 0)
            return null; // time never varies — no window at all
        // Drop trailing throttle regressors while the system is ill-conditioned.
        // Constant power over the whole window makes throttle collinear with the
        // intercept, and that is exactly the case where raw drift IS degradation,
        // so the reduced model is the correct one rather than a fallback.
        let p = k;
        let solved = null;
        while (p >= 1) {
            solved = solveSymmetric(M, c, p);
            if (solved)
                break;
            p--;
        }
        if (!solved)
            return null;
        const dof = n - (p + 1);
        if (dof <= 0)
            return null;
        const b = [solved.b[0] ?? 0, solved.b[1] ?? 0, solved.b[2] ?? 0];
        const b0 = my - (b[0] * mx[0] + b[1] * mx[1] + b[2] * mx[2]);
        let sse = 0;
        for (const q of pts) {
            const pred = b0 + b[0] * q.x[0] + b[1] * q.x[1] + b[2] * q.x[2];
            sse += (q.y - pred) ** 2;
        }
        const s2 = sse / dof;
        const sigma = Math.sqrt(Math.max(0, s2));
        const se = Math.sqrt(Math.max(0, s2 * solved.inv00));
        // Step 2 — shrink the slope by its own signal-to-noise ratio.
        const b1 = b[0];
        const shrink = se > 0 ? (b1 * b1) / (b1 * b1 + se * se) : 1;
        const last = pts[pts.length - 1];
        // Fit-implied current value, not the raw last sample: one noisy reading
        // should not move the whole projection.
        const value = b0 + b[0] * last.x[0] + b[1] * last.x[1] + b[2] * last.x[2];
        // Instantaneous and lagged throttle converge at steady state, so their
        // coefficients add up to the channel's steady-state power sensitivity —
        // which is the only form the leg-wise projection and the derate search
        // ever need.
        return { value, b0, b1: b1 * shrink, gain: b[1] + b[2], se, sigma };
    }
    /**
     * Earliest limit crossing for one channel under one sampled slope/offset,
     * solved analytically per leg. Returns seconds from `nowT`, or null if the
     * channel stays inside its limits across every projected leg.
     */
    crossingTime(m, legs, nowT, slope, levelOffset) {
        // Beyond this the drift term stops accumulating — see SLOPE_HORIZON_SEC.
        const slopeEndT = nowT + SLOPE_HORIZON_SEC;
        const uNow = clamp(m.uNow, m.uMin, m.uMax);
        for (const leg of legs) {
            // ANCHORED projection.
            //
            //   v(T) = value_now + gain*(u_leg - u_now) + slope*(T - now) + offset
            //
            // The regression's own intercept is deliberately NOT used. Reconstructing
            // the level as b0 + gain*u makes the projection only as good as the fit's
            // absolute calibration, and over a window spanning engine start, takeoff
            // and climb-out that calibration is wild — measured live, it put CHT 2 at
            // or past its 150 degC limit while the channel actually read 116 degC, and
            // the console called "land immediately" on a healthy engine at EHI 100.
            //
            // Anchoring on the measured value makes the fit responsible only for the
            // CHANGES it can actually speak to: how far the channel moves when power
            // changes, and how fast it drifts. At the current power and time the
            // projection now equals the real reading by construction, so a reported
            // breach always means the sensor is genuinely at its limit.
            const u = clamp(leg.throttle, m.uMin, m.uMax);
            const base = m.value + m.gain * (u - uNow) + levelOffset;
            const at = (T) => base + slope * (Math.min(T, slopeEndT) - nowT);
            const vStart = at(leg.startT);
            const vEnd = at(leg.endT);
            // The projection is linear then flat, so it is monotone across the leg:
            // if it ends inside the limit it never left, and any crossing lies in the
            // linear stretch, where the closed-form solve below is exact.
            if (m.limitHigh !== undefined) {
                if (vStart >= m.limitHigh)
                    return Math.max(0, leg.startT - nowT);
                if (vEnd >= m.limitHigh && slope > 0) {
                    const tc = nowT + (m.limitHigh - base) / slope;
                    if (tc >= leg.startT && tc <= Math.min(leg.endT, slopeEndT))
                        return Math.max(0, tc - nowT);
                }
            }
            if (m.limitLow !== undefined && leg.throttle >= LOW_LIMIT_MIN_POWER_PCT) {
                if (vStart <= m.limitLow)
                    return Math.max(0, leg.startT - nowT);
                if (vEnd <= m.limitLow && slope < 0) {
                    const tc = nowT + (m.limitLow - base) / slope;
                    if (tc >= leg.startT && tc <= Math.min(leg.endT, slopeEndT))
                        return Math.max(0, tc - nowT);
                }
            }
        }
        return null;
    }
    /**
     * Monte Carlo over slope and level uncertainty (step 4).
     *
     * `slopeBiasSe` shifts every slope by N standard errors TOWARD its limit —
     * 0 for the nominal run, +1 for the pessimistic band, -1 for the optimistic
     * one. Biasing toward the limit (rather than just adding se) is what makes
     * the band directional and therefore meaningful.
     */
    monteCarlo(models, legs, nowT, missionRemainingSec, slopeBiasSe, extraHazard = 0) {
        if (models.length === 0) {
            return { pSuccess: 1, safeEnduranceSec: ENDURANCE_HORIZON_SEC, rulP10: null, rulP50: null, rulP90: null };
        }
        const indepWeight = Math.sqrt(1 - CROSS_CHANNEL_RHO * CROSS_CHANNEL_RHO);
        const failureTimes = [];
        let survived = 0;
        for (let trial = 0; trial < MC_TRIALS; trial++) {
            // One shared draw per trial — the cascade term. Channels that are all
            // being pushed by the same underlying fault fail together, not
            // independently.
            const zCommon = this.normal();
            let earliest = Infinity;
            for (const m of models) {
                const z = CROSS_CHANNEL_RHO * zCommon + indepWeight * this.normal();
                // Direction "toward the limit" depends on which side the channel is
                // bounded on; for two-sided channels the high limit governs the sign.
                const towardHigh = m.limitHigh !== undefined;
                const bias = slopeBiasSe * m.se * (towardHigh ? 1 : -1);
                const slope = m.b1 + bias + m.se * z;
                const levelOffset = m.levelSe * (CROSS_CHANNEL_RHO * zCommon + indepWeight * this.normal());
                const tc = this.crossingTime(m, legs, nowT, slope, levelOffset);
                if (tc !== null && tc < earliest)
                    earliest = tc;
            }
            if (earliest === Infinity) {
                survived++;
                failureTimes.push(ENDURANCE_HORIZON_SEC);
            }
            else {
                failureTimes.push(earliest);
                if (earliest >= missionRemainingSec)
                    survived++;
            }
        }
        failureTimes.sort((a, b) => a - b);
        const idx = Math.floor((1 - ENDURANCE_SURVIVAL) * failureTimes.length);
        const mcEndurance = Math.min(ENDURANCE_HORIZON_SEC, failureTimes[Math.min(idx, failureTimes.length - 1)]);
        // Standing risk: sustained operation beyond caution, independent of any
        // trend. Hazards add across channels (an engine over caution on BOTH oil
        // temp and vibration is worse off than either alone), giving an exponential
        // survival term that multiplies the crossing-based probability.
        let hazard = extraHazard;
        for (const m of models)
            hazard += this.cautionHazard(m);
        const standingSurvival = Math.exp(-hazard * missionRemainingSec);
        // Time until standing risk alone eats the same survival budget the Monte
        // Carlo endurance figure is measured at.
        const standingEndurance = hazard > 0 ? Math.log(1 / ENDURANCE_SURVIVAL) / hazard : Infinity;
        // Time-to-first-limit quantiles across the same trials. This is a real
        // distribution over when the engine leaves its envelope, so it is what the
        // RUL band is built from — replacing the x0.7 / x1.4 multipliers that used
        // to be drawn around the ML's point estimate without measuring anything.
        // Trials that never breach are censored at the horizon and reported as
        // null rather than as "exactly the horizon".
        const q = (frac) => {
            const v = failureTimes[Math.min(failureTimes.length - 1, Math.floor(frac * failureTimes.length))];
            return v >= ENDURANCE_HORIZON_SEC ? null : Math.round(v);
        };
        return {
            pSuccess: (survived / MC_TRIALS) * standingSurvival,
            safeEnduranceSec: Math.round(Math.min(mcEndurance, standingEndurance)),
            rulP10: q(0.1),
            rulP50: q(0.5),
            rulP90: q(0.9),
        };
    }
    /**
     * Remaining-useful-life band for the current tick, taken from the Monte Carlo
     * crossing-time distribution rather than invented around a point estimate.
     * Returns nulls when no trial breaches inside the projection horizon, which
     * is the honest answer to "when will this fail?" for an engine that is not
     * failing.
     */
    prognosis(frame) {
        const models = this.fitAll(frame);
        if (models.length === 0)
            return { rulSec: null, rulLoSec: null, rulHiSec: null, basis: "insufficient_history" };
        const legs = this.projectLegs(frame.t, ENDURANCE_HORIZON_SEC, null);
        const mc = this.monteCarlo(models, legs, frame.t, this.remainingSec(frame.t), 0, this.faultProgressionHazard(frame));
        if (mc.rulP50 === null && mc.rulP10 === null) {
            return { rulSec: null, rulLoSec: null, rulHiSec: null, basis: "no_limit_crossing_projected" };
        }
        return {
            rulSec: mc.rulP50 ?? mc.rulP10,
            rulLoSec: mc.rulP10,
            rulHiSec: mc.rulP90,
            basis: "monte_carlo_limit_projection",
        };
    }
    /**
     * Per-channel headroom and deterministic time-to-limit, sorted most-urgent
     * first. This is the "why" behind the number — the UI shows the top entry as
     * the binding constraint.
     */
    buildLimiters(models, legs, nowT) {
        const out = [];
        for (const m of models) {
            // Deterministic projection (mean slope, no noise) — the headline number
            // an engineer can reproduce by hand from the drift rate.
            const secondsToLimit = this.crossingTime(m, legs, nowT, m.b1, 0);
            const high = m.limitHigh !== undefined;
            const limit = high ? m.limitHigh : m.limitLow;
            const reference = this.headroomReference(m, high);
            const span = Math.abs(limit - reference);
            const distance = Math.abs(limit - m.value);
            const headroomPct = span > 0 ? clamp((distance / span) * 100, 0, 100) : m.value === limit ? 0 : 100;
            out.push({
                channel: m.spec.id,
                subsystem: m.spec.subsystem,
                unit: m.spec.unit,
                value: round2(m.value),
                limit,
                limitKind: high ? "high" : "low",
                headroomPct: round2(headroomPct),
                beyondCaution: this.cautionDepth(m) > 0,
                ratePerMin: round3(m.b1 * 60),
                secondsToLimit: secondsToLimit === null ? null : Math.round(secondsToLimit),
            });
        }
        out.sort((a, b) => {
            const ax = a.secondsToLimit ?? Infinity;
            const bx = b.secondsToLimit ?? Infinity;
            if (ax !== bx)
                return ax - bx;
            return a.headroomPct - b.headroomPct;
        });
        return out;
    }
    /**
     * Headroom is measured across the whole margin an operator actually has: from
     * the top of the NORMAL band to the limit. Measuring it from the caution line
     * instead made every channel read 100% until it was already in caution — the
     * one number that should degrade gradually was a cliff.
     *
     * The normal edge is also the only reference that always exists.
     * contract/sensors.json gives oil pressure the same value for caution_min and
     * redline_low, so caution cannot be relied on as a distinct reference point.
     */
    headroomReference(m, high) {
        if (high)
            return m.spec.normalMax ?? m.cautionHigh ?? m.limitHigh * 0.8;
        return m.spec.normalMin ?? m.cautionLow ?? m.limitLow * 1.2;
    }
    /**
     * The recommendation ladder. Ordered so the most decisive evidence wins: an
     * actual limit breach outranks a probability, and a probability outranks a
     * trend.
     *
     * Ground phases are gated deliberately — "land immediately" for an aircraft
     * that has not taken off is nonsense advice, and health scoring is unreliable
     * during startup anyway.
     */
    decide(args) {
        const { pSuccess, airborne, binding, alreadyBreached, criticalAlert, remainingSec, safeEnduranceSec } = args;
        if (!airborne) {
            return {
                recommendation: "continue",
                derateTo: null,
                reason: `On the ground (${args.frame.phase}) — reliability advisory is armed but not applied until airborne.`,
            };
        }
        if (alreadyBreached || criticalAlert) {
            const ch = alreadyBreached?.channel ?? args.frame.alerts.find((a) => a.severity === "critical")?.channel ?? "a channel";
            return {
                recommendation: "land_immediately",
                derateTo: null,
                reason: `${prettyChannel(ch)} is at or past its limit now. Recover the aircraft.`,
            };
        }
        if (pSuccess < P_RTB) {
            return {
                recommendation: "land_immediately",
                derateTo: null,
                reason: bindingReason(binding, `Only a ${pct(pSuccess)} chance of completing the remaining ${fmtDur(remainingSec)} inside limits.`),
            };
        }
        if (pSuccess < P_DERATE) {
            return {
                recommendation: "return_to_base",
                derateTo: null,
                reason: bindingReason(binding, `${pct(pSuccess)} chance of finishing the sortie — safe endurance is ${fmtDur(safeEnduranceSec)}.`),
            };
        }
        if (pSuccess < P_CONTINUE) {
            // Find the mildest power reduction that restores an acceptable pSuccess.
            const legsFor = (p) => this.projectLegs(args.frame.t, ENDURANCE_HORIZON_SEC, p);
            let chosen = null;
            const faultHazard = this.faultProgressionHazard(args.frame);
            for (const p of DERATE_GRID) {
                const derated = this.deratedModels(args.models, p, args.frame.context.throttle_pct);
                const mc = this.monteCarlo(derated, legsFor(p), args.frame.t, remainingSec, 0, faultHazard);
                if (mc.pSuccess >= P_CONTINUE) {
                    chosen = p;
                    break;
                }
            }
            if (chosen === null) {
                return {
                    recommendation: "return_to_base",
                    derateTo: null,
                    reason: bindingReason(binding, `${pct(pSuccess)} chance of finishing; no power reduction recovers the margin.`),
                };
            }
            return {
                recommendation: "derate",
                derateTo: chosen,
                reason: bindingReason(binding, `${pct(pSuccess)} at current power; holding ${chosen}% restores it above ${pct(P_CONTINUE)}.`),
            };
        }
        if (binding && binding.secondsToLimit !== null && binding.secondsToLimit < remainingSec * 2) {
            return {
                recommendation: "continue",
                derateTo: null,
                reason: `${pct(pSuccess)} chance of completing the sortie. Watching ${prettyChannel(binding.channel)} — ${fmtDur(binding.secondsToLimit)} of margin.`,
            };
        }
        if (binding) {
            return {
                recommendation: "continue",
                derateTo: null,
                reason: bindingReason(binding, `${pct(pSuccess)} chance of completing the remaining ${fmtDur(remainingSec)}.`),
            };
        }
        return {
            recommendation: "continue",
            derateTo: null,
            reason: `${pct(pSuccess)} chance of completing the remaining ${fmtDur(remainingSec)}. Every channel is inside its normal band with no trend toward a limit.`,
        };
    }
    /**
     * Applies a power reduction to each fitted model: the measured throttle
     * sensitivity already shifts the projected LEVEL via the capped legs, so
     * this only has to slow the drift RATE, by the stated power law.
     */
    deratedModels(models, powerPct, currentThrottle) {
        const ratio = currentThrottle > 5 ? Math.min(1, powerPct / currentThrottle) : 1;
        const rateScale = Math.pow(ratio, DERATE_RATE_EXPONENT);
        return models.map((m) => ({ ...m, b1: m.b1 * rateScale, se: m.se * rateScale }));
    }
    /**
     * How much to trust the projection. Driven by how much history we have and
     * how many channels produced a slope that stands clear of its own noise.
     */
    confidenceRating(models) {
        if (this.history.length < WINDOW_SEC * 0.6)
            return "low";
        const resolved = models.filter((m) => m.se > 0 && Math.abs(m.b1) > 2 * m.se).length;
        const flat = models.filter((m) => m.se > 0 && Math.abs(m.b1) < 0.5 * m.se).length;
        // Either a clear trend or a clearly flat picture is a confident read; a
        // window full of ambiguous half-signals is not.
        if (resolved >= 1 || flat >= models.length * 0.8)
            return "high";
        return "medium";
    }
    /** Box-Muller, drawing from this engine's seeded RNG so runs are reproducible. */
    normal() {
        const u1 = Math.max(1e-12, this.rng());
        const u2 = this.rng();
        return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    }
}
exports.ReliabilityEngine = ReliabilityEngine;
// ── helpers ──────────────────────────────────────────────────────────────────
/**
 * Solves the leading p×p block of a symmetric moment matrix by Gauss-Jordan,
 * returning the coefficients and (M⁻¹)₀₀ — the multiplier that turns the fit's
 * residual variance into var(b1).
 *
 * Returns null when the block is too ill-conditioned to trust, which is the
 * caller's signal to drop a regressor and retry. The pivot test is RELATIVE to
 * the matrix scale: an absolute epsilon would misjudge channels whose units
 * differ by orders of magnitude (bar vs °C vs rpm).
 */
function solveSymmetric(M, c, p) {
    let scale = 0;
    for (let i = 0; i < p; i++)
        scale = Math.max(scale, Math.abs(M[i][i]));
    if (scale <= 0)
        return null;
    const tol = 1e-10 * scale;
    // Augmented [M | c | e0] — solving for the coefficients and the first column
    // of the inverse in one pass.
    const a = [];
    for (let i = 0; i < p; i++) {
        const row = new Array(p + 2).fill(0);
        for (let j = 0; j < p; j++)
            row[j] = M[i][j];
        row[p] = c[i];
        row[p + 1] = i === 0 ? 1 : 0;
        a.push(row);
    }
    for (let col = 0; col < p; col++) {
        let pivot = col;
        for (let r = col + 1; r < p; r++)
            if (Math.abs(a[r][col]) > Math.abs(a[pivot][col]))
                pivot = r;
        if (Math.abs(a[pivot][col]) < tol)
            return null;
        if (pivot !== col)
            [a[col], a[pivot]] = [a[pivot], a[col]];
        const pv = a[col][col];
        for (let j = col; j < p + 2; j++)
            a[col][j] /= pv;
        for (let r = 0; r < p; r++) {
            if (r === col)
                continue;
            const f = a[r][col];
            if (f === 0)
                continue;
            for (let j = col; j < p + 2; j++)
                a[r][j] -= f * a[col][j];
        }
    }
    const b = new Array(3).fill(0);
    for (let i = 0; i < p; i++)
        b[i] = a[i][p];
    const inv00 = a[0][p + 1];
    if (!Number.isFinite(inv00) || inv00 <= 0)
        return null;
    return { b, inv00 };
}
/**
 * Appends the evidence sentence to a headline. Two distinct cases, and telling
 * them apart is the point: a channel that is MOVING toward a limit gets a time,
 * a channel that is SITTING past caution gets its position. Collapsing both
 * into "trending toward a limit" would misdescribe a plateaued fault.
 */
/**
 * Every channel currently believed to be reporting a SENSOR fault rather than a
 * real engine condition, read off the (possibly compound) diagnosis label plus
 * the single-valued sensorFault block. Projecting a drifting transducer to its
 * redline would produce a confident "land immediately" for a $40 part.
 */
function sensorFaultChannels(frame) {
    const out = new Set();
    if (frame.diagnosis.sensorFault.channel)
        out.add(frame.diagnosis.sensorFault.channel);
    for (const part of frame.diagnosis.label.split("+")) {
        const spec = contract_1.SENSOR_FAULT_BY_ID.get(part);
        if (spec)
            out.add(spec.channel);
    }
    return out;
}
function bindingReason(binding, head) {
    if (!binding)
        return head;
    const bound = binding.limitKind === "high" ? "maximum" : "minimum";
    if (binding.secondsToLimit !== null) {
        return `${head} ${prettyChannel(binding.channel)} reaches its ${bound} of ${binding.limit}${binding.unit} in ${fmtDur(binding.secondsToLimit)}.`;
    }
    if (binding.beyondCaution) {
        return `${head} ${prettyChannel(binding.channel)} is holding at ${binding.value}${binding.unit}, past its caution threshold — sustained operation there is what is driving this.`;
    }
    return `${head} ${prettyChannel(binding.channel)} has ${Math.round(binding.headroomPct)}% of its margin left.`;
}
function prettyChannel(id) {
    const named = {
        rpm: "RPM",
        map_kpa: "Manifold pressure",
        oil_press_bar: "Oil pressure",
        oil_temp_c: "Oil temperature",
        coolant_temp_c: "Coolant temperature",
        fuel_flow_lph: "Fuel flow",
        fuel_press_bar: "Fuel pressure",
        inj_timing_deg: "Injection timing",
        vib_rms_g: "Vibration",
        bus_voltage_v: "Bus voltage",
        alt_current_a: "Alternator current",
    };
    if (named[id])
        return named[id];
    const cyl = /^(egt|cht)_(\d)$/.exec(id);
    if (cyl)
        return `${cyl[1].toUpperCase()} cyl ${cyl[2]}`;
    return id.replace(/_/g, " ");
}
function fmtDur(sec) {
    if (sec <= 0)
        return "0s";
    if (sec < 90)
        return `${Math.round(sec)}s`;
    const m = Math.round(sec / 60);
    if (m < 60)
        return `${m} min`;
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m`;
}
function pct(p) {
    return `${Math.round(p * 100)}%`;
}
function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
}
function round2(v) {
    return Math.round(v * 100) / 100;
}
function round3(v) {
    return Math.round(v * 1000) / 1000;
}
//# sourceMappingURL=reliability.js.map