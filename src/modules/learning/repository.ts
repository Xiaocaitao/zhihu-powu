import { randomUUID } from "node:crypto";
import type { LearningContext, LearningFeedback, LearningPlan, LearningTask } from "./contracts.ts";
export interface LearningRepository { getPlan(ownerId: string, planId?: string): Promise<LearningPlan | null>; listPlans?(ownerId: string): Promise<LearningPlan[]>; savePlan(plan: LearningPlan): Promise<void>; saveFeedback(feedback: LearningFeedback): Promise<void>; }
export class MemoryLearningRepository implements LearningRepository {
  private readonly plans = new Map<string, LearningPlan>(); private readonly feedback = new Map<string, LearningFeedback>();
  async getPlan(ownerId: string, planId?: string) { const plan = planId ? this.plans.get(planId) : [...this.plans.values()].find(x => x.ownerId === ownerId && x.mode === "final" && x.status === "active") ?? [...this.plans.values()].find(x => x.ownerId === ownerId && x.status !== "archived"); return plan?.ownerId === ownerId ? plan : null; }
  async listPlans(ownerId: string) { return [...this.plans.values()].filter(x => x.ownerId === ownerId && x.status !== "archived").sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)); }
  async savePlan(plan: LearningPlan) { this.plans.set(plan.id, plan); }
  async saveFeedback(feedback: LearningFeedback) { this.feedback.set(feedback.id, feedback); }
}
export function taskById(plan: LearningPlan, taskId: string): LearningTask | null { for (const stage of plan.stages) { const task = stage.tasks.find(x => x.id === taskId); if (task) return task; } return null; }
export function newId() { return randomUUID(); }
