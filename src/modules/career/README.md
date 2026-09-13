# Career 模块 Mock MVP

本目录实现 Career 接口文档中的第一版 Mock Application Service，不接真实 API、数据库或用户数据。

## 使用

```ts
import { MockCareerRepository } from "./mock-repository.ts";
import { MockCareerService } from "./service.ts";
import { createMockEvidenceQuery, createMockProfileQuery } from "./mock-dependencies.ts";
import { mockCompanies, mockTrends } from "./mock-data.ts";

const service = new MockCareerService({
  repository: new MockCareerRepository(),
  profileQuery: createMockProfileQuery(),
  evidenceQuery: createMockEvidenceQuery(),
  companies: mockCompanies,
  trends: mockTrends,
});
```

写操作必须携带 `idempotencyKey`，确认规划和选择岗位必须携带 `expectedVersion`。本版本只提供 Service、Mock Repository 和能力工厂，HTTP Handler、真实依赖注入和队长集成由队长负责。
