import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";

import { RouteService } from "../src/routes/service.ts";
import { createPowuServer } from "../src/server.ts";
import type { RouteAgent, RoutePlan, RouteRecord, RouteRepository, RouteRequest } from "../src/routes/types.ts";

test("health endpoint returns a successful JSON response", async (t) => {
  const server = createPowuServer();
  t.after(() => server.close());

  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  assert.ok(address && typeof address !== "string");

  const response = await fetch(`http://127.0.0.1:${address.port}/healthz`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });

  const frontend = await fetch(`http://127.0.0.1:${address.port}/`);
  assert.equal(frontend.status, 200);
  assert.match(await frontend.text(), /看山助手/);
  const asset = await fetch(`http://127.0.0.1:${address.port}/assets/idle.gif`);
  assert.equal(asset.status, 200);
  assert.equal(asset.headers.get("content-type"), "image/gif");
  assert.ok((await asset.arrayBuffer()).byteLength > 0);
});

test("route endpoint streams before generation finishes and returns a saved route", { timeout: 5000 }, async (t) => {
  const repository = new MemoryRouteRepository();
  let finishGeneration!: () => void;
  const gate = new Promise<void>(resolve => { finishGeneration = resolve; });
  t.after(() => finishGeneration());
  const agent: RouteAgent = {
    async generate(input: RouteRequest): Promise<RoutePlan> {
      await gate;
      return {
        industry_profile: `行业画像：${input.goal}`,
        summary: "先补基础，再做一个可展示的小项目。",
        capabilities: [{ name: "基础编程", type: "foundation", reason: "支撑后续实践" }],
        two_week_plan: [{ day: 1, title: "拆解目标", actions: ["写下当前水平"], acceptance: "形成一页计划", hours: 2 }],
        sources: [],
      };
    },
  };
  const server = createPowuServer({ routeService: new RouteService(repository, agent) });
  t.after(() => server.close());

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const invalid = await fetch(`${baseUrl}/api/routes`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ goal: "" }),
  });
  assert.equal(invalid.status, 400);

  const created = await fetch(`${baseUrl}/api/routes`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ goal: "成为后端开发者", profile: { weekly_hours: 10 } }),
  });
  assert.equal(created.status, 200);
  assert.match(created.headers.get("content-type") ?? "", /text\/event-stream/);
  const reader = created.body!.getReader();
  const first = await reader.read();
  assert.match(new TextDecoder().decode(first.value), /event: progress/);
  assert.equal((await repository.get("route-1"))?.status, "processing");
  finishGeneration();
  let stream = new TextDecoder().decode(first.value);
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    stream += new TextDecoder().decode(value);
  }
  const events = await readSse(new Response(stream));
  assert.ok(events.some(event => event.event === "progress" && (event.data as { stage?: string }).stage === "request_saved"));
  const record = events.find(event => event.event === "complete")?.data as RouteRecord | undefined;
  assert.ok(record);
  assert.equal(record.status, "completed");
  assert.equal(record.request.goal, "成为后端开发者");
  assert.equal(record.plan?.two_week_plan[0]?.day, 1);

  const fetched = await fetch(`${baseUrl}/api/routes/${record.id}`);
  assert.equal(fetched.status, 200);
  assert.deepEqual(await fetched.json(), record);
});

test("model JSON errors return an SSE error and persist failed status", async (t) => {
  const repository = new MemoryRouteRepository();
  const agent: RouteAgent = { async generate() { throw new SyntaxError("invalid model JSON"); } };
  const server = createPowuServer({ routeService: new RouteService(repository, agent) });
  t.after(() => server.close());
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const response = await fetch(`http://127.0.0.1:${address.port}/api/routes`, {
    method: "POST", body: JSON.stringify({ goal: "test" }),
  });
  const events = await readSse(response);
  assert.deepEqual(events.at(-1), { event: "error", data: { error: "route_generation_failed" } });
  assert.equal(events.some(event => event.event === "complete"), false);
  assert.equal((await repository.get("route-1"))?.status, "failed");
});

class MemoryRouteRepository implements RouteRepository {
  private readonly records = new Map<string, RouteRecord>();

  async createRequest(input: RouteRequest) {
    const id = `route-${this.records.size + 1}`;
    const created_at = new Date().toISOString();
    this.records.set(id, { id, status: "processing", request: input, created_at });
    return { id, created_at };
  }

  async savePlan(id: string, plan: RoutePlan): Promise<RouteRecord> {
    const previous = this.records.get(id);
    assert.ok(previous);
    const record = { ...previous, status: "completed" as const, plan };
    this.records.set(id, record);
    return record;
  }

  async failRequest(id: string, message: string): Promise<void> {
    const previous = this.records.get(id);
    if (previous) this.records.set(id, { ...previous, status: "failed", error: message });
  }

  async get(id: string): Promise<RouteRecord | null> {
    return this.records.get(id) ?? null;
  }
}

async function readSse(response: Response): Promise<Array<{ event: string; data: unknown }>> {
  const text = await response.text();
  return text.trim().split(/\n\n/).filter(Boolean).map(block => {
    const lines = block.split(/\r?\n/);
    return {
      event: lines.find(line => line.startsWith("event: "))?.slice(7) ?? "message",
      data: JSON.parse(lines.find(line => line.startsWith("data: "))?.slice(6) ?? "null"),
    };
  });
}
