# 队员 C：学习计划模块对接设计

> 本文是队员 C 的开发对接文档。开发时优先以本文的 Service 接口、数据字段和状态约束为准；通用的 `ModuleContext`、`DomainCommand`、`CapabilityResult` 以《工程契约与模块能力接口》为准。

## 0. 开发者先看这里

### C 模块要完成的主流程

```text
队长 Agent 读取 Profile、Career 和 Evidence 快照
  → 可选调用 search_zhihu / search_global 获取学习资料
  → LLM 生成结构化 trial 试验计划
  → C 保存计划、阶段和任务
  → 用户执行任务
  → 更新任务状态、记录反馈
  → 接收阶段测验结果
  → Agent 生成结构化调整操作，C 应用并保存历史
  → 用户确认后激活 final 正式计划
```

### C 模块的核心实体

```text
learning_plans       计划
  └─ learning_stages       阶段
       └─ learning_tasks        任务
            └─ task_schedules       时间安排

learning_feedback    用户反馈
learning_plan_adjustments 计划调整历史
learning_idempotency_records  写命令回执和幂等记录
```

### 开发时必须遵守的规则

- Agent 只能调用 `capabilities.ts` 暴露的 Tool，不能直接访问 Repository 或数据库。
- 其他模块只能调用 `LearningApplication`，不能直接读取 C 模块的表。
- C 保存 A、B、D 返回的 ID 和版本号，但不复制或修改他们的数据。
- 所有写操作都要校验 `ownerId`、状态、幂等键和 `expectedVersion`。
- 计划调整必须保留历史记录，不能直接覆盖到无法追溯的状态。
- 试验计划和正式计划分开管理；用户未确认前，试验计划不能替换正式计划。

## 1. 模块定位

队员 C 负责 `Learning Plan` 模块，解决以下问题：

- 根据用户情况生成试验性学习计划；
- 根据试验结果生成最终学习计划；
- 根据用户可用时间安排学习任务；
- 管理学习阶段、任务状态和完成进度；
- 接收学习反馈并动态调整计划。

队员 C 不负责用户画像、职业分析、阶段测验、学习成果和模拟面试的具体业务实现。

### 1.1 数据来源与职责边界

学习计划中的阶段、任务、学习资源和调整方案由队长负责的 Agent/LLM 根据 Profile、Career、Evidence 以及可选的知乎搜索结果生成。知乎搜索能力属于 Agent Core 的公共 Tool，不作为 Learning 模块的 Service 依赖，C 不直接调用搜索接口或模型。

C 接收已经结构化的计划和调整操作，负责保存数据并执行业务约束：用户隔离、计划状态流转、任务状态、版本、幂等、事务和调整历史。C 不判断“应该学习什么”，也不在数据库中自行生成默认任务。

## 2. 顶层抽象

```ts
export interface LearningApplication {
  getActivePlan(
    ctx: ModuleContext,
    input: { includeTasks?: boolean },
  ): Promise<LearningPlanDTO | null>;

  getTodayTasks(
    ctx: ModuleContext,
    input: { date?: string },
  ): Promise<LearningTaskDTO[]>;

  getLearningProgress(
    ctx: ModuleContext,
    input: { planId?: string },
  ): Promise<LearningProgressDTO>;

  createLearningPlan(
    command: CreateLearningPlanCommand,
  ): Promise<LearningCapabilityResult<LearningPlanDTO>>;

  updateTaskStatus(
    command: UpdateTaskStatusCommand,
  ): Promise<LearningCapabilityResult<LearningTaskDTO>>;

  recordLearningFeedback(
    command: RecordLearningFeedbackCommand,
  ): Promise<LearningCapabilityResult<LearningFeedbackDTO>>;

  adjustLearningPlan(
    command: AdjustLearningPlanCommand,
  ): Promise<LearningCapabilityResult<LearningPlanDTO>>;

  confirmLearningPlan(
    command: ConfirmLearningPlanCommand,
  ): Promise<LearningCapabilityResult<LearningPlanDTO>>;
}
```

这些方法的职责边界如下：

| 方法 | 负责什么 | 不负责什么 |
|---|---|---|
| `getActivePlan` | 查询当前有效计划及其阶段、任务 | 不生成新计划 |
| `getTodayTasks` | 按日期返回当天任务 | 不判断任务是否适合用户 |
| `getLearningProgress` | 计算计划和阶段完成度 | 不评价用户是否真正掌握 |
| `createLearningPlan` | 保存 Agent 生成的计划草案 | 不负责生成职业结论 |
| `updateTaskStatus` | 处理任务状态和实际用时 | 不保存学习成果证据 |
| `recordLearningFeedback` | 保存用户主观反馈 | 不直接改变计划内容 |
| `adjustLearningPlan` | 按调整指令修改任务和时间 | 不实现阶段测验 |
| `confirmLearningPlan` | 把用户确认的试验计划激活 | 不自动替用户确认 |

调用关系：

```text
Agent Tool
  → LearningApplication
  → LearningRepository
  → PostgreSQL
```

Agent 不直接操作数据库，其他模块不直接读取学习计划表。

### 推荐目录

```text
src/modules/learning/
  contracts.ts              # DTO、Command、枚举和错误定义
  service.ts                # LearningApplication 实现和业务规则
  repository.ts             # 数据访问接口
  postgres-repository.ts    # PostgreSQL 实现
  capabilities.ts           # Agent Tool 适配层
  tests/                    # Service 和 Repository 测试
  README.md                 # 本模块使用说明
```

数据库迁移由 C 提交、队长合并执行：

```text
src/db/migrations/004-learning.sql
```

## 3. 对 Agent 提供的工具

| Tool | 类型 | 作用 |
|---|---|---|
| `get_active_learning_plan` | Query | 获取当前有效计划、阶段和任务 |
| `get_today_learning_tasks` | Query | 获取当天需要完成的学习任务 |
| `create_learning_plan` | Command | 创建试验性计划或最终计划 |
| `update_learning_task` | Command | 更新任务状态 |
| `record_learning_feedback` | Command | 记录任务难度、实际用时和学习困难 |
| `adjust_learning_plan` | Command | 根据反馈、测验结果和时间变化调整计划 |
| `confirm_learning_plan` | Command | 用户确认试验性计划并转为正式计划 |
| `get_learning_progress` | Query | 获取计划、阶段和任务完成进度 |

计划模式：

```ts
type PlanMode = "trial" | "final";
```

- `trial`：短周期试验计划，用于验证方向、难度和时间安排；
- `final`：根据试验结果生成的正式学习计划；
- 试验计划未经用户确认，不得自动替换正式计划。

### Tool 执行约定

`capabilities.ts` 只负责参数校验、上下文转发和结果适配，业务规则统一放在 `service.ts`：

```ts
export function createLearningCapabilities(
  service: LearningApplication,
): DomainCapability[] {
  return [
    {
      name: "get_today_learning_tasks",
      description: "获取当前用户指定日期的学习任务",
      inputSchema: getTodayTasksSchema,
      execute: (ctx, input) => service.getTodayTasks(ctx, input),
    },
    {
      name: "update_learning_task",
      description: "更新当前用户学习任务的状态",
      inputSchema: updateTaskStatusSchema,
      execute: (ctx, input) =>
        service.updateTaskStatus({
          context: ctx,
          payload: input,
          idempotencyKey: ctx.requestId,
        }),
    },
  ];
}
```

Tool 的输入 Schema 必须限制枚举值、日期格式、时长范围和文本长度。Agent 没有传入 `ownerId` 的权限，该字段始终从 `CapabilityContext` 注入。

## 4. 输入输出契约

### 4.1 创建学习计划

```ts
type CreateLearningPlanCommand = DomainCommand<{
  mode: "trial" | "final";
  sourceProfileVersion: number;
  sourceCareerPlanVersion?: number;
  targetJobId?: string;
  startDate: string;
  endDate: string;
  weeklyMinutes: number;
  availableSlots?: Array<{
    weekday: number;
    startTime: string;
    endTime: string;
  }>;
  learningGoals: string[];
  stages: Array<{
    title: string;
    objective: string;
    tasks: Array<{
      title: string;
      description: string;
      taskType: "reading" | "practice" | "project" | "review";
      estimatedMinutes: number;
      capabilityKey?: string;
      evidenceRequired?: boolean;
    }>;
  }>;
}>;
```

其中：

- `sourceProfileVersion` 表示计划基于的用户画像版本；
- `sourceCareerPlanVersion` 表示计划基于的职业规划版本；
- `targetJobId` 只保存职业模块提供的外部 ID；
- `availableSlots` 是用户可学习时间的可选快照；Profile V1 未提供具体时段时，C 只按 `weeklyMinutes` 安排，不得自行编造时段；
- `stages` 和其中的 `tasks` 是 Agent/LLM 生成的结构化计划内容，C 负责校验并保存，不负责生成默认任务；
- C 不自行推断用户专业、能力和职业目标。

### 4.2 更新任务状态

```ts
type UpdateTaskStatusCommand = DomainCommand<{
  taskId: string;
  status: "todo" | "in_progress" | "completed" | "paused";
  actualMinutes?: number;
  note?: string;
}>;
```

### 4.3 记录学习反馈

```ts
type RecordLearningFeedbackCommand = DomainCommand<{
  planId: string;
  taskId?: string;
  difficulty: "too_easy" | "appropriate" | "too_hard";
  reason?:
    | "missing_prerequisite"
    | "unclear_first_step"
    | "cannot_apply"
    | "too_much_content"
    | "insufficient_time"
    | "lack_of_feedback"
    | "other";
  actualMinutes?: number;
  availableMinutes?: number;
  confidenceScore?: number;
  note?: string;
}>;
```

### 4.4 调整学习计划

```ts
type AdjustLearningPlanCommand = DomainCommand<{
  planId: string;
  trigger:
    | "user_feedback"
    | "time_change"
    | "task_delay"
    | "assessment_result"
    | "goal_change";
  assessmentId?: string;
  reason: string;
  adjustmentMode:
    | "reduce_scope"
    | "split_task"
    | "change_order"
    | "reschedule"
    | "add_prerequisite"
    | "replace_resource";
  operations: Array<
    | {
        type: "split_task";
        taskId: string;
        newTasks: Array<{
          title: string;
          description?: string;
          taskType?: "reading" | "practice" | "project" | "review";
          estimatedMinutes: number;
        }>;
      }
    | {
        type: "reschedule";
        taskId: string;
        scheduleDate: string;
      }
    | {
        type: "change_order";
        taskIds: string[];
      }
    | {
        type: "replace_resource";
        taskId: string;
        resource: string;
      }
  >;
}>;
```

`operations` 由队长 Agent/LLM 根据反馈和测验结果生成；C 只校验任务是否属于当前计划、操作是否符合当前状态和版本，然后执行并写入 `learning_plan_adjustments`。C 不自行决定调整内容。

### 4.5 确认试验计划

```ts
type ConfirmLearningPlanCommand = DomainCommand<{
  planId: string;
  expectedPlanVersion: number;
  keepUnfinishedTasks?: boolean;
}>;
```

处理要求：

- 只允许确认当前用户自己的 `trial` 计划；
- 确认时校验计划仍为 `draft` 或 `active`，且版本未变化；
- 确认成功后，将该计划标记为 `final` 或激活对应的正式版本；
- 如果存在旧的正式计划，应按业务规则将其归档或暂停；
- 通过 `expectedPlanVersion` 防止用户在旧页面重复确认。

### 4.6 获取学习进度

```ts
type LearningProgressDTO = {
  planId: string;
  planVersion: number;
  totalTasks: number;
  completedTasks: number;
  progressPercent: number;
  currentStageId?: string;
  currentStageProgressPercent?: number;
};
```

### 4.7 统一返回格式

```ts
type LearningCapabilityResult<T> = CapabilityResult & {
  domain: "learning";
  data?: T;
};
```

示例：

```json
{
  "ok": true,
  "changed": true,
  "domain": "learning",
  "entityId": "task-001",
  "version": 4,
  "status": "applied",
  "summary": "已将任务拆分为两个 30 分钟练习",
  "data": {
    "taskId": "task-001",
    "status": "todo"
  }
}
```

## 5. 计划生成与动态调整

### 5.1 试验性计划流程

```text
获取用户画像
  → 获取职业目标和能力差距
  → 创建短周期试验计划
  → 用户执行任务
  → 收集任务反馈和完成结果
  → 判断时间、难度和兴趣是否匹配
  → 用户确认后生成最终计划
```

### 5.2 动态调整规则

| 触发条件 | 调整方式 |
|---|---|
| 任务连续延期 | 拆分任务或降低单次任务时长 |
| 用户反馈任务太难 | 增加前置知识任务，降低任务难度 |
| 用户可用时间减少 | 保留关键任务，延后非核心任务 |
| 用户完成速度较快 | 增加实践任务或提高任务难度 |
| 阶段测验未通过 | 回退到薄弱知识点并生成补充练习 |
| 用户目标岗位变化 | 根据新的岗位能力差距生成新计划 |
| 用户长期没有执行 | 暂停原计划，生成低负担恢复计划 |

阶段测验由队员 D 负责，C 只接收测验结果并执行计划调整。

## 6. 数据库表设计

### 6.1 `learning_plans`

保存学习计划基本信息。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | UUID | 计划 ID |
| `owner_id` | UUID | 用户 ID |
| `mode` | VARCHAR | `trial` / `final` |
| `status` | VARCHAR | `draft` / `active` / `paused` / `completed` / `archived` |
| `source_profile_version` | INT | 用户画像版本 |
| `source_career_plan_version` | INT | 职业规划版本，可为空 |
| `target_job_id` | UUID | 目标岗位外部 ID |
| `start_date` | DATE | 开始日期 |
| `end_date` | DATE | 结束日期 |
| `weekly_minutes` | INT | 每周预计学习时长 |
| `version` | INT | 乐观锁版本 |
| `created_at` | TIMESTAMP | 创建时间 |
| `updated_at` | TIMESTAMP | 修改时间 |

约束：同一用户最多只能有一个 `active` 状态的 `final` 计划。

### 6.2 `learning_stages`

保存计划中的学习阶段。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | UUID | 阶段 ID |
| `plan_id` | UUID | 所属计划 |
| `stage_order` | INT | 阶段顺序 |
| `title` | VARCHAR | 阶段名称 |
| `objective` | TEXT | 阶段目标 |
| `start_date` | DATE | 阶段开始时间 |
| `end_date` | DATE | 阶段结束时间 |
| `status` | VARCHAR | 阶段状态 |
| `assessment_required` | BOOLEAN | 是否需要阶段测验 |
| `assessment_id` | UUID | D 模块测验 ID，可为空 |
| `progress_percent` | INT | 阶段进度 |

### 6.3 `learning_tasks`

保存具体学习任务。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | UUID | 任务 ID |
| `stage_id` | UUID | 所属阶段 |
| `parent_task_id` | UUID | 父任务，用于任务拆分 |
| `title` | VARCHAR | 任务名称 |
| `description` | TEXT | 任务要求 |
| `task_type` | VARCHAR | 阅读、练习、项目、复盘 |
| `status` | VARCHAR | `todo` / `in_progress` / `completed` / `paused` |
| `priority` | INT | 优先级 |
| `estimated_minutes` | INT | 预计时长 |
| `actual_minutes` | INT | 实际时长 |
| `capability_key` | VARCHAR | 关联能力名称 |
| `evidence_required` | BOOLEAN | 是否需要成果证据 |
| `created_at` | TIMESTAMP | 创建时间 |
| `updated_at` | TIMESTAMP | 修改时间 |

### 6.4 `learning_task_schedules`

保存任务的具体时间安排。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | UUID | 时间安排 ID |
| `task_id` | UUID | 任务 ID |
| `schedule_date` | DATE | 学习日期 |
| `start_at` | TIMESTAMP | 开始时间 |
| `end_at` | TIMESTAMP | 结束时间 |
| `duration_minutes` | INT | 安排时长 |
| `status` | VARCHAR | `scheduled` / `done` / `missed` / `rescheduled` |

### 6.5 `learning_feedback`

保存用户对学习任务的反馈。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | UUID | 反馈 ID |
| `plan_id` | UUID | 计划 ID |
| `task_id` | UUID | 任务 ID，可为空 |
| `difficulty` | VARCHAR | 难度评价 |
| `reason` | VARCHAR | 困难原因 |
| `actual_minutes` | INT | 实际耗时 |
| `available_minutes` | INT | 当前可用时长 |
| `confidence_score` | INT | 用户自评掌握度 |
| `note` | TEXT | 补充说明 |
| `created_at` | TIMESTAMP | 反馈时间 |

### 6.6 `learning_plan_adjustments`

保存计划调整记录。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | UUID | 调整记录 ID |
| `plan_id` | UUID | 计划 ID |
| `from_version` | INT | 调整前版本 |
| `to_version` | INT | 调整后版本 |
| `trigger` | VARCHAR | 调整原因 |
| `reason` | TEXT | 调整说明 |
| `change_summary` | JSONB | 任务增删改和时间变化 |
| `created_at` | TIMESTAMP | 调整时间 |

### 6.7 `learning_idempotency_records`

保存学习模块写命令的执行回执，防止网络重试造成重复创建、重复更新或重复调整。

| 字段 | 类型 | 说明 |
|---|---|---|
| `owner_id` | UUID | 用户 ID |
| `idempotency_key` | VARCHAR | 幂等键；与用户联合唯一 |
| `command_name` | VARCHAR | 命令名称 |
| `request_id` | UUID | 来源请求 ID |
| `request_hash` | VARCHAR | 命令载荷摘要，用于识别同键不同参数 |
| `result_json` | JSONB | 已完成命令的返回结果 |
| `created_at` | TIMESTAMP | 创建时间 |

主键为 `(owner_id, idempotency_key)`。相同用户、相同幂等键且载荷一致时重放原结果；载荷不同返回 `DUPLICATE_REQUEST`，不重新执行。

## 7. 与其他模块的联系

### 7.1 C 需要队员 A（Profile）提供的数据

#### 接口

```ts
interface ProfileApplication {
  getUserProfile(
    ctx: ModuleContext,
    input: { version?: number },
  ): Promise<ProfileSnapshot>;
}

type ProfileSnapshot = {
  profileVersion: number;
  grade: string;
  major: string;
  currentSkills: string[];
  interests: string[];
  weeklyMinutes?: number;
  availableSlots?: AvailableSlot[];
  learningPreference?: string;
};
```

Profile V1 的标准字段是 `learned_content`、`current_baseline` 和 `weekly_time`，并不保证提供具体的 `availableSlots`。`ProfileQuery` 负责把 Profile DTO 投影为本节的 `ProfileSnapshot`：`weekly_time.hours` 转换为 `weeklyMinutes`，`learned_content` 与 `current_baseline` 汇总为 `currentSkills`；没有具体时段时 `availableSlots` 为空，由 C 仅按周总时长安排。

#### 为什么需要

- `currentSkills`：判断任务是否需要补充前置知识；
- `weeklyMinutes`：限制计划总时长，避免生成用户无法执行的计划；
- `availableSlots`（可选）：有具体时段时把任务安排到用户方便的时间；缺失时不自行猜测时段；
- `profileVersion`：记录计划依据的画像版本，画像变化后可以判断是否需要重新规划；
- `learningPreference`：在阅读、视频、练习等任务形式之间做安排。

#### 调用时机

- 创建 `trial` 或 `final` 计划前调用；
- 用户修改每周时间后重新调用；
- Agent 请求“按我现在的时间重新安排”时调用。

#### 缺失或失败处理

- 没有画像或可用时间时，不创建正式计划，返回 `confirmation_required`，提示用户先完善画像；
- 画像服务暂时不可用时返回 `DEPENDENCY_UNAVAILABLE`，不使用旧数据静默生成新计划；
- C 只保存快照和版本号，不直接读取 Profile 表。

队员 A 现有的 `get_user_profile` Tool 应由其内部 Service 实现上述查询能力；C 不调用其他模块的 Agent Tool。

### 7.2 C 需要队员 B（Career）提供的数据

#### 接口

```ts
interface CareerApplication {
  getCareerPlanSnapshot(
    ctx: ModuleContext,
    input: { version?: number },
  ): Promise<CareerPlanSnapshot | null>;
}

type CareerPlanSnapshot = {
  careerPlanVersion: number;
  targetJobId: string;
  targetRole: string;
  skillGaps: string[];
  prioritySkills: string[];
  recommendedProjects: string[];
  deadline?: string;
};
```

#### 为什么需要

- `targetJobId` 和 `targetRole`：明确学习计划要服务的岗位目标；
- `skillGaps`：把岗位差距转换为阶段学习主题；
- `prioritySkills`：决定任务优先级和当前阶段重点；
- `recommendedProjects`：把职业模块推荐的项目转成项目型学习任务；
- `deadline`：用于倒排阶段日期和判断计划是否过长；
- `careerPlanVersion`：保证计划记录对应的职业规划版本。

#### 调用时机

- 用户要求按目标岗位制定计划时调用；
- 创建最终计划前调用；
- 目标岗位或职业规划发生变化时调用并触发计划调整。

#### 缺失或失败处理

- 没有职业规划时允许创建不绑定岗位的探索型 `trial` 计划，但不能声称该计划已匹配目标岗位；
- 岗位规划版本变化时，保留旧计划历史，创建调整记录，不直接覆盖原任务；
- Career 服务不可用时，不执行依赖岗位差距的计划调整。

队员 B 的 `get_career_plan` 是该数据的业务来源；C 只接收 B 返回的快照，不自行计算岗位匹配度和能力差距。

### 7.3 C 需要队员 D（Evidence & Interview）提供的数据

#### 接口

```ts
interface EvidenceApplication {
  getAssessmentSummary(
    ctx: ModuleContext,
    input: { assessmentId: string },
  ): Promise<AssessmentSummary>;
}

type AssessmentSummary = {
  assessmentId: string;
  stageId: string;
  score: number;
  passed: boolean;
  weakSkills: string[];
  suggestions: string[];
};
```

#### 为什么需要

- `passed`：判断阶段是否可以进入下一阶段；
- `score`：记录阶段结果，并作为计划调整的依据；
- `weakSkills`：生成补充练习或回退任务；
- `suggestions`：为调整后的任务提供针对性方向；
- `stageId`：确保测验结果应用到正确的学习阶段。

#### 调用时机

- 阶段测验提交完成后调用；
- Agent 请求“根据测验结果调整计划”时调用；
- 阶段状态从进行中转为完成前调用。

#### 缺失或失败处理

- 测验未完成时，不得把阶段标记为已通过；
- 测验结果未找到时返回 `NOT_FOUND`，不根据猜测调整任务；
- 测验服务不可用时保留当前计划，并等待重试或用户确认。

队员 D 负责测验、成果和证据的存储。C 只消费测验摘要，不实现测验评分和能力证据逻辑。

### 7.4 C 向队长 Agent/Core 提供的数据

#### 接口

```ts
getActivePlan(ctx, { includeTasks: true })
getTodayTasks(ctx, { date })
getLearningProgress(ctx, { planId })
```

#### 为什么需要

- Agent 需要知道当前任务，才能回答“今天学什么”；
- Agent 需要知道任务状态，才能理解用户说“我完成了”对应哪一项；
- 首页需要计划进度、当前阶段和今日任务进行聚合展示；
- Agent 需要基于真实计划调用反馈和调整能力，避免凭空生成计划状态。

队长负责把这些 Service 适配成 Agent Tool、注册 Tool 并发布 `domain_update`；C 不修改 Agent Runtime 和 Tool 总注册表。

### 7.5 C 向队员 B（Career）提供的数据

#### 接口

```ts
getPlanProgress(
  ctx: ModuleContext,
  input: { planId?: string },
): Promise<LearningProgressDTO>;

getCompletedCapabilityKeys(
  ctx: ModuleContext,
  input: { planId?: string },
): Promise<string[]>;
```

#### 为什么需要

- B 需要计划完成度判断用户是否正在执行职业规划；
- `completedCapabilityKeys` 可以说明用户已经通过学习任务覆盖了哪些岗位能力；
- B 可以据此更新岗位匹配分析，但不会把“完成任务”直接等同于“已经掌握能力”。

C 只提供事实数据，岗位匹配度和就业建议仍由 B 负责计算。

### 7.6 C 向队员 D（Evidence & Interview）提供的数据

#### 接口

```ts
getTaskContext(
  ctx: ModuleContext,
  input: { taskId: string },
): Promise<LearningTaskContext>;

getStageContext(
  ctx: ModuleContext,
  input: { stageId: string },
): Promise<LearningStageContext>;
```

#### 为什么需要

- D 需要知道成果或测验关联的任务和阶段；
- `capabilityKey` 用于把学习成果关联到具体能力；
- `evidenceRequired` 用于判断该任务是否需要提交项目、笔记或其他证据；
- 阶段目标用于生成阶段复盘和面试准备上下文。

```ts
type LearningTaskContext = {
  taskId: string;
  planId: string;
  stageId: string;
  title: string;
  capabilityKey?: string;
  evidenceRequired: boolean;
};

type LearningStageContext = {
  stageId: string;
  planId: string;
  title: string;
  objective: string;
  stageOrder: number;
};
```

D 只使用这些上下文建立关联，不修改 C 的任务状态和计划内容。

## 8. 领域事件

业务写入成功后，由队长统一发布：

```json
{
  "type": "domain_update",
  "domain": "learning",
  "resource": "plan",
  "entity_id": "plan-001",
  "version": 4,
  "change": "adjusted"
}
```

建议事件：

```text
learning.plan.created
learning.plan.confirmed
learning.task.updated
learning.feedback.recorded
learning.plan.adjusted
learning.stage.completed
```

队员 C 只定义事件内容，不修改全局 SSE 和 Agent Runtime。

## 9. 开发边界

队员 C 负责：

```text
src/modules/learning/
  contracts.ts
  service.ts
  repository.ts
  postgres-repository.ts
  capabilities.ts
  tests/
  README.md
```

数据库迁移由 C 提交、队长合并执行：

```text
src/db/migrations/004-learning.sql
```

队员 C 不负责：

```text
src/agent/runtime/
src/agent/tools/registry.ts
src/modules/chat/
Profile 表和 Service
Career 表和 Service
Evidence 表和 Service
全局 SSE 协议
```

最终联调链路：

```text
Profile
  → Career
  → Learning Plan
  → 用户执行任务
  → Feedback / Assessment
  → Learning Plan 动态调整
  → 首页刷新最新计划状态
```
