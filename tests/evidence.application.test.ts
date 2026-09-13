import test from "node:test";
import assert from "node:assert/strict";
import { EvidenceApplication } from "../src/modules/evidence/application.ts";
import { EvidenceService } from "../src/modules/evidence/service.ts";
import type { EvidenceRepository } from "../src/modules/evidence/repository.ts";

test("应用层写入会委托到仓储并保留业务结果", async () => { const saved: string[] = []; const repo: EvidenceRepository = { createRecord: async r => void saved.push(r.recordId), getRecord: async () => null, listRecords: async () => [], updateRecord: async () => {}, saveAssessment: async () => {}, saveReview: async () => {}, saveInterview: async () => {}, getInterview: async () => null }; const app = new EvidenceApplication(new EvidenceService(), repo); const result = await app.recordLearningEvidence({ ownerId: "owner" }, { kind: "activity", title: "学习", content: "完成练习", occurredAt: "2026-09-13T10:00:00+08:00" }); assert.equal(result.ok, true); assert.equal(saved.length, 1); });
