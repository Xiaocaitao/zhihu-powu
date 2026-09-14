import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { once } from "node:events";
import test from "node:test";
import vm from "node:vm";
import { createPowuServer } from "../src/server.ts";
import { createDefaultCapabilityRegistry } from "../src/app/composition-root.ts";
import { EvidenceApplication } from "../src/modules/evidence/application.ts";
import { createEvidenceService } from "../src/modules/evidence/defaults.ts";
import { MockEvidenceGeneration } from "../src/modules/evidence/generation.ts";
import { MemoryEvidenceRepository } from "../src/modules/evidence/memory-repository.ts";
import { defaultPorts, KNOWN_SKILL } from "./support/evidence-fixtures.ts";

type ShimElement = {
  selector: string;
  innerHTML: string;
  textContent: string;
  value: string;
  className: string;
  disabled: boolean;
  style: Record<string, unknown>;
  dataset: Record<string, string>;
  listeners: Record<string, ((event: unknown) => unknown)[]>;
  classList: { add(): void; remove(): void; toggle(): void; contains(): boolean };
  addEventListener(type: string, handler: (event: unknown) => unknown): void;
  querySelector(selector: string): ShimElement;
  querySelectorAll(selector: string): ShimElement[];
  after(): void;
  remove(): void;
  append(): void;
  setAttribute(): void;
  getAttribute(): null;
  focus(): void;
};

function createDom() {
  const elements = new Map<string, ShimElement>();
  const element = (selector: string): ShimElement => {
    const existing = elements.get(selector);
    if (existing) return existing;
    const created: ShimElement = {
      selector, innerHTML: "", textContent: "", value: "", className: "", disabled: false,
      style: {}, dataset: {}, listeners: {},
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      addEventListener(type, handler) { (created.listeners[type] ??= []).push(handler); },
      querySelector: inner => element(inner),
      querySelectorAll: () => [],
      after() {}, remove() {}, append() {}, setAttribute() {}, getAttribute: () => null, focus() {},
    };
    elements.set(selector, created);
    return created;
  };
  const document = {
    querySelector: (selector: string) => element(selector),
    querySelectorAll: () => [] as ShimElement[],
    createElement: () => element("created-" + elements.size),
    addEventListener() {},
  };
  return { document, element };
}

/**
 * Runs the prototype page scripts against a minimal DOM shim and the real API,
 * so a runtime error or a missing element in the page fails this test instead
 * of only showing up in a browser.
 */
test("原型页面脚本在真实接口下可渲染学习记录与模拟面试", async () => {
  const registry = createDefaultCapabilityRegistry({
    evidence: new EvidenceApplication(new MemoryEvidenceRepository(), createEvidenceService({
      generation: new MockEvidenceGeneration(), ports: defaultPorts(),
    })),
  });
  const server = createPowuServer({ capabilityRegistry: registry });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const cookie = "powu_owner=evidence-page-runtime";
  try {
    const html = await readFile(new URL("../public/learning-platform-prototype.html", import.meta.url), "utf8");
    const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)]
      .filter(match => !/text\/plain/.test(match[1]))
      .map(match => match[2]);
    assert.ok(scripts.length >= 5);

    const { document, element } = createDom();
    const sandbox: Record<string, unknown> = {
      document,
      console,
      window: { scrollTo() {}, addEventListener() {}, removeEventListener() {} },
      setTimeout,
      clearTimeout,
      queueMicrotask,
      URLSearchParams,
      URL,
      TextDecoder,
      Date,
      navigator: { userAgent: "node-test" },
      location: { href: origin + "/learning-platform-prototype.html" },
      headers: { "content-type": "application/json", cookie },
      apiFetch: (path: string, init?: RequestInit) =>
        fetch(origin + path, { ...init, headers: { "content-type": "application/json", cookie, ...(init?.headers ?? {}) } }),
      toastIt: () => {},
    };
    const context = vm.createContext(sandbox);
    for (const code of scripts) vm.runInContext(code, context, { filename: "prototype-script" });
    assert.equal(typeof sandbox.render, "function", "页面应导出 render 函数");

    // 页面里的 fetch 使用同源相对路径，这里替换为指向测试服务器的实现。
    vm.runInContext("globalThis.fetch = (path, init) => apiFetch(String(path), init);", context);

    // 先在接口层创建一条带能力标识的记录，再让页面渲染。
    const created = await fetch(origin + "/api/evidence/records", {
      method: "POST", headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        kind: "activity", title: "页面运行时可读记录", content: "完成请求解析并记录了缓存疑问",
        occurredAt: new Date().toISOString(), durationMinutes: 25, skillIds: [KNOWN_SKILL],
      }),
    });
    assert.equal(created.status, 200);

    vm.runInContext("render('record')", context);
    await waitFor(() => element("#record-list").innerHTML.includes("页面运行时可读记录"));
    assert.match(element("#record-list").innerHTML, /25 分钟/);
    assert.match(element("#record-count").textContent, /条/);
    assert.ok(element("#record-coverage").textContent.length > 0);
    await waitFor(() => element("#skill-list").innerHTML.includes("HTTP") || element("#skill-list").innerHTML.length > 0);

    // 模拟面试页：无会话时展示开始表单，有会话时展示当前题目。
    vm.runInContext("render('interview')", context);
    await waitFor(() => element("#interview-root").innerHTML.includes("开始一次模拟面试"));
    const started = await fetch(origin + "/api/evidence/interviews", {
      method: "POST", headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ target: { kind: "skills", skillIds: [KNOWN_SKILL] }, questionCount: 2 }),
    });
    const interview = (await started.json()).data.interview;
    assert.equal(interview.status, "active");
    vm.runInContext("render('interview')", context);
    await waitFor(() => element("#interview-root").innerHTML.includes(interview.currentQuestion.prompt));
    assert.match(element("#interview-root").innerHTML, /面试进度/);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

async function waitFor(predicate: () => boolean, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.fail("页面脚本未在预期时间内渲染服务端数据");
}
