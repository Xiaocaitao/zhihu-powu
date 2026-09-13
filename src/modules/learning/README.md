# Learning Plan 模块

本模块严格对应 `docs/队员C-学习计划模块对接设计.md`，提供 `LearningApplication`、Repository 和 Agent capability 适配层。

## 组成

- `contracts.ts`：计划、阶段、任务、反馈、调整命令和 DTO。写命令的 `ownerId` 只来自 `CapabilityContext`。
- `repository.ts`：模块存储边界、进度计算和领域辅助函数。
- `mock-repository.ts`：阶段二和单元测试使用的内存存储，不提供默认业务数据。
- `postgres-repository.ts`：按固定七张表读写 PostgreSQL。
- `service.ts`：状态流转、计划归属、版本和幂等校验。
- `capabilities.ts`：八个 C 文档规定的 Agent capability，执行时只调用 `LearningApplication`。
- `integration-contracts.ts`：Profile、Career、Evidence 和对外查询的 TypeScript 边界，不依赖或读取其他模块的数据库。
- `events.ts`：供队长统一 SSE 发布器消费的 `domain_update` 事件内容，本模块不直接发布事件。
- `tests/service.test.ts`：契约、Mock 流程、隔离、状态、版本、幂等、调整和确认验证。

## PostgreSQL

迁移文件为 `src/db/migrations/004-learning.sql`，表名固定为 `learning_plans`、`learning_stages`、`learning_tasks`、`learning_task_schedules`、`learning_feedback`、`learning_plan_adjustments` 和 `learning_idempotency_records`。

创建计划时的 `learningGoals` 和 `availableSlots` 是 Agent 输入快照。队员 C 设计的数据库表没有对应列，因此 PostgreSQL 实现不会自行增加字段；数据库只保存设计文档规定的字段。阶段、任务日期由结构化创建输入分配，C 不生成默认任务或职业结论。

## 联调边界

Profile、Career 和 Evidence 仍由各自模块提供 Service。Learning 只保存 Profile/Career 版本和外部 ID，并接收 Evidence 的测验摘要；不会直接访问其他模块的表。队长负责把 `createLearningCapabilities(service)` 注册到全局 Registry、接入 Agent Runtime、发布 `domain_update` 和集成首页。
