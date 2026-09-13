# 项目基础骨架与需求接入方案

这份文档定义后续开发的分层规则。目标是让一个需求从页面、HTTP 接口、业务编排、Agent 能力到存储都能找到固定落点，避免把逻辑堆在 `server.ts`、单个 Agent 或数据库实现里。

## 一、先固定基础骨架

建议目标目录如下：

```text
src/
├── app/                         # 应用组装、依赖注入、启动配置
│   ├── create-app.ts
│   └── config.ts
├── interfaces/                  # 对外适配层
│   ├── http/
│   │   ├── router.ts
│   │   ├── controllers/
│   │   └── schemas/
│   └── cli/
├── modules/                     # 按业务能力拆分的模块
│   └── routes/
│       ├── domain/              # 实体、值对象、业务规则
│       ├── application/         # 用例、编排、端口
│       ├── infrastructure/     # Repository 具体实现
│       └── contracts/           # API 输入输出 DTO
├── agent/                       # Agent 运行时和能力适配
│   ├── runtime/                 # Pi provider、模型、会话
│   ├── tools/                   # 可被 Agent 调用的工具
│   ├── prompts/                 # 系统提示词和输出约束
│   └── agents/                  # 具体 Agent（路线、诊断、调整）
├── integrations/                # 外部系统客户端
│   └── zhihu/
├── shared/                      # 跨模块的最小公共代码
│   ├── errors/
│   ├── result/
│   └── observability/
└── db/                          # 连接池、迁移、事务边界
```

当前代码与目标骨架的对应关系：

| 当前文件 | 目标职责 | 后续处理 |
|---|---|---|
| `src/server.ts` | HTTP 适配 + 应用组装 | 拆成 `interfaces/http` 和 `app`，保留协议处理，不放业务流程 |
| `src/routes/service.ts` | 路线创建/查询用例 | 迁到 `modules/routes/application` |
| `src/routes/types.ts` | 路线领域类型和端口 | 拆成 `domain`、`contracts`、`application/ports` |
| `src/routes/postgres-repository.ts` | PostgreSQL Repository | 迁到 `modules/routes/infrastructure` |
| `src/db/postgres.ts` | 数据库基础设施 | 保留在 `db`，增加迁移和事务封装后由 `app` 注入 |
| `src/agent/pi-route-agent.ts` | 路线 Agent | 迁到 `agent/agents`，只依赖 Agent runtime 和工具端口 |
| `src/agent/tools.ts` | Agent 工具注册 | 拆到 `agent/tools`，按外部能力或业务能力分组 |
| `src/zhihu/*` | 知乎外部集成 | 迁到 `integrations/zhihu`，不让业务模块直接拼 HTTP 请求 |
| `public/index.html` | 当前 Web 入口 | 先作为前端壳；后续前端独立为 `web/` 或 `frontend/` |

### 依赖方向

```text
interfaces/http  -> modules/*/application -> modules/*/domain
                         |                         |
                         v                         v
                 application ports          pure business rules
                         |
          ┌──────────────┴──────────────┐
          v                             v
modules/*/infrastructure          agent/agents
          |                             |
          v                             v
       db / integrations          agent/runtime + agent/tools
```

上层通过接口依赖下层能力。`RouteService` 不直接依赖 `pg`，Agent 不直接依赖 HTTP response，Controller 不直接写 SQL。

## 二、一个需求应该怎样落位

每个需求先拆成五个问题：

1. 用户从哪个页面或客户端入口发起？
2. 对外需要什么 HTTP API 和数据契约？
3. 业务用例如何校验、编排和改变状态？
4. Agent 是否需要新工具、提示词、结构化输出或新 Agent？
5. 哪些数据要持久化，读写的一致性和生命周期是什么？

对应的改动位置固定如下：

| 需求部分 | 放置位置 | 允许负责的事情 |
|---|---|---|
| 页面、表单、加载态、错误展示 | `frontend/`（当前暂由 `public/index.html` 承担） | 用户交互和展示，不写业务规则 |
| API 路由、HTTP 状态码、鉴权入口 | `src/interfaces/http` | 协议转换、参数解析、响应格式 |
| 用例和业务流程 | `src/modules/<module>/application` | 调用领域规则、Repository、Agent port，组织事务 |
| 领域规则和状态变化 | `src/modules/<module>/domain` | 不依赖 HTTP、数据库和 Pi SDK |
| 数据库读写 | `src/modules/<module>/infrastructure` | 实现 Repository，处理 SQL、映射和事务配合 |
| 外部知乎 API | `src/integrations/zhihu` | URL、鉴权、超时、响应解析和外部错误 |
| Agent 编排 | `src/agent/agents` | Prompt、工具选择、上下文和输出解析 |
| Agent 可调用能力 | `src/agent/tools` | 单一工具契约、参数校验、执行和安全边界 |
| 模型/provider/流式运行 | `src/agent/runtime` | Pi Agent 创建、模型解析、token、取消和事件 |
| 跨模块通用能力 | `src/shared` | 错误、Result、日志等小而稳定的公共原语 |

## 三、当前“生成路线”需求的标准链路

```text
前端提交目标
  -> POST /api/routes
  -> HTTP controller 解析 RouteRequest
  -> CreateRouteUseCase
     -> RouteRepository.createRequest(processing)
     -> RouteAgent.generate
        -> AgentRuntime 创建 Pi Agent
        -> 注册 search_zhihu tool
        -> Pi 调用知乎集成
        -> 输出 RoutePlan
        -> RoutePlan schema 校验
     -> RouteRepository.savePlan(completed)
  -> 返回 RouteView

失败：UseCase 调用 failRequest(failed)，Controller 映射为统一错误响应
```

这条链路中各层只做一件事：

- 前端负责收集输入和展示 `processing/completed/failed`。
- Controller 负责 HTTP，不负责生成路线。
- UseCase 负责“先落 processing，再调用 Agent，再保存结果”。
- Agent 负责推理和工具编排，不负责写数据库。
- Tool 负责一次外部能力调用，不负责决定整个业务流程。
- Repository 负责持久化，不负责调用模型。

## 四、Agent 侧的扩展规则

### 增加一个工具

例如增加“搜索招聘 JD”能力：

1. 在 `src/integrations/<provider>` 增加外部客户端方法。
2. 在 `src/agent/tools/search-jd.ts` 定义输入 schema、描述和 `execute`。
3. 在 Agent 组装处注册工具。
4. 在 prompt 中说明何时调用，以及结果是证据还是最终事实。
5. 给工具写协议测试；外部客户端用 mock，不使用真实密钥。

工具只返回结构化结果，不能偷偷修改路线状态或直接写数据库。

### 增加一个 Agent

例如增加“路线诊断 Agent”：

1. 在 `src/agent/agents/diagnose-route-agent.ts` 定义输入和输出契约。
2. 在 `src/agent/prompts/` 放系统提示词。
3. 通过 `agent/runtime` 创建 Pi Agent，禁止每个业务文件重复注册 provider。
4. 通过 application port 被用例调用，例如 `RouteDiagnosisPort`。
5. 输出必须经过 schema 校验，再交给 UseCase 决定是否修改路线。

### Agent 与业务的边界

```text
Agent：提出判断、提取结构化结果、调用工具
UseCase：验证结果是否允许改变业务状态，并执行状态变更
Repository：保存状态和结果
```

模型输出永远是不可信输入。Agent 不能直接决定数据库状态，也不能把资料中的指令当成系统指令执行。

## 五、存储抽象的重构方向

当前 `RouteRepository` 已经是正确的切入点，但建议拆分成按用例需要的端口，避免一个接口不断膨胀：

```ts
export interface RouteRequestStore {
  create(input: RouteRequest): Promise<RouteRequestCreated>;
  markCompleted(id: string, plan: RoutePlan): Promise<RouteRecord>;
  markFailed(id: string, message: string): Promise<void>;
}

export interface RouteQuery {
  getById(id: string): Promise<RouteRecord | null>;
}
```

第一阶段可以继续由 `PostgresRouteRepository` 同时实现两个接口，降低迁移成本；等出现列表、反馈、路线调整等需求，再按读写模型拆分。

存储实现必须遵守：

- 数据库类型和 SQL 只出现在 infrastructure/db 层。
- application 层只依赖 port，不导入 `pg`。
- `processing -> completed/failed` 是显式状态机。
- 幂等键、事务、唯一约束和并发策略在端口实现或数据库约束中明确记录。
- schema 变更使用迁移文件；`ensureSchema` 只保留为开发启动辅助。
- 测试优先使用内存或 mock 实现，Repository 契约测试覆盖成功、失败、重复和不存在。

## 六、按需求类型给出落点

| 需求例子 | 前端 | 后端 | Agent | 存储 |
|---|---|---|---|---|
| 创建学习路线 | 路线创建表单、生成状态页 | `CreateRouteUseCase`、`POST /api/routes` | `RouteAgent`、`search_zhihu` | 请求、状态、路线结果 |
| 汇报学习进度 | 进度输入和节点列表 | `ReportProgressUseCase`、进度 API | 可选 `DiagnoseProgressAgent` | 进度事件、节点状态 |
| 学习遇到困难 | 困难描述、诊断结果页 | `DiagnoseRouteUseCase` | 诊断 Agent、资料检索工具 | 诊断记录、调整记录 |
| 修改职业目标 | 目标编辑页、影响提示 | `ChangeGoalUseCase` | 重新规划 Agent | 用户目标版本、路线版本 |
| 粘贴招聘 JD | JD 输入和能力对照页 | `AnalyzeJobUseCase` | JD 提取 Agent、搜索工具 | JD 原文、提取结果 |
| 导出或分享路线 | 导出按钮、分享页 | 查询/导出接口 | 通常不需要 Agent | 分享 token、导出快照 |

## 七、建议的重构顺序

1. 先建立 `app`、`interfaces/http`、`modules/routes/application`、`agent/runtime` 目录，保持现有 API 行为不变。
2. 把 `server.ts` 的路由处理拆成 controller，把 `RouteService` 改名并迁移为 `CreateRouteUseCase` / `GetRouteUseCase`。
3. 把 `RouteAgent` 改成 application port，`PiRouteAgent` 放到 Agent 适配层。
4. 把知乎客户端移到 `integrations/zhihu`，Agent tool 只调用集成端口。
5. 将 PostgreSQL 实现移到模块 infrastructure，并补 Repository 契约测试和迁移机制。
6. 最后再把 `public/index.html` 演进成独立前端目录；前端只依赖 API 契约，不反向依赖后端内部类型。

每一步都保持 `npm run typecheck` 和 `npm test` 通过，并优先做可回滚的小提交。新需求先更新本文件的落点表，再开始编码。
