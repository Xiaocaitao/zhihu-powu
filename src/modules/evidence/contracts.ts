import { z } from "zod";

export const contextSchema = z.object({ ownerId: z.string().min(1), requestId: z.string().min(1).optional() });
export type EvidenceContext = z.infer<typeof contextSchema>;
export const recordInputSchema = z.object({ kind: z.enum(["activity", "project_outcome"]), title: z.string().trim().min(1).max(200), content: z.string().trim().min(1).max(20000), occurredAt: z.string().datetime({ offset: true }), durationMinutes: z.number().int().min(0).nullable().optional(), taskId: z.string().min(1).optional(), skillIds: z.array(z.string().min(1)).max(20).optional() }).strict();
export type RecordInput = z.infer<typeof recordInputSchema>;
export type LearningRecord = RecordInput & { recordId: string; ownerId: string; version: number; status: "active" | "withdrawn"; createdAt: string; updatedAt: string };
export type SkillEvidence = { skillId: string; support: "insufficient" | "partial" | "supported"; rationale: string; recordIds: string[] };
export type Interview = { interviewId: string; ownerId: string; target: { kind: "job" | "skills" | "project"; id: string }; status: "active" | "completed" | "ended_early"; totalQuestions: number; answeredCount: number; questions: { questionId: string; ordinal: number; prompt: string }[]; answers: { answerId: string; questionId: string; text: string; feedback?: string }[] };

export type CapabilityResult<T> = { ok: boolean; changed: boolean; domain: "evidence"; entityId?: string; status: "read" | "applied" | "rejected"; summary: string; data?: T; error?: { code: string; message: string } };
