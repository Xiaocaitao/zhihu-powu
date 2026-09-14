# 成员 A · Profile 模块架构与协作接口

依据：[工程契约与模块能力接口](./工程契约与模块能力接口.md)、[成长空间模块分工](./成长空间模块分工.md)。

正文分为五部分，只描述对外约定和数据表；内部实现、规则细节和交付说明统一放在文末。本文确定 A 提供的接口及 A 所需的输入格式，不代表其他成员的接口已经实现。两份依据文档保持不变。

### V1 字段冻结（本版本不再新增画像字段）

| 分组 | 字段 | 类型 | 说明 | 职业规划是否最低必需 |
|---|---|---|---|---|
| 基础信息 | `school` | 字符串 | 学校 | 否 |
| 基础信息 | `major` | 字符串 | 专业 | 是 |
| 基础信息 | `grade` | 字符串 | 年级 | 否 |
| 能力基础 | `learned_content` | 字符串数组 | 已学习的课程、技术或主题 | 是 |
| 能力基础 | `current_baseline` | 文本 | 当前掌握程度和实践基础描述 | 是 |
| 兴趣 | `interest_direction` | 字符串数组 | 感兴趣的方向 | 否 |
| 时间 | `weekly_time` | 数字 | 通常每周可投入小时数 | 是 |
| 偏好 | `learning_preference` | 字符串数组 | 学习方式偏好 | 否 |
| 目标 | `target_direction` | 字符串或 `null` | 当前希望探索或学习的方向 | 是 |

职业规划的最低采集集合为 `major`、`learned_content`、`current_baseline`、`weekly_time`、`target_direction`；其余字段可以在后续对话中补充。`learned_content` 和 `current_baseline` 只记录用户自述或评估摘要，不代表技能认证，也不直接等于职业匹配分数。

`ownerId` 不是画像字段。它由后端认证上下文注入：正式登录场景下对应用户 UUID，匿名场景下对应匿名用户身份标识。它不出现在 Agent Tool 的模型入参中。

## 一、模块顶层抽象：其他模块通过什么使用 Profile

### 1.1 模块职责与对外对象

Profile 对应“画像与规划”页面，对外负责三类数据：

| 对外对象 | 含义 | 所属职责 |
|---|---|---|
| 用户画像 `UserProfileDTO` | 学校、专业、年级、已学内容、当前基础、兴趣、每周可投入时间、学习偏好，以及当前目标方向 | A 保存并提供查询 |
| 用户目标 `UserGoalDTO` | 用户当前希望学习或探索的方向 | A 维护目标方向；岗位、企业和职业方案由 B 维护 |
| 画像完善度 `ProfileCompletionDTO` | 哪些信息已提供、哪些待补充及完成比例 | A 统一计算并提供查询 |

### 1.2 唯一业务入口

其他模块调用 `ProfileApplication`；Agent 的四个 Tool 也调用同一接口。对方不需要了解 Profile 的内部数据表、Repository 或计算方式。

```ts
export interface ProfileApplication {
  getUserProfile(
    ctx: ModuleContext,
    input: GetUserProfileInput,
  ): Promise<UserProfileDTO | null>;

  getProfileCompletion(
    ctx: ModuleContext,
    input: GetProfileCompletionInput,
  ): Promise<ProfileCompletionDTO>;

  saveProfileFact(
    command: DomainCommand<SaveProfileFactInput>,
  ): Promise<ProfileWriteResult>;

  updateUserGoal(
    command: DomainCommand<UpdateUserGoalInput>,
  ): Promise<ProfileWriteResult>;
}
```

前两个是只读查询，后两个是写入命令。对外返回的数据结构在本节完整列出；第二部分定义输入，第三部分说明各模块接收哪些输出。公开类型和 Schema 由 A 在 `contracts.ts` 提供。

`ModuleContext`、`CapabilityContext`、`DomainCommand<T>`、`CapabilityResult` 和 `DomainCapability` 使用队长维护的公共契约，不在 Profile 另建一套。

### 1.3 对外数据结构：接收方共同遵守的类型

以下是其他模块接收 Profile 数据时使用的完整类型视图，包括画像内容、值格式、来源和返回对象。与第二、第三部分出现的同名类型是同一份契约的重复展示；实现时只从 Profile 的 `contracts.ts` 导入一份定义，不在各模块复制维护。

```ts
// 分区和画像内容。通过 factType 判断 value 的具体结构。
export type ProfileSection =
  | "identity" | "background" | "interests"
  | "availability" | "preferences" | "goals";

export type ProfileFactPayload =
  | { factType: "school" | "major" | "grade"; value: { text: string } }
  | { factType: "learned_content" | "interest_direction" | "learning_preference";
      value: { items: string[] } }
  | { factType: "current_baseline"; value: { summary: string } }
  | { factType: "weekly_time"; value: { hours: number } };

export type EvidenceReference = {
  evidenceId: string;
  evaluatedAt: string; // ISO 8601 时间
};

// 输出事实沿用该内容类型，并补充下方的 id、版本等元数据。
export type SaveProfileFactInput =
  | (ProfileFactPayload & {
      source: "user_input" | "user_confirmed";
      evidenceRef?: never;
    })
  | {
      factType: "current_baseline";
      value: { summary: string };
      source: "assessment";
      evidenceRef: EvidenceReference;
    };

export type UpdateUserGoalInput = {
  goalType: "target_direction";
  value: { direction: string | null };
};

// 单项画像事实：值 + 来源 + 确认状态 + 该实体自身的版本。
export type ProfileFactDTO = SaveProfileFactInput & {
  id: string;
  section: Exclude<ProfileSection, "goals">;
  isConfirmed: boolean;
  version: number;
  updatedAt: string; // ISO 8601 时间
};

// 当前目标方向，不包含 Career 的岗位、企业和匹配结论。
export type UserGoalDTO = UpdateUserGoalInput & {
  id: string;
  version: number;
  updatedAt: string; // ISO 8601 时间
};

export type ProfileField = ProfileFactPayload["factType"] | "target_direction";

// getUserProfile 的返回；用户没有任何画像时返回 null。
export type UserProfileDTO = {
  ownerId: string;
  facts: ProfileFactDTO[];
  goals: UserGoalDTO[]; // 当前 0 或 1 个目标方向
  includedSections: ProfileSection[];
  missingFields: ProfileField[];
};

// getProfileCompletion 的返回。
export type ProfileCompletionDTO = {
  ownerId: string;
  percentage: number; // 0–100，仅表示信息完善度
  completedSections: ProfileSection[];
  missingSections?: ProfileSection[];
  missingFields?: ProfileField[];
  ruleVersion: string;
};

// 两个写入 Service 的返回；CapabilityResult 取自公共契约。
export type ProfileWriteResult = CapabilityResult & {
  domain: "profile";
  data?: {
    fact?: ProfileFactDTO;
    goal?: UserGoalDTO;
  };
};
```

写入结果的公共外层包含 `ok`、`changed`、`domain`、可选的 `entityId/version`、`status`、`summary` 和可选的 `data`。事实写入的 data.fact、目标更新的 data.goal 分别使用上述 DTO。Agent Tool 也使用公共外层，Query Service 则直接返回对应 DTO，具体适配见第四部分。

### 1.4 数据长什么样：一次分区查询的返回示例

调用 `getUserProfile(ctx, { sections: ["availability", "goals"] })` 后，返回示例为：

```json
{
  "ownerId": "user-001",
  "facts": [
    {
      "id": "fact-001",
      "section": "availability",
      "factType": "weekly_time",
      "value": { "hours": 4 },
      "source": "user_input",
      "isConfirmed": true,
      "version": 2,
      "updatedAt": "2026-09-13T08:00:00Z"
    }
  ],
  "goals": [
    {
      "id": "goal-001",
      "goalType": "target_direction",
      "value": { "direction": "后端开发" },
      "version": 1,
      "updatedAt": "2026-09-13T08:00:00Z"
    }
  ],
  "includedSections": ["availability", "goals"],
  "missingFields": []
}
```

### 1.5 其他模块如何接收和解释

| 数据位置 | 接收方处理约定 |
|---|---|
| `facts[]` | 按 factType 查找，不依赖数组顺序；例如 weekly_time 读取 value.hours，兴趣读取 value.items |
| `goals[]` | 读取当前目标方向；空数组表示无当前目标记录，direction 为 null 表示用户明确暂未确定 |
| `includedSections` | 只代表本次查询的分区范围，不能把未查询分区判为信息缺失 |
| `missingFields` | 只标记本次请求分区内未提供的字段；示例中的空数组不表示所有分区都已完善 |
| `source / isConfirmed / evidenceRef` | 区分用户自述、用户确认和证据摘要；用户确认不等于已经通过能力认证 |
| `id / version / updatedAt` | 标识具体事实或目标及其版本；更新时用对应版本，不当成整份画像版本 |
| `percentage / ruleVersion` | 接收 A 计算的完善度及口径版本，不作为职业匹配分数，也不由前端重复计算 |
| `null`、空列表、0 小时 | 分别按契约解释，不能用统一的真假判断把所有空值视为同一种状态 |

以成员 C 读取时间为例：

```ts
const profile = await profileApplication.getUserProfile(ctx, {
  sections: ["availability"],
});
const timeFact = profile?.facts.find(f => f.factType === "weekly_time");
if (timeFact?.factType === "weekly_time") {
  const weeklyHours = timeFact.value.hours; // 0 也是已提供的有效值
  // C 按自身业务规则使用 weeklyHours 安排学习计划。
} else {
  // 信息尚未提供，交由调用流程补充，不擅自填入默认时间。
}
```

## 二、输入约定：Profile 需要其他模块提供什么

### 2.1 按协作方列出的输入清单

| 提供方 | Profile 需要的输入 | 什么时候提供 | 交接入口 |
|---|---|---|---|
| 队长 Agent/Core | 可信用户身份、请求上下文；从用户表达中整理出的画像事实或目标方向 | 用户首次介绍情况、补充信息或修正画像时 | `saveProfileFact` / `updateUserGoal`；Agent 通过第四部分的 Tool 调用 |
| 队长首页/会话 | 可信用户上下文、需要查询的分区或完善度选项 | 首页加载、查看画像或继续对话时 | `getUserProfile` / `getProfileCompletion` |
| B · Career | 用户明确提出的目标方向变化 | 用户确认改变方向时；职业推荐本身不是画像输入 | 由可信调用方调用 `updateUserGoal` |
| C · Learning Plan | 用户明确提出的长期每周时间、兴趣、学习偏好等变化 | 用户修正长期学习条件时；本周临时调整仍由 C 处理 | 由可信调用方调用 `saveProfileFact` |
| D · Evidence & Interview | 与当前基础有关的证据摘要、证据 ID 和评估时间 | 根据阶段测验或成果更新基础画像时按需提供 | D 公开 Service/Query 返回摘要，可信编排层映射成 `saveProfileFact` 命令 |
| 队长 Knowledge | 当前没有必须提供给 Profile 的业务数据 | 用户引用笔记补充个人情况时，由 Agent 按用户输入处理 | 复用 `saveProfileFact`，不传整份知识库 |

**依赖结论：**Profile 基本读写只依赖队长提供的可信上下文和调用入口，不等待 B、C、D 先产出结果。B、C 只在用户画像发生变化时交接相关信息；D 的摘要在能力画像更新场景使用。Profile 不需要接收完整职业规划、学习计划、面试回答或知识库文件。

### 2.2 公共调用上下文

用户身份、会话和请求信息属于可信上下文，不属于模型可填写的业务参数。Tool 适配层从当前请求注入上下文，再调用 Profile Service。

| 调用类型 | 调用方必须提供 | 约定 |
|---|---|---|
| 查询 | `ModuleContext.ownerId`；可选 `sessionId/requestId/signal` | 身份来自可信后台，不能由模型或页面自行指定 |
| 写入 | `DomainCommand.context`、`payload`、`idempotencyKey` | `context` 使用公共 `CapabilityContext`，由可信入口提供真实身份、会话、请求信息和取消信号 |
| 更新已有事实/目标 | `expectedVersion` | 使用上次查询返回的对应实体版本；首次创建可省略 |
| 一次请求中的多个写入 | 每次命令独立且可重试复用的幂等键 | 由可信编排层提供；不能让不同命令共用同一个请求键 |

只有查询上下文的调用方，不自行拼造写入会话信息，应通过队长提供的可信命令入口提交。

### 2.3 查询输入

```ts
export type ProfileSection =
  | "identity" | "background" | "interests"
  | "availability" | "preferences" | "goals";

export type GetUserProfileInput = {
  sections?: ProfileSection[]; // 省略表示全部分区
};

export type GetProfileCompletionInput = {
  includeMissingFields?: boolean; // 默认 true
};
```

| 分区 | 包含内容 |
|---|---|
| `identity` | 学校、专业、年级 |
| `background` | 已学内容、当前基础 |
| `interests` | 兴趣方向 |
| `availability` | 每周通常可投入时间 |
| `preferences` | 学习偏好 |
| `goals` | 当前目标方向 |

### 2.4 画像事实写入输入

每次写入一项事实，`factType` 与 `value` 必须对应：

| factType | value 格式 | 含义 |
|---|---|---|
| `school`、`major`、`grade` | `{ text: string }` | 学校、专业、年级 |
| `learned_content` | `{ items: string[] }` | 已学内容列表 |
| `current_baseline` | `{ summary: string }` | 当前基础描述 |
| `interest_direction` | `{ items: string[] }` | 兴趣方向列表 |
| `weekly_time` | `{ hours: number }` | 每周通常可投入小时数 |
| `learning_preference` | `{ items: string[] }` | 学习偏好列表 |

```ts
export type ProfileFactPayload =
  | { factType: "school" | "major" | "grade"; value: { text: string } }
  | { factType: "learned_content" | "interest_direction" | "learning_preference";
      value: { items: string[] } }
  | { factType: "current_baseline"; value: { summary: string } }
  | { factType: "weekly_time"; value: { hours: number } };

export type EvidenceReference = {
  evidenceId: string;
  evaluatedAt: string; // ISO 8601 时间
};

export type SaveProfileFactInput =
  | (ProfileFactPayload & {
      source: "user_input" | "user_confirmed";
      evidenceRef?: never;
    })
  | {
      factType: "current_baseline";
      value: { summary: string };
      source: "assessment";
      evidenceRef: EvidenceReference;
    };
```

来源必须由可信调用方核验。`user_input` 表示用户直接提供，`user_confirmed` 表示用户确认了整理后的表达，`assessment` 表示来自 D 的证据摘要。模型自行写一个来源值不构成来源证明。

### 2.5 目标方向写入输入

```ts
export type UpdateUserGoalInput = {
  goalType: "target_direction";
  value: { direction: string | null };
};
```

方向可以是“后端开发”“AI 应用”等用户意向；`null` 表示用户明确暂未确定。只有用户表达改变方向时才更新，B 的推荐不自动覆盖用户选择。岗位、企业、匹配结论不进入这个接口。

### 2.6 向 D 索取的摘要格式

```ts
export type ProfileEvidenceSummaryInput = {
  evidenceId: string;
  baselineSummary: string;
  evaluatedAt: string;
};
```

| 对方输出 | Profile 接收后的对应字段 |
|---|---|
| `baselineSummary` | `value.summary` |
| `evidenceId`、`evaluatedAt` | `evidenceRef` |
| 可信 D 查询结果 | `source: "assessment"` |

这是 A 消费证据时需要的最小交接格式。D 的实际 Service 函数名由 D 提供，现有分工中的 `get_skill_evidence` 是能力名称，不在本文假定已有具体函数实现。编排层通过 D 的公开接口取得摘要后再提交给 A；Profile 基本服务不绑定 D 的实现。

无证据时不执行这次画像更新；D 不可用时不覆盖已有基础。原始测验、项目成果和面试记录留在 D。

## 三、输出约定：Profile 需要给其他模块提供什么

### 3.1 按接收方列出的输出清单

| 接收方 | A 提供的内容 | 调用接口/分区 | 用途 |
|---|---|---|---|
| 队长 Agent/Core | 完整或指定分区画像、待补字段、完善度、写入结果 | 全部四个 Service 方法 | 继续询问用户、调用规划能力、解释保存结果 |
| 队长首页聚合/会话 | 身份、兴趣、目标方向及完善度；会话所需的写入摘要 | `getUserProfile`：identity/interests/goals；`getProfileCompletion` | 首页展示、画像提示和会话反馈 |
| B · Career | 学校、专业、年级、已学内容、当前基础、兴趣、每周时间、目标方向 | `getUserProfile`：identity/background/interests/availability/goals | 职业方向、岗位要求与用户差距分析 |
| C · Learning Plan | 已学内容、当前基础、兴趣、每周时间、学习偏好、目标方向 | `getUserProfile`：background/interests/availability/preferences/goals | 制定和调整学习安排 |
| D · Evidence & Interview | 已学内容、当前基础、兴趣、目标方向 | `getUserProfile`：background/interests/goals | 测验或面试练习的用户背景；证据由 D 自己查询 |
| 队长 Knowledge | 基本上传、存储、检索无必需画像输出；个性化使用时可读取基础、兴趣、目标方向 | 按需 `getUserProfile`：background/interests/goals | 为个性化检索提供背景 |

所有接收方使用同一 DTO，按分区取用；不为不同模块维护不同版本的画像。输出保留来源、确认状态、更新时间和版本，供接收方判断信息是否适用。

### 3.2 用户画像返回定义

```ts
export type ProfileFactDTO = SaveProfileFactInput & {
  id: string;
  section: Exclude<ProfileSection, "goals">;
  isConfirmed: boolean;
  version: number;
  updatedAt: string;
};

export type UserGoalDTO = UpdateUserGoalInput & {
  id: string;
  version: number;
  updatedAt: string;
};

export type ProfileField = ProfileFactPayload["factType"] | "target_direction";

export type UserProfileDTO = {
  ownerId: string;
  facts: ProfileFactDTO[];
  goals: UserGoalDTO[]; // 当前 0 或 1 个目标方向
  includedSections: ProfileSection[];
  missingFields: ProfileField[];
};
```

`getUserProfile` 返回上述对象或 `null`。数组中只包含请求分区的数据；每项版本对应自身事实或目标，不是整份画像的总版本。

### 3.3 完善度返回定义

```ts
export type ProfileCompletionDTO = {
  ownerId: string;
  percentage: number; // 0–100
  completedSections: ProfileSection[];
  missingSections?: ProfileSection[];
  missingFields?: ProfileField[];
  ruleVersion: string;
};
```

完善度反映信息提供情况，不代表技能得分或就业匹配度。`includeMissingFields: false` 时不返回两个 missing 字段。内部计算口径见文末补充说明。

### 3.4 写入返回定义

```ts
export type ProfileWriteResult = CapabilityResult & {
  domain: "profile";
  data?: {
    fact?: ProfileFactDTO;
    goal?: UserGoalDTO;
  };
};
```

公共字段沿用工程契约：

| 字段 | A 的返回约定 |
|---|---|
| `ok`、`changed` | 操作是否成功、是否实际改变业务数据 |
| `domain` | 固定 `profile` |
| `entityId`、`version` | 本次操作对应的事实或目标 ID、版本 |
| `status` | 使用公共状态枚举；正常写入为 `applied` |
| `summary` | 对用户可读的结果说明 |
| `data` | 事实写入返回 fact，目标更新返回 goal |

写入成功后，由队长依据结果统一发送 `domain_update`。A 不自行发送 SSE，画像变更也不代表 B 的职业方案或 C 的学习计划已自动修改。

### 3.5 接收方需要遵守的结果语义

| 场景 | 返回/处理约定 |
|---|---|
| 用户没有画像 | 查询返回 `null`；完善度为 0，按选项返回待补项；查询不创建数据 |
| 只查询部分分区 | `includedSections` 明确范围；未请求字段不能被当作缺失 |
| 信息缺失 | 不默认解释成零基础、每周 0 小时或某个职业方向 |
| 更新时版本过期 | `VERSION_CONFLICT`；重新读取再决定更新，不静默覆盖 |
| 同一命令重试 | 重放原结果，不重复写入；同一幂等键不同载荷为 `DUPLICATE_REQUEST` |
| 需确认或被拒绝 | 不作为已生效结果展示，不据此继续执行依赖该更新的步骤 |

## 四、Agent 工具清单：一共提供四个

### 4.1 工具与业务接口一一对应

| Tool 名称 | 类型 | 模型提供的业务输入 | 调用的 Service | 成功时 data |
|---|---|---|---|---|
| `get_user_profile` | Query | `GetUserProfileInput` | `getUserProfile` | `UserProfileDTO \| null` |
| `get_profile_completion` | Query | `GetProfileCompletionInput` | `getProfileCompletion` | `ProfileCompletionDTO` |
| `save_profile_fact` | Command | `SaveProfileFactInput` 和更新时的 `expectedVersion` | `saveProfileFact` | `{ fact: ProfileFactDTO }` |
| `update_user_goal` | Command | `UpdateUserGoalInput` 和更新时的 `expectedVersion` | `updateUserGoal` | `{ goal: UserGoalDTO }` |

这四个工具覆盖学校、专业、年级、已学内容、当前基础、兴趣、时间、偏好、目标方向和完善度；不另外创建“学校工具”“时间工具”等重复能力。

### 4.2 工具调用约定

- Query Tool 将 Service DTO 放进公共 `CapabilityResult.data`，设置 `domain: profile`、`status: read`、`changed: false`。
- Command Tool 将业务输入映射到 `DomainCommand.payload`，将 `expectedVersion` 放到命令顶层；可信上下文和幂等键由编排层提供。
- 模型输入 Schema 不包含 `ownerId`、`sessionId`、`requestId` 或幂等键。来源和证据引用须结合可信调用上下文验证。
- Tool 只适配，不负责业务计算或直接访问数据库。失败统一交给公共错误适配，不能伪造成功结果。

A 向队长交付的工具工厂：

```ts
export function createProfileCapabilities(
  service: ProfileApplication,
): DomainCapability[];
```

每个能力包含 `name`、`description`、`inputSchema`、`execute`。队长负责总注册和 Pi 适配；A 不依赖 Pi SDK。

## 五、数据表清单：共四张，全部由 Profile 拥有

### 5.1 总表

| 表名 | 保存什么 | 为什么需要 |
|---|---|---|
| `profile_facts` | 用户当前画像事实 | 保存基础信息、能力基础、兴趣、时间和偏好 |
| `profile_goals` | 当前目标方向 | 独立维护用户目标，不混入 Career 的岗位/企业数据 |
| `profile_change_log` | 事实和目标变更记录 | 追溯来源、版本与修改前后内容 |
| `profile_command_receipts` | 命令幂等键、请求摘要和返回结果 | 持久化去重和安全重试；仅有变更日志无法完整重放命令结果 |

不单独建画像完善度表、成长空间总表、职业规划表或证据表。完善度计算自现有画像，其他业务数据归各自模块。

### 5.2 表字段与约束

字段使用 PostgreSQL 类型；所有表的 `owner_id` 为 text，承接公共上下文中的字符串身份，不重建用户账号表。时间使用 timestamptz，对外输出 ISO 8601 字符串。

| 表 | 字段 | 主键、唯一性及关系 |
|---|---|---|
| `profile_facts` | `id uuid`、`owner_id text`、`section text`、`fact_type text`、`value_json jsonb`、`source text`、`evidence_ref_json jsonb nullable`、`is_confirmed boolean`、`version integer`、`created_at/updated_at timestamptz` | 主键 id；唯一 `(owner_id, fact_type)`；一类事实保存一个当前值 |
| `profile_goals` | `id uuid`、`owner_id text`、`goal_type text`、`value_json jsonb`、`version integer`、`created_at/updated_at timestamptz` | 主键 id；唯一 `(owner_id, goal_type)`；goal_type 当前仅 target_direction |
| `profile_change_log` | `id uuid`、`owner_id text`、`entity_type text`、`entity_id uuid`、`entity_version integer`、`change_type text`、`request_id text`、`idempotency_key text`、`source text`、`before_json jsonb nullable`、`after_json jsonb`、`created_at timestamptz` | 主键 id；唯一 `(owner_id, entity_type, entity_id, entity_version)`；引用本模块 fact 或 goal |
| `profile_command_receipts` | `owner_id text`、`idempotency_key text`、`command_name text`、`request_id text`、`request_hash text`、`result_json jsonb`、`created_at timestamptz` | 联合主键 `(owner_id, idempotency_key)`；保存完成命令的返回结果 |

常用索引：facts 的 `(owner_id, section)`；change_log 的 `(owner_id, created_at)`。唯一约束已经覆盖目标查询及命令去重路径。

### 5.3 数据库迁移协作

A 只负责提交 Profile 的增量建表 SQL，不直接登录 ECS 或连接生产数据库。迁移文件统一放在仓库的 `src/db/migrations/` 下，并使用递增编号命名，例如 `002-profile.sql`；文件需要可重复执行，默认只新增表、字段和索引，不清空或删除已有数据。

队长负责：

1. 审核并合并各模块的 migration SQL，处理编号冲突；
2. 维护统一的迁移执行器和已执行记录；
3. 在本地或测试数据库验证后随应用部署执行；
4. 处理生产发布、回滚和破坏性变更评审。

队员本地使用本地 PostgreSQL 或测试数据库验证 SQL。合并后的 CI/CD 部署自动执行迁移，队员不需要 ECS 权限，也不接触生产数据库密码。

`evidence_ref_json` 仅保存 D 的证据标识和评估时间，不建立对 D 数据表的跨模块外键。其他模块只能调用 Service，不能直接查询以上表。

## 补充说明：内部定义、实现及联调细节

### A. 内部处理顺序与目录

内部链路为 Service → Repository → PostgreSQL；能力适配器复用该 Service。

```text
src/modules/profile/
  contracts.ts
  service.ts
  repository.ts
  postgres-repository.ts
  capabilities.ts
  migration.sql
  tests/
  README.md
```

A 负责该目录、迁移、业务校验、测试和 README。公共契约、Agent runtime、Tool 总注册、聊天模块、全局 SSE 和最终集成由队长维护。

### B. 字段内部校验与完善度口径

- 字符串去首尾空白后不得为空；列表元素去空白、去重；列表写入表示整体替换，更新前读取原值并带版本。
- 每周时间必须为有限数值，范围 0–168 小时。0 是有效输入，不等于未提供。
- 空列表表示用户明确没有相关内容或尚未确定；方向 null 表示明确暂未确定；未提交字段保持原值。
- `isConfirmed` 表示用户是否确认该条表达，不代表技能被认证。用户直接填写或明确确认可为 true；D 的评估摘要默认 false，用户确认后仍保留 assessment 来源和证据引用。
- 完善度首版口径：按学校、专业、年级、已学内容、当前基础、兴趣、每周时间、学习偏好、目标方向共九项等权计算，已提供项数除以九后四舍五入为整数。用户明确回答的空列表、0 小时和暂未定向均算已提供；未知或未提供不算。ruleVersion 为 `profile-completion-v1`。
- 某分区所有字段均已提供才列入 completedSections；missingFields 列未提供项，missingSections 列仍有未提供项的分区。这是 A 的完善度实现口径，不作为 Career 或 Learning 的开启阈值。

### C. 并发、幂等、来源与错误

写入校验当前 ownerId、输入、状态和版本；首次创建由唯一约束处理并发，已有实体必须校验 expectedVersion。事实或目标变更、对应日志及命令回执在同一事务中提交，失败回滚。相同值的写入不递增版本，changed 为 false。

命令回执去重范围为 ownerId 和 idempotencyKey；request_hash 包含命令名、业务载荷和 expectedVersion，不包含取消信号等运行时对象。重试先读取回执：内容一致重放原结果，内容不同返回 DUPLICATE_REQUEST，不重新执行。重放不再次发布域变更，队长编排层按调用标识去重；不能仅凭重放结果的 changed 再次触发后续动作。

来源、证据归属和用户确认以可信上下文为准，不接受模型冒认身份或评估来源。Profile 保存与查询不得跨用户，日志和回执同样受 ownerId 隔离。

错误限定为公共契约的 NOT_FOUND、FORBIDDEN、INVALID_ARGUMENT、INVALID_STATE、VERSION_CONFLICT、DUPLICATE_REQUEST、CONFIRMATION_REQUIRED、DEPENDENCY_UNAVAILABLE。错误的外层编码由队长统一适配；A 不扩展公共 CapabilityResult 状态枚举。

### D. 跨模块更新边界

- B 给出的职业建议不自动变成用户目标；用户明确采用方向时才写 Profile。岗位、企业数据仍在 Career。
- C 接到“这周只有 4 小时”时处理本期安排；只有通常每周时间被修改，才更新 Profile。
- D 的评估与用户自述须区分；新证据不会自动证明掌握全部技能。Profile 保存摘要和引用，原始证据继续由 D 管理。
- Knowledge 的文档不能自动变成用户已掌握知识。知乎授权、爬取、论坛或外部资料回填不是当前两份文档规定的 Profile 必需依赖。

### E. 联调顺序与检查

```text
用户提供或修正情况
  → 队长注入可信上下文
  → Profile 查询当前数据，提交写入命令
  → A 返回对象 ID、版本及结果
  → 队长按统一协议发送 domain_update
  → 首页/画像页刷新
  → 后续 B、C、D 操作通过 Profile Service 获取最新信息
```

Profile 不自行定义全局事件协议。队长将事实或目标变更映射到公共 resource/change；使用真实 entityId 及对应版本，不用单条事实版本伪装整体画像版本。

交付检查覆盖：画像八类事实与目标方向读写、六个分区查询、完善度、四个工具与 Service 一致、用户隔离、缺失值、版本冲突、并发首建、重复命令、事务失败回滚，以及 B/C/D 的输入输出联调。README 说明模块职责、函数和 Tool 清单、调用示例即可。

## 六、基于 main 分支的项目级增量契约

本节记录 main 分支在本架构文档形成后补充的项目级公共约束和联动设计。它们属于架构文档的增量内容；Profile 原有领域契约、字段、接口和规格仍以本文件前文为准。

### 6.1 公共上下文与能力返回

Profile 不自定义项目级上下文或返回协议，直接使用 main 的公共定义：

```ts
type ModuleContext = {
  ownerId: string;
  sessionId?: string;
  requestId?: string;
  signal?: AbortSignal;
};

type CapabilityContext = ModuleContext & {
  requestId: string;
  operationKey: string;
  sourceMessageId?: string;
  timeZone?: string;
};

type DomainCommand<T> = {
  context: CapabilityContext;
  payload: T;
  expectedVersion?: number;
  idempotencyKey: string;
};

type CapabilityResult<T = unknown> = {
  ok: boolean;
  changed: boolean;
  domain: string;
  entityId?: string;
  version?: number;
  status: "read" | "applied" | "draft_created" | "confirmation_required" | "rejected";
  summary: string;
  data?: T;
  error?: {
    code: "NOT_FOUND" | "FORBIDDEN" | "INVALID_ARGUMENT" | "INVALID_STATE"
      | "VERSION_CONFLICT" | "DUPLICATE_REQUEST" | "CONFIRMATION_REQUIRED"
      | "DEPENDENCY_UNAVAILABLE";
    message: string;
    retryable: boolean;
    fields?: string[];
  };
};
```

`ownerId`、`requestId`、`operationKey`、`sessionId` 和幂等键由可信宿主或 Agent 编排层注入，不能由模型业务参数伪造。Profile 写入结果的 `domain` 固定为 `profile`；不新增公共状态、错误码或全局返回结构。

### 6.2 Agent 统一接入方式

main 的统一 Agent 运行时通过 `DomainCapability` 接收模块能力。Profile 只提供能力工厂，不修改总注册表、Agent Runtime、Pi 适配、聊天模块或全局 SSE：

```ts
createProfileCapabilities(service: ProfileApplication): DomainCapability[]
```

四个工具仍保持架构文档第四部分的名称和职责：`get_user_profile`、`get_profile_completion`、`save_profile_fact`、`update_user_goal`。Query Tool 返回 `status: "read"`、`changed: false`；Command Tool 将业务输入放入 `DomainCommand.payload`，将 `expectedVersion` 和幂等键放在命令层，由 Service 执行业务校验。工具不得直接访问数据库或复制 Profile 业务逻辑。

### 6.3 成长空间统一读写链路

main 将成长空间四个业务域统一纳入 Agent 链路：

```text
首页聊天 → Agent Loop → Profile Tool → Profile Service → Repository/数据库
                                      ↓
                              domain_update → 成长空间页面刷新
```

Profile 页面和首页聚合读取服务端真实数据；保存成功后由队长维护的编排层触发统一刷新事件，Profile 不自行定义全局事件协议。前端不得通过本地计算、默认业务数据或绕过 Agent 的直连接口伪造 Profile 结果。

### 6.4 身份、会话与持久化上下文

main 的服务端身份策略要求：已登录用户优先使用知乎 OAuth `uid`；未登录用户使用服务端生成并持久化的匿名身份。Profile 的所有查询、写入、日志和幂等回执都必须按可信 `ownerId` 隔离，不能仅依赖浏览器传入的用户标识。`sessionId` 用于会话范围，不能替代 Profile 的长期 `ownerId`。

### 6.5 服务端回读与前端联动

Profile 写入成功后，页面应通过主应用已有的成长空间查询链路重新读取 Profile 和完善度，展示服务端回显的事实、目标和缺失项。前端只负责采集、透传、解析 SSE/JSON 和展示，不重复实现 Profile 完善度、版本或状态判断。

### 6.6 与 main 其他模块的联动边界

- Career 负责职业方向、岗位、企业、匹配和差距分析；Profile 只提供画像事实和目标方向。
- Learning 负责学习计划、阶段、任务、反馈和调整；Profile 只提供长期学习条件和偏好。
- Evidence & Interview 负责原始学习记录、成果、测验、证据和面试；Profile 只接收经过可信调用映射的摘要和证据引用。
- Knowledge 负责文档、切分、检索和知识库；知识库内容不能自动写成用户已掌握内容。
- 队长负责 Tool 总注册、Agent Loop、提示词、HTTP、SSE、首页聚合和最终部署。

### 6.7 main 增量后的验证要求

除本文件原有 Profile 验收项外，必须补充验证：公共 `DomainCommand` 和 `CapabilityResult` 兼容、四个 Tool 统一注册可用、可信 owner/session/request 上下文隔离、保存后服务端回读、`domain_update` 后页面刷新，以及不修改队长维护目录。

## 七、外部契约以 main 分支为最终准则

本节为本架构文档的最高优先级解释约定。

### 7.1 外部交互的唯一基准

凡涉及项目外部或跨模块交互的内容，均以当前 `main` 分支实际提供的项目级契约、类型、运行时协议和接口行为为准，包括但不限于：

- `ModuleContext`、`CapabilityContext`、`DomainCommand`、`CapabilityResult`、`DomainCapability`；
- ProfileApplication 的跨模块调用方式；
- Agent Tool 的注册、执行、输入 Schema 和公共返回结构；
- ownerId、sessionId、requestId、operationKey 和幂等键的注入方式；
- 公共错误码、状态枚举、HTTP/SSE/domain_update 联动协议；
- 首页、成长空间和其他模块读取 Profile 的数据交接格式。

架构文档中的外部接口描述如果与当前 main 不一致，代码实现必须服从 main，不得以本架构文档覆盖或修改 main 的公共契约。

### 7.2 架构文档的适用范围

本架构文档继续作为 Profile 的完整业务主线，负责规定：

- Profile 的职责边界；
- 内部领域字段、事实分类和目标语义；
- 画像完善度规则；
- Profile 专属数据表和内部持久化要求；
- 兼容旧调用格式的适配策略；
- 不突破 main 外部契约前提下的内部实现约束。

这些内部设计可以通过兼容层适配到 main 的外部接口，但不得把内部领域结构直接扩展为新的项目级契约。

### 7.3 兼容层原则

当架构文档中的 Profile 领域输入与 main 当前调用格式不一致时：

1. 对外暴露 main 要求的格式；
2. 在 Profile 适配层识别并转换架构文档所需的内部格式；
3. Service 内部使用统一的 Profile 领域模型；
4. 返回结果重新映射为 main 要求的公共结果结构；
5. 兼容层不得改变 main 的字段含义、错误码、状态或调用责任。

### 7.4 变更和审计

每次同步 main 后，必须重新检查 Profile 的外部接口和联动协议。若 main 新增或改变公共契约，先更新本文件的增量说明和兼容策略，再修改代码。未经确认不得把架构文档中的 Profile 专属定义提升为项目级公共契约。
