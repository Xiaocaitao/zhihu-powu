# Evidence & Interview 模块

本模块负责学习记录、项目成果、能力证据、阶段复盘和文字模拟面试。学习计划、阶段测试、岗位匹配、用户画像和知识库文件仍由对应模块负责。

## 当前交付

- `contracts.ts`：记录、证据、复盘、面试及统一结果类型。
- `service.ts`：领域规则实现（记录、证据、复盘、面试状态机），通过依赖注入调用外部查询端口与生成端口。
- `application.ts`：从仓储读取权威数据，在同一事务中保存业务对象与幂等操作；不依赖进程内历史状态。
- `repository.ts`：Repository 端口。
- `postgres-repository.ts`：PostgreSQL 事务适配器；`memory-repository.ts`：不带用户样例的测试适配器。
- `http.ts`：HTTP 路径、请求与状态码映射；`ports.ts`：外部查询边界。
- `capabilities.ts`：13 项工具定义，只做入参校验与委托。
- `generation.ts`：生成端口、模型适配器、结果校验（含引用必须可追溯）与确定性测试替身。
- `defaults.ts`：模块组装入口；`pagination.ts`：游标与时区周范围。
- `src/db/migrations/003-evidence.sql`、`008`、`009`、`010`、`011`：模块迁移文件（编号已避开 main 新增的学习计划迁移）。

13 项能力已通过 composition-root 接入主 Agent 与 HTTP，主原型两个页面调用同一批能力。逐项落地证据见 docs/Evidence原始需求落地核验.md；其中「学习计划的权威历史事件」「阶段测试结果查询」两条依赖来源模块，目前如实返回覆盖缺失，不伪造历史。

## 工具清单

学习记录：`get_learning_records`、`record_learning_evidence`、`update_learning_evidence`、`evaluate_learning_evidence`、`get_skill_evidence`、`generate_learning_review`、`get_learning_reviews`。

模拟面试：`start_interview`、`get_interview_session`、`submit_interview_answer`、`finish_interview`、`get_interview_feedback`、`get_interview_records`。

## Mock 与 PostgreSQL 的边界

生成逻辑只在生成端口内实现：配置了模型时走模型适配器，未配置时返回 `DEPENDENCY_UNAVAILABLE`（可重试）。确定性替身仅用于测试，或在本地显式设置 `EVIDENCE_GENERATION=mock` 时启用，不作为生产默认回复。

`EvidenceApplication` 每次写入都从仓储恢复权威状态，并在一个短事务内保存业务对象与幂等操作；生成调用发生在事务之外，避免长时间占用连接。生产 server 注入 PostgreSQL 仓储，测试使用 MemoryEvidenceRepository。

生产组装应使用：

```text
PostgresEvidenceRepository
  → EvidenceApplication
  → DomainCapability adapter
  → Agent registry / HTTP handler
```

生成题目、评估证据、生成复盘、逐题反馈和整场报告统一走 `EvidenceGenerationPort`。默认实现由 `LlmInvoker` 驱动（`src/llm/doubao.ts` 提供豆包执行器），缺少 `PI_API_KEY`/`PI_MODEL` 时如实返回依赖不可用。

## HTTP 入口

页面与 Agent 使用同一批能力，仅传输层不同；写入可携带 `Idempotency-Key`，修正记录需通过 `If-Match` 或请求体提供 `expectedVersion`。

```text
GET    /api/evidence/records[?weekOf=|from=&to=&kinds=&taskId=&skillId=&limit=&cursor=]
POST   /api/evidence/records
GET    /api/evidence/records/:id
PATCH  /api/evidence/records/:id
GET    /api/evidence/skills[?skillIds=&sources=]
POST   /api/evidence/assessments
GET    /api/evidence/reviews ; POST /api/evidence/reviews ; GET /api/evidence/reviews/:id
GET    /api/evidence/interviews[?statuses=&jobId=&skillId=] ; POST /api/evidence/interviews
GET    /api/evidence/interviews/:id
POST   /api/evidence/interviews/:id/answers
POST   /api/evidence/interviews/:id/finish
GET    /api/evidence/interviews/:id/feedback[?questionId=]
```

错误映射：400 参数或身份字段非法、404 不存在、409 版本冲突或重复意图、502 生成失败、503 依赖未配置。

## 关键协作约束

- Learning Plan 提供任务、阶段、反馈、计划调整及阶段测试结果摘要；本模块只引用，不负责测试或调整计划。
- Career 提供岗位要求和能力标识；本模块不自行计算岗位匹配度。
- Profile 提供必要学习背景；缺少时只能使用本次明确输入。
- Knowledge 提供材料权限、内容片段及引用位置；本模块不直接读取知识库表。
- 外部来源变化使用稳定事件标识和修订号去重；同一学习事实不能重复计时。
- `ownerId` 由可信宿主注入，不能从模型参数读取。

## 验证

```text
npm run typecheck
node --test tests/evidence*.test.ts
```

测试覆盖保存、查询、详情、修正与版本冲突、撤回、来源去重、证据评估、能力卡片有效性、阶段复盘、生成失败恢复、面试状态机、报告、页面调用契约、持久幂等与并发隔离。完整仓库测试中的外部知乎上传用例可能受 Windows symlink 权限影响，与本模块无关。

真实数据库验证必须设置指向独立测试库的 TEST_DATABASE_URL：

- evidence-persistence.test.ts：重启、继续作答、结束、原子回滚。
- evidence-durable-operations.test.ts：持久幂等、同键不同载荷、并发回答、同场题目约束。
- evidence-http.test.ts：HTTP 重启后重试、错误状态、路径与身份输入隔离。
- evidence-ports.test.ts：外部查询归属与覆盖限制、真实文本材料读取。
- evidence-page-contract.test.ts：主原型两个页面实际调用的接口契约。
- evidence.service.test.ts / evidence.application.test.ts / evidence.generation.test.ts：领域规则、应用编排与生成校验。

HTTP 写入可携带 Idempotency-Key；同一次请求重试复用该值，新意图使用新值。键按 owner 和工具分隔，相同键不同载荷返回 409。生成失败时，会话或回答保留并通过 `recovery` 给出可重试动作，不会用固定内容冒充结果。
