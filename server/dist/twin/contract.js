"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SENSOR_FAULT_IDS = exports.ENGINE_FAULT_IDS = exports.SENSOR_FAULT_BY_ID = exports.SENSOR_FAULTS = exports.FAULT_CLASS_BY_ID = exports.FAULT_CLASSES = exports.SPEC_BY_ID = exports.sensorContract = void 0;
exports.resolveLimits = resolveLimits;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
// server/contract/, not ../../../contract — see the file-header comment above.
// __dirname is server/src/twin in dev (tsx) and server/dist/twin once built
// (tsc mirrors the src/ tree under dist/), so "../../contract" reaches
// server/contract in both cases.
const contractPath = path_1.default.join(__dirname, "../../contract/sensors.json");
const raw = JSON.parse(fs_1.default.readFileSync(contractPath, "utf-8"));
function toSpec(id, ch) {
    const cylinderMatch = /_(\d)$/.exec(id);
    return {
        id,
        unit: ch.unit,
        subsystem: ch.subsystem ?? "",
        cylinder: cylinderMatch ? Number(cylinderMatch[1]) : undefined,
        min: ch.redline_low,
        max: ch.redline ?? ch.redline_high,
        cautionMin: ch.caution_min,
        cautionMax: ch.caution_max,
        normalMin: ch.normal_min,
        normalMax: ch.normal_max,
        estimated: ch.source === "estimated" || ch.source === "derived",
        note: ch.note,
    };
}
exports.sensorContract = {
    engine: Object.entries(raw.channels)
        .filter(([, ch]) => ch.type === "engine")
        .map(([id, ch]) => toSpec(id, ch)),
    phases: ["startup", "taxi", "takeoff", "climb", "cruise", "loiter", "descent", "approach", "shutdown"],
};
exports.SPEC_BY_ID = new Map(exports.sensorContract.engine.map((s) => [s.id, s]));
/**
 * Resolves a channel's alert bounds. Every bound now comes straight from
 * /contract/sensors.json (Retribution's file) via toSpec() above — Retribution
 * states flat redlines for every channel, including oil pressure, so the
 * earlier manual-derived RPM-conditional oil-pressure floor is retired along
 * with the old contract file. See CONTEXT.md "Revision 4" for what changed and
 * why. `sensors` is accepted but unused — kept so existing call sites
 * (alerts.ts, stubTwin.ts) don't need to change.
 */
function resolveLimits(spec, _sensors) {
    return { min: spec.min, max: spec.max, cautionMin: spec.cautionMin, cautionMax: spec.cautionMax };
}
const faultsPath = path_1.default.join(__dirname, "../../contract/faults.json"); // server/contract/, see above
const rawFaults = JSON.parse(fs_1.default.readFileSync(faultsPath, "utf-8"));
exports.FAULT_CLASSES = rawFaults.classes;
exports.FAULT_CLASS_BY_ID = new Map(exports.FAULT_CLASSES.map((f) => [f.id, f]));
exports.SENSOR_FAULTS = rawFaults.sensorFaults;
exports.SENSOR_FAULT_BY_ID = new Map(exports.SENSOR_FAULTS.map((f) => [f.id, f]));
exports.ENGINE_FAULT_IDS = exports.FAULT_CLASSES.filter((f) => f.id !== "healthy").map((f) => f.id);
exports.SENSOR_FAULT_IDS = exports.SENSOR_FAULTS.map((f) => f.id);
//# sourceMappingURL=contract.js.map