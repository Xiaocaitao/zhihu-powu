import { z } from "zod";
import type { CapabilityContext } from "../../contracts/capability.ts";

export const chatRequestSchema = z.object({
  message: z.string().min(1).max(32000).refine(value => value.trim().length > 0),
  request_id: z.uuid(),
  session_id: z.uuid().optional(),
  attachments: z.array(z.object({ id: z.uuid(), original_name: z.string(), mime_type: z.string(), size_bytes: z.number().int().nonnegative(), url: z.string(), created_at: z.string(), remote_knowledge_base_id: z.string().nullable().optional(), remote_recall_content_id: z.string().nullable().optional(), sync_status: z.enum(["synced", "failed"]).optional() })).max(10).optional(),
}).strict();
export type ChatRequest = z.infer<typeof chatRequestSchema>;
export type ChatAttachment = NonNullable<ChatRequest["attachments"]>[number];
export type ChatEvent = { type: string; [key: string]: unknown };
export type Emit = (event: ChatEvent) => Promise<void>;
// Transcript is opaque infrastructure data; only the runtime interprets Pi messages.
export type Transcript = object[];
export interface ChatRuntime {
  run(input: { message: string; sessionId: string; history: Transcript; signal: AbortSignal; attachments?: ChatAttachment[]; context?: CapabilityContext }, emit: Emit): Promise<Transcript>;
}
export type RunStatus = "completed" | "failed" | "cancelled" | "interrupted";
export type SavedRun = { request_id: string; message: string; status: string; events: ChatEvent[] };
export type SessionSummary = { session_id: string; created_at: string; message_count: number; preview: string | null };
export interface ChatStore {
  create(owner: string): Promise<{ sessionId: string; createdAt: string }>;
  list(owner: string): Promise<SessionSummary[]>;
  begin(owner: string, input: ChatRequest): Promise<{
    sessionId: string; history: Transcript;
    finish(status: RunStatus, events: ChatEvent[], history?: Transcript): Promise<void>;
    release(): Promise<void>;
  }>;
  get(owner: string, sessionId: string): Promise<SavedRun[] | null>;
}
export class ChatError extends Error {
  status: number;
  constructor(code: string, status = 500) { super(code); this.status = status; }
}
