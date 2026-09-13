import { ChatError, type ChatRequest, type ChatRuntime, type ChatStore, type ChatEvent, type Emit } from "./contracts.ts";

export class ChatService {
  private store: ChatStore; private runtime: ChatRuntime;
  constructor(store: ChatStore, runtime: ChatRuntime) { this.store = store; this.runtime = runtime; }

  createSession(owner: string) { return this.store.create(owner); }
  listSessions(owner: string) { return this.store.list(owner); }

  async chat(owner: string, input: ChatRequest, signal: AbortSignal, emit: Emit) {
    const run = await this.store.begin(owner, input);
    const events: ChatEvent[] = [];
    const send: Emit = async event => {
      signal.throwIfAborted();
      events.push(structuredClone(event));
      await emit(event);
    };
    try {
      signal.throwIfAborted();
      if (JSON.stringify(run.history).length > 2_000_000) throw new ChatError("context_limit", 413);
      await send({ type: "session", session_id: run.sessionId, request_id: input.request_id });
      const history = await this.runtime.run({ message: input.message, sessionId: run.sessionId, history: run.history, signal }, send);
      signal.throwIfAborted();
      await run.finish("completed", events, history);
    } catch (error) {
      await run.finish(signal.aborted ? "cancelled" : "failed", events);
      throw error;
    } finally {
      await run.release();
    }
    // A transport error after commit must not change the committed run back to failed.
    await emit({ type: "complete", request_id: input.request_id, session_id: run.sessionId });
  }

  get(owner: string, sessionId: string) { return this.store.get(owner, sessionId); }
}
