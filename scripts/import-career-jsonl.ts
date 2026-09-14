import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createPool, ensureSchema } from "../src/db/postgres.ts";

const files = process.argv.slice(2);
if (!files.length) throw new Error("用法：node --env-file-if-exists=.env scripts/import-career-jsonl.ts <file.jsonl> [...]");
const pool = createPool(); await ensureSchema(pool);
let jobs = 0, interviews = 0;
try {
  for (const file of files) {
    const sourceFile = resolve(file); const sourceId = sourceFile.split("/").pop() ?? sourceFile;
    for (const line of (await readFile(sourceFile, "utf8")).split(/\r?\n/)) {
      if (!line.trim()) continue;
      const row = JSON.parse(line) as Record<string, unknown>; const content = String(row.content ?? "");
      const hash = createHash("sha256").update(content).digest("hex"); const id = `${sourceId}:${String(row.id ?? hash)}`;
      if (row.record_type === "job") {
        await pool.query(`INSERT INTO career_catalog_jobs (id,source_id,title,company_name,city,employment_type,salary_text,description,requirements,responsibilities,tags,source_url,collected_at,content_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12,$13,$14) ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title,company_name=EXCLUDED.company_name,city=EXCLUDED.city,employment_type=EXCLUDED.employment_type,salary_text=EXCLUDED.salary_text,description=EXCLUDED.description,requirements=EXCLUDED.requirements,responsibilities=EXCLUDED.responsibilities,tags=EXCLUDED.tags,source_url=EXCLUDED.source_url,collected_at=EXCLUDED.collected_at,content_hash=EXCLUDED.content_hash`, [id, String(row.id ?? id), String(row.title ?? ""), row.company_name ?? null, row.city ?? null, row.employment_type ?? null, row.salary_text ?? null, content, JSON.stringify(row.requirements ?? []), JSON.stringify(row.responsibilities ?? []), JSON.stringify(row.tags ?? []), row.source_url ?? null, row.collected_at ?? null, hash]); jobs++;
      } else if (row.record_type === "interview") {
        await pool.query(`INSERT INTO career_catalog_interviews (id,source_id,title,content,company_name,job_title,city,interview_round,result,question_count,tags,source_url,collected_at,content_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14) ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title,content=EXCLUDED.content,company_name=EXCLUDED.company_name,job_title=EXCLUDED.job_title,city=EXCLUDED.city,interview_round=EXCLUDED.interview_round,result=EXCLUDED.result,question_count=EXCLUDED.question_count,tags=EXCLUDED.tags,source_url=EXCLUDED.source_url,collected_at=EXCLUDED.collected_at,content_hash=EXCLUDED.content_hash`, [id, String(row.id ?? id), String(row.title ?? ""), content, row.company_name ?? null, row.job_title ?? null, row.city ?? null, row.interview_round ?? null, row.result ?? null, row.question_count ?? null, JSON.stringify(row.tags ?? []), row.source_url ?? null, row.collected_at ?? null, hash]); interviews++;
      }
    }
  }
  console.log(JSON.stringify({ ok: true, jobs, interviews }));
} finally { await pool.end(); }
