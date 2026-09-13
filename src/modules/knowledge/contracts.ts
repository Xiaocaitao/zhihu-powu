export type KnowledgeUpload = {
  filename: string;
  contentType: string;
  data: Buffer;
};

export type KnowledgeFile = {
  id: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  url: string;
  created_at: string;
  remote_knowledge_base_id?: string | null;
  remote_recall_content_id?: string | null;
  sync_status?: "synced" | "failed";
};

export interface KnowledgeStore {
  save(owner: string, upload: KnowledgeUpload): Promise<KnowledgeFile>;
  list(owner: string): Promise<KnowledgeFile[]>;
  get(owner: string, id: string): Promise<(KnowledgeFile & { path: string }) | null>;
}
