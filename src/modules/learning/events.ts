import type { LearningFeedback, LearningPlan, LearningTask } from "./contracts.ts";

export type LearningDomainEventType =
  | "learning.plan.created"
  | "learning.plan.confirmed"
  | "learning.task.updated"
  | "learning.feedback.recorded"
  | "learning.plan.adjusted"
  | "learning.stage.completed";

export type LearningDomainEvent = {
  type: LearningDomainEventType;
  domain: "learning";
  resource: "plan" | "task" | "feedback" | "stage";
  entityId: string;
  ownerId: string;
  version?: number;
  occurredAt: string;
  payload?: Record<string, unknown>;
};

export function planCreatedEvent(plan: LearningPlan): LearningDomainEvent {
  return event("learning.plan.created", "plan", plan.id, plan.ownerId, plan.version, plan.updatedAt, { mode: plan.mode, status: plan.status });
}

export function planConfirmedEvent(plan: LearningPlan): LearningDomainEvent {
  return event("learning.plan.confirmed", "plan", plan.id, plan.ownerId, plan.version, plan.updatedAt, { mode: plan.mode, status: plan.status });
}

export function taskUpdatedEvent(task: LearningTask, ownerId: string, version: number, occurredAt = task.updatedAt ?? new Date().toISOString()): LearningDomainEvent {
  return event("learning.task.updated", "task", task.id, ownerId, version, occurredAt, { planId: task.planId, status: task.status });
}

export function feedbackRecordedEvent(feedback: LearningFeedback): LearningDomainEvent {
  return event("learning.feedback.recorded", "feedback", feedback.id, feedback.ownerId, undefined, feedback.createdAt, { planId: feedback.planId, taskId: feedback.taskId });
}

function event(type: LearningDomainEventType, resource: LearningDomainEvent["resource"], entityId: string, ownerId: string, version: number | undefined, occurredAt: string, payload: Record<string, unknown>): LearningDomainEvent {
  return { type, domain: "learning", resource, entityId, ownerId, version, occurredAt, payload };
}
