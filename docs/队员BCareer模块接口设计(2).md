# Career 模块接口与 Agent Tool 契约

> **负责人：队员 B**
>
> **所属模块：Career（职业规划 / 目标岗位 / 岗位匹配）**
>
> **版本：v0.2**
>
> **更新日期：2026-09-13**

本文是 Career 模块面向队长、其他业务模块、前端 HTTP Handler 和 Agent Tool 调用者的接口总览。

---

## 0. 先看这里：调用者快速指南

### 0.1 Career 负责什么

```text
职业方向分析
职业规划草稿与确认
目标岗位 / 目标企业
岗位要求结构化
岗位匹配与能力差距
推荐下一步行动
```

### 0.2 Career 不负责什么

```text
用户画像事实                 → Profile
学习计划、学习任务和任务状态   → Learning Plan
学习记录、项目成果、能力证据   → Evidence & Interview
Agent Loop、Tool 总注册、SSE  → 队长 / Agent Core
```

### 0.3 两种调用路径

```text
前端按钮或页面加载
  → HTTP Handler
  → CareerApplication Service

用户自然语言
  → Agent Loop
  → Career Agent Tool
  → CareerApplication Service
```

两条路径必须复用同一个 `CareerApplication`，不能为 Agent 复制另一套业务逻辑。

### 0.4 Career 当前需要的外部依赖

| 依赖 | 必须性 | Career 调用目的 |
|---|---|---|
| `ProfileQuery` | **必须** | 获取画像、兴趣、当前基础、时间和方向偏好 |
| `EvidenceQuery` | **必须** | 获取用户能力证据，支撑岗位差距分析 |
| `LearningProgressQuery` | 可选 | 展示推荐行动是否已进入学习计划 |

Career 只依赖其他模块公开的 Query/Service 接口，**不直接读取其他模块的数据表**。

---

# 1. 接口分层总览

## 1.1 基础接口：必须实现

这些接口来自模块分工，是 Career 的核心 MVP：

| Service 方法 | Agent Tool | 类型 | 作用 |
|---|---|---|---|
| `getCareerPlan` | `get_career_plan` | Query | 读取职业规划 |
| `createCareerPlanDraft` | `create_career_plan_draft` | Command | 创建职业规划草稿 |
| `getTargetJobs` | `get_target_jobs` | Query | 读取用户已保存岗位 |
| `analyzeJobGap` | `analyze_job_gap` | Command | 分析单个岗位与用户能力的差距 |
| `confirmCareerPlan` | `confirm_career_plan` | Command | 确认职业规划 |

## 1.2 前端闭环接口：建议本轮实现

这些接口用于支撑当前前端“目标岗位”和“就业成长”页面：

| Service 方法 | Agent Tool | 类型 | 作用 |
|---|---|---|---|
| `saveTargetJob` | `save_target_job` | Command | 保存用户粘贴的 JD |
| `listJobCatalog` | `list_job_catalog` | Query | 岗位目录、筛选、分页 |
| `selectTargetJob` | `select_target_job` | Command | 设定当前目标岗位 |
| `getLatestJobGapAnalysis` | 可选 | Query | 读取岗位最新差距分析 |
| `getCareerDashboard` | `get_career_dashboard` | Query | 读取职业页聚合数据 |
| `compareTargetJobs` | `compare_target_jobs` | Query | 对比两个岗位 |

## 1.3 后续接口：企业和行业趋势

| Service 方法 | Agent Tool | 优先级 | 作用 |
|---|---|---|---|
| `listTargetCompanies` | `list_target_companies` | P1 | 企业目录 |
| `selectTargetCompany` | `select_target_company` | P1 | 选择 / 更换企业 |
| `compareTargetCompanies` | `compare_target_companies` | P1 | 对比两家企业及其岗位 |
| `getIndustryTrends` | `get_industry_trends` | P1 | 行业趋势卡片 |
| `getTargetJob` | `get_target_job` | 可选 | 查看单个岗位完整 JD |

---

# 2. 统一调用契约

以下类型由队长在公共契约中统一维护，Career 只引用，不修改：

```ts
export type ModuleContext = {
  ownerId: string;
  sessionId?: string;
  requestId?: string;
  signal?: AbortSignal;
};

export type CapabilityContext = {
  ownerId: string;
  sessionId: string;
  requestId: string;
  sourceMessageId?: string;
  signal: AbortSignal;
};

export type DomainCommand<T> = {
  context: CapabilityContext;
  payload: T;
  expectedVersion?: number;
  idempotencyKey: string;
};

export type CapabilityResult = {
  ok: boolean;
  changed: boolean;
  domain: string;
  entityId?: string;
  version?: number;
  status:
    | "read"
    | "applied"
    | "draft_created"
    | "confirmation_required"
    | "rejected";
  summary: string;
  data?: unknown;
};
```

## 2.1 调用者必须遵守

- `ownerId`、`sessionId`、`requestId` 不由模型或前端传入，由队长编排层注入；
- 所有写操作使用 `DomainCommand`；
- 所有写操作使用 `idempotencyKey`；
- Career Plan 的确认、目标岗位选择、目标企业选择使用 `expectedVersion`；
- 查询必须校验 `ownerId`；
- Agent Tool 只能调用 Service，不能直接调用 Repository 或数据库；
- 写入成功后的 `domain_update` 由队长发送，Career 不自行发送 SSE。

## 2.2 统一错误码

```text
NOT_FOUND                 资源不存在
FORBIDDEN                 资源不属于当前用户
INVALID_ARGUMENT          参数不合法
INVALID_STATE             当前状态不允许该操作
VERSION_CONFLICT          乐观锁版本冲突
DUPLICATE_REQUEST        相同幂等请求已经执行
CONFIRMATION_REQUIRED     缺少用户明确确认
DEPENDENCY_UNAVAILABLE    Profile / Evidence / Learning 依赖不可用
```

---

# 3. Career Service 接口

建议文件：

```text
src/modules/career/service.ts
```

## 3.1 完整应用接口

```ts
export interface CareerApplication {
  // 基础接口
  getCareerPlan(
    ctx: ModuleContext,
    input: GetCareerPlanInput,
  ): Promise<CareerPlanDTO | null>;

  createCareerPlanDraft(
    command: DomainCommand<CreateCareerPlanDraftInput>,
  ): Promise<CapabilityResult>;

  getTargetJobs(
    ctx: ModuleContext,
    input: GetTargetJobsInput,
  ): Promise<PaginatedResult<TargetJobDTO>>;

  analyzeJobGap(
    command: DomainCommand<AnalyzeJobGapInput>,
  ): Promise<CapabilityResult>;

  confirmCareerPlan(
    command: DomainCommand<ConfirmCareerPlanInput>,
  ): Promise<CapabilityResult>;

  // 前端闭环接口
  saveTargetJob(
    command: DomainCommand<SaveTargetJobInput>,
  ): Promise<CapabilityResult>;

  listJobCatalog(
    ctx: ModuleContext,
    input: ListJobCatalogInput,
  ): Promise<PaginatedResult<TargetJobDTO>>;

  selectTargetJob(
    command: DomainCommand<SelectTargetJobInput>,
  ): Promise<CapabilityResult>;

  getLatestJobGapAnalysis(
    ctx: ModuleContext,
    input: { jobId: string },
  ): Promise<JobGapAnalysisDTO | null>;

  getCareerDashboard(
    ctx: ModuleContext,
    input: GetCareerDashboardInput,
  ): Promise<CareerDashboardDTO>;

  compareTargetJobs(
    ctx: ModuleContext,
    input: CompareTargetJobsInput,
  ): Promise<JobComparisonDTO>;

  // P1：企业和趋势
  listTargetCompanies?(
    ctx: ModuleContext,
    input: ListTargetCompaniesInput,
  ): Promise<PaginatedResult<TargetCompanyDTO>>;

  selectTargetCompany?(
    command: DomainCommand<SelectTargetCompanyInput>,
  ): Promise<CapabilityResult>;

  compareTargetCompanies?(
    ctx: ModuleContext,
    input: CompareTargetCompaniesInput,
  ): Promise<CompanyComparisonDTO>;

  getIndustryTrends?(
    ctx: ModuleContext,
    input: GetIndustryTrendsInput,
  ): Promise<IndustryTrendDTO[]>;

  getTargetJob?(
    ctx: ModuleContext,
    input: { jobId: string },
  ): Promise<TargetJobDTO | null>;
}
```

> 实际实现中，P1 方法也可以拆到单独的 `CareerGrowthApplication` 接口；为方便队长注册，本文先统一列在 Career 能力边界中。

## 3.2 基础接口输入

```ts
export type GetCareerPlanInput = {
  status?: "draft" | "confirmed" | "archived";
  includeGapAnalysis?: boolean;
};

export type CreateCareerPlanDraftInput = {
  directionCodes?: string[];       // 最多 3 个
  targetJobId?: string;
  targetCompanyName?: string;
  targetCity?: string;
  targetSalaryText?: string;
  userNotes?: string;
};

export type GetTargetJobsInput = {
  directionCode?: string;
  keyword?: string;
  limit?: number;                  // 默认 20，最大 50
  cursor?: string;
};

export type AnalyzeJobGapInput = {
  jobId: string;
  planId?: string;
  includeUnknown?: boolean;
};

export type ConfirmCareerPlanInput = {
  planId: string;
  expectedVersion: number;
};
```

## 3.3 前端闭环接口输入

```ts
export type SaveTargetJobInput = {
  title: string;
  companyName?: string;
  directionCode?: string;
  city?: string;
  employmentType?: "internship" | "full_time" | "unknown";
  salaryText?: string;
  description: string;             // 用户粘贴的原始 JD
  source?: "manual" | "imported";
};

export type ListJobCatalogInput = {
  keyword?: string;
  directionCode?: string;
  companyId?: string;
  city?: string;
  employmentType?: "internship" | "full_time";
  limit?: number;
  cursor?: string;
};

export type SelectTargetJobInput = {
  planId: string;
  jobId: string;
  expectedVersion: number;
};

export type GetCareerDashboardInput = {
  trendPeriodDays?: 30 | 90 | 180;
  includeCompanies?: boolean;
  includeLearningProgress?: boolean;
};

export type CompareTargetJobsInput = {
  leftJobId: string;
  rightJobId: string;
};
```

## 3.4 P1 输入

```ts
export type ListTargetCompaniesInput = {
  keyword?: string;
  directionCode?: string;
  city?: string;
  limit?: number;
  cursor?: string;
};

export type SelectTargetCompanyInput = {
  planId: string;
  companyId: string;
  expectedVersion: number;
};

export type CompareTargetCompaniesInput = {
  leftCompanyId: string;
  rightCompanyId: string;
};

export type GetIndustryTrendsInput = {
  directionCodes?: string[];
  periodDays?: 30 | 90 | 180;
};
```

---

# 4. Career 领域 DTO

## 4.1 目标岗位和岗位要求

```ts
export type JobRequirementDTO = {
  id: string;
  skillCode: string;
  skillName: string;
  description?: string;
  importance: "required" | "preferred";
  expectedLevel?: 1 | 2 | 3 | 4 | 5;
  evidenceHints: string[];
  sourceText?: string;
};

export type TargetJobDTO = {
  id: string;
  ownerId: string;
  title: string;
  companyName?: string;
  directionCode?: string;
  city?: string;
  employmentType?: "internship" | "full_time" | "unknown";
  salaryText?: string;
  description: string;
  requirements: JobRequirementDTO[];
  source: "manual" | "seed" | "imported";
  createdAt: string;
  updatedAt: string;
};
```

## 4.2 职业规划

```ts
export type CareerPlanDTO = {
  id: string;
  ownerId: string;
  version: number;
  status: "draft" | "confirmed" | "archived";
  directions: CareerDirectionDTO[];
  primaryDirectionCode?: string;
  targetJobId?: string;
  targetCompanyName?: string;
  targetCity?: string;
  targetSalaryText?: string;
  rationale: string;
  milestones: CareerMilestoneDTO[];
  latestGapAnalysis?: JobGapAnalysisDTO;
  createdAt: string;
  updatedAt: string;
};

export type CareerDirectionDTO = {
  code: string;
  name: string;
  summary: string;
  fitReasons: string[];
  entryBarriers: string[];
  trialAction?: string;
  fitScore?: number;
};

export type CareerMilestoneDTO = {
  id: string;
  title: string;
  description: string;
  skillCodes: string[];
  expectedEvidence: string[];
  order: number;
};
```

## 4.3 岗位差距和推荐行动

```ts
export type CareerGapItemDTO = {
  requirement: JobRequirementDTO;
  status: "possessed" | "partial" | "missing" | "unknown";
  currentLevel?: 1 | 2 | 3 | 4 | 5;
  evidenceIds: string[];
  reason: string;
  nextAction?: CareerActionDTO;
};

export type CareerActionDTO = {
  id: string;
  title: string;
  description: string;
  type:
    | "learn_skill"
    | "complete_task"
    | "submit_project"
    | "verify_evidence"
    | "clarify_requirement";
  priority: "high" | "medium" | "low";
  skillCodes: string[];
  estimatedHours?: number;
  linkedTaskId?: string;
};

export type JobGapAnalysisDTO = {
  id: string;
  ownerId: string;
  jobId: string;
  planId?: string;
  matchScore: number;              // 0-100，不是录用概率
  possessed: CareerGapItemDTO[];
  partial: CareerGapItemDTO[];
  missing: CareerGapItemDTO[];
  unknown: CareerGapItemDTO[];
  recommendedActions: CareerActionDTO[];
  evidenceSnapshotAt: string;
  createdAt: string;
};
```

## 4.4 前端聚合数据

```ts
export type CareerDashboardDTO = {
  activePlan: CareerPlanDTO | null;
  activeJob: TargetJobDTO | null;
  activeGapAnalysis: JobGapAnalysisDTO | null;
  trends: IndustryTrendDTO[];
  targetCompanies: TargetCompanyDTO[];
  recommendedActions: CareerActionProgressDTO[];
  refreshedAt: string;
};

export type CareerActionProgressDTO = CareerActionDTO & {
  learningPlanStatus:
    | "not_linked"
    | "planned"
    | "in_progress"
    | "completed";
  linkedTaskId?: string;
};
```

## 4.5 岗位、企业和趋势对比

```ts
export type JobComparisonDTO = {
  leftJob: Pick<TargetJobDTO, "id" | "title" | "companyName" | "directionCode">;
  rightJob: Pick<TargetJobDTO, "id" | "title" | "companyName" | "directionCode">;
  commonRequirements: JobRequirementDTO[];
  onlyInLeft: JobRequirementDTO[];
  onlyInRight: JobRequirementDTO[];
  levelDifferences: Array<{
    skillCode: string;
    skillName: string;
    leftExpectedLevel?: number;
    rightExpectedLevel?: number;
    explanation: string;
  }>;
  currentUserRecommendation: {
    preferredJobId?: string;
    reason: string;
    sharedSkillsToPrioritize: string[];
    additionalSkillsForLeft: string[];
    additionalSkillsForRight: string[];
  };
};

export type TargetCompanyDTO = {
  id: string;
  name: string;
  industry?: string;
  city?: string;
  summary?: string;
  relatedJobIds: string[];
  matchScore?: number;
  selectionStatus: "selected" | "candidate" | "comparable";
  updatedAt: string;
};

export type CompanyComparisonDTO = {
  leftCompany: TargetCompanyDTO;
  rightCompany: TargetCompanyDTO;
  comparableJobPairs: Array<{
    leftJobId: string;
    rightJobId: string;
    comparison: JobComparisonDTO;
  }>;
  summary: string;
};

export type IndustryTrendDTO = {
  id: string;
  directionCode: string;
  directionName: string;
  metric: "demand_heat" | "growth" | "skill_change";
  value: number;
  title: string;
  summary: string;
  periodDays: 30 | 90 | 180;
  sampleSize?: number;
  sourceLabel: string;
  asOf: string;
};
```

分页统一使用：

```ts
export type PaginatedResult<T> = {
  items: T[];
  nextCursor?: string;
};
```

---

# 5. Career 对其他模块的依赖

## 5.1 Profile：必须

```ts
export type ProfileSnapshot = {
  directionHints: string[];
  interests: string[];
  currentSkills: {
    skillCode: string;
    level?: number;
  }[];
  weeklyAvailableHours?: number;
  goalText?: string;
};

export interface ProfileQuery {
  getProfileSnapshot(
    ctx: ModuleContext,
  ): Promise<ProfileSnapshot | null>;
}
```

用途：

```text
createCareerPlanDraft
  → ProfileQuery.getProfileSnapshot
  → 推荐职业方向、生成规划草稿
```

## 5.2 Evidence & Interview：岗位分析必须

```ts
export type SkillEvidenceSnapshot = {
  skillCode: string;
  level?: 1 | 2 | 3 | 4 | 5;
  evidenceIds: string[];
  evidenceCount: number;
};

export interface EvidenceQuery {
  getSkillEvidenceSnapshot(
    ctx: ModuleContext,
    input: { skillCodes: string[] },
  ): Promise<SkillEvidenceSnapshot[]>;
}
```

用途：

```text
analyzeJobGap
  → 读取岗位 requirements.skillCode
  → EvidenceQuery.getSkillEvidenceSnapshot
  → 计算 possessed / partial / missing / unknown
```

## 5.3 Learning Plan：可选只读依赖

如果职业页需要展示推荐行动的学习计划状态，可以依赖：

```ts
export interface LearningProgressQuery {
  getActionProgress(
    ctx: ModuleContext,
    input: { actionIds: string[] },
  ): Promise<Array<{
    actionId: string;
    status: "not_linked" | "planned" | "in_progress" | "completed";
    linkedTaskId?: string;
  }>>;
}
```

Career 不能调用 Learning 的写接口，也不能创建学习任务。

正确流程：

```text
Career 推荐 recommendedActions
  → Agent / 队长编排
  → Learning Plan 的创建或调整 Tool
  → Learning Plan 写入任务
```

## 5.4 统一 LLM 调用能力

岗位差距分析需要理解 JD、用户画像和能力证据之间的语义关系，但 Career 不直接创建 Pi Agent，也不自行读取模型密钥。队长提供统一的后端 LLM 接口，Career 通过依赖注入使用它。

队长维护的最小接口：

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

Career 负责：

```text
岗位差距分析的业务 Prompt
输入数据组织（岗位要求、Profile、Evidence）
输出 JSON Schema
skillCode、evidenceId、分数和状态的业务校验
分析快照持久化
```

队长负责：

```text
LlmInvoker 的模型适配（Pi / 豆包等）
模型配置和鉴权
超时、取消、重试和统一错误
结构化输出的基础校验
```

`analyze_job_gap` 的内部调用链为：

```text
Agent 调用 analyze_job_gap Tool
  → CareerApplication.analyzeJobGap
  → ProfileQuery / EvidenceQuery
  → Career GapAnalysisEngine
  → LlmInvoker.generateStructured
  → Career Service 校验结果
  → 保存 career_gap_analyses
  → 返回 JobGapAnalysisDTO
```

Career 的 Prompt 是岗位差距分析专用 Prompt，不是主 Agent 的 System Prompt。Career 不得在 Tool 内启动嵌套 Agent、直接访问 Provider 或直接操作数据库。LLM 调用失败时返回 `DEPENDENCY_UNAVAILABLE`，不得伪造分析结果；证据不足时使用 `unknown`，不得猜测。

---

# 6. Agent Tool 契约

建议文件：

```text
src/modules/career/capabilities.ts
```

## 6.1 Tool 工厂

```ts
export function createCareerCapabilities(
  service: CareerApplication,
): DomainCapability[];
```

Tool 实现规则：

```ts
execute(ctx, input)
  → service.method(...)
```

不允许：

```text
execute
  → 直接查询数据库
  → 在 Tool 内计算岗位匹配规则
  → 在 Tool 内修改 Learning 数据
```

## 6.2 基础 Tool

| Tool | 何时调用 | 写入 | 确认要求 |
|---|---|---:|---:|
| `get_career_plan` | 用户询问当前职业规划 | 否 | 否 |
| `create_career_plan_draft` | 用户希望生成职业方向 / 规划 | 是 | 否 |
| `get_target_jobs` | 用户查看已保存岗位 | 否 | 否 |
| `analyze_job_gap` | 用户询问岗位适配 / 差距 | 是：保存分析快照 | 否 |
| `confirm_career_plan` | 用户明确确认规划 | 是 | **必须明确确认** |

## 6.3 P0 增量 Tool

| Tool | 何时调用 | 写入 | 确认要求 |
|---|---|---:|---:|
| `get_career_dashboard` | Agent 需要当前职业上下文 | 否 | 否 |
| `list_job_catalog` | 用户让 Agent 找候选岗位 | 否 | 否 |
| `save_target_job` | 用户在聊天中提供 JD | 是 | 用户必须提供岗位信息 |
| `select_target_job` | 用户明确说“设为目标岗位” | 是 | 需要明确选择 |
| `compare_target_jobs` | 用户询问两个岗位差异 | 否 | 否 |

## 6.4 P1 Tool

```text
list_target_companies
select_target_company
compare_target_companies
get_industry_trends
```

`get_latest_job_gap_analysis` 和 `get_target_job` 可以先作为 Service/HTTP 接口；如果 Agent 需要读取完整 JD 或详细解释历史分析，再注册为 Tool。

## 6.5 Tool 输入 Schema 摘要

```ts
const saveTargetJobSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "description"],
  properties: {
    title: { type: "string", minLength: 1, maxLength: 160 },
    companyName: { type: "string", maxLength: 120 },
    directionCode: { type: "string", maxLength: 64 },
    city: { type: "string", maxLength: 80 },
    employmentType: {
      type: "string",
      enum: ["internship", "full_time", "unknown"],
    },
    salaryText: { type: "string", maxLength: 80 },
    description: { type: "string", minLength: 20, maxLength: 20000 },
    source: { type: "string", enum: ["manual", "imported"] },
  },
};

const analyzeJobGapSchema = {
  type: "object",
  additionalProperties: false,
  required: ["jobId"],
  properties: {
    jobId: { type: "string", minLength: 1, maxLength: 128 },
    planId: { type: "string", maxLength: 128 },
    includeUnknown: { type: "boolean", default: true },
  },
};

const selectTargetJobSchema = {
  type: "object",
  additionalProperties: false,
  required: ["planId", "jobId", "expectedVersion"],
  properties: {
    planId: { type: "string", minLength: 1, maxLength: 128 },
    jobId: { type: "string", minLength: 1, maxLength: 128 },
    expectedVersion: { type: "integer", minimum: 1 },
  },
};

const compareTargetJobsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["leftJobId", "rightJobId"],
  properties: {
    leftJobId: { type: "string", minLength: 1, maxLength: 128 },
    rightJobId: { type: "string", minLength: 1, maxLength: 128 },
  },
};
```

---

# 7. Agent 多 Tool 调用流程

## 7.1 用户粘贴 JD，要求分析

```text
用户：这是我想投的后端实习 JD，帮我看看差距。

1. get_career_dashboard
2. save_target_job
3. analyze_job_gap（使用 save 返回的 jobId）
4. Agent 解释已具备、部分具备、缺口和下一步
```

此流程不会自动更换用户当前目标岗位。

## 7.2 用户明确将 JD 设为目标

```text
1. save_target_job（如果尚未保存）
2. get_career_plan（获取当前 planId/version）
3. select_target_job
4. analyze_job_gap（如需要最新分析）
5. 队长发送 domain_update
```

如果用户只是说“看看这个岗位”，不能调用 `select_target_job`。

## 7.3 用户比较两个岗位

```text
1. get_career_dashboard
2. list_job_catalog（如缺少岗位 ID）
3. compare_target_jobs
4. Agent 解释共同能力、独有能力和当前更适合的方向
```

比较不能改变当前目标岗位。

## 7.4 用户要求根据差距制定学习计划

```text
1. get_career_dashboard
2. Career 返回 recommendedActions
3. Agent 调用 Learning Plan 的创建 / 调整 Tool
4. Learning Plan 返回任务结果
5. Agent 回复用户
```

Career 只负责“建议补什么”，Learning Plan 负责“创建什么任务”。

---

# 8. 前端 HTTP 映射

HTTP 层由队长或统一 API 层维护，Handler 只能调用 Career Service。

| HTTP 接口 | Service 方法 | 页面用途 |
|---|---|---|
| `GET /api/career/plan` | `getCareerPlan` | 读取职业规划 |
| `POST /api/career/plans/draft` | `createCareerPlanDraft` | 创建规划草稿 |
| `POST /api/career/plans/:id/confirm` | `confirmCareerPlan` | 确认规划 |
| `GET /api/career/jobs` | `getTargetJobs` | 读取已保存岗位 |
| `GET /api/career/job-catalog` | `listJobCatalog` | 选择目标岗位 |
| `POST /api/career/jobs` | `saveTargetJob` | 保存用户粘贴 JD |
| `POST /api/career/plans/:id/target-job` | `selectTargetJob` | 选择当前目标岗位 |
| `GET /api/career/jobs/:id/gap-analysis/latest` | `getLatestJobGapAnalysis` | 读取最新差距 |
| `POST /api/career/gap-analysis` | `analyzeJobGap` | 重新分析岗位差距 |
| `GET /api/career/dashboard` | `getCareerDashboard` | 加载职业成长页 |
| `POST /api/career/jobs/compare` | `compareTargetJobs` | 对比两个岗位 |
| `GET /api/career/companies` | `listTargetCompanies` | 企业选择 |
| `POST /api/career/plans/:id/company` | `selectTargetCompany` | 选择 / 更换企业 |
| `POST /api/career/companies/compare` | `compareTargetCompanies` | 对比企业 |
| `GET /api/career/trends` | `getIndustryTrends` | 行业趋势 |

前端不计算以下内容：

```text
匹配度
已具备 / 部分具备 / 缺口
推荐行动
行业趋势结论
```

这些必须由后端 Service 返回。

---

# 9. 前端页面字段对应

| 前端区域 | 主要数据来源 |
|---|---|
| 目标岗位标题、公司、匹配度 | `CareerDashboardDTO.activeJob` + `activeGapAnalysis` |
| “已具备” | `activeGapAnalysis.possessed` |
| “还需补齐 / 待补齐” | `activeGapAnalysis.partial` + `missing` |
| “建议顺序” | `activeGapAnalysis.recommendedActions` |
| 行业趋势卡片 | `CareerDashboardDTO.trends` |
| 目标企业列表 | `CareerDashboardDTO.targetCompanies` 或 `listTargetCompanies` |
| 企业“已选 / 可比较” | `TargetCompanyDTO.selectionStatus` |
| 查看关联学习计划 | `recommendedActions.learningPlanStatus`，具体任务由 Learning 返回 |
| 页面刷新时间 | `CareerDashboardDTO.refreshedAt` |

前端原型中的 `68%`、`近 90 天`、`后端开发实习生` 等是示例展示值，正式接入时必须由接口返回。

---

# 10. 状态写入与事件

## 10.1 重要写操作

| 操作 | 必须条件 |
|---|---|
| 创建规划草稿 | Profile 可用；使用幂等键 |
| 保存目标岗位 | 用户明确提供岗位或 JD；使用幂等键 |
| 选择目标岗位 | owner 校验、`expectedVersion`、幂等键 |
| 选择目标企业 | owner 校验、`expectedVersion`、幂等键 |
| 确认职业规划 | 用户明确确认、`expectedVersion`、幂等键 |
| 分析岗位差距 | Evidence 可用；保存分析快照和幂等结果 |

## 10.2 `domain_update`

Career Service 写入成功后，由队长发送：

```json
{
  "type": "domain_update",
  "domain": "career",
  "resource": "target_job",
  "entity_id": "job-001",
  "version": 3,
  "change": "selected"
}
```

可用事件：

```text
resource=plan          change=draft_created | confirmed
resource=target_job    change=saved | selected
resource=target_company change=selected
resource=gap_analysis  change=analyzed
```

前端收到事件后重新请求：

```text
GET /api/career/dashboard
GET /api/career/jobs/:id/gap-analysis/latest
GET /api/home-summary
```

Career 不直接发送 SSE，也不直接刷新前端。

---

# 11. 数据库和代码边界

## 11.1 推荐目录

```text
src/modules/career/
  contracts.ts
  service.ts
  repository.ts
  postgres-repository.ts
  capabilities.ts
  migration.sql
  tests/
  README.md
```

## 11.2 Career 自己维护的数据

```text
career_plans
career_target_jobs
career_gap_analyses
career_idempotency_records
```

最小要求：

- 所有业务表带 `owner_id`；
- 规划带 `version`；
- 写操作记录 `idempotency_key`；
- 差距分析保存 Evidence 快照时间；
- 不在 Career 表中复制 Profile、Learning、Evidence 的全部数据。

## 11.3 不要修改的文件

队员 B 不直接修改：

```text
src/agent/runtime/
src/agent/tools/registry.ts
src/contracts/capability.ts
src/contracts/domain-events.ts
src/modules/chat/
```

如果公共契约需要变化，向队长提交变更说明，不在 Career 模块内私自复制一份。

---

# 12. 队长接入清单

## 12.1 队员 B 交付

```text
[ ] contracts.ts：DTO、输入类型、模块错误映射
[ ] service.ts：CareerApplication 实现
[ ] repository.ts：Repository 接口
[ ] postgres-repository.ts：数据库实现
[ ] capabilities.ts：createCareerCapabilities
[ ] gap-analysis-engine.ts：岗位差距分析及 LlmInvoker 调用
[ ] migration.sql：Career 表和索引
[ ] tests/：Service、权限、幂等、版本冲突测试
[ ] README.md：模块运行和调用说明
```

## 12.2 队长接入

```ts
const careerCapabilities = createCareerCapabilities(careerService);

const capabilities = [
  ...createProfileCapabilities(profileService),
  ...careerCapabilities,
  ...createLearningCapabilities(learningService),
  ...createEvidenceCapabilities(evidenceService),
];
```

队长还需要负责：

- 注入 `CapabilityContext`；
- 提供并维护统一 `LlmInvoker` 实现；
- 将 Career Tool 注册到总表；
- 编排 `save_target_job → analyze_job_gap`；
- 编排 `Career recommendedActions → Learning Plan Tool`；
- 管理确认机制、SSE 和 `domain_update`；
- 提供 HTTP Handler 和首页聚合；
- 处理跨模块依赖不可用的统一降级。

## 12.3 其他模块调用 Career

### Learning Plan 调用 Career

只读取当前岗位和职业建议，例如：

```ts
const plan = await careerService.getCareerPlan(ctx, {
  includeGapAnalysis: true,
});
```

Learning 不能读取 Career 表，也不能直接修改 Career 规划。

### 首页聚合调用 Career

```ts
const dashboard = await careerService.getCareerDashboard(ctx, {
  trendPeriodDays: 90,
  includeCompanies: true,
  includeLearningProgress: true,
});
```

---

# 13. 验收标准

## 13.1 基础能力

```text
[ ] 能创建职业规划草稿
[ ] 能确认职业规划
[ ] 能保存和读取目标岗位
[ ] 能对单个岗位做能力差距分析
[ ] 能返回 possessed / partial / missing / unknown
[ ] 有缺口时能返回至少一个推荐行动
```

## 13.2 外部依赖和安全

```text
[ ] Career 通过 ProfileQuery 获取画像
[ ] Career 通过 EvidenceQuery 获取能力证据
[ ] 不直接读取其他模块数据表
[ ] 所有写入包含 owner 校验和幂等键
[ ] 规划选择和确认支持 expectedVersion
[ ] 跨用户访问不会泄露岗位或规划内容
```

## 13.3 Agent Tool

```text
[ ] 基础 5 个 Tool 名称稳定
[ ] P0 增量 Tool 可由 Service 工厂生成
[ ] Tool 不直接访问数据库
[ ] save_target_job 不会自动改变当前目标
[ ] select_target_job 只有明确选择意图时执行
[ ] confirm_career_plan 只有明确确认后执行
```

## 13.4 前端闭环

```text
[ ] 能从岗位目录选择目标岗位
[ ] 页面能读取最新岗位差距分析
[ ] 职业页能通过 Dashboard 加载所需数据
[ ] 前端不硬编码匹配度和职业结论
[ ] 推荐行动能显示 Learning 关联状态或 not_linked
[ ] 写入后队长能发送 domain_update 并触发刷新
```

---

# 14. 版本记录

| 版本 | 日期 | 说明 |
|---|---|---|
| 0.1 | 2026-09-13 | 初版 Service、DTO、Tool、依赖和联调契约 |
| 0.2 | 2026-09-13 | 按前端页面、Agent 编排和队长接入重新整理；区分基础、P0 增量和 P1 接口 |
