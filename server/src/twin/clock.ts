import { stepRun } from "./runManager";
import { TickFrame } from "../types";

const TICK_MS = 1000;

/**
 * Self-correcting 1Hz scheduler, one per active run. `stepRun` is synchronous
 * today because the stub twin is in-process (no network hop) — the moment it's
 * replaced by a real HTTP call to the Python twin-core (ml_procedure.md §6),
 * `tick()` just needs an `await` in front of that call; nothing else here changes.
 */
export class RunClock {
  private timer: NodeJS.Timeout | null = null;
  private failures = 0;
  private next = 0;

  constructor(
    private runId: string,
    private onFrame: (frame: TickFrame) => void,
    private onStatus: (status: "degraded") => void,
  ) {}

  start() {
    this.next = Date.now() + TICK_MS;
    this.schedule();
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule() {
    const delay = Math.max(0, this.next - Date.now());
    this.timer = setTimeout(() => this.tick(), delay);
  }

  private tick() {
    try {
      const frame = stepRun(this.runId);
      if (frame) {
        this.failures = 0;
        this.onFrame(frame);
      } else {
        this.failures += 1;
      }
    } catch (e) {
      console.error(`twin step failed for run ${this.runId}`, e);
      this.failures += 1;
    }
    if (this.failures >= 3) this.onStatus("degraded");
    this.next += TICK_MS;
    this.schedule();
  }
}
