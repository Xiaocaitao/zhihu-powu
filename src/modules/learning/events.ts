export type LearningDomainEvent = {
  type: "domain_update";
  domain: "learning";
  resource: "plan" | "task" | "feedback" | "stage";
  entity_id: string;
  version?: number;
  change: "created" | "confirmed" | "updated" | "recorded" | "adjusted" | "completed";
};

export function learningDomainEvent(resource: LearningDomainEvent["resource"], entityId: string, change: LearningDomainEvent["change"], version?: number): LearningDomainEvent {
  return { type: "domain_update", domain: "learning", resource, entity_id: entityId, version, change };
}
