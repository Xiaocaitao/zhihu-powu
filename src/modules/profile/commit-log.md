# Profile 模块开发更新记录

## 2026-09-13 · A 阶段与首批功能

- 建立 `src/modules/profile/` 模块骨架，固定 `contracts`、`service`、`repository`、PostgreSQL Repository、`capabilities`、测试、README 和更新记录的职责边界。
- 固化 Profile V1 公开契约：六个画像分区、九项画像字段、事实来源与确认状态、证据引用、版本字段，以及 `UserProfileDTO`、`ProfileCompletionDTO`、`ProfileWriteResult` 和输入 Schema。
- 实现 Profile Service 与内存 Repository：支持画像事实和目标方向的按用户读写、用户隔离、完善度查询、版本递增及过期版本拒绝。
- 实现四个 Agent Tool 适配：`get_user_profile`、`get_profile_completion`、`save_profile_fact`、`update_user_goal`；Tool 只负责 Schema 校验和上下文转发，业务逻辑统一由 Service 处理。
- 增加 Profile 专属迁移骨架，包含 `profile_facts`、`profile_goals`、`profile_change_log`、`profile_command_receipts` 四张表及唯一性、版本、幂等所需字段；未建立跨模块外键。
- 同步本地总 HTML 的“画像与职业规划”分支：增加画像完善度、基础画像编辑、目标方向编辑、保存反馈和统一视觉样式；HTML 仅本地交付，不纳入 GitHub 提交。
- 增加单元测试，覆盖画像读写、目标更新、用户隔离、九项完善度计算、版本冲突和四个 Tool 的 Service 委托；类型检查通过，5 项测试全部通过。
- 本阶段提交仅包含 Profile 模块、Profile 专属迁移、必要模块文档和测试；未修改 Agent Runtime、Tool 总注册表、聊天模块、公共契约或其他业务模块。

## 提交记录

- `19a7f1f`：Profile 契约、Service、Repository、Agent 能力适配、迁移骨架及模块文档。
- `788c8a0`：Profile Service 版本校验、单元测试、README 与开发记录更新。
