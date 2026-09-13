# 成员 A Profile 模块规格文档

## 1. 公开 Service

ProfileApplication 提供：getUserProfile(ctx, input)、getProfileCompletion(ctx, input)、saveProfileFact(command)、updateUserGoal(command)。前两项为 Query，后两项为使用公共 DomainCommand 的 Command。

## 2. V1 类型契约

ProfileSection：identity、background、interests、availability、preferences、goals。

ProfileFactPayload：school/major/grade 使用 {text:string}；learned_content/interest_direction/learning_preference 使用 {items:string[]}；current_baseline 使用 {summary:string}；weekly_time 使用 {hours:number}。

目标类型仅为 target_direction，值为 {direction:string|null}。

事实来源为 user_input、user_confirmed 或 assessment；assessment 必须带 evidenceId 和 evaluatedAt。

ProfileFactDTO 在事实值外包含 id、section、source、isConfirmed、evidenceRef、version、updatedAt。

UserGoalDTO 包含 id、goalType、value、version、updatedAt。

UserProfileDTO 包含 ownerId、facts、goals、includedSections、missingFields。

ProfileCompletionDTO 包含 ownerId、percentage、completedSections、missingSections、missingFields、ruleVersion。

ProfileWriteResult 复用公共 CapabilityResult，domain 固定为 profile，data 返回 fact 或 goal。

## 3. 协作输入输出

| 协作方 | Profile 接收 | Profile 输出 |
|---|---|---|
| Agent/Core | 可信上下文、用户整理后的画像事实和目标方向 | UserProfileDTO、ProfileCompletionDTO、ProfileWriteResult |
| Career | 用户明确改变目标方向时的更新命令 | identity、background、interests、availability、goals |
| Learning Plan | 用户明确改变长期时间、兴趣或偏好时的更新命令 | background、interests、availability、preferences、goals |
| Evidence & Interview | 按需提供基础摘要、证据 ID、评估时间 | background、interests、goals |
| 首页聚合 | 查询上下文和分区选择 | 用户摘要、目标方向、完善度 |
| Knowledge | 无必需输入 | 个性化使用时按需读取画像 |

所有接收方按 factType 读取 value，不依赖数组顺序；按 includedSections 判断查询范围；按 source、isConfirmed、version、updatedAt 判断可信度、确认状态和更新条件。

## 4. Agent Tool

- get_user_profile：Query，输入分区选择，返回 UserProfileDTO 或 null。
- get_profile_completion：Query，输入是否返回缺失项，返回 ProfileCompletionDTO。
- save_profile_fact：Command，输入事实类型、对应值、来源和可选证据引用，返回 ProfileWriteResult.data.fact。
- update_user_goal：Command，输入 target_direction 和可选 expectedVersion，返回 ProfileWriteResult.data.goal。

ownerId、sessionId、requestId、幂等键不属于模型业务入参，由可信编排层注入。Tool 必须委托 Profile Service。

## 5. 数据表

| 表 | 作用 | 核心约束 |
|---|---|---|
| profile_facts | 当前画像事实 | owner_id + fact_type 唯一；事实值 JSON；来源、确认状态、版本 |
| profile_goals | 当前目标方向 | owner_id + goal_type 唯一；goal_type 仅 target_direction |
| profile_change_log | 事实和目标变更记录 | owner、实体、实体版本、请求/幂等键和前后摘要 |
| profile_command_receipts | 写入幂等回执 | owner_id + idempotency_key 联合主键；保存请求哈希和结果 |

不建立完善度表、成长空间总表或其他业务域表；不建立跨模块外键。迁移只提交增量 SQL，由队长统一合并执行。

## 6. 统一约定

所有 Query/Command 使用工程契约上下文和返回格式；错误仅使用公共错误语义。写入校验权限、版本和幂等，变更、日志和回执原子提交。写入成功后的 profile domain_update 由队长发送。Career 的岗位企业、Learning 的计划任务、Evidence 的原始证据和 Knowledge 的文档不写入 Profile。

## 7. 前端规格

前端基准为 zhihu/docs/破雾 · 个性化学习与就业成长助手.html，范围为主页面侧边栏画像与职业规划分支。页面使用上述 DTO 展示和编辑画像、完善度及缺失项，不重复计算完善度。后端每完成一个能力必须同步对应可操作组件；HTML 仅本地交付。
