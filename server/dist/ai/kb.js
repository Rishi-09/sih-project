"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getKbEntry = getKbEntry;
const KNOWLEDGE_BASE = {
    healthy: {
        id: "healthy",
        label: "Healthy",
        description: "Every health factor the physics twin estimates is at its as-built value and every sensor agrees with the others.",
        fallbackAdvisory: "**Status: Nominal.** The physics twin explains every monitored channel with a healthy engine at the current flight condition, and no sensor disagrees with the others. No action required.",
    },
    assessing: {
        id: "assessing",
        label: "Assessing",
        description: "The twin needs roughly 75 seconds of airborne data before its first assessment.",
        fallbackAdvisory: "**Status: Assessing.** The engine is on the ground or has only just taken off. The twin needs about 75 seconds of airborne telemetry before it can estimate engine health. No judgement is available yet.",
    },
    turbo_degradation: {
        id: "turbo_degradation",
        label: "Turbocharger degradation",
        description: "Turbo efficiency is falling: manifold pressure below what the throttle should produce, all four EGTs higher together, fuel flow and RPM down, oil slightly warmer (oil-cooled bearing).",
        fallbackAdvisory: "**Observation:** Manifold pressure is below what this throttle and altitude should give, and all four EGTs are running hotter together. The twin attributes this to falling turbocharger efficiency, not to any single cylinder.\n\n**Probable cause:** Turbine or compressor wheel wear or rub, bearing play, wastegate actuator sticking, or an exhaust leak upstream of the turbine.\n\n**Recommended ground action:** Check turbo shaft play and wheel rub, wastegate actuator travel, and the exhaust manifold joints upstream of the turbine.\n\n**Time criticality:** Moderate. Reduced power margin hits climb and hot-day take-off first; hotter exhaust shortens turbine life.",
    },
    induction_leak: {
        id: "induction_leak",
        label: "Induction leak",
        description: "Volumetric efficiency is falling: less charge reaches the cylinders, so fuel flow and RPM drop at a given throttle while manifold pressure still reads normal.",
        fallbackAdvisory: "**Observation:** Fuel flow and RPM are below what this throttle should give, but manifold pressure reads normal. The engine is breathing less air than the manifold reading suggests.\n\n**Probable cause:** A leak in the induction path downstream of the MAP sensor (hose, clamp, intercooler joint) or a restricted airbox.\n\n**Recommended ground action:** Pressure-test the induction system: hoses, clamps, intercooler and airbox joints.\n\n**Time criticality:** Moderate. Mainly a power-margin problem, but an unmetered leak can lean the mixture.",
    },
    coolant_restriction: {
        id: "coolant_restriction",
        label: "Coolant circuit restriction",
        description: "Cooling effectiveness is falling: coolant temperature (and the CHTs derived from it) run hotter than the flight condition explains, oil temperature follows, and the gap grows with power.",
        fallbackAdvisory: "**Observation:** Coolant temperature is running hotter than this power, altitude and airspeed explain, and oil temperature is following it. The gap grows with power.\n\n**Probable cause:** Low coolant, a partially blocked radiator core, a weak water pump, or a sticking thermostat.\n\n**Recommended ground action:** Check coolant level and condition, the radiator core for blockage, the pump drive and the thermostat.\n\n**Time criticality:** High at high power. Watch the time-to-limit figure; a hot-day take-off is the first thing to become unsafe.",
    },
    oil_restriction: {
        id: "oil_restriction",
        label: "Oil circuit restriction",
        description: "Oil circuit resistance is rising: oil pressure falls at a given RPM while oil temperature climbs, because less oil is flowing through the engine.",
        fallbackAdvisory: "**Observation:** Oil pressure is below normal for this RPM and oil temperature is rising together. That is the pattern of reduced oil flow, not a pressure-sensor fault, because two independent channels agree.\n\n**Probable cause:** A clogging oil filter (check the bypass indicator), a sticking pressure relief valve, or a restriction in the oil lines.\n\n**Recommended ground action:** Inspect the oil filter and relief valve, and take an oil sample for debris.\n\n**Time criticality:** High if oil pressure approaches its minimum. Bearings depend on it.",
    },
    weak_cylinder: {
        id: "weak_cylinder",
        label: "Weak cylinder",
        description: "One cylinder's combustion index is falling: its EGT drops against the other three, vibration rises and RPM droops slightly. The other cylinders are unaffected.",
        fallbackAdvisory: "**Observation:** Cylinder {cyl}'s exhaust temperature has dropped relative to the other three, and vibration has risen. The twin attributes this to weak combustion in that one cylinder.\n\n**Probable cause:** A fouled or failing spark plug, an ignition lead fault on cylinder {cyl}, or an injector problem on that cylinder.\n\n**Recommended ground action:** Inspect the spark plugs and both ignition leads on cylinder {cyl}, then borescope the cylinder.\n\n**Time criticality:** Moderate, rising with vibration. A persistent misfire can cause secondary mechanical damage.",
    },
    sensor_fault: {
        id: "sensor_fault",
        label: "Sensor fault",
        description: "One channel disagrees with what the physics predicts from every other channel, and no change in engine health explains it. The engine itself is judged healthy; the reading is not trusted.",
        fallbackAdvisory: "**Observation:** {channel} is reading {mode} in a way no change in engine health can explain. Every other channel agrees with a healthy engine. The twin has stopped trusting this sensor and raises no engine alarm from it.\n\n**Probable cause:** A failing probe or transducer, a damaged harness, or a loose connector on {channel}.\n\n**Recommended ground action:** Inspect the {channel} harness and connector, swap the probe, and re-check it against the twin's prediction.\n\n**Time criticality:** Low for the engine, moderate for situational awareness. While this channel is distrusted, a real problem on it would only be visible through the channels it couples to.",
    },
};
const CHANNEL_NAMES = {
    egt_1: "EGT 1", egt_2: "EGT 2", egt_3: "EGT 3", egt_4: "EGT 4",
    coolant_temp_c: "coolant temperature", oil_temp_c: "oil temperature", oil_press_bar: "oil pressure",
    map_kpa: "manifold pressure", fuel_flow_lph: "fuel flow", rpm: "RPM", vib_rms_g: "vibration",
};
function fill(entry, ctx) {
    const sub = (s) => s
        .replaceAll("{cyl}", String(ctx.cylinder ?? "?"))
        .replaceAll("{channel}", CHANNEL_NAMES[ctx.channel ?? ""] ?? ctx.channel ?? "the affected sensor")
        .replaceAll("{mode}", ctx.mode === "frozen" ? "frozen" : ctx.mode ? `with a ${ctx.mode}` : "wrongly");
    return { ...entry, label: sub(entry.label), description: sub(entry.description), fallbackAdvisory: sub(entry.fallbackAdvisory) };
}
function getKbEntry(label, ctx = {}) {
    const cyl = /^weak_cylinder_cyl(\d)$/.exec(label);
    if (cyl)
        return fill(KNOWLEDGE_BASE.weak_cylinder, { ...ctx, cylinder: Number(cyl[1]) });
    // A compound label from the stub ("a+b") is advised on its first member.
    const key = label.split("+")[0];
    const entry = KNOWLEDGE_BASE[key] ?? (key.startsWith("sensor_") ? KNOWLEDGE_BASE.sensor_fault : KNOWLEDGE_BASE.healthy);
    return fill(entry, ctx);
}
//# sourceMappingURL=kb.js.map