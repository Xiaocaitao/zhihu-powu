import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { openAsBlob } from "node:fs";
import { basename, join } from "node:path";
import type { Pool } from "pg";
import type { KnowledgeFile, KnowledgeStore, KnowledgeUpload } from "./contracts.ts";
import { ZhihuClient } from "../../integrations/zhihu/client.ts";

export class PostgresKnowledgeStore implements KnowledgeStore {
  private readonly pool: Pool;
  private readonly uploadRoot: string;
  private readonly zhihu: ZhihuClient;
  private readonly knowledgeBaseId?: string;
  constructor(pool: Pool, zhihu = new ZhihuClient(), uploadRoot = process.env.UPLOAD_DIR ?? join(process.cwd(), "uploads"), knowledgeBaseId = process.env.ZHIHU_KNOWLEDGE_BASE_ID) { this.pool = pool; this.zhihu = zhihu; this.uploadRoot = uploadRoot; this.knowledgeBaseId = knowledgeBaseId; }

  async save(owner: string, upload: KnowledgeUpload) {
    const id = randomUUID();
    const originalName = basename(upload.filename).replace(/[\u0000-\u001f]/g, "_").slice(0, 180) || "未命名文件";
    const safeOwner = owner.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "anonymous";
    const directory = join(this.uploadRoot, safeOwner);
    const storedName = `${id}-${originalName}`;
    const path = join(directory, storedName);
    await mkdir(directory, { recursive: true });
    await writeFile(path, upload.data, { flag: "wx" });
    try {
      const remote = await this.zhihu.uploadKnowledgeBlob({ blob: await openAsBlob(path), filename: originalName, knowledgeBaseId: this.knowledgeBaseId });
      const result = await this.pool.query<KnowledgeFile>(
        `INSERT INTO knowledge_files (id, owner, original_name, stored_name, mime_type, size_bytes, remote_knowledge_base_id, remote_recall_content_id, sync_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'synced')
         RETURNING id, original_name, mime_type, size_bytes::int AS size_bytes, remote_knowledge_base_id, remote_recall_content_id, sync_status, '/api/knowledge/files/' || id AS url, created_at::text AS created_at`,
        [id, owner, originalName, storedName, (upload.contentType || "application/octet-stream").split(";", 1)[0].trim().toLowerCase(), upload.data.byteLength, remote.data.KnowledgeBaseID, remote.data.RecallContentID],
      );
      return result.rows[0];
    } catch (error) {
      try {
        await this.pool.query(
          `INSERT INTO knowledge_files (id, owner, original_name, stored_name, mime_type, size_bytes, sync_status)
           VALUES ($1,$2,$3,$4,$5,$6,'failed')`,
          [id, owner, originalName, storedName, (upload.contentType || "application/octet-stream").split(";", 1)[0].trim().toLowerCase(), upload.data.byteLength],
        );
      } catch { await unlink(path).catch(() => undefined); }
      throw error;
    }
  }

  async list(owner: string) {
    const result = await this.pool.query<KnowledgeFile>(
      `SELECT id, original_name, mime_type, size_bytes::int AS size_bytes, remote_knowledge_base_id, remote_recall_content_id, sync_status,
              '/api/knowledge/files/' || id AS url, created_at::text AS created_at
         FROM knowledge_files WHERE owner=$1 ORDER BY created_at DESC`,
      [owner],
    );
    return result.rows;
  }

  async get(owner: string, id: string) {
    const result = await this.pool.query<KnowledgeFile & { stored_name: string }>(
      `SELECT id, original_name, mime_type, size_bytes::int AS size_bytes, remote_knowledge_base_id, remote_recall_content_id, sync_status, stored_name,
              '/api/knowledge/files/' || id AS url, created_at::text AS created_at
         FROM knowledge_files WHERE id=$1 AND owner=$2`,
      [id, owner],
    );
    const file = result.rows[0];
    return file ? { ...file, path: join(this.uploadRoot, owner.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "anonymous", file.stored_name) } : null;
  }
}
