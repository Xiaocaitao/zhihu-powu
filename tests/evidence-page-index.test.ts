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
  disabled: boolean;
  ariaBusy: string;
  focused: boolean;
  scrolled: boolean;
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
  scrollIntoView(): void;
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
      reset() {}, focus() { created.focused = true; }, scrollIntoView() { created.scrolled = true; },
      remove() { for (const parent of elements.values()) parent.children = parent.children.filter(child => child !== created); },
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
  let failHistory = false;
  let releaseRequest: (() => void) | undefined;
  let pausePath: string | undefined;
  try {
    const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
    // 静态约束：两个模块不再使用旧的跳会话钩子，其它模块保持原样。
    assert.ok(!html.includes('id="interview-form"'), "面试表单不应再使用旧的跳会话钩子");
    assert.ok(!html.includes('data-record-action="add"'), "学习记录不应再使用旧的跳会话钩子");
    assert.ok(html.includes('data-profile-action="read"'), "其它模块的入口应保持原样");
    assert.ok(html.includes("if(name==='record')void refreshRecords()"), '主导航应调用导出的模块刷新入口');
    for (const id of ['record-project-source', 'record-project-existing', 'interview-target-project-title', 'interview-target-project-goal', 'interview-history-status', 'interview-scope-details', 'interview-scope-notes', 'record-save-status']) {
      assert.ok(html.includes(`id="${id}"`), `${id} 必须存在于真实 HTML，不能只靠测试 DOM 自动虚构`);
    }

    const block = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].at(-1)?.[2];
    assert.ok(block, "应能找到页面最后一段脚本");
    const { document, element } = createDom();
    const sseHandlers: Record<string, (data: unknown) => unknown> = {};
    const pageCalls: string[] = [];
    const sandbox: Record<string, unknown> = {
      document,
      console,
      setTimeout,
      clearTimeout,
      queueMicrotask,
      URLSearchParams,
      URL,
      Date,
      crypto: globalThis.crypto,
      fetch: async (path: string, init?: RequestInit) => {
        calls.push(String(path));
        if (path === pausePath) await new Promise<void>(resolve => { releaseRequest = resolve; });
        if (failHistory && /^\/api\/evidence\/interviews\/[^/]+$/.test(path)) return new Response(JSON.stringify({ error: { message: '临时读取失败' } }), { status: 503 });
        return fetch(origin + String(path), { ...init, headers: { "content-type": "application/json", cookie, ...(init?.headers ?? {}) } });
      },
      // 页面里已有的全局函数：这里只用于验证 Agent 工具结束后的页面联动。
      parseSse: (_response: unknown, handlers: Record<string, (data: unknown) => unknown>) => {
        Object.assign(sseHandlers, handlers);
        return Promise.resolve();
      },
      showPage: (name: string) => { pageCalls.push(name); },
      renderInterviewPanel: () => Promise.resolve(),
      refreshRecords: () => Promise.resolve(),
    };
    const context = vm.createContext(sandbox);
    vm.runInContext(block, context, { filename: "index-evidence-script" });
    const panel = sandbox.renderInterviewPanel as () => Promise<void>;
    assert.equal(typeof panel, "function");
    assert.equal(element('#interview-answer').disabled, true, '未开始时不能回答');
    await (sandbox.refreshRecords as () => Promise<void>)();
    assert.ok(calls.some(path => path.startsWith('/api/evidence/records')), '进入学习记录页必须调用新版初始化入口');

    // 记录一条学习：页面表单直接落库，时间线在页内刷新。
    element("#record-title").value = "页内记录：HTTP 练习";
    element("#record-content").value = "完成请求解析并记录了缓存疑问";
    element("#record-duration").value = "30";
    element("#record-kind").value = "activity";
    await element("#record-form").listeners.submit[0]({ preventDefault() {} });
    await waitFor(() => element("#record-list").innerHTML.includes("页内记录：HTTP 练习"));
    assert.match(element("#record-count").textContent, /条/);
    await waitFor(() => element('#record-save-status').ariaBusy === 'false');
    element('#review-range').value = '7d';
    pausePath = '/api/evidence/reviews';
    await element('#review-form').listeners.submit[0]({ preventDefault() {} });
    await waitFor(() => !!releaseRequest);
    assert.equal(element('#review-list').ariaBusy, 'true');
    assert.equal(element('#review-form button[type="submit"]').disabled, true);
    assert.match(element('#review-list').innerHTML, /正在整理所选时段/);
    pausePath = undefined; releaseRequest!(); releaseRequest = undefined;
    await waitFor(() => element('#review-list').ariaBusy === 'false');
    assert.match(element('#review-list').innerHTML, /进展/);
    assert.equal(element('#review-form button[type="submit"]').disabled, false);

    // 开始面试：能力下拉来自共享能力目录，题目在页内出现。
    element("#interview-target-kind").value = "skills";
    element("#interview-target-skill").value = KNOWN_SKILL;
    element("#interview-count").value = "1";
    pausePath = '/api/evidence/interviews';
    await element("#interview-start-form").listeners.submit[0]({ preventDefault() {} });
    await waitFor(() => !!releaseRequest);
    assert.equal(element('#interview-feedback').ariaBusy, 'true');
    assert.equal(element('#interview-start-form button[type="submit"]').disabled, true);
    assert.match(element('#interview-feedback').innerHTML, /正在根据训练范围生成题目/);
    pausePath = undefined; releaseRequest!(); releaseRequest = undefined;
    await waitFor(() => element("#interview-question").textContent.length > 0 && element("#interview-question-title").textContent.startsWith("第 1 题"));
    await waitFor(() => element('#interview-feedback').ariaBusy === 'false');

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
    await waitFor(() => element('#interview-start-form button[type="submit"]').disabled === false);
    await panel();
    const historyRows = element('#interview-history').children as ShimElement[];
    assert.equal(historyRows.length, 2);
    const older = historyRows.find(row => textOf(row).includes('已完成'))!;
    const active = historyRows.find(row => textOf(row).includes('进行中'))!;
    const open = (row: ShimElement) => (row.children as ShimElement[]).find(child => child.type === 'button')!.listeners.click[0]({});
    element('#interview-answer').value = '尚未提交的真实回答';
    pausePath = `/api/evidence/interviews/${older.dataset.interviewId}`;
    const opening = open(older);
    await waitFor(() => !!releaseRequest);
    assert.equal(element('#interview-history-status').ariaBusy, 'true');
    pausePath = undefined; releaseRequest!(); releaseRequest = undefined;
    await opening;
    assert.match(element('#interview-status').textContent, /已完成/);
    assert.equal(element('#interview-answer').disabled, true);
    assert.equal(element('#interview-question-title').scrolled, true);
    assert.equal(element('#interview-question-title').focused, true);
    assert.equal(element('#interview-history-status').ariaBusy, 'false');
    await element('[data-interview-resume]').listeners.click[0]({});
    assert.equal(element('#interview-answer').value, '尚未提交的真实回答');
    failHistory = true;
    await open(older);
    assert.match(element('#interview-history-status').innerHTML, /临时读取失败/);
    assert.equal(element('#interview-start-form button[type="submit"]').disabled, false);
    assert.match(element('#interview-status').textContent, /进行中/);
    failHistory = false;

    // 聊天的 SSE 里 Agent 调用本模块工具成功后，页面自动切到对应模块。
    await (sandbox.parseSse as (response: unknown, handlers: object) => Promise<void>)({}, {});
    const toolEnd = sseHandlers.tool_end as (data: unknown) => unknown;
    assert.equal(typeof toolEnd, "function", "应接管 tool_end 事件");
    toolEnd({ tool_name: "start_interview", error: false });
    assert.deepEqual(pageCalls, ["interview"], "开始面试后应切到模拟面试页");
    toolEnd({ tool_name: "record_learning_evidence", error: false });
    assert.deepEqual(pageCalls, ["interview", "record"], "记录学习后应切到学习记录页");
    toolEnd({ tool_name: "start_interview", error: true });
    toolEnd({ tool_name: "get_learning_records", error: false });
    assert.deepEqual(pageCalls, ["interview", "record"], "失败或只读工具不应触发跳转");

    const sessions = await (await fetch(`${origin}/api/evidence/interviews`, { headers: { cookie } })).json();
    const exactId = sessions.data.session.interviewId;
    toolEnd({ tool_name: 'start_interview', error: false, entity_id: exactId });
    await waitFor(() => pageCalls.length === 3);
    assert.ok(calls.includes(`/api/evidence/interviews/${exactId}`), 'AI 应打开工具返回的具体会话');
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
