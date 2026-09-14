# Career 模块

本目录提供基于远程 `main` 分支类型的 Career 应用服务、能力注册和仓储实现。当前实现不再包含旧版 Mock 数据、Mock 依赖、Mock Repository 或旧 Service 测试。

## 当前实现

- `contracts.ts`：Career 领域类型、输入类型和 Zod 校验 Schema。
- `types.ts`：`CareerApplication` 应用服务接口。
- `service.ts`：职业规划、目标岗位、岗位差距分析、企业目录、行业趋势和岗位/企业对比等用例。
- `repository.ts`：`CareerRepository` 接口、内存仓储和岗位构造辅助函数。
- `postgres-repository.ts`：生产环境 PostgreSQL 仓储实现。
- `capabilities.ts`：Career 能力注册，包括岗位、企业、趋势的读取、保存、选择、确认、分析和对比操作。

## 已注册能力

`get_career_plan`、`create_career_plan_draft`、`get_target_jobs`、`save_target_job`、`list_job_catalog`、`select_target_job`、`analyze_job_gap`、`confirm_career_plan`、`get_career_dashboard`、`compare_target_jobs`、`list_target_companies`、`select_target_company`、`compare_target_companies`、`get_industry_trends`。

写操作通过 `DomainCommand` 传递用户上下文；涉及职业规划状态变化的选择岗位和确认规划操作需要显式确认，并使用 `expectedVersion` 做乐观并发校验。生产启动应注入 `PostgresCareerRepository`，数据库结构见 `src/db/migrations/004-career.sql`、`src/db/migrations/005-career-idempotency.sql` 和 `src/db/migrations/006-career-p1.sql`。
