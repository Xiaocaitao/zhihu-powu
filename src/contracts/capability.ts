/** Shared boundary between business modules, HTTP handlers and Agent tools. */
export type ModuleContext = {
  ownerId: string;
  sessionId?: string;
  requestId?: string;
  signal?: AbortSignal;
};

export type CapabilityContext = ModuleContext & {
  requestId: string;
  operationKey: string;
  sourceMessageId?: string;
  timeZone?: string;
};

export type DomainCommand<T> = {
  context: CapabilityContext;
  payload: T;
  expectedVersion?: number;
  idempotencyKey: string;
};

export type CapabilityErrorCode =
  | "NOT_FOUND" | "FORBIDDEN" | "INVALID_ARGUMENT" | "INVALID_STATE"
  | "VERSION_CONFLICT" | "DUPLICATE_REQUEST" | "CONFIRMATION_REQUIRED"
  | "DEPENDENCY_UNAVAILABLE";

export type CapabilityResult<T = unknown> = {
  ok: boolean;
  changed: boolean;
  domain: string;
  entityId?: string;
  version?: number;
  status: "read" | "applied" | "draft_created" | "confirmation_required" | "rejected";
  summary: string;
  data?: T;
  error?: { code: CapabilityErrorCode; message: string; retryable: boolean; fields?: string[] };
};

export type DomainCapability = {
  name: string;
  description: string;
  inputSchema: unknown;
  execute: (ctx: CapabilityContext, input: unknown) => Promise<CapabilityResult>;
  requiresConfirmation?: boolean;
};
