import type { SkillDefinition } from "./contracts.ts";

/**
 * Shared terminology, never user proficiency or a recommended learning plan.
 * Keep IDs stable when adding aliases; material changes require a new revision.
 */
export const initialSkillDefinitions: readonly SkillDefinition[] = [
  { skillId: "skill-http", name: "HTTP", aliases: ["HTTP 协议", "http"], description: "HTTP 请求、响应、方法、状态码与缓存语义。", revision: 1 },
  { skillId: "skill-sql", name: "SQL", aliases: ["结构化查询语言", "sql"], description: "关系数据库的查询、连接、聚合与数据修改语句。", revision: 1 },
  { skillId: "skill-postgresql", name: "PostgreSQL", aliases: ["postgres", "postgresql"], description: "PostgreSQL 的数据建模、事务、查询计划与索引使用。", revision: 1 },
  { skillId: "skill-javascript", name: "JavaScript", aliases: ["js", "javascript"], description: "JavaScript 语言语义、异步控制流与程序组织。", revision: 1 },
  { skillId: "skill-typescript", name: "TypeScript", aliases: ["ts", "typescript"], description: "TypeScript 类型建模、类型检查与 JavaScript 互操作。", revision: 1 },
  { skillId: "skill-python", name: "Python", aliases: ["python"], description: "Python 语言、模块组织与常用数据结构。", revision: 1 },
  { skillId: "skill-git", name: "Git", aliases: ["git", "版本控制"], description: "Git 提交、分支、合并与冲突处理。", revision: 1 },
  { skillId: "skill-testing", name: "软件测试", aliases: ["software testing"], description: "测试用例设计、单元测试、集成测试与缺陷验证。", revision: 1 },
];
