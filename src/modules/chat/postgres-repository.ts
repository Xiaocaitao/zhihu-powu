import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { ChatError, type ChatStore, type ChatRequest, type SavedRun, type Transcript } from "./contracts.ts";

export class PostgresChatStore implements ChatStore {
  private pool: Pool;
  constructor(pool: Pool) { this.pool = pool; }

  async begin(owner: string, input: ChatRequest) {
    const sessionId = input.session_id ?? randomUUID();
    const db = await this.pool.connect();
    let locked = false;
    const release = async () => {
      try {
        if (locked) await db.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [sessionId]);
        locked = false;
        db.release();
      } catch (error) { db.release(true); throw error; }
    };
    try {
      // One connection per active run. Scale the pool with the admitted concurrency.
      const lock = await db.query("SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked", [sessionId]);
      locked = lock.rows[0].locked;
      if (!locked) throw new ChatError("session_busy", 409);
      if (!input.session_id) await db.query("INSERT INTO chat_sessions (id, owner) VALUES ($1, $2)", [sessionId, owner]);
      const session = await db.query<{ history: Transcript }>("SELECT history FROM chat_sessions WHERE id=$1 AND owner=$2", [sessionId, owner]);
      if (!session.rows[0]) throw new ChatError("session_not_found", 404);
      await db.query("UPDATE chat_runs SET status='interrupted' WHERE session_id=$1 AND status='running'", [sessionId]);
      const inserted = await db.query(
        "INSERT INTO chat_runs (request_id, session_id, message, status) VALUES ($1,$2,$3,'running') ON CONFLICT (request_id) DO NOTHING RETURNING request_id",
        [input.request_id, sessionId, input.message],
      );
      if (!inserted.rowCount) throw new ChatError("duplicate_request", 409);
      return {
        sessionId, history: session.rows[0].history, release,
        finish: async (status, events, history) => {
          await db.query("BEGIN");
          try {
            await db.query("UPDATE chat_runs SET status=$2, events=$3::jsonb WHERE request_id=$1 AND status='running'", [input.request_id, status, JSON.stringify(events)]);
            if (history) await db.query("UPDATE chat_sessions SET history=$2::jsonb WHERE id=$1", [sessionId, JSON.stringify(history)]);
            await db.query("COMMIT");
          } catch (error) { await db.query("ROLLBACK"); throw error; }
        },
      } satisfies Awaited<ReturnType<ChatStore["begin"]>>;
    } catch (error) { await release(); throw error; }
  }

  async get(owner: string, sessionId: string): Promise<SavedRun[] | null> {
    const session = await this.pool.query("SELECT id FROM chat_sessions WHERE id=$1 AND owner=$2", [sessionId, owner]);
    if (!session.rowCount) return null;
    const result = await this.pool.query<SavedRun>("SELECT request_id, message, status, events FROM chat_runs WHERE session_id=$1 ORDER BY created_at, request_id", [sessionId]);
    return result.rows;
  }
}
