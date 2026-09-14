import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createDoubaoStructuredExecutor } from '../src/llm/doubao.ts';
import { createLlmInvoker } from '../src/llm/invoker.ts';
import { createLlmEvidenceGeneration } from '../src/modules/evidence/generation.ts';

test('豆包传输链路向模型发送具体题目契约，真实 HTTP 返回文本可解析', async () => {
  let received: unknown;
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    received = JSON.parse(body);
    const message = { id: 'msg-test', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify({ questions: [{ category: 'project', prompt: '这个项目解决了什么问题？', skillIds: [] }] }), annotations: [] }] };
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const events = [
      { type: 'response.output_item.added', output_index: 0, item: { ...message, content: [] } },
      { type: 'response.output_item.done', output_index: 0, item: message },
      { type: 'response.completed', response: { id: 'resp-test', status: 'completed', output: [message], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
    ];
    for (const event of events) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    res.end();
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const addr = server.address(); assert.ok(addr && typeof addr !== 'string');
  const previousKey = process.env.PI_API_KEY;
  process.env.PI_API_KEY = 'local-test-only';
  try {
    const executor = createDoubaoStructuredExecutor({ modelId: 'local-contract-test', baseUrl: `http://127.0.0.1:${addr.port}` });
    assert.ok(executor);
    const generator = createLlmEvidenceGeneration(createLlmInvoker(executor));
    const plan = await generator.buildInterview({ target: { kind: 'project', project: { title: '测试知识库', goal: '整理笔记' } }, difficulty: null, questionCount: 1, focus: null, skills: [], requirements: null, project: { title: '测试知识库', goal: '整理笔记', contribution: null }, baseline: null });
    assert.equal(plan.questions[0].prompt, '这个项目解决了什么问题？');
    const sent = JSON.stringify(received);
    assert.match(sent, /JSON Schema/);
    assert.match(sent, /skillIds/);
    assert.match(sent, /category/);
    assert.match(sent, /additionalProperties/);
  } finally {
    if (previousKey === undefined) delete process.env.PI_API_KEY; else process.env.PI_API_KEY = previousKey;
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
