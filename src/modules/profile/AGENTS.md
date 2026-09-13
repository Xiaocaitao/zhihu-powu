# Profile 模块 AGENTS 规则

适用范围：`src/modules/profile/` 及其测试、迁移、README、commit log 和对应前端组件。每次处理本目录前必须读取并执行。

## 1. 职责与边界

- Profile 负责：学校、专业、年级、已学内容、当前基础、兴趣方向、每周可投入时间、学习偏好、目标方向、画像完善度。
- 不负责 Career、Learning Plan、Evidence & Interview、Knowledge、聊天、Agent Loop、Tool 总注册或全局 SSE 的业务和数据。
- **跨模块只能调用公开 Service/Query，禁止直接读写任何模块数据表。**
- **不得擅自新增或修改架构文档已冻结的字段、接口、数据结构、工具、表和职责边界；变更前须获负责人确认并同步文档。**

## 2. 开发前

每次修改必须按顺序：

1. 检查状态和当前分支。
2. 从 `git@github.com:Xiaocaitao/zhihu-powu.git` 拉取最新代码并安全整合。
3. 存在未知远端提交、冲突或无法安全整合时立即停止，不得覆盖远端。
4. 阅读本规则、Profile 架构文档、README、相关代码和测试，确认影响范围。

**完成同步和现状确认前不得修改代码。**默认开发分支为远程 `dev-wzyhhh666`。所有 Profile 内容只提交并推送到 `dev-wzyhhh666`，**不得合并到 `main`，不得创建或提交 PR**。

## 3. 架构与 Agent 能力

- **Agent Tool 必须调用 Profile Service；禁止复制业务逻辑或直接操作数据库。**
- 遵循工程契约目录：`contracts.ts`、`service.ts`、`repository.ts`、PostgreSQL Repository、`capabilities.ts`、迁移、测试和 README。
- Tool 固定为：`get_user_profile`、`save_profile_fact`、`update_user_goal`、`get_profile_completion`。
- 模块间优先使用 TypeScript Service，不通过 localhost HTTP。
- `ownerId`、`sessionId`、`requestId`、幂等键由可信上下文注入，不得由模型伪造。
- 查询与写入分离；写入使用公共 `DomainCommand<T>`，执行权限、输入、状态、幂等和版本校验。
- 返回遵循公共 `CapabilityResult`，`domain: "profile"`，不得新增公共返回协议或错误码。
- **不得修改 `src/agent/runtime/`、`src/agent/tools/registry.ts`、`src/modules/chat/`、公共契约或全局 SSE；这些由队长维护。**

## 4. 前端同步

- Profile 前端范围是总页面侧边栏的“画像与职业规划”分支。
- **每完成一个后端功能，必须同步在总页面增加或更新对应 HTML 组件和交互；后端完成时前端必须同时可操作。**
- 总页面源码基准：`zhihu/docs/破雾 · 个性化学习与就业成长助手.html`。
- 必须基于该文件修改，遵循现有视觉和交互；组件使用 Profile 对外数据结构，不重复计算完善度、不伪造数据、不绕过后端规则。
- HTML 是本地前端交付物，**不推送到云端**；后端代码与模块文档按正常 Git 流程提交。总页面路径变化时同步更新本规则。

## 5. 提交与推送

- **只提交逻辑闭环、可运行且验证通过的完整功能或修复；半成品、调试代码和未自测代码禁止提交。**
- 单次提交只做一件事，只暂存直接相关文件；遵守 `.gitignore`，禁止提交依赖、产物、密钥、本地配置、数据库文件、编辑器配置和临时文档。
- **只上传 Profile 模块负责的内容：src/modules/profile/、Profile 专属迁移、必要测试及模块文档；其他模块、公共维护目录和无关文件不得暂存或推送。总页面 HTML 仅本地交付，不上传云端。**
- 完整功能必须更新模块 README 和 commit log，记录目的、文件、接口/表变化、验证命令和结果。
- 提交前执行匹配的类型检查、测试和必要集成验证；核对暂存文件及 `git diff --cached`，验证失败不得提交。
- 推送顺序：检查状态 → 更新 README/commit log → 验证 → 暂存并核对 → 本地提交 → 再次拉取并安全整合 → 推送远程 `dev-wzyhhh666`；**不得推送到 `main`，不得合并主分支或创建 PR**。
- **禁止强制推送。**远端未知提交、冲突或推送失败时停止并说明原因与仓库状态。
- 推送成功反馈分支、提交标识和结果；失败反馈原因和当前状态。
- 不用pull也不用拉main，直接推到我自己的dev-wzyhhh666分支。

## 6. 质量与自检

- **禁止脱离既定计划私自修改结构、接口或设计方案。**
- 保持高内聚、低耦合、职责单一和可扩展性，遵循成熟工程实践。
- 新增字段、Tool、表或跨模块依赖前，确认属于 Profile，并同步架构契约、README、迁移和测试。
- 开发前确认已同步远端且改动属于 Profile；提交前确认功能完整、验证通过、文档已更新、无无关或敏感文件、未修改队长维护内容。



- **仅修改本地 HTML 的前端调整不更新、不上传 commit-log.md，也不纳入 GitHub 提交；只有后端功能或模块文档变更才记录提交日志。**
