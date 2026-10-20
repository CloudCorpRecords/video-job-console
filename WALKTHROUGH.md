# Runway Product Engineer: build walkthrough

**5 bullets Rene can present from:**

1. **I built a generative video job console, simulated end to end and labeled as such.** Submit a prompt, duration, aspect ratio, and model; a queue advances the job through queued, processing, completed or failed; a gallery shows finished renders as placeholder cards. No video is ever generated, and the UI, README, and code all say so. The build models the platform mechanics, which is the product engineering part of a video generation product.

2. **The core is a strict state machine, not a pile of flags.** Transitions live in one table (`queue.ts`): queued goes to processing or cancelled, processing goes to completed, failed, or cancelled, and only failed or cancelled can retry back to queued. Illegal moves throw `IllegalTransitionError`. This is the same discipline real job platforms use, and it is why cancel-during-processing and retry-after-failure just work in the demo.

3. **Retries are a cost control surface.** Attempts are capped at 3 and the UI shows `attempt/3`. The simulated worker fails deterministically only when the failure-injection toggle is armed, so I can always demo the failure path on demand, and the tests pin the exact behavior. Orphaned `processing` jobs resume as `queued` after a restart, which is how a real platform reclaims work from a dead worker.

4. **Cost estimation is honest math.** `ceil(duration * creditsPerSecond)` per simulated model, computed before submit and shown in the form. Whole-credit rounding up means the platform never under-quotes a job. The per-model duration caps (30/60/120s) model the tier gating real platforms do.

5. **Zero dependencies, 23 tests, all real.** No npm install, no keys, no external calls. The suite covers the state machine (including illegal transitions), the retry cap, persistence round-trips, restart resume, corrupt-store recovery, deterministic worker ticks, and end-to-end HTTP against an ephemeral server. I smoke-tested the running server via curl: create, worker completion, gallery, and persistence across a kill/restart.

**The Clipwise connection (honest, not a stretch):** Clipwise is an MCP-first AI video clipping app in production, so I have lived the other side of this problem: a video pipeline where the queue, the job states, and the cost accounting are the parts the user actually feels. The simulated worker here advances progress on a timer; in Clipwise the worker is a real server-side editing pipeline, and the failure modes are things like stalled renders and partial outputs. If asked how this would change against real GPU workers, I would say: the state machine stays identical, the worker becomes a claim/lease on a real queue with heartbeats, progress becomes frame counts from the renderer, and the failure injection I used for demos becomes chaos drills against the staging queue.

**Likely follow-ups, with honest answers from the real code:**

- *Why not generate actual video?* That would need GPU compute and model access this prototype deliberately does not have. The brief was the platform mechanics; adding a real renderer would change one module (the worker) without touching the state machine or API.
- *How would you scale the worker?* Replace the in-process interval with a real queue (SQS, Redis streams) where each worker claims a job with a lease and heartbeats. The transition table already models claim semantics: only one worker can hold `processing` at a time.
- *Why a JSON file instead of a database?* Deliberately boring for a demo: readable, zero setup, and `JobStore` is the single seam where Postgres or DynamoDB would slot in. Nothing in the server or worker touches the filesystem directly.
- *What would you add next?* WebSocket push instead of 1s polling, per-user credit balances with a spend ledger, and a moderation state before `processing`, since a video platform needs it.
- *Is this affiliated with Runway?* No. It is an independent prototype built from general knowledge of how video generation platforms work, labeled as such everywhere. The models and prices are fictional.
