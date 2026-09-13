import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { Pool } from "pg";
import type { KnowledgeFile, KnowledgeStore, KnowledgeUpload } from "./contracts.ts";

export class PostgresKnowledgeStore implements KnowledgeStore {
  private readonly pool: Pool;
  private readonly uploadRoot: string;
  constructor(pool: Pool, uploadRoot = process.env.UPLOAD_DIR ?? join(process.cwd(), "uploads")) { this.pool = pool; this.uploadRoot = uploadRoot; }

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
      const result = await this.pool.query<KnowledgeFile>(
        `INSERT INTO knowledge_files (id, owner, original_name, stored_name, mime_type, size_bytes)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING id, original_name, mime_type, size_bytes::int AS size_bytes, '/api/knowledge/files/' || id AS url, created_at::text AS created_at`,
        [id, owner, originalName, storedName, (upload.contentType || "application/octet-stream").split(";", 1)[0].trim().toLowerCase(), upload.data.byteLength],
      );
      return result.rows[0];
    } catch (error) {
      await unlink(path).catch(() => undefined);
      throw error;
    }
  }

  async list(owner: string) {
    const result = await this.pool.query<KnowledgeFile>(
      `SELECT id, original_name, mime_type, size_bytes::int AS size_bytes,
              '/api/knowledge/files/' || id AS url, created_at::text AS created_at
         FROM knowledge_files WHERE owner=$1 ORDER BY created_at DESC`,
      [owner],
    );
    return result.rows;
  }

  async get(owner: string, id: string) {
    const result = await this.pool.query<KnowledgeFile & { stored_name: string }>(
      `SELECT id, original_name, mime_type, size_bytes::int AS size_bytes, stored_name,
              '/api/knowledge/files/' || id AS url, created_at::text AS created_at
         FROM knowledge_files WHERE id=$1 AND owner=$2`,
      [id, owner],
    );
    const file = result.rows[0];
    return file ? { ...file, path: join(this.uploadRoot, owner.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "anonymous", file.stored_name) } : null;
  }
}
