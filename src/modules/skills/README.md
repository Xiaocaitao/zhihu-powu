# Shared Skills

共享能力目录负责稳定的能力 ID、名称、别名和术语说明。Evidence、Career、Learning 等模块引用同一个目录，不在用户页面预设掌握程度或学习路线。

## 已提供接口

- SharedSkills.get(skillIds)：返回真实目录项及 missingIds，不将未知名称当作标识。
- SharedSkills.resolve(terms)：只按名称、ID、精确别名匹配，返回 resolved、ambiguous 或 unresolved。歧义必须由调用方澄清。
- SharedSkills.list(keyword, limit)：浏览目录。
- 主 Agent 工具：resolve_skill_refs、list_skill_catalog，均只读，独立于 Evidence 的 13 项工具。

初始公共术语由 definitions.ts 维护，供团队扩充，不代表用户技能。修改定义保留 skillId，增加 revision；PostgreSQL 安装过程仅插入新定义或升级修订，不降级、删除或重命名既有 ID。

迁移：008-shared-skills.sql。生产启动在迁移后安装目录；内存适配器用于开发和测试。整个模块不读取用户表或其他模块的表。

## 验证

运行 node --test tests/shared-skills.test.ts。设置指向独立测试库的 TEST_DATABASE_URL 后，还会验证 PostgreSQL 安装、重复安装及解析一致性。
