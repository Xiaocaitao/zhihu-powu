import type { IndustryTrendDTO, TargetCompanyDTO } from "./contracts.ts";

export const mockTrends: IndustryTrendDTO[] = [
  { directionCode: "backend_engineering", directionName: "后端工程", periodDays: 90, signal: "rising", summary: "服务稳定性与可观测性能力受到更多关注", skillKeywords: ["接口设计", "数据库", "可观测性"] },
  { directionCode: "data_platform", directionName: "数据平台", periodDays: 90, signal: "stable", summary: "数据工程岗位持续重视任务编排和质量治理", skillKeywords: ["Python", "SQL", "数据质量"] },
];

export const mockCompanies: TargetCompanyDTO[] = [
  { id: "company-example-a", name: "示例科技", directionCodes: ["backend_engineering"], cities: ["杭州", "北京"], selectionStatus: "available" },
  { id: "company-example-b", name: "示例数据实验室", directionCodes: ["data_platform"], cities: ["上海"], selectionStatus: "available" },
];
