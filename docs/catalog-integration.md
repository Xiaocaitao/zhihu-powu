# 岗位与面经目录服务

## 导入

先准备 `DATABASE_URL`，再执行：

```bash
node --env-file-if-exists=.env scripts/import-career-jsonl.ts \
  docs/成长空间/资料/jobs.jsonl \
  'docs/成长空间/资料/nowcoder_job_descriptions(1).jsonl' \
  docs/成长空间/资料/nowcoder_interviews_20260914_001.jsonl
```

导入脚本会按来源文件和原始记录 ID 区分记录，使用正文哈希做版本更新依据；不会覆盖不同来源的同名面经。

## 查询接口

```text
GET /api/growth/jobs/library?keyword=Java&city=北京&tag=后端&limit=20
GET /api/growth/interviews/library?keyword=Redis&tag=后端&limit=20
```

接口返回 `{ ok: true, items: [...] }`。公共目录数据与用户保存的目标岗位分开存储；收藏动作应继续通过 Career 模块写入 `career_target_jobs`。
