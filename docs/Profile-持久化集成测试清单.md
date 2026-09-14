# Profile 持久化集成测试清单

本文档记录 Profile 模块在具备真实 PostgreSQL 和完整项目依赖后的必做验证，不替代单元测试。

## 环境准备

- 安装 `package.json` 中全部依赖。
- 准备独立测试数据库并设置 `DATABASE_URL`。
- 执行迁移，确认 Profile 四张表和唯一约束存在。
- 测试使用专用数据库和测试身份，不连接生产数据库。

## Repository 与事务

- 新建事实、更新事实、新建目标、更新目标均能真实读写。
- `expectedVersion` 正确接受当前版本，过期版本返回 `VERSION_CONFLICT`。
- 首次并发创建同一事实只有一个版本 1 记录。
- 事实/目标写入、`profile_change_log` 和 `profile_command_receipts` 在同一事务中提交。
- 任一 SQL 失败时事务完整回滚，不能留下半条数据、孤立日志或孤立回执。

## 幂等与审计

- 相同 `ownerId + idempotencyKey + requestHash` 重试直接回放原结果。
- 相同幂等键但请求哈希不同返回 `DUPLICATE_REQUEST`。
- 幂等重放不重复递增版本、不重复写日志、不重复发送后续域更新。
- 变更日志包含实体、版本、请求标识、幂等键、来源及前后内容。
- 不同用户使用相同幂等键时互不影响。

## Service、Tool 和 HTTP 联调

- 四个 Profile Tool 均通过统一注册表执行。
- Tool 不暴露或接受 `ownerId`、`requestId`、`operationKey` 等可信字段。
- 保存后 `/api/growth/profile` 返回服务端最新事实、目标和完善度。
- `domain_update` 后画像页面重新读取服务端数据。
- 未登录匿名身份与 OAuth 身份的数据相互隔离。

## 验证命令

```text
npm run typecheck
npm test
node --test --experimental-strip-types src/modules/profile/tests/profile.test.ts
```

集成测试必须记录数据库版本、迁移结果、测试命令和失败日志；未通过时不得提交“已完成”结论。
