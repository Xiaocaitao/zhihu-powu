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

const port = Number(process.env.PREVIEW_PORT ?? 3100);
const host = process.env.PREVIEW_HOST ?? "127.0.0.1";
// 使用完整默认组装，让岗位下拉（Career）与能力目录（Shared Skills）在预览里也可用。
const applications = createDefaultApplications();
const server = createPowuServer({ applications });

server.listen(port, host, () => {
  console.log(`学习记录与模拟面试预览：http://${host}:${port}/learning-platform-prototype.html`);
});
