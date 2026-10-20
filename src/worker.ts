// Simulated render worker.
//
// A real platform farms work to GPU workers; here a tick loop advances every
// "processing" job by a deterministic fraction. Progress math is a pure
// function so tests pin the behavior without timers. Failure injection is a
// deliberate, visible control (the UI's "simulate failure on next job"
// toggle): the next job that would complete fails instead with a clear
// error. There is no hidden randomness, so the demo and the tests agree.

import { JobStore } from "./queue.ts";
import type { JobRecord } from "./types.ts";

// How many real seconds of wall clock one second of video takes.
// SPEEDUP 4 means a 5 second clip renders in about 2.5 real seconds, which
// keeps the demo watchable without pretending to be fast hardware.
export const SPEEDUP = 4;
export const TICK_MS = 500;

export interface WorkerOptions {
  // When true, the next job that would complete fails instead, and the
  // flag is consumed. Controlled by the UI and by tests.
  failNext: boolean;
}

// Pure progress math: fraction of the job completed by one tick.
// A job of durationSeconds completes in durationSeconds / SPEEDUP wall
// seconds, so each tick advances tickMs / (wall ms per job).
export function progressForTick(durationSeconds: number, tickMs: number = TICK_MS): number {
  return (tickMs * SPEEDUP) / (durationSeconds * 1000);
}

export class Worker {
  private store: JobStore;
  private failNext: boolean = false;

  constructor(store: JobStore) {
    this.store = store;
  }

  setFailNext(value: boolean): void {
    this.failNext = value;
  }

  getFailNext(): boolean {
    return this.failNext;
  }

  // Advance one tick. Jobs are picked up from "queued" first (FIFO by
  // creation time), then every processing job advances. Returns the jobs
  // that changed state this tick.
  tick(): JobRecord[] {
    const changed: JobRecord[] = [];
    const queued = this.store.list("queued").reverse();
    for (const job of queued) {
      this.store.transition(job.id, "processing");
      changed.push(this.store.get(job.id)!);
    }
    for (const job of this.store.list("processing")) {
      const current = this.store.get(job.id)!;
      const progress = Math.min(1, current.progress + progressForTick(current.durationSeconds));
      if (progress >= 1) {
        if (this.failNext) {
          this.failNext = false;
          this.store.fail(job.id, "Simulated render failure (injected by failure toggle)");
          changed.push(this.store.get(job.id)!);
        } else {
          this.store.transition(job.id, "completed");
          changed.push(this.store.get(job.id)!);
        }
      } else {
        this.store.setProgress(job.id, progress);
      }
    }
    return changed;
  }
}
