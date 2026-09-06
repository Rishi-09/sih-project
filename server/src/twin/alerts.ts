import { sensorContract, resolveLimits } from "./contract";
import { AlertPayload, TickFrame } from "../types";

const DEBOUNCE_TICKS = 4;

// Real engine monitoring systems inhibit specific redline checks during a
// defined startup/warm-up window. Confirmed against the real simulator, not
// guessed: oil pressure is genuinely below its normal-operation floor before
// the pump has spun up on a cold start — that's expected, not a fault. Only
// the low-side check is inhibited; a high-side or caution-side reading during
// startup would still be a real anomaly worth flagging.
const STARTUP_SUPPRESSED_LOW = new Set(["oil_press_bar"]);

interface Candidate {
  code: string;
  channel: string;
  severity: "caution" | "critical";
  message: string;
  active: boolean;
}

interface TrackedAlert {
  channel: string;
  severity: "caution" | "critical";
  message: string;
  consecutiveTicks: number;
  open: boolean;
}

export interface AlertEvaluation {
  newAlerts: AlertPayload[];
  clearedCodes: string[];
  openAlerts: AlertPayload[];
}

/**
 * Debounce (must hold N consecutive ticks before firing) + dedup (one open
 * alert per code) alert engine, one instance per run — see published plan §B4.
 * Bounds are two-sided (min/max, cautionMin/cautionMax), resolved per-tick via
 * resolveLimits() from /contract/sensors.json (Retribution's file — every
 * channel there states a flat redline/caution, no conditional limits as of
 * this contract). Real hysteresis (clearing at a threshold meaningfully below
 * the one that fired) is a documented refinement — this clears as soon as the
 * triggering condition itself stops.
 */
export class AlertEngine {
  private tracked = new Map<string, TrackedAlert>();

  evaluate(frame: TickFrame): AlertEvaluation {
    const candidates = this.buildCandidates(frame);
    const seen = new Set(candidates.map((c) => c.code));
    const newAlerts: AlertPayload[] = [];
    const clearedCodes: string[] = [];

    for (const c of candidates) {
      const existing = this.tracked.get(c.code);
      if (!c.active) {
        if (existing?.open) {
          existing.open = false;
          existing.consecutiveTicks = 0;
          clearedCodes.push(c.code);
        } else if (existing) {
          existing.consecutiveTicks = 0;
        }
        continue;
      }
      if (!existing) {
        this.tracked.set(c.code, { channel: c.channel, severity: c.severity, message: c.message, consecutiveTicks: 1, open: false });
        continue;
      }
      existing.consecutiveTicks += 1;
      existing.message = c.message;
      if (!existing.open && existing.consecutiveTicks >= DEBOUNCE_TICKS) {
        existing.open = true;
        newAlerts.push({ code: c.code, severity: existing.severity, channel: existing.channel, message: existing.message });
      }
    }

    for (const [code, t] of this.tracked) {
      if (!seen.has(code) && t.open) {
        t.open = false;
        t.consecutiveTicks = 0;
        clearedCodes.push(code);
      }
    }

    const openAlerts: AlertPayload[] = [...this.tracked.entries()]
      .filter(([, t]) => t.open)
      .map(([code, t]) => ({ code, severity: t.severity, channel: t.channel, message: t.message }));

    return { newAlerts, clearedCodes, openAlerts };
  }

  private buildCandidates(frame: TickFrame): Candidate[] {
    const out: Candidate[] = [];
    for (const spec of sensorContract.engine) {
      const value = frame.sensors[spec.id];
      if (value === undefined) continue;
      const limits = resolveLimits(spec, frame.sensors);

      if (limits.max !== undefined) {
        out.push({
          code: `REDLINE_HIGH_${spec.id.toUpperCase()}`,
          channel: spec.id,
          severity: "critical",
          message: `${spec.id} at ${value}${spec.unit} — above max (${limits.max}${spec.unit})`,
          active: value > limits.max,
        });
        if (limits.cautionMax !== undefined) {
          out.push({
            code: `CAUTION_HIGH_${spec.id.toUpperCase()}`,
            channel: spec.id,
            severity: "caution",
            message: `${spec.id} at ${value}${spec.unit} — above caution (${limits.cautionMax}${spec.unit})`,
            active: value > limits.cautionMax && value <= limits.max,
          });
        }
      }
      const suppressLow = frame.phase === "startup" && STARTUP_SUPPRESSED_LOW.has(spec.id);
      if (limits.min !== undefined && !suppressLow) {
        out.push({
          code: `REDLINE_LOW_${spec.id.toUpperCase()}`,
          channel: spec.id,
          severity: "critical",
          message: `${spec.id} at ${value}${spec.unit} — below min (${limits.min}${spec.unit})`,
          active: value < limits.min,
        });
        if (limits.cautionMin !== undefined) {
          out.push({
            code: `CAUTION_LOW_${spec.id.toUpperCase()}`,
            channel: spec.id,
            severity: "caution",
            message: `${spec.id} at ${value}${spec.unit} — below caution (${limits.cautionMin}${spec.unit})`,
            active: value < limits.cautionMin && value >= limits.min,
          });
        }
      }
    }
    if (frame.diagnosis.sensorFault.channel) {
      out.push({
        code: "SENSOR_FAULT",
        channel: frame.diagnosis.sensorFault.channel,
        severity: "caution",
        message: `${frame.diagnosis.sensorFault.channel} looks like a ${frame.diagnosis.sensorFault.mode} sensor, not an engine fault`,
        active: true,
      });
    }
    return out;
  }
}
