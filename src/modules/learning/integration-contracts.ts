import type { ModuleContext } from "../../contracts/capability.ts";
import type { AvailableSlot, LearningProgressDTO, LearningStageContext, LearningTaskContext } from "./contracts.ts";

/** Typed boundaries for the services owned by the other module members. */
export interface ProfileApplication {
  getUserProfile(ctx: ModuleContext, input: { version?: number }): Promise<ProfileSnapshot>;
}

export type ProfileSnapshot = {
  profileVersion: number;
  grade: string;
  major: string;
  currentSkills: string[];
  interests: string[];
  weeklyMinutes?: number;
  availableSlots?: AvailableSlot[];
  learningPreference?: string;
};

export interface CareerApplication {
  getCareerPlanSnapshot(ctx: ModuleContext, input: { version?: number }): Promise<CareerPlanSnapshot | null>;
}

export type CareerPlanSnapshot = {
  careerPlanVersion: number;
  targetJobId: string;
  targetRole: string;
  skillGaps: string[];
  prioritySkills: string[];
  recommendedProjects: string[];
  deadline?: string;
};

export interface EvidenceApplication {
  getAssessmentSummary(ctx: ModuleContext, input: { assessmentId: string }): Promise<AssessmentSummary>;
}

export type AssessmentSummary = {
  assessmentId: string;
  stageId: string;
  score: number;
  passed: boolean;
  weakSkills: string[];
  suggestions: string[];
};

export interface LearningProgressQuery {
  getPlanProgress(ctx: ModuleContext, input: { planId?: string }): Promise<LearningProgressDTO>;
  getCompletedCapabilityKeys(ctx: ModuleContext, input: { planId?: string }): Promise<string[]>;
}

export interface LearningContextQuery {
  getTaskContext(ctx: ModuleContext, input: { taskId: string }): Promise<LearningTaskContext | null>;
  getStageContext(ctx: ModuleContext, input: { stageId: string }): Promise<LearningStageContext | null>;
}
