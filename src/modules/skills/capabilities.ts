import type { DomainCapability } from "../../contracts/capability.ts";
import { skillListSchema, skillLookupSchema } from "./contracts.ts";
import type { SharedSkills } from "./service.ts";

export function createSkillCapabilities(skills: SharedSkills): DomainCapability[] {
  return [
    {
      name: "resolve_skill_refs",
      description: "按名称、别名或真实标识查询公共能力目录；歧义或未收录时返回候选及限制，不代表用户已掌握。",
      inputSchema: skillLookupSchema,
      execute: async (_ctx, input) => ({
        ok: true, changed: false, domain: "skills", status: "read", summary: "已查询公共能力标识",
        data: { items: await skills.resolve(skillLookupSchema.parse(input).terms) },
      }),
    },
    {
      name: "list_skill_catalog",
      description: "浏览公共能力术语及说明，不生成用户的能力地图或推荐计划。",
      inputSchema: skillListSchema,
      execute: async (_ctx, input) => {
        const filter = skillListSchema.parse(input);
        return { ok: true, changed: false, domain: "skills", status: "read", summary: "已读取公共能力目录",
          data: { items: await skills.list(filter.keyword, filter.limit) } };
      },
    },
  ];
}
