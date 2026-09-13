# 云 Agent 助手架构（2026-09-13）

## 需求与边界
废弃固定成长路线接口，改为通用聊天。前端不填默认背景、不识别问候、不生成固定回答；模型自主理解输入、选择工具、决定输出。模型能力通过 runtime 的工具和可信动态上下文扩展。

```text
public/ 展示与 SSE 解析
  -> src/interfaces/http/ HTTP、身份与协议
  -> src/modules/chat/ 会话归属、请求状态、并发、持久化
  -> src/agent/runtime/ Pi 模型 + 工具循环
       -> src/agent/prompts/ 人格与可信上下文
       -> src/agent/tools/ 工具适配与能力授权
       -> src/integrations/zhihu/ 现有外部 API
```

当前由 `server.ts` 负责配置和组装；后续规模扩大时再抽出 `app/`。runtime 不依赖 HTTP/数据库，chat 模块不解析业务 JSON，前端不导入服务端内部模块。

当前目录对应关系：

```text
src/server.ts                         HTTP 路由、SSE、启动组装
src/modules/chat/                     聊天协议、用例、PostgreSQL 会话存储
src/agent/runtime/                    Pi Agent、provider 和流式事件
src/agent/prompts/                    人格提示词与可信上下文注入
src/agent/tools/                      Tool 适配器与能力白名单
src/integrations/zhihu/               知乎 HTTP 客户端和响应协议
src/db/                               连接池、开发建表和迁移文件
public/                               单页聊天界面、SSE 解析、Markdown 展示
```

后续新增代码按这条依赖方向落位：`server -> modules/chat -> agent/runtime -> integrations`；数据库实现只由 `modules/chat` 的 port 使用，runtime 不反向调用 HTTP 或 SQL。

## 本次需求落点
| 需求 | 文件/目录 | 验证 |
|---|---|---|
| 原文透传、通用流式输出 | src/server.ts、src/modules/chat/contracts.ts | 问候与任意文本保持不变；分片早于 complete |
| Pi 自主业务决策 | agent/runtime/pi-chat-runtime.ts、agent/prompts/system.ts | 不强制搜索、没有 RoutePlan；工具循环/多轮 |
| 基础设施 | src/modules/chat/service.ts、postgres-repository.ts、src/db/migrations | 会话隔离、并发冲突、失败/取消状态 |
| 数据展示 | public/index.html、public/assets/marked.umd.js | Markdown 清洗、流式更新、滚动、不混合思考/正文 |
| 配置发布 | app/、Dockerfile、deploy/ | 类型、测试、前后端同镜像 |

## HTTP 契约
POST /api/chat：{ message: string, request_id: UUID, session_id?: UUID }。仅校验协议和资源上限，不添加业务数据。
SSE 事件：session、message_start、text_delta、thinking_delta、content_end、tool_start、tool_update、tool_end、complete、error。
每条助手消息有 message_id，每个内容块有 block_index；工具事件带 tool_call_id。
complete 只确认请求保存完成，不再替换流式正文。error 保留已展示片段但不能标记成功。
GET /api/sessions/:id：仅所属浏览器/身份可读取已保存的用户消息和展示事件。
/api/routes 返回 410，不再提供路线生成。历史路线代码仅保留作迁移参考，不被新应用组装引用；历史数据不删除。

## 基础设施约束
- 新增 chat_sessions、chat_runs 表，版本迁移可重复执行；旧表不动。
- 会话归属优先使用已登录知乎 `uid`，未登录时回退到服务端生成的 HttpOnly SameSite 匿名 Cookie；数据库查询同时限定用户 owner 与 session_id，确保用户隔离和会话隔离。生产需 HTTPS 和上游限流。
- PostgreSQL advisory lock 防止同会话并行运行，request_id 唯一约束防止重复执行。断连/停止/超时传到 Pi 和工具。
- 不自动重跑整轮 Agent 或工具；provider 连接级重试由 Pi SDK 承担并受总超时约束。中途失败保留展示事件，后续上下文只继承已成功的完整 Pi transcript。
- 进程中断后下次获取同会话锁时将遗留 running 请求标记 interrupted；不会静默重放。
- 请求日志只写 request_id、状态、耗时，不记录密钥和整段用户内容。
- 会话上下文上限显式报错，不静默截断或填充。自动压缩和写工具审批 UI 暂不实现。

## 工具与提示词
复用全部 21 个工具的定义、描述和 JSON Schema，通过统一 Pi adapter 接入。
公开 Web 默认只授权 search_zhihu、search_global、get_zhihu_hot_list、ask_zhihu 四个公共能力。模型自主选择，不要求先搜索。
其他能力需要可信宿主按身份显式授权；写工具必须逐调用审批，不能由模型参数自行确认。新增工具不等于自动向匿名用户开放。
人格提示词不包含业务 schema。动态注入函数每轮接收原始消息/会话标识，用于可信服务端上下文；工具返回永远是不可信资料。
thinking 只展示供应商实际返回的内容，不伪造进度或推理。供应商不返回该事件时不显示该区块。

## 发布与回滚
先跑 typecheck、完整测试和本地浏览器 mock 流式验收，再提交 dev-titusliu。commit 标题描述需求，正文列需求、改动、验证、兼容性边界。
部署仍由 main 合并后的工作流触发，不直接更改线上数据库或绕过 PR。
回滚镜像即可恢复旧服务（旧表未删）；新聊天数据保留。跨版本的页面/API 缓存通过 no-store 避免不匹配。
