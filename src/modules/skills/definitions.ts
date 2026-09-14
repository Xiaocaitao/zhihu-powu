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
  { skillId: "skill-user-research", name: "用户研究", aliases: ["user_research", "user research"], description: "通过访谈、观察与行为数据识别用户需求，并验证研究结论。", revision: 1 },
  { skillId: "skill-ai-product-design", name: "AI 产品设计", aliases: ["ai_product_design", "AI产品设计"], description: "围绕用户需求设计 AI 功能、交互、效果评价与失败处理。", revision: 1 },
  { skillId: "skill-product-iteration", name: "产品迭代", aliases: ["product_iteration", "product iteration"], description: "根据用户反馈、行为指标与实验结果确定并验证产品改进。", revision: 1 },
  { skillId: "skill-communication", name: "沟通表达", aliases: ["communication", "沟通能力"], description: "清晰说明观点与依据，理解反馈并与协作者达成共识。", revision: 1 },
  { skillId: "skill-llm", name: "大语言模型", aliases: ["llm", "large language model", "大模型"], description: "理解大语言模型的基本原理、能力边界及产品应用中的评价方法。", revision: 1 },
  { skillId: "skill-ai-product-experience", name: "AI 产品实践", aliases: ["ai_product_experience", "AI产品经验"], description: "在真实 AI 产品实践中说明本人职责、实施过程、验证结果与反思；岗位要求本身不证明已有经验。", revision: 1 },
];
