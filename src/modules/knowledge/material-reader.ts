import { createHash } from "node:crypto";
import { lstat, open } from "node:fs/promises";
import type { KnowledgeStore } from "./contracts.ts";

export type MaterialRead = {
  documentId: string;
  state: "available" | "unavailable";
  revision: string | null;
  excerpts: { locator: string; text: string }[];
  reason: string | null;
};

/** Knowledge-owned, read-only access to authorized text materials. Never executes or fetches links. */
export class KnowledgeMaterialReader {
  private readonly store: KnowledgeStore;
  constructor(store: KnowledgeStore) { this.store = store; }

  async read(ownerId: string, documentId: string): Promise<MaterialRead> {
    const unavailable = (reason: string): MaterialRead => ({
      documentId, state: "unavailable", revision: null, excerpts: [], reason,
    });
    const file = await this.store.get(ownerId, documentId);
    if (!file) return unavailable("材料不存在或不可访问");
    const mediaType = file.mime_type.split(";", 1)[0].toLowerCase();
    if (!["text/plain", "text/markdown", "application/json"].includes(mediaType)) {
      return unavailable("当前材料尚无可供引用的文本解析结果");
    }
    try {
      const stat = await lstat(file.path);
      if (!stat.isFile() || stat.isSymbolicLink()) return unavailable("材料存储位置不可读取");
      const handle = await open(file.path, "r");
      try {
        const info = await handle.stat();
        if (!info.isFile() || info.ino !== stat.ino || info.dev !== stat.dev) return unavailable("材料读取期间存储位置发生变化");
        if (info.size > 256 * 1024) return unavailable("材料超过本次读取预算，请提供更小的材料");
        const buffer = Buffer.alloc(256 * 1024 + 1);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        if (bytesRead > 256 * 1024) return unavailable("材料超过本次读取预算，请提供更小的材料");
        if (bytesRead !== info.size) return unavailable("材料读取不完整，请稍后重试");
        const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, bytesRead));
        if (!text.trim() || text.includes("\u0000")) return unavailable("材料没有可引用的 UTF-8 文本");
        if (text.length > 20000) return unavailable("材料文本超过本次评估预算，请指定更小的材料");
        return {
          documentId, state: "available", revision: createHash("sha256").update(text).digest("hex"),
          excerpts: [{ locator: "text:0:" + text.length, text }], reason: null,
        };
      } finally { await handle.close(); }
    } catch { return unavailable("材料暂时不可读取"); }
  }
}
