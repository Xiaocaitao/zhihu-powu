# Profile 模块

成员 A 负责的用户画像模块，职责、公开接口和边界以项目契约及 Profile 架构文档为准。

## 当前实现

- 九项画像事实与目标方向的读写、分区查询和完善度计算。
- 公共 `CapabilityContext`、`DomainCommand`、`CapabilityResult` 接入。
- 四个 Agent Tool：`get_user_profile`、`get_profile_completion`、`save_profile_fact`、`update_user_goal`。
- 内存 Repository 与 PostgreSQL Repository、Profile 专属迁移及版本冲突校验。
- 输入结构、测评证据引用、空值和目标方向校验。

## 验证

```text
node node_modules/typescript/bin/tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --skipLibCheck --allowImportingTsExtensions src/modules/profile/contracts.ts src/modules/profile/repository.ts src/modules/profile/service.ts src/modules/profile/capabilities.ts
node --test --experimental-strip-types src/modules/profile/tests/profile.test.ts src/modules/profile/tests/request-hash.test.ts
```

当前 Profile 独立类型检查通过，单元测试 19 项全部通过。
