import { randomUUID } from "node:crypto";
import type { LearningAdjustment, LearningContext, LearningFeedback, LearningPlan, LearningStageContext, LearningTask, LearningTaskContext } from "./contracts.ts";

export type LearningIdempotencyRecord = { commandName: string; requestHash: string; result: unknown };

export interface LearningRepository {
  getPlan(ownerId: string, planId?: string): Promise<LearningPlan | null>;
  listPlans?(ownerId: string): Promise<LearningPlan[]>;
  savePlan(plan: LearningPlan): Promise<void>;
  saveFeedback(feedback: LearningFeedback): Promise<void>;
  saveAdjustment?(adjustment: LearningAdjustment): Promise<void>;
  listAdjustments?(ownerId: string, planId: string): Promise<LearningAdjustment[]>;
  getIdempotency?(ownerId: string, key: string): Promise<LearningIdempotencyRecord | null>;
  saveIdempotency?(ownerId: string, key: string, record: LearningIdempotencyRecord): Promise<void>;
  savePlanChange?(plan: LearningPlan, adjustment?: LearningAdjustment): Promise<void>;
  savePlanAndFeedback?(plan: LearningPlan, feedback: LearningFeedback): Promise<void>;
  savePlans?(plans: LearningPlan[]): Promise<void>;
}

export class MemoryLearningRepository implements LearningRepository {
  private readonly plans = new Map<string, LearningPlan>();
  private readonly feedback = new Map<string, LearningFeedback>();
  private readonly adjustments = new Map<string, LearningAdjustment[]>();
  private readonly idempotency = new Map<string, LearningIdempotencyRecord>();

  async getPlan(ownerId: string, planId?: string) {
    const plan = planId
      ? this.plans.get(planId)
      : [...this.plans.values()].find(x => x.ownerId === ownerId && x.mode === "final" && x.status === "active")
        ?? [...this.plans.values()].find(x => x.ownerId === ownerId && x.status !== "archived");
    return plan?.ownerId === ownerId ? clone(plan) : null;
  }

  async listPlans(ownerId: string) { return [...this.plans.values()].filter(x => x.ownerId === ownerId && x.status !== "archived").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(clone); }
  async savePlan(plan: LearningPlan) { this.plans.set(plan.id, clone(plan)); }
  async saveFeedback(feedback: LearningFeedback) { this.feedback.set(feedback.id, clone(feedback)); }
  async saveAdjustment(adjustment: LearningAdjustment) { this.adjustments.set(adjustment.planId, [clone(adjustment), ...(this.adjustments.get(adjustment.planId) ?? [])]); }
  async listAdjustments(ownerId: string, planId: string) { return (this.adjustments.get(planId) ?? []).filter(item => item.ownerId === ownerId).map(clone); }
  async getIdempotency(ownerId: string, key: string) { const record = this.idempotency.get(`${ownerId}:${key}`); return record ? clone(record) : null; }
  async saveIdempotency(ownerId: string, key: string, record: LearningIdempotencyRecord) { this.idempotency.set(`${ownerId}:${key}`, clone(record)); }
  async savePlanChange(plan: LearningPlan, adjustment?: LearningAdjustment) { await this.savePlan(plan); if (adjustment) await this.saveAdjustment(adjustment); }
  async savePlanAndFeedback(plan: LearningPlan, feedback: LearningFeedback) { await this.savePlan(plan); await this.saveFeedback(feedback); }
  async savePlans(plans: LearningPlan[]) { for (const plan of plans) await this.savePlan(plan); }
}

export function taskById(plan: LearningPlan, taskId: string): LearningTask | null { for (const stage of plan.stages) { const task = stage.tasks.find(x => x.id === taskId); if (task) return task; } return null; }
export function taskContext(plan: LearningPlan, taskId: string): LearningTaskContext | null { const task = taskById(plan, taskId); if (!task) return null; return { taskId: task.id, planId: plan.id, stageId: task.stageId, title: task.title, capabilityKey: task.capabilityKey, evidenceRequired: task.evidenceRequired }; }
export function stageContext(plan: LearningPlan, stageId: string): LearningStageContext | null { const stage = plan.stages.find(item => item.id === stageId); return stage ? { stageId: stage.id, planId: plan.id, title: stage.title, objective: stage.objective, stageOrder: stage.order } : null; }
export function newId() { return randomUUID(); }
export function clone<T>(value: T): T { return structuredClone(value); }
