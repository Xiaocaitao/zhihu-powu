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
  children: unknown[];
  textContent: string;
  innerHTML: string;
  value: string;
  checked: boolean;
  hidden: boolean;
  className: string;
  type: string;
  placeholder: string;
  style: Record<string, unknown>;
  dataset: Record<string, string>;
  files: unknown[];
  options: unknown[];
  listeners: Record<string, ((event: unknown) => unknown)[]>;
  classList: { add(): void; remove(): void; toggle(): void; contains(): boolean };
  addEventListener(type: string, handler: (event: unknown) => unknown): void;
  append(...nodes: unknown[]): void;
  replaceChildren(...nodes: unknown[]): void;
  reset(): void;
  focus(): void;
  remove(): void;
};

function textOf(node: unknown): string {
  if (node === null || node === undefined) return "";
  if (typeof node === "string") return node;
  const element = node as Partial<ShimElement>;
  const own = typeof element.textContent === "string" ? element.textContent : "";
  const nested = Array.isArray(element.children) ? element.children.map(textOf).join("") : "";
  return own + nested;
}

function createDom() {
  const elements = new Map<string, ShimElement>();
  const element = (selector: string): ShimElement => {
    const existing = elements.get(selector);
    if (existing) return existing;
    const created = {
      selector, children: [] as unknown[], textContent: "", value: "", checked: false, hidden: false,
      className: "", type: "", placeholder: "", style: {}, dataset: {}, files: [], options: [],
      listeners: {} as Record<string, ((event: unknown) => unknown)[]>,
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      addEventListener(type: string, handler: (event: unknown) => unknown) { (created.listeners[type] ??= []).push(handler); },
      append(...nodes: unknown[]) { created.children.push(...nodes); },
      replaceChildren(...nodes: unknown[]) { created.children = [...nodes]; created.textContent = ""; },
      reset() {}, focus() {}, remove() {},
    } as unknown as ShimElement;
    Object.defineProperty(created, "innerHTML", {
      get: () => textOf(created),
      set: (value: string) => { created.children = [value]; created.textContent = ""; },
    });
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
 * 运行主页面最后一段脚本（学习记录与模拟面试的页内实现），连真实接口，
 * 断言两个模块的动作都在页内完成，并且不会走 Agent 会话接口。
 */
test("主页面两个模块的动作在页内直连接口完成，不跳到会话", async () => {
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
  const cookie = "powu_owner=evidence-index-page";
  const calls: string[] = [];
  try {
    const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
    // 静态约束：两个模块不再使用旧的跳会话钩子，其它模块保持原样。
    assert.ok(!html.includes('id="interview-form"'), "面试表单不应再使用旧的跳会话钩子");
    assert.ok(!html.includes('data-record-action="add"'), "学习记录不应再使用旧的跳会话钩子");
    assert.ok(html.includes('data-profile-action="read"'), "其它模块的入口应保持原样");

    const block = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].at(-1)?.[2];
    assert.ok(block, "应能找到页面最后一段脚本");
    const { document, element } = createDom();
    const sandbox: Record<string, unknown> = {
      document,
      console,
      setTimeout,
      clearTimeout,
      queueMicrotask,
      URLSearchParams,
      URL,
      Date,
      fetch: async (path: string, init?: RequestInit) => {
        calls.push(String(path));
        return fetch(origin + String(path), { ...init, headers: { "content-type": "application/json", cookie, ...(init?.headers ?? {}) } });
      },
    };
    const context = vm.createContext(sandbox);
    vm.runInContext(block, context, { filename: "index-evidence-script" });
    const panel = sandbox.renderInterviewPanel as () => Promise<void>;
    assert.equal(typeof panel, "function");

    // 记录一条学习：页面表单直接落库，时间线在页内刷新。
    element("#record-title").value = "页内记录：HTTP 练习";
    element("#record-content").value = "完成请求解析并记录了缓存疑问";
    element("#record-duration").value = "30";
    element("#record-kind").value = "activity";
    await element("#record-form").listeners.submit[0]({ preventDefault() {} });
    await waitFor(() => element("#record-list").innerHTML.includes("页内记录：HTTP 练习"));
    assert.match(element("#record-count").textContent, /条/);

    // 开始面试：能力下拉来自共享能力目录，题目在页内出现。
    element("#interview-target-kind").value = "skills";
    element("#interview-target-skill").value = KNOWN_SKILL;
    element("#interview-count").value = "1";
    await element("#interview-start-form").listeners.submit[0]({ preventDefault() {} });
    await waitFor(() => element("#interview-question").textContent.length > 0 && element("#interview-question-title").textContent.startsWith("第 1 题"));

    // 提交回答：逐题反馈与报告都在页内渲染。
    element("#interview-answer").value = "我实现了请求解析并说明了结果。";
    await element("#interview-answer-form").listeners.submit[0]({ preventDefault() {} });
    await waitFor(() => element("#interview-feedback").innerHTML.includes("本题反馈"));
    await waitFor(() => element("#interview-report").innerHTML.includes("建议") || element("#interview-report").innerHTML.includes("报告状态"));

    // 全程不调用 Agent 会话接口，也没有任何跳转会话的动作。
    assert.ok(calls.some(path => path.startsWith("/api/skills")), "能力下拉应来自共享能力目录接口");
    assert.ok(calls.some(path => path.startsWith("/api/evidence/records")), "记录应走 Evidence 公开接口");
    assert.ok(calls.some(path => path.startsWith("/api/evidence/interviews")), "面试应走 Evidence 公开接口");
    assert.ok(!calls.some(path => path.startsWith("/api/chat")), "模块内动作不应调用主 Agent 会话");

    // 能力目录接口本身可用，且包含页面下拉需要的能力标识。
    const catalog = await fetch(`${origin}/api/skills?limit=100`, { headers: { cookie } });
    assert.equal(catalog.status, 200);
    const catalogItems = (await catalog.json()).data.items;
    assert.ok(catalogItems.some((item: { skillId: string }) => item.skillId === KNOWN_SKILL), "能力目录应包含共享能力标识");

    // 按同样范围再练一场：创建新的会话，不去修改已结束的那场。
    const startsBefore = calls.filter(path => path === "/api/evidence/interviews").length;
    await element("[data-interview-again]").listeners.click[0]({});
    await waitFor(() => element("#interview-question-title").textContent.startsWith("第 1 题"));
    const startsAfter = calls.filter(path => path === "/api/evidence/interviews").length;
    assert.equal(startsAfter, startsBefore + 1, "再练一场应创建新的面试会话");
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
