import { createHash } from "node:crypto";
import { z } from "zod";

const cursorSchema = z.object({ at: z.string().datetime({ offset: true }), id: z.string().uuid(), scope: z.string().length(64) }).strict();
export function scopeHash(ownerId: string, filter: unknown): string {
  return createHash("sha256").update(JSON.stringify([ownerId, filter])).digest("hex");
}
export function decodeCursor(cursor: string) {
  try { return cursorSchema.parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"))); }
  catch { throw new Error("INVALID_ARGUMENT: 分页游标无效"); }
}
export function validateCursor(cursor: string | undefined, scope: string) {
  if (cursor && decodeCursor(cursor).scope !== scope) throw new Error("INVALID_ARGUMENT: 分页游标不属于当前用户或筛选范围");
}
export function encodeCursor(at: string, id: string, scope: string) {
  return Buffer.from(JSON.stringify({ at: new Date(at).toISOString(), id, scope })).toString("base64url");
}

function parts(instant: number, timeZone: string) {
  const result = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(instant);
  const fields = Object.fromEntries(result.map(part => [part.type, part.value]));
  return Date.UTC(Number(fields.year), Number(fields.month) - 1, Number(fields.day), Number(fields.hour), Number(fields.minute), Number(fields.second));
}
function wallToInstant(wall: number, zone: string) {
  let candidate = wall;
  for (let count = 0; count < 5; count++) {
    const delta = wall - parts(candidate, zone);
    if (delta === 0) return new Date(candidate).toISOString();
    candidate += delta;
  }
  throw new Error("INVALID_ARGUMENT: 该时区的本周起点不存在，请指定明确时间范围");
}
/** Compute local Monday boundaries, including DST changes inside the week. */
export function currentWeek(timeZone: string, now = new Date()) {
  const wall = new Date(parts(now.getTime(), timeZone));
  const weekday = (wall.getUTCDay() + 6) % 7;
  const monday = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate() - weekday);
  return { from: wallToInstant(monday, timeZone), to: wallToInstant(monday + 7 * 86400000, timeZone), timeZone };
}
