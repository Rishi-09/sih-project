"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SUBSYSTEMS = exports.ENGINE_CHANNELS = exports.CONTRACT_VERSION = void 0;
/**
 * Mirrors /contract/types.ts — see that file for the "why duplicated" note.
 * Keep in sync; a shape change here needs the freeze ritual (published plan §B2).
 */
exports.CONTRACT_VERSION = "1.1.0";
// 19 engine channels — the original count. The Rotax 915 iS has liquid-cooled
// cylinder heads with no factory per-cylinder CHT sensor (see
// /contract/sensors.json _correction) — cht_1..4 are restored here as
// DERIVED/MODELED estimates (from coolant_temp_c + EGT + fuel flow), not raw
// sensors, by team decision. The manual's own "EGT-Split" concept (per-cylinder
// EGT deviation from the mean) drives that derivation internally rather than
// existing as its own 20th top-level channel.
exports.ENGINE_CHANNELS = [
    "rpm", "map_kpa",
    "egt_1", "egt_2", "egt_3", "egt_4",
    "cht_1", "cht_2", "cht_3", "cht_4",
    "oil_press_bar", "oil_temp_c", "coolant_temp_c",
    "fuel_flow_lph", "fuel_press_bar", "inj_timing_deg",
    "vib_rms_g", "bus_voltage_v", "alt_current_a",
];
exports.SUBSYSTEMS = {
    lubrication: ["oil_press_bar", "oil_temp_c"],
    cooling: ["coolant_temp_c", "cht_1", "cht_2", "cht_3", "cht_4"],
    combustion: ["egt_1", "egt_2", "egt_3", "egt_4"],
    fuel: ["fuel_press_bar", "fuel_flow_lph"],
    mechanical: ["vib_rms_g", "rpm"],
    induction: ["map_kpa"],
    electrical: ["bus_voltage_v", "alt_current_a"],
    injection: ["inj_timing_deg"],
};
//# sourceMappingURL=types.js.map