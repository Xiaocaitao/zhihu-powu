import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { ZodError } from "zod";
import { createPool, ensureSchema } from "./db/postgres.ts";
import { PiRouteAgent } from "./agent/pi-route-agent.ts";
import { PostgresRouteRepository } from "./routes/postgres-repository.ts";
import { RouteService } from "./routes/service.ts";
import { routeRequestSchema } from "./routes/types.ts";

type PowuServerOptions = {
  routeService?: RouteService;
  readiness?: () => Promise<void>;
};

export function createPowuServer(options: PowuServerOptions = {}): Server {
  return createServer(async (request, response) => {
    const path = (request.url ?? "/").split("?", 1)[0];
    response.setHeader("content-type", "application/json; charset=utf-8");

    if (path === "/healthz") {
      response.statusCode = 200;
      response.end(JSON.stringify({ ok: true }));
      return;
    }

    if (path === "/readyz") {
      try {
        await options.readiness?.();
        sendJson(response, 200, { ok: true });
      } catch (error) {
        console.error("readiness check failed", error);
        sendJson(response, 503, { ok: false, error: "not_ready" });
      }
      return;
    }

    if (path === "/" && request.method === "GET") {
      try {
        response.setHeader("content-type", "text/html; charset=utf-8");
        response.statusCode = 200;
        response.end(await readFile(new URL("../public/index.html", import.meta.url), "utf8"));
      } catch (error) {
        console.error("frontend unavailable", error);
        sendJson(response, 503, { ok: false, error: "frontend_unavailable" });
      }
      return;
    }

    if (path.startsWith("/assets/") && request.method === "GET") {
      const assetName = path.slice("/assets/".length);
      if (!assetName || assetName.includes("..") || assetName.includes("\\")) {
        sendJson(response, 404, { ok: false, error: "not_found" });
        return;
      }
      try {
        const asset = await readFile(new URL(`../public/assets/${assetName}`, import.meta.url));
        const contentTypes: Record<string, string> = {
          ".gif": "image/gif",
          ".jpg": "image/jpeg",
          ".jpeg": "image/jpeg",
          ".png": "image/png",
          ".js": "text/javascript; charset=utf-8",
        };
        const extension = assetName.slice(assetName.lastIndexOf(".")).toLowerCase();
        response.setHeader("content-type", contentTypes[extension] ?? "application/octet-stream");
        response.statusCode = 200;
        response.end(asset);
      } catch {
        sendJson(response, 404, { ok: false, error: "not_found" });
      }
      return;
    }

    const asset = path.match(/^\/assets\/(kanshan-front\.jpg|idle\.gif|wander\.gif)$/)?.[1];
    if (asset && request.method === "GET") {
      try {
        const body = await readFile(new URL(`../public/assets/${asset}`, import.meta.url));
        response.setHeader("content-type", asset.endsWith(".jpg") ? "image/jpeg" : "image/gif");
        response.end(body);
      } catch {
        sendJson(response, 404, { error: "not_found" });
      }
      return;
    }

    if (path === "/api/routes" && request.method === "POST") {
      if (!options.routeService) {
        sendJson(response, 503, { ok: false, error: "route_service_unavailable" });
        return;
      }

      try {
        const body = await readJsonBody(request);
        routeRequestSchema.parse(body);
        const controller = new AbortController();
        const abort = () => controller.abort();
        request.once("aborted", abort);
        response.statusCode = 200;
        response.setHeader("content-type", "text/event-stream; charset=utf-8");
        response.setHeader("cache-control", "no-cache, no-transform");
        response.setHeader("connection", "keep-alive");
        response.setHeader("x-accel-buffering", "no");
        writeSse(response, "progress", { stage: "accepted", message: "已接收请求，正在准备路线" });
        const heartbeat = setInterval(() => {
          if (!response.destroyed && !response.writableEnded) response.write(": heartbeat\n\n");
        }, 15000);
        const stopHeartbeat = () => clearInterval(heartbeat);
        response.once("close", stopHeartbeat);
        try {
          const record = await options.routeService.create(body, controller.signal, event => {
            writeSse(response, "progress", event);
          });
          writeSse(response, "complete", record);
        } finally {
          stopHeartbeat();
          response.removeListener("close", stopHeartbeat);
          request.removeListener("aborted", abort);
        }
        response.end();
      } catch (error) {
        if (response.headersSent) {
          console.error("route generation failed", error);
          writeSse(response, "error", { error: "route_generation_failed" });
          response.end();
          return;
        }
        if (
          error instanceof ZodError ||
          error instanceof SyntaxError ||
          (error instanceof Error && ["request body is required", "request body too large"].includes(error.message))
        ) {
          const issues = error instanceof ZodError ? error.issues : undefined;
          sendJson(response, 400, { ok: false, error: "invalid_request", ...(issues ? { issues } : {}) });
          return;
        }
        console.error("route generation failed", error);
        sendJson(response, 502, { ok: false, error: "route_generation_failed" });
      }
      return;
    }

    const routeId = path.match(/^\/api\/routes\/([^/]+)$/)?.[1];
    if (routeId && request.method === "GET") {
      if (!options.routeService) {
        sendJson(response, 503, { ok: false, error: "route_service_unavailable" });
        return;
      }
      const record = await options.routeService.get(routeId);
      sendJson(response, record ? 200 : 404, record ?? { ok: false, error: "not_found" });
      return;
    }

    sendJson(response, 404, { ok: false, error: "not_found" });
  });
}

export async function startPowuServer(): Promise<Server> {
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? "0.0.0.0";
  const pool = createPool();
  await ensureSchema(pool);
  const repository = new PostgresRouteRepository(pool);
  const routeService = new RouteService(repository, new PiRouteAgent());
  const server = createPowuServer({
    routeService,
    readiness: async () => {
      await pool.query("SELECT 1");
    },
  });
  server.once("close", () => {
    void pool.end();
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.removeListener("error", reject);
      console.log(`powu server listening on ${host}:${port}`);
      resolve();
    });
  });

  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startPowuServer().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}

function sendJson(response: import("node:http").ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.end(JSON.stringify(body));
}

function writeSse(response: import("node:http").ServerResponse, event: string, data: unknown): void {
  if (response.writableEnded || response.destroyed) return;
  response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function readJsonBody(request: import("node:http").IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 128 * 1024) throw new Error("request body too large");
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) throw new Error("request body is required");
  return JSON.parse(text);
}
