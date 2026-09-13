import type { IncomingMessage, ServerResponse } from "node:http";
import type { CapabilityContext } from "../contracts/capability.ts";

export type ApplicationRoute = {
  method: string;
  pattern: RegExp;
  handle: (input: {
    request: IncomingMessage;
    response: ServerResponse;
    params: Record<string, string>;
    context: CapabilityContext;
  }) => Promise<void> | void;
};

export function matchApplicationRoute(routes: readonly ApplicationRoute[], method: string, path: string) {
  for (const route of routes) {
    if (route.method !== method) continue;
    const match = route.pattern.exec(path);
    if (match) return { route, params: Object.fromEntries(Object.entries(match.groups ?? {})) };
  }
  return null;
}
