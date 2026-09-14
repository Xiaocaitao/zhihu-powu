import { createHash } from "node:crypto";
import type { CareerRepository } from "../modules/career/repository.ts";
import type { LearningRepository } from "../modules/learning/repository.ts";
import type { ProfileApplication } from "../modules/profile/service.ts";
import type { KnowledgeStore } from "../modules/knowledge/contracts.ts";
import { KnowledgeMaterialReader } from "../modules/knowledge/material-reader.ts";
import type { SharedSkills } from "../modules/skills/service.ts";
import { unavailable, type Coverage, type EvidencePorts, type ExternalResult, type SourceChange } from "../modules/evidence/ports.ts";

/** Best-effort task reference from a stored adjustment summary; never invented. */
function taskIdOf(changeSummary: unknown): string | undefined {
  if (!changeSummary || typeof changeSummary !== "object") return undefined;
  const summary = changeSummary as { taskId?: unknown; taskIds?: unknown };
  if (typeof summary.taskId === "string") return summary.taskId;
  if (Array.isArray(summary.taskIds) && typeof summary.taskIds[0] === "string") return summary.taskIds[0];
  return undefined;
}

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
          if (stage) {
            const from = stage.startDate ?? null;
            const to = stage.endDate ?? null;
            return available({
              stageId, title: stage.title, objective: stage.objective, from, to,
              taskIds: stage.tasks.map(task => task.id), revision: String(plan.version),
            }, from && to
              ? complete()
              : { ...complete(), complete: false, missing: [{ source: "learning.stageRange", reason: "阶段没有明确起止日期，需要用户指定复盘范围" }] });
          }
        }
        return unavailable("learning", "在可访问计划中未找到该阶段");
      },
      /**
       * Only confirmed events are surfaced: plan adjustments that Learning
       * already persisted. Task status changes and difficulty feedback are not
       * stored as history there, so the coverage says so instead of guessing.
       */
      async listHistory(ctx, range) {
        const plans = await dependencies.learning.listPlans?.(ctx.ownerId);
        if (!plans) return unavailable("learning.history", "来源未提供计划列表查询，无法读取已确认的计划调整");
        if (!dependencies.learning.listAdjustments) {
          return unavailable("learning.history", "Learning 未提供计划调整历史查询");
        }
        const items: SourceChange[] = [];
        for (const plan of plans) {
          const adjustments = await dependencies.learning.listAdjustments(ctx.ownerId, plan.id);
          for (const adjustment of adjustments) {
            if (adjustment.createdAt < range.from || adjustment.createdAt >= range.to) continue;
            items.push({
              sourceDomain: "learning",
              sourceEventId: adjustment.id,
              sourceEntityId: adjustment.id,
              sourceRevision: adjustment.toVersion,
              occurredAt: adjustment.createdAt,
              kind: "plan_adjustment",
              change: "created",
              snapshot: {
                title: `学习计划调整（${adjustment.trigger}）`,
                content: adjustment.reason,
                taskId: taskIdOf(adjustment.changeSummary),
                skillIds: [],
              },
            });
          }
        }
        items.sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
        return available({ items: items.slice(0, 100), nextCursor: null }, {
          ...complete(), complete: false,
          missing: [{ source: "learning.history", reason: "当前只同步已确认的计划调整；任务状态变化与困难反馈尚未以历史事件形式提供" }],
        });
      },
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
