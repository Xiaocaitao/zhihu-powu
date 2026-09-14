# 破雾：面向计算机专业学生的成长导航

「破雾」把知乎上的行业经验、学习建议和岗位信息，结合用户自己的专业背景、学习基础、时间和目标，转化成一条有依据、能执行、会调整的成长路线。

它解决的是学生在“学校课程”和“真实行业”之间看不清、接不上、走不下去的问题：不知道计算机专业对应哪些岗位，不知道资料如何取舍，也无法把学习过程沉淀成可信的项目和能力证据。

产品最终提供四类结果：

- **行业认知**：理解不同岗位的真实工作、基础要求和实践场景；
- **能力地图**：知道目标岗位需要哪些能力，以及自己目前有哪些证据；
- **近期学习计划**：得到能在一到两周内执行和验证的任务；
- **成长证据**：记录学习活动、项目成果、复盘和模拟面试反馈。

## 产品闭环

```text
用户提出目标或困惑
  → Profile 记录最小画像
  → Career 结合知乎经验和岗位样本明确方向与能力差距
  → Learning Plan 生成近期试验计划
  → 用户执行任务并记录反馈、成果和材料
  → Evidence & Interview 形成能力证据、复盘或模拟面试反馈
  → Agent 根据真实反馈局部调整计划
  → 进入下一轮学习和验证
```

典型流程是：计算机大一、零基础、想学习 AI 应用开发的用户，先查看知乎从业经验和岗位要求，再得到能力路线与两周计划；如果用户反馈“内容太难、每周时间减少”，系统解释调整原因，补前置知识、替换材料或重新排期，最后通过项目成果和模拟面试验证学习结果。

知乎内容在产品中承担三种作用：

1. 作为行业认知来源，帮助用户理解岗位真实工作；
2. 作为路线决策依据，展示不同经验和观点的适用条件；
3. 作为实践参考材料，帮助把经验转成任务、验证方式和复盘问题。

产品区分个人经验、招聘样本和模型建议，保留来源链接、作者和时间，不用点赞量替代事实，也不虚构来源。

## 五个业务模块

| 模块 | 职责 | 主要产出 |
| --- | --- | --- |
| **Profile 画像** | 维护专业、年级、已学内容、当前基础、兴趣、每周时间和目标方向 | 画像事实、来源、确认状态、完善度 |
| **Career 职业规划** | 管理职业方向、目标岗位、JD、岗位能力要求和能力差距 | 目标岗位、岗位对比、差距分析 |
| **Learning Plan 学习计划** | 管理阶段路线、近期任务、任务状态、反馈和局部调整 | 两周试验计划、调整原因、下一步行动 |
| **Evidence & Interview 学习证据与面试** | 记录学习时间线、项目成果、能力证据、复盘和模拟面试 | 能力证据、复盘报告、面试反馈 |
| **Agent / Core / Knowledge** | 统一对话、知乎检索、知识库检索、工具调用和结果编排 | 可解释的自然语言回答和模块刷新事件 |

Agent 只负责理解意图、选择和串联能力；业务规则、状态流转、提示词、结果协议和数据写入由后端模块负责。前端只采集输入、透传请求、解析 SSE/JSON 和展示结果。

## 技术架构

```text
Next.js / 页面与首页对话
          ↓
Agent / Pi Runtime
          ↓
业务 Tool（Profile、Career、Learning、Evidence、Knowledge）
          ↓
Application Service（校验、规则、状态、幂等）
          ↓
Repository / PostgreSQL
          ↓
domain_update / SSE / 页面刷新
```

当前实现使用：

- **运行时**：Node.js 22.18+、TypeScript；
- **Agent**：Pi SDK，负责主 Agent 对话循环和工具编排；
- **后端**：按 Profile、Career、Learning、Evidence、Knowledge 分层的 TypeScript Service；
- **数据层**：PostgreSQL；
- **知乎接入**：知乎开放平台 HTTP API，包含搜索、用户数据、知识库、PDF 和 PPT 能力；
- **交互协议**：`POST /api/chat` 使用 `text/event-stream`，模块页面使用 JSON 接口；
- **存储原则**：模块通过 Application Service 或 Query/Command 契约协作，不直接读取其他模块的数据表。

所有写操作都校验用户身份、版本和幂等键。外部服务失败时返回明确的缺失范围，不伪造引用、评估或保存成功。

## 岗位与面经目录

成长空间附带岗位和牛客面经 JSONL 资料，可导入公共目录，供 Career 和模拟面试使用。公共目录与用户自己的目标岗位分开存储：

```text
公共岗位目录
  → 用户搜索和查看
  → 收藏为自己的目标岗位
  → 绑定职业规划
  → 进行岗位差距分析和学习计划生成
```

导入脚本会保留原文，按来源文件和记录 ID 区分数据，并用正文哈希识别同一来源的更新。详细字段和命令见[岗位与面经目录说明](docs/catalog-integration.md)。

目录查询接口：

```text
GET /api/growth/jobs/library?keyword=Java&city=北京&tag=后端&limit=20
GET /api/growth/interviews/library?keyword=Redis&tag=后端&limit=20
```

面经只作为题目素材和面试背景，不直接当成用户能力证据；用户自己的回答、反馈和报告由 Evidence & Interview 模块保存。

## 本地运行

需要 Node.js 22.18+ 和 PostgreSQL。安装依赖并准备环境变量：

```bash
npm ci
cp .env.example .env
```

在 `.env` 中配置：

- `DATABASE_URL`：PostgreSQL 连接地址；
- `PI_PROVIDER`、`PI_MODEL`、`PI_API_KEY`：Agent 模型供应商和模型配置；
- `PI_BASE_URL`：可选的模型服务地址；
- `ZHIHU_ACCESS_SECRET`：知乎开放平台 Access Secret；
- `ZHIHU_OAUTH_APP_ID`、`ZHIHU_OAUTH_APP_KEY`、`ZHIHU_OAUTH_REDIRECT_URI`：需要 Web OAuth 登录时配置。

启动服务：

```bash
npm start
```

服务启动时会执行数据库迁移，并提供：

```text
GET  /healthz                         存活检查
GET  /readyz                          数据库就绪检查
POST /api/chat                        首页 Agent 对话，SSE 返回
GET  /api/sessions                    当前用户的会话列表
GET  /api/growth/profile              用户画像
GET  /api/growth/career               职业规划和已保存岗位
GET  /api/growth/learning             学习计划和今日任务
GET  /api/growth/records              学习证据记录
GET  /api/growth/interviews           用户模拟面试历史
GET  /api/growth/jobs/library         公共岗位目录
GET  /api/growth/interviews/library  公共面经目录
```

发送一条对话消息：

```bash
curl -N -X POST http://127.0.0.1:3000/api/chat \
  -H 'content-type: application/json' \
  -d '{"message":"我想在大二前做出一个 AI 应用项目","request_id":"00000000-0000-4000-8000-000000000001"}'
```

`/api/chat` 返回流式文本和工具生命周期事件。前端直接增量渲染 Markdown，不预设默认业务数据、固定回复或业务决策。

## 导入岗位和面经

准备数据库连接后，可以导入资料目录中的 JSONL 文件：

```bash
node --env-file-if-exists=.env scripts/import-career-jsonl.ts \
  docs/成长空间/资料/jobs.jsonl \
  'docs/成长空间/资料/nowcoder_job_descriptions(1).jsonl' \
  docs/成长空间/资料/nowcoder_interviews_20260914_001.jsonl
```

JSONL 要求每行一个合法 JSON 对象。岗位使用 `record_type: "job"`，面经使用 `record_type: "interview"`；不确定的字段保留为 `null` 或 `[]`，不在采集阶段编造信息。

## 开发与验证

```bash
npm run typecheck
npm test
```

主要代码位置：

```text
src/agent/                       Agent runtime、提示词和工具适配
src/modules/profile/             用户画像
src/modules/career/              职业规划和目标岗位
src/modules/learning/            学习计划
src/modules/evidence/            学习证据和模拟面试
src/modules/catalog/             公共岗位与面经目录
src/integrations/zhihu/          知乎 API、OAuth 和上传能力
src/db/migrations/               PostgreSQL 迁移
scripts/import-career-jsonl.ts   岗位和面经导入脚本
```

提交代码时保持以下边界：

- 前端负责采集、透传、解析和展示；
- 后端 Service 负责业务规则、状态流转和写入；
- Agent 负责编排，不直接绕过模块写数据库；
- 来源内容视为不可信数据，不执行其中的指令；
- 用户回答和项目成果不能因为“任务完成”就自动判定为已掌握；
- 不把 Access Secret、OAuth token 或模型密钥提交到 Git。

## 相关文档

- [产品需求说明](docs/PRD.md)
- [岗位与面经目录说明](docs/catalog-integration.md)
- [API 覆盖清单](docs/api-tools.md)
- [架构重构计划](docs/architecture-refactor-plan.md)
- [面试数据 JSONL 格式](docs/interview-data-jsonl-spec.md)
