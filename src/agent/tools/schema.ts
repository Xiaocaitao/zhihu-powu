/**
 * Pi 的工具协议要求标准 JSON Schema。
 * 业务模块为了运行时校验使用 Zod，因此在边界处统一转换，避免把
 * Zod 的内部对象直接暴露给模型，导致模型看见没有参数的 function。
 */
export function toToolSchema(schema: unknown): Record<string, unknown> {
  if (schema && typeof schema === "object" && "toJSONSchema" in schema) {
    const convert = (schema as { toJSONSchema?: (options?: unknown) => unknown }).toJSONSchema;
    if (typeof convert === "function") {
      const converted = convert.call(schema, { target: "draft-07", io: "input" });
      if (converted && typeof converted === "object") return converted as Record<string, unknown>;
    }
  }
  return (schema ?? { type: "object", additionalProperties: false }) as Record<string, unknown>;
}
