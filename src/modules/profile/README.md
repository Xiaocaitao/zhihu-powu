# Profile 模块

本目录为成员 A 负责的 Profile 模块。职责、公开接口、数据结构和边界以 `docs/成员A-Profile模块架构设计.md`、`docs/成员A-Profile模块规格文档.md` 为准。

## 当前实现

- Profile 契约、Service、内存 Repository 与 Agent 能力适配
- Profile 四张表迁移骨架
- 单元测试覆盖画像读写、用户隔离、完善度、版本冲突和 Tool 委托

## 验证

```text
node node_modules/typescript/bin/tsc --noEmit
node --test --experimental-strip-types src/modules/profile/tests/profile.test.ts
```

结果：5 项测试通过。

- Service 写入校验测评来源证据引用、文本/列表非空和每周时间范围。
- 当前单元测试共 7 项通过。

- 分区查询仅裁剪返回事实，缺失字段仍按完整画像计算；支持隐藏缺失字段。
- 目标方向更新支持 expectedVersion 冲突校验；当前单元测试共 10 项通过。

- 本地画像页面补齐已学内容、当前基础和学习偏好字段，前端表单覆盖九项 V1 画像字段。
- 前端将已学内容、当前基础和学习偏好独立为“学习画像”分区，使用宽幅文本框展示。
