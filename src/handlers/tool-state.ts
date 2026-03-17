import type { ProviderMessage, ProviderThread, OutgoingMessage } from "../provider.js";

// ── Task types ──

export interface TaskInfo {
  id: string;
  subject: string;
  status: "pending" | "in_progress" | "completed" | "deleted";
}

// ── Tool thread entry ──

export interface ToolEntry {
  thread: ProviderThread | null;
  toolName: string;
  content: string;
  cachedInput?: OutgoingMessage[];
}

// ── Shared mutable state for tool-related handlers ──

export const toolState = {
  /** toolUseId → thread/tool info */
  toolUseThreads: new Map<string, ToolEntry>(),

  /** Active passive tool group (Read/Grep/Glob) */
  activePassiveGroup: null as {
    thread: ProviderThread;
    counts: Map<string, number>;
    toolUseIds: string[];
  } | null,

  /** Task tool tracking */
  taskToolUseIds: new Set<string>(),
  taskCreateTempIds: new Map<string, string>(),
  taskMap: new Map<string, TaskInfo>(),
  taskPinnedMessage: null as ProviderMessage | null,
};

export const INLINE_RESULT_THRESHOLD = 400;
export const PASSIVE_TOOLS = new Set(["Read", "Grep", "Glob"]);
export const TASK_TOOLS = new Set(["TaskCreate", "TaskUpdate", "TaskList", "TaskGet"]);
