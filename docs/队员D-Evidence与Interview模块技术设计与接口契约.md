# Evidence & Interview 模块技术设计与接口契约

需求基线：《Evidence与Interview模块需求文档.md》V1.0
适用范围：学习记录、能力证据、阶段复盘、文字模拟面试

## 1. 设计目标与现状

本设计将通过评审的 13 项工具落实为模块应用接口、输入输出类型、数据归属、事务与状态流转，供本模块开发及队长集成使用。需求范围不扩展；阶段测试仍由 Learning Plan 负责。

### 1.1 已核实的项目现状

| 项目 | 当前状态 | 对本模块的影响 |
| --- | --- | --- |
| 运行环境 | Node.js 22.18+、TypeScript、Zod 4、PostgreSQL | 复用现有依赖，不引入另一套应用框架 |
| 模块结构 | 当前只有 `src/modules/chat/` | Evidence 模块及跨模块业务接口需要新建 |
| Agent 工具 | `createZhihuTools` 和专用于其类型的 `adaptTools` | 不能直接把新能力追加到现有数组就声称完成注册 |
| 身份传递 | ChatService 有 owner，ChatRuntime.run 尚未接收 owner 和 requestId | 队长需要补充可信上下文传递，模块不能从模型输入取身份 |
| 工具授权 | 现有适配器有公共工具白名单和外部写操作确认入口 | 本模块不修改白名单，不沿用知乎上传操作的确认规则作为所有业务写入规则 |
| 统一领域契约 | 文档中已有建议，但 `src/contracts/capability.ts` 等尚不存在 | 本文提出兼容契约，最终公共类型及注册由队长维护 |
| 数据迁移 | 当前开发启动代码只初始化路线和聊天表 | 本模块迁移独立交付，由队长决定统一执行入口 |
| 页面 | 给定 HTML 是静态原型 | 页面端点及刷新接入属于待实施和联调事项 |

所有下文的文件、表、端点和其他模块函数均为拟定设计，不能视为已经存在。

### 1.2 设计决策

- 使用一个 `evidence` 业务模块、一个对外工厂，内部区分 records、assessments、reviews、interviews 四类用例。
- 统一事件中的 `domain` 拟用 `evidence`；通过 resource 区分 record、assessment、review、interview、report，不再创建一个 growth 域。
- Agent 工具与页面入口调用同一应用服务；前端仅采集输入、透传请求、解析结果并展示。
- 本模块不启动嵌套的主 Agent 循环。生成题目、评估、复盘通过明确的生成端口执行，提示词和输出校验归本模块。
- 外部模块仅通过查询接口或可信来源通知协作；不存在跨模块直读表或跨模块数据库外键。
- 首版保留 13 个工具，不额外暴露阶段测试、SQL、原始模型调用或来源事件伪造工具。

## 2. 文件组织与依赖方向

```text
src/modules/evidence/
  contracts.ts                  输入 Schema、对外 DTO、业务错误
  service.ts                    EvidenceApplication 与应用工厂
  capabilities.ts               13 项工具定义，委托应用服务
  ports.ts                      Learning / Career / Profile / Knowledge / Generation 端口
  repository.ts                 事务、查询、版本和操作恢复抽象
  postgres-repository.ts        PostgreSQL 实现
  records.ts                    记录、项目、修正及来源同步
  assessments.ts                证据评估与能力卡片查询
  reviews.ts                    阶段复盘
  interviews.ts                 面试状态与问答流程
  generation.ts                 生成输入构造、结果校验及失败分类
  prompts/                      题目、逐题评估、整场报告、证据评估、复盘提示词
  README.md                     组装方式及待接入项
tests/
  evidence-*.test.ts             与当前 npm test 的匹配规则保持一致
```

数据库迁移由 D 提交、队长合并执行：

```text
src/db/migrations/005-evidence.sql
```

调用方向：

```text
主 Agent 工具 / 其他业务模块 / 页面端点
  → EvidenceApplication
    → 用例和业务校验
      → Repository（本模块数据）
      → 其他模块 Query Port（外部数据）
      → Generation Port（结构化生成）
```

本模块不直接编辑 `src/agent/runtime/`、`src/modules/chat/`、工具总注册及全局事件协议。共享契约就位前，使用模块内可替换的类型入口；不得提交一个冒充全局标准的重复注册层。

## 3. 统一上下文、命令与结果

### 3.1 标识与基础类型

```ts
type EntityId = string;       // 本模块生成 UUID
type ExternalId = string;     // 外部模块的不透明标识，不假定为 UUID
type Instant = string;        // 带偏移或 Z 的 ISO 8601 时间
type Resource = "record" | "assessment" | "review" | "interview" | "report";

type ModuleContext = {
  ownerId: string;
  sessionId?: string;         // 聊天会话，不是面试会话
  requestId?: string;
  signal?: AbortSignal;
};

type TrustedExecution = ModuleContext & {
  requestId: string;
  operationKey: string;       // 宿主构造，不出现在模型输入 Schema
  sourceMessageId?: string;
  timeZone: string;           // 可信配置或用户偏好提供的 IANA 时区
};

type Command<T> = {
  context: TrustedExecution;
  payload: T;
  expectedVersion?: number;
  idempotencyKey: string;     // 等于可信 operationKey
};
```

工程契约中 `CapabilityContext.sessionId` 必填的约定用于主 Agent；其他模块和页面可无聊天会话。适配层把两种来源转换为应用上下文。面试始终使用独立 `interviewId`，禁止把聊天 sessionId 当作面试主键。

`operationKey` 是拟增加的可信执行元信息：主 Agent 来源由 requestId 和 toolCallId 组合，页面来源使用提交操作标识，来源通知使用来源事件标识。只使用 requestId 会把同一轮的“保存成果”和“评估成果”错误合并；模型不能填入或改写该值。

### 3.2 与统一返回格式对齐

```ts
type ErrorCode =
  | "NOT_FOUND" | "FORBIDDEN" | "INVALID_ARGUMENT" | "INVALID_STATE"
  | "VERSION_CONFLICT" | "DUPLICATE_REQUEST" | "CONFIRMATION_REQUIRED"
  | "DEPENDENCY_UNAVAILABLE";

type CapabilityResult<T> = {
  ok: boolean;
  changed: boolean;
  domain: "evidence";
  entityId?: EntityId;
  version?: number;
  status: "read" | "applied" | "draft_created" | "confirmation_required" | "rejected";
  summary: string;
  data?: T;
  error?: { code: ErrorCode; message: string; retryable: boolean; fields?: string[] };
};

type GenerationStatus = "not_started" | "running" | "succeeded" | "failed";
type Coverage = {
  complete: boolean;
  missing: { source: string; reason: string }[];
  observedAt: Instant;
};
type Page<T> = { items: T[]; nextCursor: string | null; hasMore: boolean };
```

`error` 是拟对公共契约补齐的结构化错误字段，需队长统一接受。其余顶层字段及枚举沿用现有工程文档。生成状态放在 data 中，不向全局 status 私增 running、failed 等值。

| 结果 | 顶层语义 | data 语义 |
| --- | --- | --- |
| 正常查询或空列表 | ok=true，changed=false，status=read | 已有数据及 Coverage |
| 首次保存成功 | ok=true，changed=true，status=applied | 保存对象及版本 |
| 回答已保存，反馈生成失败 | ok=true，changed=true，status=applied | feedback.status=failed，带失败原因及恢复动作 |
| 完全无法取得必需依赖，尚未保存业务对象 | ok=false，changed=false，status=rejected | error=DEPENDENCY_UNAVAILABLE |
| 幂等重放且本次无新写入 | ok=true，changed=false，status=read | 原对象及当前状态，注明 replayed=true |
| 相同幂等键对应不同意图 | ok=false，changed=false，status=rejected | error=DUPLICATE_REQUEST |

部分成功不把已保存结果丢进一个总错误。涉及身份的对象查询统一对外返回 NOT_FOUND，避免泄露别人的对象是否存在；已知对象的操作授权失败可用 FORBIDDEN。

### 3.3 输入校验基线

- 输入 Schema 严格拒绝未定义字段；查询和详情采用可辨别的联合结构。
- 内部 ID 按 UUID 校验；外部标识只校验非空与长度，不擅自转换大小写。
- 字符串先校验去空白后的有效内容；回答原文保留，比较重试使用规范化后的摘要。
- 初始资源上限：标题 200 字符，记录及回答正文 20,000 字符，关注说明 2,000 字符，一次评估最多 20 份证据，单条记录最多 20 个材料引用，列表默认 20 条、最大 100 条。
- 显式题量接受 1–20；省略时生成器在该范围内选择并返回实际题量，不在前端注入 5 题。单次复盘最大范围暂定 366 天。以上是可配置技术上限，不是掌握度或推荐结论。
- 时间段采用 `[from, to)`，from 必须早于 to。本周按可信时区计算当地周一 00:00 至下周一 00:00；数据库保存 UTC 时间。
- 时间用时 `durationMinutes` 为非负整数或 null，null 表示未知；预计用时不进入该字段。
- 游标包含排序值及筛选摘要，按 `(occurredAt, id)` 或 `(createdAt, id)` 降序稳定分页，校验其适用筛选范围；owner 始终来自上下文。

## 4. 核心 DTO

下列字段是拟定对外协议；TypeScript 代码为设计示意，不表示已落地的源文件。

### 4.1 记录、材料与来源

```ts
type RecordKind = "activity" | "project_outcome" | "task_change"
  | "learning_feedback" | "plan_adjustment" | "assessment_result" | "interview_result";
type SkillRef = { skillId: ExternalId; name: string };
type MaterialRef = { documentId: ExternalId; itemId?: ExternalId; label?: string };
type SourceRef = {
  domain: "evidence" | "learning" | "knowledge" | "career";
  entityId: string;
  revision: string;
  locator?: string;
};
type RecordDTO = {
  recordId: EntityId;
  version: number;
  kind: RecordKind;
  status: "active" | "withdrawn";
  title: string;
  content: string;
  occurredAt: Instant;
  durationMinutes: number | null;
  projectId: EntityId | null;
  taskId: ExternalId | null;
  skillRefs: SkillRef[];
  evidenceId: EntityId | null;
  materials: MaterialRef[];
  source: SourceRef;
  materialState: "none" | "pending" | "available" | "partial" | "unavailable";
  sourceState: "current" | "superseded" | "withdrawn" | "unavailable";
  createdAt: Instant;
  updatedAt: Instant;
};
```

模型可创建的 kind 仅限 activity、project_outcome。其他类型只能由可信来源协作或本模块完成面试时创建。RecordDTO.source.domain 进一步限制为 evidence 或 learning；Knowledge、Career 的 SourceRef 用于材料及标准引用，不代表它们可以直接写本模块时间线。用户在 activity 中描述卡点，不等于生成一条 Learning Plan 的权威反馈。

项目使用独立 `projectId` 支持里程碑关系，但首版通过记录成果完成创建或关联，不增项目管理工具。材料引用不包含任意本地路径；原始外部 URL 可作为未读取的用户说明保留，但只有 Knowledge 返回可用内容后才可作为“已阅读材料”。

### 4.2 证据、评估与复盘

```ts
type Citation = {
  source: SourceRef;
  excerpt: string;
};
type SkillFinding = {
  skill: SkillRef;
  support: "insufficient" | "partial" | "supported";
  performance: "exposed" | "explain" | "apply" | "consistent" | null;
  rationale: string;
  citations: Citation[];
  limitations: string[];
  nextChecks: string[];
};
type AssessmentDTO = {
  assessmentId: EntityId;
  version: number;
  evidenceIds: EntityId[];
  status: GenerationStatus;
  validity: "current" | "stale" | "withdrawn";
  findings: SkillFinding[];
  criteriaSummary: string;
  assessedAt: Instant | null;
  coverage: Coverage;
};
type SkillCardDTO = {
  skill: SkillRef;
  evidenceIds: EntityId[];
  assessments: AssessmentDTO[];
  verification: "no_evidence" | "pending" | "available" | "needs_review";
};
type ReviewDTO = {
  reviewId: EntityId;
  version: number;
  status: GenerationStatus;
  range: { from: Instant; to: Instant; timeZone: string };
  stageId: ExternalId | null;
  progress: { text: string; citations: Citation[] }[];
  blockers: { observation: string; hypothesis: string | null; citations: Citation[] }[];
  suggestions: { text: string; skillIds: ExternalId[]; taskIds: ExternalId[] }[];
  sourceChanged: boolean;
  coverage: Coverage;
  createdAt: Instant;
};
```

`performance` 与证据有效性分别表达，不把 pending 映射为低能力等级。能力卡片聚合已有有效结论，可同时返回相互矛盾的 findings，不另行调用模型计算“综合掌握度”。`supported` 也仅限所引用标准及材料的范围。

### 4.3 面试、回答与报告

```ts
type InterviewTarget =
  | { kind: "job"; jobId: ExternalId; skillIds?: ExternalId[]; projectId?: EntityId }
  | { kind: "skills"; skillIds: ExternalId[]; projectId?: EntityId }
  | { kind: "project"; projectId: EntityId; skillIds?: ExternalId[] };
type QuestionDTO = {
  questionId: EntityId;
  ordinal: number;
  category: "knowledge" | "project" | "expression";
  prompt: string;
  skillRefs: SkillRef[];
};
type AnswerFeedbackDTO = {
  questionId: EntityId;
  answerId: EntityId;
  status: GenerationStatus;
  strengths: string[];
  issues: { dimension: "knowledge" | "project" | "expression"; text: string; quote: string }[];
  suggestions: string[];
  limitations: string[];
};
type InterviewDTO = {
  interviewId: EntityId;
  version: number;
  target: InterviewTarget;
  status: "preparing" | "active" | "completed" | "ended_early" | "preparation_failed";
  difficulty: "introductory" | "intermediate" | "advanced" | null;
  totalQuestions: number | null;
  answeredCount: number;
  currentQuestion: QuestionDTO | null;
  answers: { answerId: EntityId; question: QuestionDTO; text: string; feedback: AnswerFeedbackDTO }[];
  report: { reportId: EntityId | null; status: GenerationStatus };
  coverage: Coverage;
};
type ReportDTO = {
  reportId: EntityId;
  version: number;
  interviewId: EntityId;
  status: GenerationStatus;
  answeredCount: number;
  totalQuestions: number;
  summary: string;
  findings: SkillFinding[];
  recommendations: { text: string; skillIds: ExternalId[]; answerIds: EntityId[] }[];
  unevaluatedQuestionIds: EntityId[];
  limitations: string[];
};
```

difficulty 只在 preparing 或 preparation_failed 且尚未确定难度时允许 null，active 及已结束会话必须具有实际难度和题量。全套题目、参考答案、评价要点是内部快照。对 active 面试只返回已答题及当前题，不能因读取 session 暴露未来答案。原始回答与评估分开保存。首版不添加没有需求依据的总分字段。

## 5. 13 项工具的字段契约

表中 `?` 表示可选；除显式声明外不允许 null 作为“未填写”。输入只列 payload，不包含可信身份、operationKey 或输出状态。

| 工具 → 应用方法 | 输入 payload | 返回 data |
| --- | --- | --- |
| `get_learning_records` → getLearningRecords | `{mode:"detail", recordId}` 或 `{mode:"list", from?, to?, kinds?, taskId?, skillId?, limit?, cursor?}`；from/to 必须同时出现 | detail：`{record:RecordDTO, coverage}`；list：`{page:Page<RecordDTO>, range, coverage}` |
| `record_learning_evidence` → recordLearningEvidence | `{kind:"activity"\|"project_outcome", title, content, occurredAt, durationMinutes?, taskId?, skillIds?, materialRefs?, project?}`；project 为 `{projectId}` 或 `{title, goal, contribution?, contributionPending}` | `{record, evidenceId, pendingAssociations[], missingInformation[]}` |
| `update_learning_evidence` → updateLearningEvidence | `{recordId, action:"amend", changes:{title?,content?,occurredAt?,durationMinutes?,materialRefs?,skillIds?,taskId?,contribution?}}` 或 `{recordId, action:"withdraw", reason}`；amend 至少一项变更 | `{record, invalidatedAssessmentIds[], affectedReviewIds[]}` |
| `evaluate_learning_evidence` → evaluateLearningEvidence | `{evidenceIds, skillIds, criteria?:{kind:"job",jobId}\|{kind:"task",taskId}, focus?}`；两组 ID 均非空 | `{assessment:AssessmentDTO, recovery?}` |
| `get_skill_evidence` → getSkillEvidence | `{skillIds?, from?, to?, sources?, limit?, cursor?}`；指定 ID 不存在时说明无证据或能力标识无效 | `{page:Page<SkillCardDTO>, coverage}` |
| `generate_learning_review` → generateLearningReview | `{from?,to?,stageId?,taskIds?,projectIds?,skillIds?,focus?}`；至少时间段或 stageId；同时存在时取交集 | `{review:ReviewDTO, recovery?}` |
| `get_learning_reviews` → getLearningReviews | `{mode:"detail",reviewId}` 或 `{mode:"list",from?,to?,stageId?,limit?,cursor?}` | `{review}` 或 `{page:Page<ReviewSummary>}` |
| `start_interview` → startInterview | `{target:InterviewTarget,difficulty?,questionCount?,focus?,startNew?:boolean}` | `{interview:InterviewDTO, reused:boolean, recovery?}` |
| `get_interview_session` → getInterviewSession | `{interviewId}` | `{interview:InterviewDTO,recovery?}` |
| `submit_interview_answer` → submitInterviewAnswer | `{interviewId,questionId,answer}` | `{answerId,saved:true,feedback,interviewVersion,answeredCount,nextQuestion,sessionStatus,report,recovery?}` |
| `finish_interview` → finishInterview | `{interviewId,reason?}` | `{interviewId,sessionStatus,report:ReportDTO\|null,reportStatus,recovery?}` |
| `get_interview_feedback` → getInterviewFeedback | `{interviewId,questionId?}` | 有 questionId：`{feedback,recovery?}`；否则 `{report,reportStatus,recovery?}` |
| `get_interview_records` → getInterviewRecords | `{from?,to?,jobId?,skillId?,statuses?,limit?,cursor?}` | `{page:Page<InterviewSummary>}` |

补充定义：

- `ReviewSummary`：reviewId、status、range、stageId、createdAt、sourceChanged；不在列表重新生成摘要。
- `InterviewSummary`：interviewId、target、difficulty、status、answeredCount、totalQuestions、createdAt、endedAt、reportStatus、已有 summary。
- `recovery`：`{toolName, entityId, action, retryable}`。action 为用户可理解的说明，不包含密钥、内部错误栈或可执行代码。
- amend 的 materialRefs、skillIds 为明确替换；空数组表示清空。durationMinutes、taskId 在 changes 中可为 null 表示清空，省略表示不变。创建时 durationMinutes 省略保存 null。
- 首版 project_outcome 必须提供 project；关联已有项目时读取其贡献背景，本次 content 仍应说明本次产出。不清楚贡献时返回 missingInformation，不能评为个人已验证成果。
- InterviewTarget 的 skills 模式要求 skillIds 非空；project 模式必须有可访问的本模块项目。明确的“JavaScript”等自然语言能力先由共享能力查询解析为标识；解析能力未接入时返回所需信息，不能随机生成 skillId。
- expectedVersion 在修改已有记录时必需：页面通过命令元信息回传其实际读到的版本，Agent 适配层使用本轮已读取对象的版本。它是前置条件，不是模型可以自称的新版本；宿主也不能在写入前临时读取最新版来掩盖用户基于旧内容进行编辑的冲突。面试回答以当前题及唯一约束判并发，避免反馈写入导致无关版本冲突。
- 首版已撤回记录不支持原地恢复，用户需要重新记录时形成新对象并引用旧记录；后续若增加恢复操作，需要单独定义失效评估如何处理。

### 5.1 调用示例：保存与评估分开

以下为 payload 示例，ID 仅为文档演示，不是预设用户数据。

```json
{
  "kind": "activity",
  "title": "实现 GET API",
  "content": "已完成基础接口，运行截图稍后补充",
  "occurredAt": "2026-09-13T10:00:00+08:00",
  "durationMinutes": 55,
  "skillIds": ["skill-http"]
}
```

成功返回 recordId 与 evidenceId，评估状态仍为未评估。主 Agent 按用户需要继续调用 `evaluate_learning_evidence`，只传证据和能力标识，不传“能应用”或“通过”。

### 5.2 调用示例：回答已保存、反馈失败

```json
{
  "ok": true,
  "changed": true,
  "domain": "evidence",
  "entityId": "26e893ab-b01a-46ea-a109-8cd52bb68335",
  "version": 3,
  "status": "applied",
  "summary": "回答已保存，反馈生成失败，可恢复反馈处理",
  "data": {
    "answerId": "f624262b-02a8-4493-b33b-3c5ad7c69ba2",
    "saved": true,
    "feedback": { "status": "failed" },
    "answeredCount": 1,
    "sessionStatus": "active",
    "recovery": {
      "toolName": "submit_interview_answer",
      "entityId": "26e893ab-b01a-46ea-a109-8cd52bb68335",
      "action": "使用该题原已保存回答恢复评估，不重复推进题号",
      "retryable": true
    }
  }
}
```

示例省略正常返回中的 nextQuestion 等字段；错误状态不能用空数组伪装成“没有问题”。

## 6. 数据设计与归属

### 6.1 本模块表

所有表统一使用 `ei_` 前缀。涉及个人数据的表均保存 owner_id；内部关联使用 `(owner_id, id)` 唯一键和复合外键，不能仅凭外来 UUID 建立跨用户关系。时间使用 timestamptz。

会发布领域变化的记录、评估、复盘、面试和报告均有递增的 version，更新状态或有效性时同步递增；表中未重复列出的 version、created_at、updated_at 为这些聚合的公共列。outbox 使用对应聚合提交后的版本。

| 表 | 关键字段 | 约束及用途 |
| --- | --- | --- |
| `ei_projects` | id、owner_id、title、goal、version、created_at | 项目聚合，关联多次成果；不管理学习任务 |
| `ei_records` | id、owner_id、kind、status、occurred_at、duration_minutes、project_id、task_id、current_revision、source_domain、source_entity_id、source_revision | 时间线与自主记录；owner+occurred_at+id 索引；可信来源对象唯一 |
| `ei_record_revisions` | id、owner_id、record_id、revision、content、title、contribution、materials、skill_refs、reason、created_at | owner+record_id+revision 唯一，修订快照不可覆盖 |
| `ei_evidence` | id、owner_id、record_id、source_kind、validity、created_at | owner+record_id 唯一；记录可有零或一个证据对象，只有可引用内容建立证据 |
| `ei_assessments` | id、owner_id、operation_id、source_snapshots、criteria_snapshot、status、findings、assessed_at | 来源含证据标识及修订；多证据支持一次评估；评估结果不覆盖来源 |
| `ei_reviews` | id、owner_id、operation_id、range_from、range_to、time_zone、stage_id、source_snapshots、status、result、created_at | 保存阶段复盘及覆盖范围，不维护测试成绩 |
| `ei_interviews` | id、owner_id、target、requirements_snapshot、profile_snapshot、status、difficulty、question_count、answered_count、version、created_at、ended_at | owner+created_at+id 索引，保留开场背景；不保存完整无关画像 |
| `ei_questions` | id、owner_id、interview_id、ordinal、prompt、category、skill_refs、private_rubric | owner+interview_id+ordinal 唯一，参考答案与评价要点不作为普通查询输出 |
| `ei_answers` | id、owner_id、interview_id、question_id、text、text_hash、created_at | owner+interview_id+question_id 唯一，正式回答不可覆盖 |
| `ei_answer_feedback` | id、owner_id、answer_id、operation_id、status、result、updated_at | owner+answer_id 唯一，允许失败恢复，不改回答原文 |
| `ei_interview_reports` | id、owner_id、interview_id、operation_id、status、source_snapshots、result、created_at | owner+interview_id 唯一，整场有效报告只生成一份 |
| `ei_operations` | id、owner_id、capability、idempotency_key、payload_hash、entity_id、phase、generation_status、attempt、lease_until、fencing_token、result、error | owner+capability+idempotency_key 唯一；记录事实提交与生成完成分别进行到哪一步 |
| `ei_source_inbox` | owner_id、source_domain、source_event_id、source_entity_id、source_revision、payload_hash、received_at | owner+source_domain+source_event_id 唯一；重复或乱序通知不重复入账 |
| `ei_outbox` | id、owner_id、resource、entity_id、version、change、created_at、delivered_at | 业务写入与待发送领域变化同事务；队长接入统一发布 |

JSONB 用于材料数组、能力引用、冻结的要求及模型结构化结果；状态、归属、时间、排序字段使用独立列。结构化结果入库前必须通过 Schema 与引用校验，不以 JSONB 替代业务校验。

`ei_answers` 的关联还需保证 question_id 属于同一 interview_id，采用 `(owner_id, interview_id, question_id)` 组合关联到题目；只分别校验“会话属于用户”和“题目属于用户”不足以阻止同一用户串场提交。

首版没有能力主表、用户主表、岗位表、学习任务表、阶段测试表或知识库文件表。skillId、taskId、jobId、documentId 仅为外部引用，不创建跨模块外键。

### 6.2 防止时间重复累计

- 只有代表实际投入的活动事实可以贡献 duration_minutes；成果、任务状态或面试总结引用同一事实时不再次记时。
- 来源需要提供 activityRef 或等价的稳定事实标识。来源无法给出可去重的实际用时信息时，该汇入条目 duration_minutes 保存 null。
- 用户独立提交与外部任务变化能确认同一事实时建立关联，不复制实际用时；无法确认时不靠相似标题自动合并，返回待澄清信息。
- 预计时间只来自 Learning Plan 的任务背景，不进入实际时间统计。

### 6.3 修订、失效与历史读取

修改成果时，在一个事务中写入新 revision、更新当前记录版本、标记受影响评估失效并创建领域变更。复盘和报告保留 source_snapshots；读取时比较当前可知修订返回 sourceChanged，不在查询中生成新总结。

历史快照保留不等于绕过权限：来源模块撤销材料访问后，查询须屏蔽不再可访问的摘录，保留“来源已不可用”的说明。外部状态无法核实时不能声明来源仍最新，Coverage 标记缺失。

## 7. 状态流转与事务

### 7.1 记录与评估

```text
记录：active → amended（保持 active、版本递增）→ withdrawn
评估生成：not_started → running → succeeded / failed
评估有效性：current → stale / withdrawn
```

amended 是变化类型，不是 RecordDTO.status 的额外枚举。单纯查询不推进任何状态。重新评估创建新的 assessment，与旧评估并存；因同一生成失败而恢复则继续原 assessment。

评估过程：

1. 校验身份、证据有效性与来源要求，冻结输入修订，创建 operation 和 assessment。
2. 事务外读取必要材料并执行生成，不持有数据库行锁等待模型。
3. 提交前重新校验源修订和当前操作 fencing_token。
4. 来源已改变时不发布为 current，可保留 stale 结果并返回需要重评；校验通过则保存 findings 与 outbox。

### 7.2 面试创建与作答

```text
preparing → active → completed
    │          └──→ ended_early
    └──→ preparation_failed → preparing（显式恢复）

回答保存：不存在 → saved（不可改写）
单题反馈：not_started → running → succeeded / failed
整场报告：not_started → running → succeeded / failed
```

创建面试时短事务串行校验该用户已有会话及操作键，创建 preparing；事务外生成全套题目与私有评价要点，校验成功后一次保存题目并转 active。生成失败保留会话和失败状态；相同创建操作可恢复，不重复新开。

作答时：

1. 先查同题已有回答；内容相同可重放或恢复反馈，即使会话已结束也不能误报为非法新作答。
2. 若内容不同，返回 INVALID_STATE，不覆盖原回答。
3. 无已有回答时锁定面试行，校验 active 和当前题；插入回答、增加 answered_count、建立待处理 feedback。
4. 最后一题在同一事务内转 completed，并建立待生成 report；提前结束工具与作答使用相同面试行锁。
5. 事务提交后生成单题反馈；按序触发整场报告。模型失败不撤销已保存回答与完成状态。
6. 报告结束后创建唯一的 interview_result 记录及证据引用；反馈内容不冒充项目实操证据。

页面可在反馈生成中查看已保存进度和当前待答题；是否展示“继续作答”由返回的允许动作决定，前端不自行猜测面试规则。

### 7.3 结束与报告恢复

- active 的 finish 调用将会话转 ended_early，冻结已答集合并建立 report；无回答时生成无有效评价说明，不调用模型编造评分。
- completed 或 ended_early 且 report succeeded 时直接返回已有报告。
- report failed 或运行租约已过期时，显式 finish 可以重新取得处理权，使用原回答恢复缺失评估和总结。
- 报告只评价成功读取的回答；无法完成的单题评估列入 unevaluatedQuestionIds 和 limitations。
- 一个晚到的生成结果不得覆盖另一轮已成功报告，依靠 fencing_token 和目标状态条件更新。

### 7.4 幂等与恢复语义

业务写入与模型生成是分阶段 operation。只缓存最终失败会导致“重试永远拿到失败”；因此同一意图的幂等重放先识别事实是否已提交，再决定仅读取、继续未完成生成或返回处理中。

| 场景 | 处理 |
| --- | --- |
| 同 operationKey、相同 payload | 返回已有实体；生成失败且允许恢复时继续原操作 |
| 同 operationKey、不同 payload | DUPLICATE_REQUEST，不复用旧对象 |
| 不同 operationKey、同题同回答 | 依靠答案唯一键重放；可恢复未完成反馈 |
| 不同 operationKey、同题不同回答 | INVALID_STATE，保留原文 |
| 同一复盘范围，用户明确重新生成 | 新 operationKey、新 review；不能用范围作为幂等键 |
| 评估、复盘创建失败后跨聊天轮恢复 | 宿主根据返回的实体和可信操作记录复用原 operationKey；不让模型填入任意操作键 |
| 进程退出后 operation 仍 running | 读取说明 lease 已失效并提供 recovery；仅后续显式命令抢占租约，不由 Query 写状态 |

首版采用请求内执行加持久化恢复，不承诺后台无人触发时自动完成。队长如增加后台执行器，可复用 operation 状态与租约，不改变工具含义。断连后的生成遵守 AbortSignal，已提交事实不撤销。

## 8. 生成与评估端口

生成能力统一使用队长提供的后端 `LlmInvoker`，D 不直接创建 Pi Agent、读取模型密钥或访问具体 Provider。

```ts
export interface LlmInvoker {
  generateStructured<T>(input: {
    systemPrompt: string;
    userInput: unknown;
    outputSchema: unknown;
    signal?: AbortSignal;
  }): Promise<T>;
}
```

D 负责题目、证据评估、复盘和面试反馈的业务 Prompt、输入组织、输出 Schema、引用校验及结果落库；队长负责 `LlmInvoker` 的模型适配、鉴权、超时、取消、重试和统一错误。`EvidenceGenerationPort` 是 D 对内部用例的业务抽象，具体实现通过依赖注入使用 `LlmInvoker`，不是另一个 Agent Loop。

```ts
interface EvidenceGenerationPort {
  buildInterview(input: InterviewGenerationInput, signal?: AbortSignal): Promise<InterviewPlan>;
  assessEvidence(input: EvidenceAssessmentInput, signal?: AbortSignal): Promise<SkillFinding[]>;
  reviewLearning(input: LearningReviewInput, signal?: AbortSignal): Promise<ReviewContent>;
  assessAnswer(input: AnswerAssessmentInput, signal?: AbortSignal): Promise<AnswerFeedbackContent>;
  summarizeInterview(input: InterviewReportInput, signal?: AbortSignal): Promise<ReportContent>;
}
```

该接口供真实模型适配器及测试替身实现。模型提供方可由队长注入，不能为缺少模型配置提供生产固定回复。生产未组装真实生成器时返回 DEPENDENCY_UNAVAILABLE；测试样例仅用于测试。

生成结果校验要求：

- 使用严格结构化 Schema，拒绝多余工具指令、无法解析结果和不符合枚举的状态。
- 所有引用 ID 必须来自本次输入白名单；引用摘录必须能够对应到原始文本，不接受伪造来源。
- 能力标识限定本次训练或评估范围；证据来源为自述时，不允许输出已被材料验证的结论。
- 题量与题号一致、问题非空、引用项目可访问；由本模块生成问题 ID，模型不生成数据库主键。
- 材料、回答、网页摘录作为不可信数据提供，不能改变系统规则或获得其他工具权限。
- 不默认执行用户项目、下载外部链接或访问本地文件；材料获取委托 Knowledge 端口。
- 设置调用超时和内容预算，超限记录覆盖缺失或拒绝操作，不静默截断后声称完整评估。
- 自动重试只允许有界的瞬时模型连接失败；业务操作恢复仍遵守第 7 节，不重放整个主 Agent 任务。

## 9. 跨模块端口契约

以下函数是本模块需要对方提供或适配的接口，不是对方现有工具的实现事实。

| 端口方法 | 输入 | 必须提供的输出 |
| --- | --- | --- |
| Learning.getTask | ctx、taskId | taskId、stageId、status、title、expectedOutcome、criteria、revision |
| Learning.getStage | ctx、stageId | stageId、目标、明确起止时间及任务关联；缺少时间时显式说明 |
| Learning.listHistory | ctx、时间范围、游标 | 进度、反馈、调整、已有测试结果摘要；每项含稳定 sourceEventId、sourceEntityId、revision、occurredAt |
| Learning.getAssessmentResult | ctx、resultId | 已有测试结果、考察能力、原评分依据、可引用内容、revision、访问状态 |
| Career.getJobRequirements | ctx、jobId | jobId、岗位名称、skillRefs、要求、revision、资料覆盖 |
| Profile.getLearningContext | ctx | 必要基础、已知目标、可信时区；未知字段为 null |
| Knowledge.resolveMaterials | ctx、MaterialRef[] | 每项的权限及可用状态、内容片段、来源修订、可引用位置、类型与内容范围 |
| SharedSkills.resolve / get | ctx、能力名称或 skillIds | 项目统一的 SkillRef；归属方需团队指定，本模块不自行建立第二套能力目录 |
| Evidence.syncSourceChange | 可信 ctx、SourceChange | 应用或重放结果、关联 recordId、当前来源修订 |

### 9.1 来源同步约定

SourceChange 至少包含 sourceDomain、sourceEventId、sourceEntityId、sourceRevision、occurredAt、kind、change、内容快照与可选 activityRef。owner 由可信调用方提供，不从事件正文推断。

- sourceEventId 标识一次通知；sourceEntityId 标识一条可修正的历史事实，不是直接使用可多次变化的 taskId。同一任务的两次独立进度变化必须具有不同历史事实标识，任务关联另放 taskId；修正某条变化则沿用该事实标识并提高 revision，避免时间线被任务最新状态覆盖。
- kind 可为 task_change、learning_feedback、plan_adjustment、assessment_result；不允许客户端直接调用该入口。
- revision 需要对方提供可比较顺序或可验证的“当前修订”查询；不能假定任意字符串天然可排序。
- inbox 去重与记录修改在同一事务。乱序通知不覆盖更新版本；无法判序时查询来源当前状态或拒绝待恢复。
- 来源撤回使引用失效，保留历史说明，不删除来源模块的数据。
- 批量补齐历史通过同一同步能力处理，不在 get_learning_records 查询中偷偷落库。Coverage 需要反映同步水位及失败范围。

历史范围的完整性由 Learning.listHistory 返回的 coverage、已完成分页和可信同步结果共同确定。只有零散通知、没有范围完成证明时，Coverage.complete 必须为 false；不能凭“最近收到了一条通知”认定整周历史齐全。首版允许查询时向来源只读核实覆盖范围，不强行增加后台同步任务。

### 9.2 缺失与降级

| 缺失项 | 允许的行为 | 禁止的行为 |
| --- | --- | --- |
| 没有学习计划 | 保存计划外活动、文字成果；按明确专项训练 | 创建虚构任务或阶段 |
| 指定岗位要求不可用 | 返回依赖失败，保留明确的专项训练入口供用户选择 | 静默换成固定后端题库 |
| 画像不可用 | 按本次明确提供的信息确定范围并说明限制 | 填入原型学校、年级或基础 |
| 材料不可读 | 保存关联或自述，评估结果标明证据不足 | 声称已经阅读截图或运行仓库 |
| 测试结果不可用 | 复盘注明该部分缺失 | 在本模块重做或补造测试结果 |

## 10. 页面与主 Agent 集成提案

### 10.0 页面入口与 Agent 入口

页面和 Agent 可以是两个调用入口，但业务写入的唯一边界是 `EvidenceApplication`，不是某一个入口：

```text
页面 HTTP Handler ─┐
                   ├→ EvidenceApplication → Repository → 数据库
Agent Tool ────────┘
```

两条路径复用同一套 Schema、owner 校验、状态流转、版本和幂等规则，不能在页面脚本或 Agent Tool 中复制业务逻辑。

首版建议：

- 页面直接提供查询入口，展示时间线、能力卡片、复盘和面试状态；
- 有明确原子意图的操作（提交面试回答、结束面试、确认结果）可以由页面 HTTP Handler 直接调用同一 Application；
- 需要理解自然语言、生成题目/反馈/复盘或跨模块编排的操作走 Agent Tool；
- 如果某个页面暂时只做展示，写入按钮可以先跳转到聊天并预填意图，不要求页面重复实现 Agent 编排。

因此，“写入唯一”应理解为**唯一写入 Service**，而不是强制所有写入都必须经过聊天 Agent。页面不会绕过 Agent 去改数据库，Agent 也不会绕过 Application 直接写表。

### 10.1 页面端点映射

以下路径供队长统一路由时采用，不在模块内部调用 localhost HTTP。页面写操作与 Agent 使用相同应用方法、Schema、身份校验及幂等语义。

| 页面动作 | 建议 HTTP 入口 | 应用方法 |
| --- | --- | --- |
| 时间线与单条详情 | GET /api/evidence/records；GET /api/evidence/records/:id | getLearningRecords |
| 记录或补充成果 | POST /api/evidence/records；PATCH /api/evidence/records/:id | recordLearningEvidence、updateLearningEvidence |
| 评估与能力卡片 | POST /api/evidence/assessments；GET /api/evidence/skills | evaluateLearningEvidence、getSkillEvidence |
| 生成或读取复盘 | POST /api/evidence/reviews；GET /api/evidence/reviews；GET /api/evidence/reviews/:id | generateLearningReview、getLearningReviews |
| 开始或查历史面试 | POST /api/evidence/interviews；GET /api/evidence/interviews | startInterview、getInterviewRecords |
| 恢复面试 | GET /api/evidence/interviews/:id | getInterviewSession |
| 提交回答 | POST /api/evidence/interviews/:id/answers | submitInterviewAnswer |
| 结束或恢复总结 | POST /api/evidence/interviews/:id/finish | finishInterview |
| 查询逐题或整场反馈 | GET /api/evidence/interviews/:id/feedback | getInterviewFeedback |

页面生成中可按返回状态进行有界轮询；停止轮询不删除操作，重新进入可查询。HTTP 状态码区分传输失败和业务部分成功：例如回答保存成功、评估失败仍返回可解析的成功业务包，不能要求用户盲目重新提交。

### 10.2 主 Agent 集成清单

队长需完成：

1. 将 ownerId、chat sessionId、requestId、toolCallId 和 AbortSignal 从可信入口传递到模块，不能仅把参数对象交给模型再让模型传回。
2. 将统一 DomainCapability 适配到 Pi，而不是强制新模块匹配知乎客户端工具类型。
3. 按当前用户授权注册模块工具；外部上传确认与普通学习记录写入分别依据实际动作处理。
4. 保留完整 CapabilityResult。现有适配器只返回 result.data，新适配需要保留 changed、status、summary、error，供主 Agent 正确判断部分成功与恢复。
5. 正确传递已有实体版本和恢复用的可信 operationKey；不能直接把整轮 requestId 用于所有写工具。
6. 消费模块 outbox，统一发送 domain_update，并接入首页及成长空间刷新。

### 10.3 领域更新

沿用现有事件形状：type、domain、resource、entity_id、version、change。拟定 resource 和 change：

| resource | change |
| --- | --- |
| record | created、amended、withdrawn、source_updated |
| assessment | generated、invalidated |
| review | generated |
| interview | started、answered、completed、ended_early |
| report | generated |

这些枚举值是待队长并入公共协议的提案。事件只在相关数据提交后发送；至少一次发送允许重复，页面根据实体及版本重新读取，不能把事件次数作为学习次数。

## 11. 验证与实施顺序

### 11.1 验证矩阵

| 检查层次 | 重点 |
| --- | --- |
| Schema 与契约 | 13 个工具齐全；拒绝模型身份字段；详情与列表互斥；空答案、错误时间、超限材料被拒绝 |
| 业务用例 | 保存与评估分离；任务与测试不越界；修正使评估失效；复盘无记录时不虚构 |
| 数据库集成 | 同 owner 条件；复合外键；并发作答只推进一次；同键不同载荷；同题不同回答；来源重复与乱序 |
| 生成失败恢复 | 回答保存后超时；提交后断连；进程退出租约过期；晚到结果不能覆盖新成功结果 |
| 只读验证 | 查询数据库写调用计数为零，不调用生成器；未作答参考答案不可见 |
| 跨模块契约 | 不可访问材料、岗位缺失、测试引用与来源撤回；Coverage 正确反映部分结果 |
| 页面与 Agent 联调 | 当前题恢复；生成状态可见；操作成功后刷新；同一轮不同工具不被错误去重 |

测试使用受控生成器验证业务不变量，再用真实模型验证结构化协议和引用质量。不能把固定测试题当作生产题库。新增模块测试保持 `tests/*.test.ts` 命名，避免 npm test 漏跑。

### 11.2 实施顺序及完成标志

1. **契约与数据基础：**建立模块输入输出、端口、迁移和仓储；验证 owner 隔离、版本与幂等。
2. **记录与证据：**完成 T01–T05 及可信来源入口，验证补材料、撤回与证据失效。
3. **阶段复盘：**完成 T06–T07，验证来源范围、部分数据和历史引用。
4. **面试闭环：**完成 T08–T13，验证创建、保存、恢复、结束与报告唯一性。
5. **真实生成适配：**组装生成端口并验证题目与引用约束，缺配置不得以固定回复通过验收。
6. **队长和队员联调：**补齐第 9、10 节端口及宿主身份、注册、事件、路由，最后完成两个页面。

模块单元测试通过不代表主 Agent 已能调用，也不代表页面已接通。只有真实依赖、可信身份、注册、迁移与页面读写均验证后，才可声称完整上线。迁移先在测试库验证，不在设计阶段执行生产数据变更。

## 12. 扩展约束

- 语音和视频后续扩展 Answer 的内容类型与引用，文字回答原文及既有会话保持可读。
- 追问需要增加父题关联并明确题量规则，不重解释现有 ordinal。
- 重评和人工复核新增评估版本与来源，不覆盖原有模型评估为另一个人的结论。
- 导出与趋势分析使用已保存报告，不因查询历史自动重新打分。
- 后台任务执行可替换请求内执行器，继续使用 operation 及 fencing_token，不改变 13 个工具的基本语义。
- 阶段测试不因扩展转移归属；任务调整和岗位匹配仍通过相应模块能力实现。
