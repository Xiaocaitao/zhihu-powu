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
};

export interface KnowledgeStore {
  save(owner: string, upload: KnowledgeUpload): Promise<KnowledgeFile>;
  list(owner: string): Promise<KnowledgeFile[]>;
  get(owner: string, id: string): Promise<(KnowledgeFile & { path: string }) | null>;
}
