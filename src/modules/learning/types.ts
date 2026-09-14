import type { DomainCommand, ModuleContext } from "../../contracts/capability.ts";
import type { AdjustPlanInput, CreatePlanInput, FeedbackInput, LearningContext, LearningFeedback, LearningPlan, LearningProgress, LearningResult, LearningStageContext, LearningTask, LearningTaskContext, UpdateTaskInput } from "./contracts.ts";

export interface LearningApplication {
  getActivePlan(ctx: ModuleContext, input: { includeTasks?: boolean }): Promise<LearningPlan | null>;
  listPlans?(ctx: LearningContext): Promise<LearningPlan[]>;
  getTodayTasks(ctx: ModuleContext, input: { date?: string }): Promise<LearningTask[]>;
  getLearningProgress(ctx: ModuleContext, input: { planId?: string }): Promise<LearningProgress | null>;
  createLearningPlan(command: DomainCommand<CreatePlanInput>): Promise<LearningResult<{ plan: LearningPlan }>>;
  updateTaskStatus(command: DomainCommand<UpdateTaskInput>): Promise<LearningResult<{ task: LearningTask }>>;
  recordLearningFeedback(command: DomainCommand<FeedbackInput>): Promise<LearningResult<{ feedback: LearningFeedback }>>;
  adjustLearningPlan(command: DomainCommand<AdjustPlanInput>): Promise<LearningResult<{ plan: LearningPlan; adjustment: AdjustPlanInput }>>;
  confirmLearningPlan(command: DomainCommand<{ planId: string; expectedPlanVersion: number; keepUnfinishedTasks?: boolean }>): Promise<LearningResult<{ plan: LearningPlan }>>;
  getCompletedCapabilityKeys?(ctx: ModuleContext, input: { planId?: string }): Promise<string[]>;
  getTaskContext?(ctx: ModuleContext, input: { taskId: string }): Promise<LearningTaskContext | null>;
  getStageContext?(ctx: ModuleContext, input: { stageId: string }): Promise<LearningStageContext | null>;
}
