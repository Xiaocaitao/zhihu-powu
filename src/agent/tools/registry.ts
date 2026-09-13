import type { CapabilityContext, DomainCapability } from "../../contracts/capability.ts";

export type CapabilityFactory = () => readonly DomainCapability[];

export class CapabilityRegistry {
  private readonly capabilities = new Map<string, DomainCapability>();

  register(capabilities: readonly DomainCapability[]): void {
    for (const capability of capabilities) {
      if (this.capabilities.has(capability.name)) throw new Error(`duplicate capability: ${capability.name}`);
      this.capabilities.set(capability.name, capability);
    }
  }

  list(): DomainCapability[] { return [...this.capabilities.values()]; }

  forContext(_context: CapabilityContext): DomainCapability[] {
    // Authorization is deliberately decided by the trusted composition root.
    return this.list();
  }
}
