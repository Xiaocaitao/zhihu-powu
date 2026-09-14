# 成员 A Profile 模块任务文档

依据：工程契约、成长空间模块分工、成员 A Profile 模块架构设计及 Profile AGENTS.md。

## 1. 目标与边界

完成画像与规划业务模块，为 Agent、首页、Career、Learning Plan、Evidence & Interview 提供统一的用户画像、目标方向和完善度能力。Profile 只负责学校、专业、年级、已学内容、当前基础、兴趣、每周可投入时间、学习偏好、目标方向和完善度；不负责职业分析、学习计划、学习记录、证据、面试、知识库、聊天编排或全局事件。

## 2. 实施任务

### A. 准备
- 同步远端并确认分支 test/wzyhhh666。
- 阅读契约、架构文档、AGENTS.md 和现有代码。
- 确认模块目录、迁移目录、README 与 commit log。

### B. 契约与数据
- 固化 V1 九项字段、六个画像分区、目标方向和来源语义。
- 定义 ProfileFactPayload 联合类型、UserProfileDTO、ProfileCompletionDTO、ProfileWriteResult 及输入 Schema。
- 完成 profile_facts、profile_goals、profile_change_log、profile_command_receipts 四张表及增量迁移。

### C. Service 与 Repository
- 实现 getUserProfile、saveProfileFact、updateUserGoal、getProfileCompletion。
- 实现 owner 隔离、权限、输入、版本、幂等、唯一性和事务校验。
- 正确处理空画像、部分分区、缺失字段、版本冲突、重复命令和失败回滚。

### D. Agent 能力
- 在 capabilities.ts 提供 get_user_profile、save_profile_fact、update_user_goal、get_profile_completion。
- Tool 只做 Schema、上下文映射和 Service 调用，不复制业务逻辑。
- 不修改 Agent runtime、总注册表、聊天模块、公共契约或全局 SSE。

### E. 前端同步
- 以 zhihu/docs/破雾 · 个性化学习与就业成长助手.html 为基准。
- 在侧边栏画像与职业规划分支同步实现画像查看、编辑、完善度、缺失信息和状态反馈。
- 每完成一个后端能力，必须有对应可操作 HTML 组件；HTML 只本地交付，不推送云端。

### F. 验证与交付
- 完成类型、Schema、Service、Repository、Tool、迁移、权限隔离、版本冲突、幂等、事务和前端交互测试。
- 更新 README 与模块 commit log，核对暂存差异后提交。
- 提交前再次拉取并安全整合远端，推送 test/wzyhhh666；禁止强制推送。

## 3. 完成标准

四个 Tool 与四个 Service 一一对应；九项字段和目标方向可读写；完善度可查询；四张表迁移可执行；B/C/D/首页无需读表即可调用 Profile；前后端功能闭环且验证通过。

## 4. 依赖顺序

队长提供公共契约和可信上下文 → A 完成画像读写与 Tool 工厂 → B/C/D 通过 Service 查询 → 队长统一发布 profile 域更新并接入首页。
