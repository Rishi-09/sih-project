"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const stubTwin_1 = require("./stubTwin");
const alerts_1 = require("./alerts");
const reliability_1 = require("./reliability");
/**
 * Scenario harness for the mission reliability engine — `npm run check:reliability`.
 *
 * Reliability advice is only worth anything if it is right in BOTH directions,
 * and neither direction is checkable by reading the code. This drives the stub
 * twin through five sorties and prints what the engine advises at each stage:
 *
 *   - HEALTHY must never escalate. It is the false-alarm test, and the one that
 *     caught the most bugs: an early version called "land immediately" during
 *     the climb of every single flight, healthy or not, because it read thermal
 *     lag as degradation.
 *   - COOLING / LUBRICATION / BEARING must escalate, and must STAY escalated
 *     once the fault plateaus — a finished fault ramp leaves flat trends, and a
 *     trend-only model happily reports 100% for a visibly sick engine.
 *   - SENSOR DRIFT must not escalate at all. A drifting transducer is not a
 *     degrading engine.
 *
 * The constants in reliability.ts are tuned against this output, so re-run it
 * after changing any of them.
 */
function run(label, fault) {
    const twin = new stubTwin_1.TwinRun("r1", "e1", 42, "test");
    const alerts = new alerts_1.AlertEngine();
    const rel = new reliability_1.ReliabilityEngine();
    console.log(`\n===== ${label} =====`);
    for (let i = 0; i < 900; i++) {
        if (fault && i === fault.at)
            twin.injectFault({ type: fault.type, severity: fault.severity });
        const f = twin.step();
        f.alerts = alerts.evaluate(f).openAlerts;
        rel.ingest(f);
        f.mission = rel.evaluate(f);
        if (i % 120 === 0 || i === 899) {
            const m = f.mission;
            const b = m.limiters[0];
            // "--" is a real state, not a formatting fallback: before the projection
            // has a trend window there is no probability and no endurance figure.
            const n2 = (v) => (v === null ? "--" : v.toFixed(2));
            console.log(`t=${String(f.t).padStart(4)} ${f.phase.padEnd(8)} ehi=${(f.health.ehi === null ? "--" : f.health.ehi.toFixed(0)).padStart(3)}`, `P=${n2(m.pSuccess)}[${n2(m.pSuccessLo)}-${n2(m.pSuccessHi)}]`, `safe=${String(m.safeEnduranceSec ?? "--").padStart(4)}s rem=${m.missionRemainingSec}s`, `${m.recommendation}${m.derateTo ? `(${m.derateTo}%)` : ""}`, `conf=${m.confidence}`, b
                ? `| bind ${b.channel} ${b.value}${b.unit}->${b.limit} ttl=${b.secondsToLimit} rate=${b.ratePerMin}/min head=${b.headroomPct}%`
                : "| no limiter");
            if (i === 480 || i === 899)
                console.log(`      reason: ${m.reason}`);
        }
    }
}
run("HEALTHY (false-alarm check — must never escalate)", null);
run("COOLING FAILURE sev 0.7 @ t=300", { type: "cooling_failure", severity: 0.7, at: 300 });
run("LUBRICATION DEGRADATION sev 0.6 @ t=300", { type: "lubrication_degradation", severity: 0.6, at: 300 });
run("BEARING WEAR sev 0.8 @ t=300", { type: "bearing_wear", severity: 0.8, at: 300 });
run("SENSOR DRIFT oilpress (must NOT escalate — sensor, not engine)", {
    type: "sensor_drift_oilpress",
    severity: 0.9,
    at: 300,
});
//# sourceMappingURL=reliability.scenarios.js.map