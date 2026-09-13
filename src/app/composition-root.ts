import { CapabilityRegistry, type CapabilityFactory } from "../agent/tools/registry.ts";

/** Assemble module capabilities in one place; modules remain unaware of the Agent runtime. */
export function createCapabilityRegistry(factories: readonly CapabilityFactory[] = []): CapabilityRegistry {
  const registry = new CapabilityRegistry();
  for (const factory of factories) registry.register(factory());
  return registry;
}
