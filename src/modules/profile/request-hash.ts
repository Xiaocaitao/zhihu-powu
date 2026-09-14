import { createHash } from 'node:crypto';

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonicalize(v)]));
  return value;
}
export function hashProfileCommand(commandName: string, payload: unknown, expectedVersion?: number): string {
  const canonical = JSON.stringify({ commandName, payload: canonicalize(payload), expectedVersion: expectedVersion ?? null });
  return createHash('sha256').update(canonical).digest('hex');
}
