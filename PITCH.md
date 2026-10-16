# AI Digital Twin for UAV Engines — Feature Pitch

### Predictive health monitoring and mission reliability for the Rotax 915 iS MALE UAV engine

---

## 1. The problem, in one line

A UAV engine gives no warning before it fails mid-mission. Today's alerts are simple
threshold alarms — a light turns red only after damage has already started. Operators
have no way to know, **before takeoff**, whether an engine will survive the mission ahead.

## 2. What we built, in one line

A **digital twin** of the engine: software that knows what a *healthy* engine should read
at every moment, compares it to what the *real* engine is reading, and turns the difference
into an early warning, a diagnosis, a repair recommendation, and a go/no-go call for the
next mission — in real time, explainable, and running entirely on our own physics and
machine-learning models.

---

## 3. Core ML pipeline — the engine health brain

**Three-model architecture, purpose-built, no black box.**

| Model | What it does | Keywords |
|---|---|---|
| **Nominal Digital Twin** | 19 gradient-boosted regressors predict what every sensor *should* read, given throttle, altitude, air temperature, airspeed, and flight phase. | physics-informed machine learning, multi-target regression, HistGradientBoosting, digital twin |
| **Fault Classifier** | Compares actual vs. expected readings (**residuals**), turns them into 76 rolling statistical features, and classifies the engine into 1 of 91 states — healthy, single fault, compound fault, or triple fault. | supervised classification, residual analysis, fault signature matching, compound-fault detection |
| **Anomaly Detector** | An unsupervised Isolation Forest flags anything the classifier has never seen before — novel, unmodeled failure behaviour — with a near-zero false-alarm rate. | unsupervised learning, novelty detection, out-of-distribution detection, low false-alarm rate |

**Output:** 0–100 health scores across 8 engine subsystems (lubrication, cooling,
combustion, induction, fuel, injection, mechanical, electrical), a plain-language
explanation of *why* the score dropped, and a **Remaining Useful Life (RUL)** estimate —
how much time is left before a redline is breached.

**Why it matters:** explainable AI, not a black box. Every alert traces back to a specific
sensor, a specific subsystem, and a specific physical cause a maintainer can act on.

---

## 4. Mission Reliability Engine — the "will it finish?" answer

Health score alone answers "how degraded is the engine right now." It does **not** answer
the question that actually matters before a sortie: *will this engine complete this mission?*
Two engines at the same health score can have very different futures — one flat, one
trending toward a redline in 11 minutes. Our reliability engine tells them apart.

**How it works, in five steps:**

1. **Throttle-conditioned trend fitting** — measures each channel's real degradation rate,
   separated from normal power changes (a climb heating the engine is not degradation).
2. **Slope shrinkage** — a statistical safeguard that stops sensor noise from being
   mistaken for a failing engine.
3. **Analytic time-to-limit projection** — computes exactly when a channel will cross its
   redline, for every remaining leg of the mission, without expensive simulation.
4. **Monte Carlo risk sampling** — runs thousands of probabilistic trials, accounting for
   the fact that real faults cascade across multiple sensors at once (a lubrication fault
   raises oil temperature, coolant temperature, *and* vibration together).
5. **Decision engine** — turns the probability into a mission-ready call: **P(mission
   success)**, a recommendation (**continue / derate / return to base / land immediately**),
   the exact channel driving the risk, and the *lowest* power derate that restores safety —
   computed, not guessed.

**Keywords:** mission assurance, probabilistic risk modeling, Monte Carlo simulation,
predictive analytics, reliability engineering, go/no-go decision support, real-time
telemetry, aerospace safety.

---

## 5. NEW — Physics-Hybrid Fleet Twin (next-generation model series)

A second, deeper layer of intelligence, built for **fleet-scale prognosis and maintenance
decisions**, not just single-flight monitoring.

**The core idea:** instead of treating a "fault" as an abstract label, every failure mode
is modeled as a change in a real physical property of the engine — turbocharger
efficiency, volumetric efficiency, per-cylinder combustion quality, oil-circuit resistance,
cooling effectiveness. This makes every downstream prediction **physically explainable**
and lets the twin separate a *lying sensor* from a *sick engine* — automatically.

| Model | Plain-English job | Keywords |
|---|---|---|
| **M1 — Signal Trust** | Is the alarm real, or is a sensor lying? Tests two competing explanations — "the engine changed" vs. "sensor X is wrong" — and picks the one the physics supports. | sensor fault detection, virtual sensors, signal validation, hypothesis testing |
| **M2 — Health Estimation** | Fits 8 physical health factors to real telemetry using physics-hybrid regression, learning each engine's individual build offsets automatically. | physics-hybrid modeling, parameter estimation, per-asset calibration, digital twin |
| **M4 — Cylinder-Level Diagnosis** | Flags a weakening cylinder by comparing its exhaust temperature against its sibling cylinders — the earliest sign of ignition or combustion trouble. | component-level diagnostics, comparative analysis, early fault detection |
| **M5 — Thermal Time-to-Limit** | Forward-simulates the engine at any power setting to answer: "how many flight hours until this engine can no longer survive a hot-day takeoff?" | prognostics, thermal modeling, forward simulation, predictive limits |
| **M6 — Root Cause Diagnosis** | Ranks the top 3 most likely causes of any anomaly, each with a first maintenance check to perform — turning an alarm into an action. | root cause analysis, explainable diagnostics, maintenance recommendation engine |
| **M7 — Survival / Prognosis** | A statistical survival model (Weibull) estimates failure probability across the whole fleet, properly handling engines that haven't failed yet — a technique from reliability engineering and clinical trials, applied to aircraft engines. | survival analysis, Weibull modeling, fleet-level prognosis, censored data |
| **M8 — Mission Advisor** | Combines everything into one number: probability of mission completion, a go/conditional-go/no-go verdict, alternative mission profiles, and which engine in the fleet is the best choice for a given mission. | decision support system, fleet optimization, mission planning AI |
| **L1 — Per-Engine Learning** | Learns each individual engine's manufacturing quirks in its first few flights, so the twin adapts to *this* engine, not an average one. | personalized modeling, adaptive learning, per-asset baseline |
| **S1–S3 — Self-Reflection Loop** | Every prediction is logged and checked against what actually happened — an automatic accuracy audit, so the system's own reliability is transparent and measurable. | model monitoring, prediction ledger, calibration tracking, trustworthy AI |

**Validated results (synthetic fleet, 20 engines, 862 flights):**
- **99.4%** accuracy telling sensor faults apart from real engine faults
- **100%** of top-3 diagnoses contained the true root cause
- **5 of 5** slow-developing faults caught as early drift, before any limit was breached
- Held up even when the underlying engine physics was deliberately mismatched by **±15%** —
  a stress test for robustness

---

## 6. Live 3D Engine Twin & Fleet Dashboard

- **Real-time 3D visualization** of the running engine, streamed live over WebSockets at 1 Hz
- **Fleet-wide view**: every UAV, its live health score, and its alert state at a glance
- **Sensor grid**, **alert panel**, and an **AI-assisted advisory chat** (LLM-backed with an
  offline fallback, so the console never goes dark)
- **What-if mission planner**: drag a power setting, see the reliability number change instantly
- **Auto-generated post-flight debriefs** in plain English — what happened, why, and what to check

**Keywords:** real-time dashboard, WebSocket telemetry, human-in-the-loop AI, decision
support UI, data visualization.

---

## 7. Why this matters for DRDO / MALE UAV operations

| Capability | Operational value |
|---|---|
| Early fault detection | Fewer in-flight failures, fewer aborted missions |
| Sensor-vs-engine attribution | Fewer false alarms, less unnecessary maintenance |
| Mission-level P(success) | Commanders get a *decision*, not just a health number |
| Fleet ranking & ranking-by-risk | Right engine assigned to the right mission |
| Root-cause + first-check recommendation | Faster turnaround for ground crews |
| Self-auditing prediction ledger | The system's trustworthiness is measurable, not assumed |
| Physics-grounded, explainable | No black-box AI — every call traces to a real physical cause |

---

## 8. Technology stack (keywords for the record)

Python · NumPy/SciPy · scikit-learn (HistGradientBoosting, Isolation Forest) · Weibull
survival analysis · physics-informed machine learning · digital twin · TypeScript ·
Next.js 16 · React 19 · Three.js (3D visualization) · Express · Socket.IO · Prisma ·
SQLite/TiDB · WebSocket real-time telemetry · Monte Carlo simulation · explainable AI ·
predictive maintenance · prognostics and health management (PHM) · mission assurance.

---

*One-line summary: an explainable, physics-grounded AI digital twin that tells operators —
before they take off — whether their engine will make it back.*
