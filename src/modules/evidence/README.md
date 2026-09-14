# Evidence & Interview 模块

本模块负责学习记录、项目成果、能力证据、阶段复盘和文字模拟面试。学习计划、阶段测试、岗位匹配、用户画像和知识库文件仍由对应模块负责。

## 当前交付

- `contracts.ts`：记录、证据、复盘、面试及统一结果类型。
- `service.ts`：可重复测试的内存业务实现，适合第一版 mock 和单元测试。
- `application.ts`：将写入结果委托给 Repository 的应用层包装器。
- `repository.ts`：Repository 端口。
- `postgres-repository.ts`：PostgreSQL 基础适配器。
- `capabilities.ts`：向主 Agent 暴露工具定义，执行逻辑委托 Service。
- `src/db/migrations/003-evidence.sql`：模块迁移文件。

当前 `capabilities.ts` 可以用于模块级测试和组装检查；队长需要把它适配到公共 `DomainCapability`，并注入可信 owner、requestId、toolCallId、版本和 AbortSignal。模块不会修改主 Agent 注册表。

## 工具清单

学习记录：`get_learning_records`、`record_learning_evidence`、`update_learning_evidence`、`evaluate_learning_evidence`、`get_skill_evidence`、`generate_learning_review`、`get_learning_reviews`。

模拟面试：`start_interview`、`get_interview_session`、`submit_interview_answer`、`finish_interview`、`get_interview_feedback`、`get_interview_records`。

## Mock 与 PostgreSQL 的边界

`EvidenceService` 使用内存 Map 保存当前进程数据，用于验证业务规则；重启后数据会消失，不能作为生产实现。`PostgresEvidenceRepository` 提供持久化端口，但当前应用组装仍需由队长注入数据库连接并完成迁移执行。真实模型生成、跨模块查询和领域事件也由宿主注入。

生产组装应使用：

```text
PostgresEvidenceRepository
  → EvidenceApplication
  → DomainCapability adapter
  → Agent registry / HTTP handler
```

生成题目、评估证据、生成复盘和反馈时，使用队长提供的 `LlmInvoker`；缺少生成依赖时返回依赖不可用，不能使用固定生产回复。

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

测试覆盖保存、查询、撤回、幂等、证据评估、阶段复盘、当前题校验、重复回答保护和 Repository 委托。完整仓库测试中的外部知乎上传测试可能受 Windows symlink 权限影响，与本模块无关。
