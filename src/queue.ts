// Job queue: state machine plus a JSON-file store.
//
// The state machine is the product core being modeled. A real video platform
// has extra states (rendering, uploading, moderation) and distributed
// workers; here we model the five states that matter for the demo with a
// strict transition table so illegal moves are impossible by construction.
//
// Legal transitions:
//   queued     -> processing | cancelled
//   processing -> completed | failed | cancelled
//   failed     -> queued      (retry, bumps attempt)
//   cancelled  -> queued      (retry, bumps attempt)
//   completed  -> (terminal)
//
// Retry is capped at MAX_ATTEMPTS. The store persists to a JSON file so jobs
// survive a restart; any job left in "processing" at load is returned to
// "queued" because the worker is ephemeral and its progress was lost with the
// process. That resume-on-boot behavior is the honest version of what a real
// platform does with orphaned worker claims.

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { estimateCredits, findModel, MAX_ATTEMPTS, validateJobInput } from "./models.ts";
import type { CreateJobInput, JobRecord, JobStatus } from "./types.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_DATA_FILE = join(HERE, "..", "data", "jobs.json");

const TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  queued: ["processing", "cancelled"],
  processing: ["completed", "failed", "cancelled"],
  failed: ["queued"],
  cancelled: ["queued"],
  completed: [],
};

export class IllegalTransitionError extends Error {
  constructor(from: JobStatus, to: JobStatus) {
    super(`Illegal transition from ${from} to ${to}`);
    this.name = "IllegalTransitionError";
  }
}

function now(): string {
  return new Date().toISOString();
}

export class JobStore {
  private jobs = new Map<string, JobRecord>();
  private readonly file: string;

  constructor(file: string = DEFAULT_DATA_FILE) {
    this.file = file;
    this.load();
  }

  private load(): void {
    if (!existsSync(this.file)) return;
    try {
      const raw = JSON.parse(readFileSync(this.file, "utf8")) as JobRecord[];
      for (const job of raw) {
        // Jobs orphaned in "processing" by a restart resume as queued.
        if (job.status === "processing") {
          job.status = "queued";
          job.progress = 0;
          job.startedAt = null;
          job.updatedAt = now();
        }
        this.jobs.set(job.id, job);
      }
    } catch {
      // Corrupt store: start empty rather than crash. Documented in README.
      this.jobs.clear();
    }
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify([...this.jobs.values()], null, 2));
  }

  create(input: CreateJobInput): JobRecord {
    const problem = validateJobInput(input);
    if (problem) throw new Error(problem);
    const model = findModel(input.model)!;
    const stamp = now();
    const job: JobRecord = {
      id: randomBytes(8).toString("hex"),
      prompt: input.prompt.trim(),
      durationSeconds: input.durationSeconds,
      aspectRatio: input.aspectRatio,
      model: model.id,
      modelName: model.name,
      status: "queued",
      progress: 0,
      creditsEstimated: estimateCredits(model, input.durationSeconds),
      attempt: 1,
      error: null,
      createdAt: stamp,
      updatedAt: stamp,
      startedAt: null,
      completedAt: null,
    };
    this.jobs.set(job.id, job);
    this.save();
    return job;
  }

  get(id: string): JobRecord | undefined {
    return this.jobs.get(id);
  }

  list(status?: JobStatus): JobRecord[] {
    const all = [...this.jobs.values()].sort((a, b) =>
      a.createdAt < b.createdAt ? 1 : -1
    );
    return status ? all.filter((j) => j.status === status) : all;
  }

  transition(id: string, to: JobStatus): JobRecord {
    const job = this.jobs.get(id);
    if (!job) throw new Error(`Unknown job ${id}`);
    if (!TRANSITIONS[job.status].includes(to)) {
      throw new IllegalTransitionError(job.status, to);
    }
    job.status = to;
    job.updatedAt = now();
    if (to === "processing") {
      job.startedAt = job.startedAt ?? now();
    }
    if (to === "completed" || to === "failed" || to === "cancelled") {
      job.completedAt = now();
      if (to === "completed") job.progress = 1;
    }
    this.save();
    return job;
  }

  // Retry a failed or cancelled job. Bumps the attempt counter and clears
  // the old error and progress. Beyond MAX_ATTEMPTS the job stays failed and
  // the user sees the real limit.
  retry(id: string): JobRecord {
    const job = this.jobs.get(id);
    if (!job) throw new Error(`Unknown job ${id}`);
    if (job.status !== "failed" && job.status !== "cancelled") {
      throw new Error(`Only failed or cancelled jobs can be retried (job is ${job.status})`);
    }
    if (job.attempt >= MAX_ATTEMPTS) {
      throw new Error(`Job ${id} has used all ${MAX_ATTEMPTS} attempts`);
    }
    if (!TRANSITIONS[job.status].includes("queued")) {
      throw new IllegalTransitionError(job.status, "queued");
    }
    job.attempt += 1;
    job.error = null;
    job.progress = 0;
    job.status = "queued";
    job.updatedAt = now();
    this.save();
    return job;
  }

  setProgress(id: string, progress: number): JobRecord {
    const job = this.jobs.get(id);
    if (!job) throw new Error(`Unknown job ${id}`);
    job.progress = progress;
    job.updatedAt = now();
    this.save();
    return job;
  }

  fail(id: string, error: string): JobRecord {
    const job = this.jobs.get(id);
    if (!job) throw new Error(`Unknown job ${id}`);
    if (job.status !== "processing") {
      throw new IllegalTransitionError(job.status, "failed");
    }
    job.status = "failed";
    job.error = error;
    job.completedAt = now();
    job.updatedAt = now();
    this.save();
    return job;
  }
}
