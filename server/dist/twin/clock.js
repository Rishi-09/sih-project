"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RunClock = void 0;
const runManager_1 = require("./runManager");
const TICK_MS = 1000;
/**
 * Self-correcting 1Hz scheduler, one per active run. `stepRun` is synchronous
 * today because the stub twin is in-process (no network hop) — the moment it's
 * replaced by a real HTTP call to the Python twin-core (ml_procedure.md §6),
 * `tick()` just needs an `await` in front of that call; nothing else here changes.
 */
class RunClock {
    constructor(runId, onFrame, onStatus) {
        this.runId = runId;
        this.onFrame = onFrame;
        this.onStatus = onStatus;
        this.timer = null;
        this.failures = 0;
        this.next = 0;
    }
    start() {
        this.next = Date.now() + TICK_MS;
        this.schedule();
    }
    stop() {
        if (this.timer)
            clearTimeout(this.timer);
        this.timer = null;
    }
    schedule() {
        const delay = Math.max(0, this.next - Date.now());
        this.timer = setTimeout(() => this.tick(), delay);
    }
    tick() {
        try {
            const frame = (0, runManager_1.stepRun)(this.runId);
            if (frame) {
                this.failures = 0;
                this.onFrame(frame);
            }
            else {
                this.failures += 1;
            }
        }
        catch (e) {
            console.error(`twin step failed for run ${this.runId}`, e);
            this.failures += 1;
        }
        if (this.failures >= 3)
            this.onStatus("degraded");
        this.next += TICK_MS;
        this.schedule();
    }
}
exports.RunClock = RunClock;
//# sourceMappingURL=clock.js.map