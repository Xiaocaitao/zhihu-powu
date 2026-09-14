import { createHash } from 'node:crypto';

/** Stable request digest for Profile command receipt de-duplication. */
export function hashProfileCommand(commandName: string, payload: unknown, expectedVersion?: number): string {
  const canonical = JSON.stringify({ commandName, payload, expectedVersion: expectedVersion ?? null });
  return createHash('sha256').update(canonical).digest('hex');
}
