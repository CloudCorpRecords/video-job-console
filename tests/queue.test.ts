// Unit tests: the job state machine and the JSON store.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IllegalTransitionError, JobStore } from "../src/queue.ts";
import { Worker } from "../src/worker.ts";
import type { CreateJobInput } from "../src/types.ts";

function tmpFile(): string {
  return join(mkdtempSync(join(tmpdir(), "runway-q-")), "jobs.json");
}

function input(over: Partial<CreateJobInput> = {}): CreateJobInput {
  return {
    prompt: "Foggy coastline at dawn",
    durationSeconds: 4,
    aspectRatio: "16:9",
    model: "aurora-pro",
    ...over,
  };
}

describe("JobStore state machine", () => {
  it("creates jobs in queued status with a cost estimate", () => {
    const store = new JobStore(tmpFile());
    const job = store.create(input());
    assert.equal(job.status, "queued");
    assert.equal(job.creditsEstimated, 20);
    assert.equal(job.attempt, 1);
    assert.equal(job.progress, 0);
  });

  it("allows the full happy path queued -> processing -> completed", () => {
    const store = new JobStore(tmpFile());
    const job = store.create(input());
    store.transition(job.id, "processing");
    const done = store.transition(job.id, "completed");
    assert.equal(done.status, "completed");
    assert.equal(done.progress, 1);
    assert.ok(done.completedAt);
  });

  it("rejects illegal transitions", () => {
    const store = new JobStore(tmpFile());
    const job = store.create(input());
    assert.throws(() => store.transition(job.id, "completed"), IllegalTransitionError);
    assert.throws(() => store.transition(job.id, "failed"), IllegalTransitionError);
  });

  it("allows cancel from queued and processing but not from completed", () => {
    const store = new JobStore(tmpFile());
    const a = store.create(input());
    assert.equal(store.transition(a.id, "cancelled").status, "cancelled");
    const b = store.create(input());
    store.transition(b.id, "processing");
    assert.equal(store.transition(b.id, "cancelled").status, "cancelled");
    const c = store.create(input());
    store.transition(c.id, "processing");
    store.transition(c.id, "completed");
    assert.throws(() => store.transition(c.id, "cancelled"), IllegalTransitionError);
  });

  it("retries failed jobs, bumps attempts, and enforces the attempt cap", () => {
    const store = new JobStore(tmpFile());
    const job = store.create(input());
    store.transition(job.id, "processing");
    store.fail(job.id, "boom");
    const retried = store.retry(job.id);
    assert.equal(retried.status, "queued");
    assert.equal(retried.attempt, 2);
    assert.equal(retried.error, null);
    store.transition(job.id, "processing");
    store.fail(job.id, "boom");
    store.retry(job.id);
    store.transition(job.id, "processing");
    store.fail(job.id, "boom");
    assert.throws(() => store.retry(job.id), /all 3 attempts/);
  });

  it("persists jobs to disk and resumes orphaned processing jobs as queued", () => {
    const file = tmpFile();
    const a = new JobStore(file);
    const job = a.create(input());
    a.transition(job.id, "processing");
    a.setProgress(job.id, 0.5);
    const b = new JobStore(file);
    const resumed = b.get(job.id)!;
    assert.equal(resumed.status, "queued");
    assert.equal(resumed.progress, 0);
  });

  it("survives a corrupt store file by starting empty", () => {
    const file = tmpFile();
    writeFileSync(file, "not json {{{");
    const store = new JobStore(file);
    assert.equal(store.list().length, 0);
  });
});

describe("Worker tick", () => {
  it("advances queued jobs through the state machine deterministically", () => {
    const store = new JobStore(tmpFile());
    const worker = new Worker(store);
    const job = store.create(input({ durationSeconds: 4 }));
    // 4s of video at SPEEDUP 4 completes in 1s of wall clock: 2 ticks at 500ms.
    worker.tick();
    const mid = store.get(job.id)!;
    assert.equal(mid.status, "processing");
    assert.ok(mid.progress > 0 && mid.progress < 1);
    worker.tick();
    assert.equal(store.get(job.id)!.status, "completed");
  });

  it("fails the next job when failure injection is armed, then disarms", () => {
    const store = new JobStore(tmpFile());
    const worker = new Worker(store);
    worker.setFailNext(true);
    const job = store.create(input({ durationSeconds: 1 }));
    // 1s of video at SPEEDUP 4 completes in a single 500ms tick.
    worker.tick();
    const failed = store.get(job.id)!;
    assert.equal(failed.status, "failed");
    assert.match(failed.error!, /Simulated render failure/);
    assert.equal(worker.getFailNext(), false);
  });
});
