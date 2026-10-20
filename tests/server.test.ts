// End-to-end API tests against a real HTTP server on an ephemeral port.
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type App } from "../src/server.ts";

let app: App;
let base: string;

async function setup(): Promise<void> {
  if (app) return;
  const dataFile = join(mkdtempSync(join(tmpdir(), "runway-srv-")), "jobs.json");
  app = createApp({ dataFile, port: 0 });
  await new Promise<void>((resolve) => app.server.listen(0, resolve));
  const addr = app.server.address();
  if (typeof addr !== "object" || !addr) throw new Error("Server did not bind a port");
  base = `http://127.0.0.1:${addr.port}`;
}

async function post(path: string, body: unknown): Promise<{ status: number; data: Record<string, unknown> }> {
  await setup();
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: (await res.json()) as Record<string, unknown> };
}

async function get(path: string): Promise<{ status: number; data: Record<string, unknown> }> {
  await setup();
  const res = await fetch(`${base}${path}`);
  return { status: res.status, data: (await res.json()) as Record<string, unknown> };
}

type Job = { id: string; status: string; error: string | null };

async function createJob(over: Record<string, unknown> = {}): Promise<Job> {
  const { status, data } = await post("/api/jobs", {
    prompt: "A neon city at night",
    durationSeconds: 4,
    aspectRatio: "16:9",
    model: "aurora-pro",
    ...over,
  });
  assert.equal(status, 201);
  return (data as { job: Job }).job;
}

async function waitFor(id: string, want: string, timeoutMs = 8000): Promise<Job> {
  const start = Date.now();
  for (;;) {
    const { data } = await get(`/api/jobs/${id}`);
    const job = (data as { job: Job }).job;
    if (job.status === want) return job;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for job ${id} to reach ${want} (stuck at ${job.status})`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}

after(async () => {
  if (app) await app.close();
});

describe("jobs API", () => {
  it("creates a job and lists it", async () => {
    const job = await createJob();
    assert.equal(job.status, "queued");
    const { status, data } = await get("/api/jobs");
    assert.equal(status, 200);
    const ids = ((data as { jobs: Job[] }).jobs).map((j) => j.id);
    assert.ok(ids.includes(job.id));
  });

  it("rejects invalid input with 400", async () => {
    const { status, data } = await post("/api/jobs", {
      prompt: "",
      durationSeconds: 4,
      aspectRatio: "16:9",
      model: "aurora-pro",
    });
    assert.equal(status, 400);
    assert.match(String(data.error), /prompt/);
  });

  it("completes a job through the simulated worker", async () => {
    const job = await createJob({ durationSeconds: 1 });
    const done = await waitFor(job.id, "completed");
    assert.equal(done.status, "completed");
  });

  it("cancels a job and rejects canceling a completed one", async () => {
    const job = await createJob({ durationSeconds: 60 });
    const { status } = await post(`/api/jobs/${job.id}/cancel`, {});
    assert.equal(status, 200);
    const fast = await createJob({ durationSeconds: 1 });
    await waitFor(fast.id, "completed");
    const bad = await post(`/api/jobs/${fast.id}/cancel`, {});
    assert.equal(bad.status, 409);
    assert.match(String(bad.data.error), /Illegal transition/);
  });

  it("fails a job via the failure toggle and retries it", async () => {
    await post("/api/failure", { enabled: true });
    const job = await createJob({ durationSeconds: 1 });
    const failed = await waitFor(job.id, "failed");
    assert.match(String(failed.error), /Simulated render failure/);
    const { status, data } = await post(`/api/jobs/${job.id}/retry`, {});
    assert.equal(status, 200);
    assert.equal((data as { job: Job }).job.status, "queued");
    const done = await waitFor(job.id, "completed");
    assert.equal(done.status, "completed");
  });

  it("returns 404 for unknown jobs", async () => {
    const { status } = await get("/api/jobs/doesnotexist");
    assert.equal(status, 404);
  });
});
