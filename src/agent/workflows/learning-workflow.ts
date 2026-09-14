export type LearningWorkflowState =
  | "idle"
  | "goal_detected"
  | "researching"
  | "draft_ready"
  | "awaiting_confirmation"
  | "active"
  | "task_completed"
  | "evidence_recorded";

export function deriveLearningWorkflowState(message: string, history: unknown[] = []): LearningWorkflowState {
  const text = message.trim();
  if (/(记录|保存).*(学习经历|学习成果|学习证据)/.test(text)) return "evidence_recorded";
  if (/(完成|做完|学完).*(任务|计划)|实际用时/.test(text)) return "task_completed";
  if (/(确认|同意|激活).*(学习计划|学习规划|该计划)/.test(text)) return "active";
  if (/(草案|试学计划|trial).*(保存|生成)|生成.*(学习计划|试学计划)/.test(text)) return "draft_ready";
  if (history.length > 0 && /(是否执行|是否激活|确认激活|等你确认)/.test(historyText(history))) return "awaiting_confirmation";
  if (/(搜索|知乎|经验|实践)/.test(text) && /(学习|掌握)/.test(text)) return "researching";
  if (/(学习|掌握|想学|我要学)/.test(text)) return "goal_detected";
  return "idle";
}

function historyText(history: unknown[]) {
  return JSON.stringify(history).slice(-12000);
}

export function hasZhihuResearch(history: unknown[]): boolean {
  const text = historyText(history);
  return /search_zhihu|zhuanlan\.zhihu\.com|知乎/.test(text);
}

export function workflowHint(state: LearningWorkflowState): string {
  switch (state) {
    case "goal_detected": return "当前工作流阶段：已识别学习目标。先理解目标和信息缺口，必要时询问；不要自动写入业务数据。";
    case "researching": return "当前工作流阶段：外部经验研究。用户提到知乎/实践经验时可搜索并保留原始来源，搜索本身不激活计划。";
    case "draft_ready": return "当前工作流阶段：学习计划草案。只生成并保存 trial draft，回复草案内容并等待用户决定，不调用激活确认。";
    case "awaiting_confirmation": return "当前工作流阶段：等待用户确认。除非用户明确确认激活，否则不要调用确认或其他写入工具。";
    case "active": return "当前工作流阶段：用户已明确确认激活。读取最新草案版本后再激活，避免使用模型猜测的计划 ID。";
    case "task_completed": return "当前工作流阶段：任务完成回报。先更新任务状态；只有用户同时明确要求保存学习经历时才记录证据。";
    case "evidence_recorded": return "当前工作流阶段：学习证据记录。使用用户提供的活动内容和时间，不补造日期、时长或成果。";
    default: return "当前工作流阶段：普通对话。按用户意图选择是否进入学习工作流。";
  }
}
