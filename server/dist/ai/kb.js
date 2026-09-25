"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KNOWLEDGE_BASE = void 0;
exports.getKbEntry = getKbEntry;
exports.KNOWLEDGE_BASE = {
    healthy: {
        id: "healthy",
        label: "Healthy",
        description: "All monitored subsystems are within their nominal residual bands.",
        fallbackAdvisory: "**Status: Nominal.** All 19 monitored channels are tracking within expected residual bounds for the current flight condition. No action required.",
    },
    lubrication_degradation: {
        id: "lubrication_degradation",
        label: "Lubrication Degradation",
        description: "Oil pressure drops first, followed by rising oil temperature and a mild coolant-temperature rise as lubrication breaks down.",
        fallbackAdvisory: "**Observation:** Oil pressure is tracking below nominal, with oil temperature beginning to climb — the classic signature of a developing lubrication fault.\n\n**Probable cause:** Oil pump wear, a partial blockage in the oil circuit, or oil level/viscosity out of spec.\n\n**Recommended ground action:** Inspect oil level and condition on landing; check the oil filter and pump for wear before the next sortie.\n\n**Time criticality:** Moderate — plan for inspection at the next opportunity; escalate if oil pressure keeps declining in flight.",
    },
    cooling_failure: {
        id: "cooling_failure",
        label: "Cooling System Failure",
        description: "Coolant temperature rises first and keeps climbing toward the 120°C normal-operation limit — distinct from lubrication faults where oil pressure moves first.",
        fallbackAdvisory: "**Observation:** Coolant temperature is trending up toward its normal-operation limit, with oil pressure holding steady.\n\n**Probable cause:** Coolant loss, a failing water pump, or a partially blocked radiator/cooling path — the 915 iS cools its cylinder heads by liquid, so this is the primary overheat indicator on this engine.\n\n**Recommended ground action:** Check coolant level and look for external leaks; inspect the water pump and radiator on landing.\n\n**Time criticality:** Moderate to high if the trend accelerates — sustained high coolant temperature risks head damage.",
    },
    ignition_fault_cyl3: {
        id: "ignition_fault_cyl3",
        label: "Ignition Fault (cylinder 3)",
        description: "Cylinder 3's EGT drops sharply (unburned charge) with a step onset, along with a vibration increase and mild RPM roughness.",
        fallbackAdvisory: "**Observation:** Cylinder 3's exhaust gas temperature has dropped sharply relative to its peers, with a step-like onset and increased vibration.\n\n**Probable cause:** A fouled or failed spark plug, ignition lead fault, or coil failure on cylinder 3.\n\n**Recommended ground action:** Inspect and, if needed, replace the spark plug and ignition lead on cylinder 3 before further flight.\n\n**Time criticality:** High if vibration is climbing — a persistent misfire risks secondary mechanical damage.",
    },
    induction_loss: {
        id: "induction_loss",
        label: "Induction / MAP Loss",
        description: "Manifold pressure drops at a fixed throttle setting, followed by RPM droop and a lean EGT rise — distinct from a natural high-altitude MAP rolloff.",
        fallbackAdvisory: "**Observation:** Manifold pressure is below what this throttle/altitude combination should produce, with RPM drooping and EGTs running lean.\n\n**Probable cause:** A turbocharger or wastegate fault, an induction leak, or a partially blocked air filter.\n\n**Recommended ground action:** Inspect the turbocharger, wastegate actuator, and induction ducting for leaks or damage.\n\n**Time criticality:** Moderate — reduced power margin affects mission reliability more than immediate safety.",
    },
    fuel_system_degradation: {
        id: "fuel_system_degradation",
        label: "Fuel System Degradation",
        description: "Fuel pressure drops first, followed by falling fuel flow and all four EGTs rising as the mixture leans out.",
        fallbackAdvisory: "**Observation:** Fuel pressure and flow are both below nominal, with EGTs running lean.\n\n**Probable cause:** A clogged fuel filter, a failing fuel pump, or a restriction in the fuel line.\n\n**Recommended ground action:** Inspect and replace the fuel filter; check fuel pump output pressure on the ground.\n\n**Time criticality:** High — a worsening lean condition risks detonation and cylinder damage.",
    },
    bearing_wear: {
        id: "bearing_wear",
        label: "Bearing Wear",
        description: "Vibration rises gradually well before any thermal or pressure channel moves — the slowest-developing fault in the taxonomy.",
        fallbackAdvisory: "**Observation:** RMS vibration has been climbing gradually over several minutes, with oil pressure and temperature only beginning to shift.\n\n**Probable cause:** Main or rod bearing wear, or a developing imbalance in a rotating component.\n\n**Recommended ground action:** Schedule a borescope/vibration-spectrum inspection before further flight; don't dismiss a slow vibration trend as noise.\n\n**Time criticality:** Moderate now, escalating — bearing failures accelerate once wear begins.",
    },
    injector_fault_cyl3: {
        id: "injector_fault_cyl3",
        label: "Injector Fault (cylinder 3)",
        description: "Cylinder 3's EGT rises (lean) — the opposite direction from an ignition fault — alongside irregular injection timing on that cylinder.",
        fallbackAdvisory: "**Observation:** Cylinder 3's EGT is elevated relative to its peers while injection timing on that cylinder looks irregular — a lean-running injector, not a misfire.\n\n**Probable cause:** A partially clogged or sticking fuel injector on cylinder 3.\n\n**Recommended ground action:** Inspect and clean or replace the injector on cylinder 3.\n\n**Time criticality:** Moderate to high — a lean cylinder is a detonation risk under sustained high power.",
    },
    electrical_degradation: {
        id: "electrical_degradation",
        label: "Electrical / Charging Degradation",
        description: "Alternator current drops or becomes erratic first, followed by a slow bus voltage decline as the battery discharges. Touches no other subsystem.",
        fallbackAdvisory: "**Observation:** Alternator output current is low or erratic and bus voltage is trending down — the engine's mechanical health is otherwise unaffected.\n\n**Probable cause:** A failing alternator/regulator, a worn drive belt, or a degraded battery.\n\n**Recommended ground action:** Load-test the battery and check alternator output and belt condition before the next sortie.\n\n**Time criticality:** Moderate — the FADEC and avionics depend on this bus; don't defer past the next flight if voltage keeps declining.",
    },
    sensor_freeze_coolant: {
        id: "sensor_freeze_coolant",
        label: "Sensor Freeze (coolant)",
        description: "The coolant temperature reading is frozen at whatever value it held at fault onset, independent of what the engine is actually doing — the engine may be entirely healthy underneath.",
        fallbackAdvisory: "**Observation:** Coolant temperature has stopped tracking flight condition — it's holding a fixed value no matter what throttle or altitude does. This looks like an instrumentation fault, not an engine fault.\n\n**Probable cause:** A failed coolant temperature sensor, damaged wiring harness, or a loose connector on that channel.\n\n**Recommended ground action:** Inspect the wiring and connector for the coolant temperature sensor before trusting its readings.\n\n**Time criticality:** Low for the engine itself, moderate for situational awareness — a frozen coolant reading can mask a real overheat developing underneath it.",
    },
    sensor_drift_oilpress: {
        id: "sensor_drift_oilpress",
        label: "Sensor Drift (oil pressure)",
        description: "The oil pressure reading drifts steadily downward independent of engine state — a calibration/wiring fault on that one channel, not an actual lubrication problem.",
        fallbackAdvisory: "**Observation:** Oil pressure is trending down at a steady rate that doesn't match any other lubrication-subsystem channel — oil temperature and vibration are not corroborating an actual lubrication fault.\n\n**Probable cause:** A drifting oil pressure sensor, a degraded connector, or a calibration fault on that channel.\n\n**Recommended ground action:** Cross-check with a ground test-stand gauge before trusting the in-flight reading; inspect the sensor and its wiring.\n\n**Time criticality:** Low for the engine itself, moderate for situational awareness — don't let a drifting sensor mask a real oil-pressure drop, or cause an unnecessary abort.",
    },
};
function getKbEntry(faultId) {
    return exports.KNOWLEDGE_BASE[faultId] ?? exports.KNOWLEDGE_BASE.healthy;
}
//# sourceMappingURL=kb.js.map