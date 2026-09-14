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

## 2026-09-13 · 写入校验与边界测试

- 为 Profile Service 增加画像事实输入校验：测评来源必须携带证据引用，文本/列表不能为空，每周投入时间不得为负数。
- 扩展边界单元测试，类型检查与 7 项测试全部通过。

## 2026-09-13 · 分区查询与并发边界

- 修正分区查询语义：返回指定分区内容，同时按完整画像计算缺失字段，避免跨模块规划误判画像状态。
- 补充完善度缺失字段隐藏选项和目标方向版本冲突校验。
- 类型检查通过，10 项单元测试全部通过。

## 2026-09-14 · 公共命令契约对齐

- Profile Service 与四个 Agent Tool 统一接入 `CapabilityContext`、`DomainCommand` 和公共 `CapabilityResult`，确保可信 owner/request/operation 上下文由运行时注入。
- Profile 写入校验失败与版本冲突统一返回 `rejected` 结果及标准错误码，避免向 Agent 泄漏未规范化异常。
- 完善度按分区全部字段完成后标记分区完成，目标方向为空时继续计入缺失字段。
- 将旧 Profile 单元测试迁移到公共命令调用方式，10 项测试全部通过。

## 2026-09-14 · PostgreSQL 版本语义与 DTO 映射修正

- PostgreSQL Repository 在携带 `expectedVersion` 时先确认目标记录存在且版本一致，避免不存在记录被错误插入。
- PostgreSQL 返回值显式映射为公共 DTO，去除数据库字段名和内部 `ownerId` 泄漏。
- Profile 独立类型检查与 10 项单元测试全部通过。

## 2026-09-14 · 目标更新输入兼容适配

- 将架构文档规定的 `{ goalType: "target_direction", value: { direction } }` 作为标准目标更新结构。
- 在 Profile Tool 适配层兼容 main 历史调用使用的 `{ direction }`，统一转换后再进入 DomainCommand 和 Service。
- 保持公共 CapabilityResult、可信上下文和版本校验语义不变。
- Profile 独立类型检查通过，10 项单元测试全部通过。

## 2026-09-14 · 事实来源边界校正

- 明确 `assessment` 仅允许写入 `current_baseline`，且必须携带证据引用。
- 拒绝用户输入为其他事实伪造测评来源，拒绝非测评来源携带测评证据引用。
- 新增来源边界测试；Profile 独立类型检查通过，11 项单元测试全部通过。

## 2026-09-14 · 外部查询上下文对齐 main

- Profile 查询接口改用 main 公共 `ModuleContext`，不再要求跨模块调用方提供仅命令侧需要的 `operationKey`。
- 写入命令继续使用 main 的 `CapabilityContext` 与 `DomainCommand`，保持可信上下文和幂等键边界。
- 独立类型检查通过，11 项单元测试全部通过。

## 2026-09-14 · 相同值写入幂等语义

- 写入前比较事实值、来源、确认状态和证据引用；完全相同时返回 `changed: false` 并保持原版本。
- 目标方向相同值更新同样不递增版本。
- 新增兼容性行为由现有 11 项测试覆盖，独立类型检查通过。

## 2026-09-14 · main 同步后的版本稳定回归

- 对照 main `9e3e21f` 未发现新的 Profile 外部契约变化；新增内容主要属于 Learning/Catalog。
- 增加相同事实、相同目标重复提交的版本稳定回归测试。
- Profile 独立类型检查通过，13 项单元测试全部通过。

## 2026-09-14 · 外部命令上下文静态回归

- 新增 Tool 契约测试，验证写入能力透传可信 `ownerId`、`operationKey` 和幂等键。
- 验证业务 payload 与命令上下文分离，防止模型输入伪造身份或幂等信息。
- Profile 独立类型检查通过，14 项单元测试全部通过。

## 2026-09-14 · 完善度规则版本对齐

- 将完善度返回的 `ruleVersion` 从 `v1` 校正为架构文档规定的 `profile-completion-v1`。
- 增加规则版本回归断言；Profile 独立类型检查通过，14 项单元测试全部通过。

## 2026-09-14 · 目标方向 null 完善度语义

- 明确用户提交 `direction: null` 表示已回答但暂未确定，计入画像完善度。
- 增加目标方向空值回归测试；Profile 独立类型检查通过，15 项单元测试全部通过。

## 2026-09-14 · 空画像查询契约对齐

- 无事实和目标记录时，`getUserProfile` 返回 `null`，符合 Profile 架构文档约定。
- 完善度查询在空画像上仍返回 0 和完整缺失字段列表。
- 更新用户隔离与分区查询测试；独立类型检查通过，15 项单元测试全部通过。

## 2026-09-14 · 持久化集成验证基座

- 新增 Profile 持久化集成测试清单，覆盖真实 PostgreSQL 读写、事务回滚、幂等回放、并发和服务端回读。
- 新增 `hashProfileCommand`，按命令名、业务载荷和 expectedVersion 生成稳定 SHA-256 请求摘要。
- 新增命令哈希单元测试；Profile 类型检查通过，16 项测试全部通过。

## 2026-09-14 · 命令幂等回执实现

- Service 写入入口按 `ownerId + idempotencyKey` 查询回执并计算请求哈希。
- 相同请求回放原结果，载荷不同返回 `DUPLICATE_REQUEST`。
- Memory 与 PostgreSQL Repository 均提供回执读写；新增增量迁移补齐命令名和请求 ID 字段。
- Profile 独立类型检查通过，18 项单元测试全部通过。
- PostgreSQL 并发唯一约束、事务回滚和真实数据库集成测试已记录在 `docs/Profile-持久化集成测试清单.md`，待数据库环境执行。
