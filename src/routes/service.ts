import { routeRequestSchema, type RouteAgent, type RouteDelta, type RouteProgress, type RouteRecord, type RouteRepository } from "./types.ts";

export class RouteService {
  private readonly repository: RouteRepository;
  private readonly agent: RouteAgent;

  constructor(
    repository: RouteRepository,
    agent: RouteAgent,
  ) {
    this.repository = repository;
    this.agent = agent;
  }

  async create(input: unknown, signal?: AbortSignal, onProgress?: (event: RouteProgress) => void, onDelta?: (delta: RouteDelta) => void): Promise<RouteRecord> {
    const request = routeRequestSchema.parse(input);
    const created = await this.repository.createRequest(request);
    onProgress?.({ stage: "request_saved", message: "请求已保存，开始生成路线" });
    try {
      const plan = await this.agent.generate(request, signal, onProgress, onDelta);
      onProgress?.({ stage: "saving", message: "路线已生成，正在保存结果" });
      const record = await this.repository.savePlan(created.id, plan);
      onProgress?.({ stage: "completed", message: "路线生成完成" });
      return record;
    } catch (error) {
      await this.repository.failRequest(created.id, error instanceof Error ? error.message : "route generation failed");
      throw error;
    }
  }

  get(id: string): Promise<RouteRecord | null> {
    return this.repository.get(id);
  }
}
