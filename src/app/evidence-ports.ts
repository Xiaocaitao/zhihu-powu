import { createHash } from "node:crypto";
import type { CareerRepository } from "../modules/career/repository.ts";
import type { LearningRepository } from "../modules/learning/repository.ts";
import type { ProfileApplication } from "../modules/profile/service.ts";
import type { KnowledgeStore } from "../modules/knowledge/contracts.ts";
import { KnowledgeMaterialReader } from "../modules/knowledge/material-reader.ts";
import type { SharedSkills } from "../modules/skills/service.ts";
import { unavailable, type Coverage, type EvidencePorts, type ExternalResult } from "../modules/evidence/ports.ts";

const complete = (): Coverage => ({ complete: true, missing: [], observedAt: new Date().toISOString() });
const snapshotRevision = (input: unknown) => createHash("sha256").update(JSON.stringify(input)).digest("hex");
const available = <T>(value: T, coverage = complete()): ExternalResult<T> => ({ value, coverage });

/** Host adapters call source-owned query APIs. No cross-module SQL or guessed history. */
export function createEvidencePorts(dependencies: {
  learning: LearningRepository;
  career: CareerRepository;
  profile: ProfileApplication;
  skills: SharedSkills;
  knowledge?: KnowledgeStore;
}): EvidencePorts {
  return {
    skills: dependencies.skills,
    learning: {
      async getTask(ctx, taskId) {
        const plans = await dependencies.learning.listPlans?.(ctx.ownerId);
        if (!plans) return unavailable("learning", "来源未提供计划列表查询");
        for (const plan of plans) for (const stage of plan.stages) {
          const task = stage.tasks.find(item => item.id === taskId);
          if (task) return available({
            taskId, stageId: stage.id, title: task.title, status: task.status,
            expectedOutcome: task.description, criteria: null, revision: String(plan.version),
          }, { ...complete(), complete: false, missing: [{ source: "learning.criteria", reason: "任务来源尚未提供结构化验收要求" }] });
        }
        return unavailable("learning", "在可访问计划中未找到该任务；当前查询不覆盖归档计划");
      },
      async getStage(ctx, stageId) {
        const plans = await dependencies.learning.listPlans?.(ctx.ownerId);
        if (!plans) return unavailable("learning", "来源未提供计划列表查询");
        for (const plan of plans) {
          const stage = plan.stages.find(item => item.id === stageId);
          if (stage) return available({
            stageId, title: stage.title, objective: stage.objective, from: null, to: null,
            taskIds: stage.tasks.map(task => task.id), revision: String(plan.version),
          }, { ...complete(), complete: false, missing: [{ source: "learning.stageRange", reason: "阶段无明确起止时间，需要用户指定复盘范围" }] });
        }
        return unavailable("learning", "在可访问计划中未找到该阶段");
      },
      async listHistory() { return unavailable("learning.history", "Learning 尚未提供权威历史查询，当前计划状态不能代替历史事件"); },
      async getAssessmentResult() { return unavailable("learning.assessment", "Learning 尚未提供阶段测试结果查询，本模块不发起或重新评分测试"); },
    },
    career: {
      async getJobRequirements(ctx, jobId) {
        const job = await dependencies.career.getJob(ctx.ownerId, jobId);
        if (!job) return unavailable("career", "岗位不存在或不可访问");
        const resolved = await dependencies.skills.resolve(job.requirements.map(item => item.skillCode));
        const skillRefs = resolved.filter(item => item.status === "resolved").flatMap(item => item.candidates);
        const missing = resolved.filter(item => item.status !== "resolved")
          .map(item => ({ source: "skills", reason: "岗位引用的能力尚未统一：" + item.input }));
        if (!job.requirements.length) missing.push({ source: "career", reason: "岗位仅提供原始 JD，尚无结构化能力要求" });
        return available({
          jobId, title: job.title, requirements: job.description, skillRefs,
          revision: snapshotRevision({ description: job.description, requirements: job.requirements }),
        }, { ...complete(), complete: missing.length === 0, missing });
      },
    },
    profile: {
      async getLearningContext(ctx) {
        const profile = await dependencies.profile.getUserProfile(ctx, { sections: ["background", "goals"] });
        if (!profile) return unavailable("profile", "暂无可用学习画像");
        return available({
          baseline: profile.facts.find(item => item.factType === "current_baseline")?.value ?? null,
          goals: profile.goals, timeZone: null,
        }, { ...complete(), complete: false, missing: [{ source: "profile.timeZone", reason: "画像未维护时区，采用宿主可信配置" }] });
      },
    },
    knowledge: {
      async resolveMaterials(ctx, refs) {
        if (!dependencies.knowledge) return unavailable("knowledge", "材料查询服务未配置");
        const reader = new KnowledgeMaterialReader(dependencies.knowledge);
        const value = await Promise.all(refs.map(async reference => {
          if (reference.itemId) return {
            reference, state: "unavailable" as const, revision: null, excerpts: [],
            reason: "当前 Knowledge 尚未提供指定片段查询",
          };
          const content = await reader.read(ctx.ownerId, reference.documentId);
          return { reference, state: content.state, revision: content.revision, excerpts: content.excerpts, reason: content.reason };
        }));
        return available(value, {
          ...complete(), complete: value.every(item => item.state === "available"),
          missing: value.filter(item => item.state !== "available").map(item => ({ source: "knowledge", reason: item.reason ?? "材料不可读取" })),
        });
      },
    },
  };
}
