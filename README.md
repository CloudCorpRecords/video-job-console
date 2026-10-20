# Generative Video Job Console (Simulated Prototype)

**Independent prototype. Not affiliated with Runway. No video is generated; job processing and outputs are simulated.**

A runnable model of the product-engineering core of a video generation platform: submit a generation job, watch a queue advance it through a strict state machine, cancel or retry it, estimate its credit cost up front, and browse finished renders in a gallery. The "renders" are styled placeholder cards; what is genuinely implemented is everything around them: the queue, the worker, the cost model, the persistence, and the API contract.

## Architecture

- `src/server.ts`: zero-dependency Node HTTP server. REST API for jobs and models, serves the single-page client, and runs the simulated worker on a 500ms interval.
- `src/queue.ts`: the heart of the build. A strict job state machine (`queued -> processing -> completed | failed | cancelled`, with `failed/cancelled -> queued` retries capped at 3 attempts) plus a JSON-file store. Illegal transitions are impossible by construction (`IllegalTransitionError`). Any job orphaned in `processing` by a restart resumes as `queued`, which is the honest version of how a real platform reclaims work from a dead worker.
- `src/worker.ts`: simulated render worker. Progress math is a pure deterministic function (a 4s clip completes in ~1s of wall clock at `SPEEDUP = 4`); failure injection is an explicit, visible toggle, never hidden randomness, so the demo and the tests always agree.
- `src/models.ts`: simulated model catalog (`aurora-mini`, `aurora-pro`, `vista-xl`, fictional) with credits-per-second pricing and per-model duration caps. Cost estimation is `ceil(duration * rate)` so the platform never under-quotes.
- `src/types.ts`: shared shapes.
- `public/index.html`: single-page console. Live-updating queue table with progress bars, cancel/retry actions, failure-injection toggle, cost estimate preview on the submit form, and a gallery of completed jobs as labeled simulated placeholder cards.

Zero runtime dependencies. TypeScript runs directly on Node 22.6+ via type stripping (imports use `.ts` specifiers; see the Adyen build's note on `allowImportingTsExtensions`). Tests use the built-in `node:test` runner.

## Run it in under 2 minutes

```bash
cd ~/workspace/job-search/prebuilt-proof/builds/runway
npm test    # 23 tests, no install step needed
npm start   # serves the console at http://localhost:3000
```

Then: submit a job ("A drone shot over a foggy coastline at dawn", 5s, 16:9, Aurora Pro), watch it move through queued -> processing -> completed, check its cost estimate, then toggle "simulate a render failure" and retry the failed job. Jobs persist in `data/jobs.json`, so refresh the page freely.

## Product decisions and tradeoffs

1. **Simulation scope is explicit, not decorative.** The banner, the README, and every placeholder card say no video is generated. The demo models the platform mechanics (queue, state machine, pricing, retries), which is the product engineering, not the model weights.
2. **State machine over booleans.** A transition table makes illegal moves unrepresentable. Real platforms add states (rendering, uploading, moderation, NSFW review); this five-state core is the minimum that still demonstrates the discipline.
3. **Deterministic worker.** Real failures are stochastic and annoying in demos. An explicit failure-injection toggle gives the reviewer the retry path on demand, and tests pin the exact behavior.
4. **Attempt cap at 3.** Retries are a cost control surface, not infinite. The cap is enforced in `retry()` and surfaced in the UI as `attempt/3`.
5. **Whole-credit estimation, shown before submit.** Real platforms would quote by tier, resolution, and render time; a per-second rate keeps the math inspectable, and rounding up protects the platform from under-quoting.
6. **JSON file store.** Deliberately boring and readable. A production system would use a real queue (SQS, Redis streams) plus a DB; the interface boundary (`JobStore`) is where that swap would happen, and nothing in the server or worker touches the filesystem directly.

## Data model

`JobRecord`: id, prompt, durationSeconds, aspectRatio, model, modelName, status, progress (0-1), creditsEstimated, attempt, error, createdAt, updatedAt, startedAt, completedAt. Persisted as a JSON array in `data/jobs.json`.

## Test report

```
$ npm test
ℹ tests 23
ℹ suites 5
ℹ pass 23
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ duration_ms 2962.97
```

Coverage: cost estimation and input validation (8), the state machine including illegal transitions, retry attempt counting and the 3-attempt cap, persistence round-trip, restart resume, corrupt-store recovery, deterministic worker ticks and failure injection (9), and end-to-end HTTP on an ephemeral port: create/list, validation 400s, cancel from queued and from completed (409), failure-inject -> retry -> complete, and 404s (6). Smoke-tested `npm start` end to end via curl: job created queued with a 10-credit estimate, completed after worker ticks, appeared in the gallery, and persisted to `data/jobs.json` across a restart.

## What is simulated vs real

**Simulated (documented in code):** the video models and their catalog (fictional names and prices, not Runway's), the render worker (a timer, not GPU compute), the gallery thumbnails (CSS gradients, no media files), the HMAC-style polish of a real webhook pipeline (out of scope here).

**Real:** the state machine and its illegal-transition enforcement, the queue and persistence, the cost estimation math, the REST API contract, the retry and attempt-cap logic, the restart-resume behavior.
