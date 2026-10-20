// Generative video job console. SIMULATED end to end.
//
// Independent prototype. Not affiliated with Runway. No video is generated:
// the worker advances progress on a timer and completed jobs render as
// styled placeholder cards in the gallery. What IS real: the job state
// machine, the queue, cost estimation, persistence, and the API contract.
//
// Zero runtime dependencies. TypeScript runs directly on Node 22.6+ via
// type stripping; imports use .ts specifiers (see tsconfig
// allowImportingTsExtensions).

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ASPECT_RATIOS, MODELS } from "./models.ts";
import { DEFAULT_DATA_FILE, JobStore } from "./queue.ts";
import { SPEEDUP, TICK_MS, Worker } from "./worker.ts";
import type { JobStatus } from "./types.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(HERE, "..", "public");
const PORT = Number(process.env.PORT ?? 3000);

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-length": Buffer.byteLength(text),
    "content-type": "application/json; charset=utf-8",
  });
  res.end(text);
}

function sendHtml(res: ServerResponse, html: string): void {
  res.writeHead(200, {
    "content-length": Buffer.byteLength(html),
    "content-type": "text/html; charset=utf-8",
  });
  res.end(html);
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("Request body is not valid JSON"));
      }
    });
  });
}

export interface App {
  server: Server;
  store: JobStore;
  worker: Worker;
  port: number;
  close(): Promise<void>;
}

export function createApp(options: { dataFile?: string; port?: number } = {}): App {
  const store = new JobStore(options.dataFile ?? DEFAULT_DATA_FILE);
  const worker = new Worker(store);

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const method = req.method ?? "GET";
    const parts = url.pathname.split("/").filter(Boolean);

    try {
      // Static client.
      if (method === "GET" && url.pathname === "/") {
        const html = await readFile(join(PUBLIC_DIR, "index.html"), "utf8");
        return sendHtml(res, html);
      }

      // Honest metadata.
      if (method === "GET" && url.pathname === "/api/models") {
        return sendJson(res, 200, { models: MODELS, aspectRatios: ASPECT_RATIOS });
      }
      if (method === "GET" && url.pathname === "/api/config") {
        return sendJson(res, 200, {
          simulated: true,
          affiliation: "Independent prototype. Not affiliated with Runway. No video is generated.",
          speedup: SPEEDUP,
          tickMs: TICK_MS,
          maxAttempts: 3,
        });
      }

      // Failure injection control.
      if (url.pathname === "/api/failure") {
        if (method === "GET") return sendJson(res, 200, { failNext: worker.getFailNext() });
        if (method === "POST") {
          const body = (await readJsonBody(req)) as { enabled?: unknown };
          worker.setFailNext(body.enabled === true);
          return sendJson(res, 200, { failNext: worker.getFailNext() });
        }
      }

      // Jobs collection.
      if (parts[0] === "api" && parts[1] === "jobs" && parts.length === 2) {
        if (method === "GET") {
          const status = url.searchParams.get("status");
          const valid: JobStatus[] = ["queued", "processing", "completed", "failed", "cancelled"];
          if (status && !valid.includes(status as JobStatus)) {
            return sendJson(res, 400, { error: `status must be one of ${valid.join(", ")}` });
          }
          return sendJson(res, 200, { jobs: store.list(status as JobStatus | undefined) });
        }
        if (method === "POST") {
          const body = (await readJsonBody(req)) as {
            prompt?: unknown;
            durationSeconds?: unknown;
            aspectRatio?: unknown;
            model?: unknown;
          };
          const durationSeconds = Number(body.durationSeconds);
          try {
            const job = store.create({
              prompt: String(body.prompt ?? ""),
              durationSeconds,
              aspectRatio: String(body.aspectRatio ?? ""),
              model: String(body.model ?? ""),
            });
            return sendJson(res, 201, { job });
          } catch (err) {
            return sendJson(res, 400, { error: (err as Error).message });
          }
        }
      }

      // Job member actions.
      if (parts[0] === "api" && parts[1] === "jobs" && parts.length === 3) {
        const job = store.get(parts[2]);
        if (!job) return sendJson(res, 404, { error: "Unknown job" });
        if (method === "GET") return sendJson(res, 200, { job });
      }
      if (parts[0] === "api" && parts[1] === "jobs" && parts.length === 4) {
        const id = parts[2];
        const action = parts[3];
        if (method === "POST" && action === "cancel") {
          try {
            return sendJson(res, 200, { job: store.transition(id, "cancelled") });
          } catch (err) {
            return sendJson(res, 409, { error: (err as Error).message });
          }
        }
        if (method === "POST" && action === "retry") {
          try {
            return sendJson(res, 200, { job: store.retry(id) });
          } catch (err) {
            return sendJson(res, 409, { error: (err as Error).message });
          }
        }
      }

      return sendJson(res, 404, { error: "Not found" });
    } catch (err) {
      return sendJson(res, 500, { error: (err as Error).message });
    }
  };

  const server = createServer((req, res) => {
    void handler(req, res);
  });

  // The simulated worker advances jobs on a fixed interval.
  const timer = setInterval(() => {
    try {
      worker.tick();
    } catch {
      // A tick must never crash the server; errors surface via the API.
    }
  }, TICK_MS);
  timer.unref();

  return {
    server,
    store,
    worker,
    port: options.port ?? PORT,
    close: () =>
      new Promise<void>((resolve, reject) => {
        clearInterval(timer);
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

const invokedAsMain = process.argv[1] === fileURLToPath(import.meta.url);
if (invokedAsMain) {
  const app = createApp();
  app.server.listen(app.port, () => {
    console.log(`Generative video job console (SIMULATED) on http://localhost:${app.port}`);
    console.log("Independent prototype. Not affiliated with Runway. No video is generated.");
  });
}
