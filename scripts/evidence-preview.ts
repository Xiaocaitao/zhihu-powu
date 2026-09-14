/**
 * 本地预览学习记录与模拟面试页面：
 *
 *   node scripts/evidence-preview.ts
 *
 * 使用内存仓储与确定性生成器，不连接数据库、不调用模型，
 * 便于在没有模型密钥时核对页面结构、筛选和面试流程。
 * 生产环境仍由 src/server.ts 组装 PostgreSQL 与模型生成端口。
 */
import { createPowuServer } from "../src/server.ts";
import { createDefaultApplications } from "../src/app/composition-root.ts";
import { createEvidencePorts } from "../src/app/evidence-ports.ts";
import { createEvidenceApplication } from "../src/modules/evidence/defaults.ts";
import { GenerationError, MockEvidenceGeneration } from "../src/modules/evidence/generation.ts";
import { MemoryCareerRepository } from "../src/modules/career/repository.ts";
import { MemoryLearningRepository } from "../src/modules/learning/repository.ts";
import { ProfileService } from "../src/modules/profile/service.ts";
import { MemoryProfileRepository } from "../src/modules/profile/repository.ts";
import { SharedSkills } from "../src/modules/skills/service.ts";
import { MemorySkillRepository } from "../src/modules/skills/repository.ts";
import { initialSkillDefinitions } from "../src/modules/skills/definitions.ts";

const port = Number(process.env.PREVIEW_PORT ?? 3100);
const host = process.env.PREVIEW_HOST ?? "127.0.0.1";
// 使用完整默认组装，让岗位下拉（Career）与能力目录（Shared Skills）在预览里也可用。
const career = new MemoryCareerRepository();
const learning = new MemoryLearningRepository();
const profile = new MemoryProfileRepository();
const skills = new SharedSkills(new MemorySkillRepository(initialSkillDefinitions));
const generation = new MockEvidenceGeneration();
if (process.env.PREVIEW_FAIL_FIRST_INTERVIEW === '1') {
  const build = generation.buildInterview.bind(generation);
  let first = true;
  generation.buildInterview = async input => {
    if (first) { first = false; throw new GenerationError('GENERATION_FAILED', '预览故障注入：首次出题失败'); }
    return build(input);
  };
}
const evidence = createEvidenceApplication({ generation, ports: createEvidencePorts({ career, learning, profile: new ProfileService(profile), skills }) });
const applications = createDefaultApplications({ career, learning, profile, skills, evidence });
const server = createPowuServer({ applications });

server.listen(port, host, () => {
  console.log(`学习记录与模拟面试预览：http://${host}:${port}/ （内存数据、模拟生成，仅用于本地测试）`);
});
