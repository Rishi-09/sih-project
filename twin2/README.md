# twin2: physics-hybrid engine digital twin (3-day prototype)

Implements Part B of `DRDO-engine-twin-6-month-and-3-day-plan.md` on top of the existing
Rotax 915 iS simulator. It covers the whole loop: telemetry, sensor trust, health estimation,
diagnosis, survival, mission advice and self-reflection. Everything runs on a synthetic
20-engine fleet.

```bash
python -m twin2.run            # full loop + validation (about 20 s on 16 cores, plus the same again for the robustness pass)
python -m twin2.run --no-robustness
python -m twin2.api            # console API on :8100 (runs the pipeline first if twin2/out is empty)
cd web && npm run dev          # console at http://localhost:3000/twin2
python -m twin2.tests.test_physics_parity
```

Dependencies: numpy, scipy, pandas, aiohttp (already used by `retribution/`). No new packages.

## Models

| Plan | Module | What it does |
|---|---|---|
| Physics | `physics.py` | Vectorized NumPy port of `retribution/simulator` NominalSensorModel (parity-tested), plus **8 health factors**: VE, turbo efficiency, per-cylinder combustion ×4, oil-circuit resistance, cooling effectiveness. A fault is a change in a physical property; every affected channel follows from the physics. |
| M1 | `models/m1_trust.py` | Shape rules (dropout, stuck, spike), then a hypothesis test: *engine change* vs *sensor X is wrong*. Each is fitted by M2 and the cheapest penalized explanation wins. The prediction of a channel from all the others is the physics virtual sensor. |
| M2 + L1 | `models/m2_health.py` | Weighted least-squares fit of the 8 factors on the steady power holds, with a prior on the previous sortie's estimate. L1 learns per-engine build offsets over 4 commissioning sorties. |
| M4 | `models/m4_m5_m6.py` | Each cylinder's EGT minus the mean of the others, with its trend. |
| M5 | `models/m4_m5_m6.py` | Thermal time-to-limit (first-order approach at a power setting), and the engine hours until a hot-day take-off breaches a redline on the current health trend. |
| M6 | `models/m4_m5_m6.py` | Rule table over M1/M2/M4 evidence and raw residual signatures: top 3 causes, each with a first check. |
| M7 | `models/m7_m8.py` | Weibull proportional hazards in counting-process form. Handles censoring, late entry and time-varying covariates (health deficit, its trend, power stress). Fitted 5-fold by engine, so ledger predictions are out-of-fold. |
| M8 / R1–R3 | `models/m7_m8.py` | P_complete with an 80% band, go / conditional / no-go against a reliability budget, a power-cap option and a shorter-sortie option costed in time on station, an engine swap, and a fleet ranking. |
| S1 / S2 / S3 | `ledger.py`, `reflect.py` | SQLite prediction ledger resolved against outcomes, a markdown auto-debrief per sortie, and a reliability diagram with Brier score. |

## Results (seed 7)

| Check (plan B5) | Target | Result |
|---|---|---|
| Sensor-vs-engine attribution | ≥ 85% | 99.4% of 178 events; 0% false sensor flags on 604 normal sorties |
| Slow faults visible as drift before the limit | 4 of 5 kinds | 5 of 5 |
| M6 top-3 contains the cause | ≥ 80% | 100% of 175 |
| P_complete, verdict and options | yes | yes |
| Ledger reliability plot and debrief | yes | Brier 0.0038 vs 0.0069 climatology |

**Read these numbers carefully.** The twin's physics has the same structure as the simulator,
so this validation mostly shows that the architecture works end to end. As a partial check,
`run.py` repeats the whole assessment on engines whose *true* physics coefficients are off by up
to ±15%, with throttle-dependent errors in the healthy model that L1 cannot absorb. The results
hold: attribution 98.9%, top-3 98.9%, 5 of 5 slow faults caught. That is still synthetic noise.
Accuracy on real engines comes from the 6-month plan's test-bed and replay validation.

## Deviations from the plan

- **UI**: added to the existing Next.js console (`web/app/twin2`) instead of Streamlit, to keep one front end.
- **M1 virtual sensor**: the physics prediction built from the other channels, instead of LightGBM (not installed). It needs no training data and can explain its calls.
- **M6**: a rule table, as the plan specifies for the prototype. The existing 91-class classifier was trained on the old additive-delta faults and is not used here.
- **R3 option B**: a shorter sortie rather than a lower altitude. The health model has no altitude-dependent wear term to trade against.
- **CHT channels**: never used as evidence. They are derived from coolant and EGT, not measured (`contract/sensors.json`).
- **Scope**: the live WebSocket/ML path (`retribution/server_ops`, `server/`) is untouched. twin2 is a fleet/offline twin alongside it.

## Scripted demo engines (plan B5 demo script)

1. **Sensor lies**: `UAV-11` sortie 20, EGT-2 thermocouple drift. M1 flags the sensor and raises no engine alarm.
2. **Engine wears**: `UAV-03`, turbo efficiency declining. M2 shows the drift from about 9% of the way to failure; M6 ranks turbocharger degradation first.
3. **Cylinder distress**: `UAV-07`, cylinder 3 separating (M4) while its combustion index is only 40% of the way to failure.
4. **Mission decision**: `UAV-03`, 20 h at 62%. Conditional go (P≈0.92). A shorter sortie meets the budget; UAV-05 ranks first in the fleet.
5. **Self-reflection**: the Self-reflection tab shows the ledger, the reliability diagram and slow-fault lead times.
