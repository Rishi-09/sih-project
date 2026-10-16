// End-to-end test of the live console path, driven exactly like the browser:
// REST to start a sortie and inject faults, Socket.IO for the frames.
//
//   simulator (retribution/run_ws_only.py, ideally --speed 5)
//     -> server (server/, npm run dev)  -> this script
//
//   node tools/e2e_live.mjs [http://localhost:4000]
//
// Exits non-zero if any step fails. socket.io-client is resolved from web/node_modules.
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, "..", "web", "package.json"));
const { io } = require("socket.io-client");

const API = process.argv[2] ?? process.env.API_BASE ?? "http://localhost:4000";
const results = [];
let latest = null;
let lastT = -1;

async function http(method, p, body) {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${p} -> ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

/** Wait until pred(frame) holds, up to `simSec` simulated seconds (frames carry sim time t). */
function waitFor(label, pred, simSec) {
  const startT = latest?.t ?? 0;
  const wall = Date.now();
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      if (latest && pred(latest)) {
        clearInterval(timer);
        results.push({ step: label, ok: true, detail: `after ${latest.t - startT} sim-s` });
        resolve(latest);
      } else if ((latest && latest.t - startT > simSec) || Date.now() - wall > 600_000) {
        clearInterval(timer);
        const f = latest;
        results.push({
          step: label, ok: false,
          detail: `timed out after ${simSec} sim-s; label=${f?.diagnosis.label} twin=${f?.twin ? f.twin.attribution : "null"}`,
        });
        resolve(null);
      }
    }, 250);
  });
}

function check(label, cond, detail) {
  results.push({ step: label, ok: Boolean(cond), detail });
}

const worstFactor = (f) => [...f.twin.factors].sort((a, b) => b.deficit - a.deficit)[0];

async function main() {
  const engines = await http("GET", "/api/engines");
  if (!engines.length) throw new Error("no engines - seed the backend (npm run seed in server/)");
  const { runId } = await http("POST", "/api/runs", { engineId: engines[0].id, scenario: "S1" });
  console.log(`run ${runId} on ${engines[0].tail}`);

  const socket = io(API, { transports: ["websocket"] });
  socket.on("connect", () => socket.emit("run:join", { runId }));
  socket.on("frame", (f) => {
    if (f.runId !== runId) return;
    latest = f;
    if (f.t >= lastT + 30) {
      lastT = f.t;
      const tw = f.twin;
      console.log(`  t=${String(f.t).padStart(4)} ${f.phase.padEnd(8)} label=${f.diagnosis.label.padEnd(22)} ehi=${f.health.ehi ?? "-"} ` +
        (tw ? `attr=${tw.attribution} worst=${worstFactor(f).name}:${worstFactor(f).deficit.toFixed(2)} ${tw.computeMs}ms` : "twin=null"));
    }
  });

  try {
    // 1. healthy flight, first assessment
    const h = await waitFor("twin publishes a healthy assessment after take-off",
      (f) => f.twin && f.diagnosis.label === "healthy", 600);
    if (h) {
      check("contract version 1.2.0", h.contractVersion === "1.2.0", h.contractVersion);
      check("nominal + residualZ populated", Object.keys(h.nominal).length >= 10 && Object.keys(h.residualZ).length >= 10,
        `${Object.keys(h.nominal).length} nominal, ${Object.keys(h.residualZ).length} residualZ`);
      check("healthy engine scores >= 95", (h.health.ehi ?? 0) >= 95, `ehi ${h.health.ehi}`);
    }

    // 2. engine fault
    await http("POST", `/api/runs/${runId}/fault`, { type: "turbo_degradation", severity: 0.6 });
    const t = await waitFor("turbo_degradation 0.6 diagnosed", (f) => f.diagnosis.label === "turbo_degradation", 200);
    if (t) {
      // the headline flips as soon as the factor crosses 15%; the estimate settles once the ramp is in the window
      const settled = await waitFor("eta_turbo estimate settles near severity 0.6",
        (f) => (f.twin?.factors.find((x) => x.name === "eta_turbo")?.deficit ?? 0) > 0.45, 120);
      const eta = (settled ?? t).twin.factors.find((x) => x.name === "eta_turbo");
      check("eta_turbo deficit within 0.45-0.85", eta.deficit > 0.45 && eta.deficit < 0.85, `deficit ${eta.deficit}`);
      check("first check names the turbocharger", /turbo/i.test(t.twin.causes[0].check), t.twin.causes[0].check);
      check("injected ledger shows the fault", t.injectedFaults.includes("turbo_degradation"), t.injectedFaults.join(","));
    }
    await http("DELETE", `/api/runs/${runId}/faults`);
    await waitFor("recovers to healthy after clearing", (f) => f.diagnosis.label === "healthy", 300);

    // 3. sensor fault: the engine must stay healthy
    await http("POST", `/api/runs/${runId}/fault`, { type: "sensor_bias_oilpress", severity: 1.0 });
    const s = await waitFor("oil-pressure bias attributed to the SENSOR",
      (f) => f.diagnosis.sensorFault.channel === "oil_press_bar", 200);
    if (s) {
      check("engine health unaffected by a sensor fault", (s.health.ehi ?? 0) >= 90, `ehi ${s.health.ehi}`);
      check("twin attribution = sensor", s.twin.attribution === "sensor", s.twin.attribution);
    }
    await http("DELETE", `/api/runs/${runId}/faults`);
    await waitFor("recovers after clearing the sensor fault", (f) => f.diagnosis.label === "healthy" && !f.diagnosis.sensorFault.channel, 300);

    // 4. weak cylinder, with the cylinder picked by the fault id
    await http("POST", `/api/runs/${runId}/fault`, { type: "weak_cylinder_cyl2", severity: 0.7 });
    const c = await waitFor("weak cylinder 2 diagnosed", (f) => f.diagnosis.label === "weak_cylinder_cyl2", 200);
    if (c) check("diagnosis.cylinder = 2", c.diagnosis.cylinder === 2, `cylinder ${c.diagnosis.cylinder}`);
    await waitFor("mission reliability publishes P(success)", (f) => f.mission.pSuccess !== null, 300);

    // 5. unknown fault ids are rejected
    let rejected = false;
    try { await http("POST", `/api/runs/${runId}/fault`, { type: "bearing_wear", severity: 0.5 }); } catch { rejected = true; }
    check("old catalog id rejected with 400", rejected, "bearing_wear");

    // 6. AI advisory on the current diagnosis
    const adv = await http("POST", `/api/runs/${runId}/report`, { kind: "advisory" });
    check("advisory generated", adv.contentMd.length > 80, `${adv.source}, ${adv.contentMd.length} chars`);
    check("advisory is about cylinder 2", /cylinder\s*2|cyl\s*2/i.test(adv.contentMd), adv.contentMd.slice(0, 120).replace(/\s+/g, " "));
  } finally {
    await http("POST", `/api/runs/${runId}/stop`).catch(() => {});
    socket.disconnect();
  }

  console.log("");
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.step}  (${r.detail})`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
