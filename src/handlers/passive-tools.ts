import type { MessageHandler, SessionContext, HandlerResult } from "../handler.js";
import type { ProcessedMessage } from "../types.js";
import type { ProviderThread } from "../provider.js";
import { hasThreads } from "../provider.js";
import { toolState, PASSIVE_TOOLS } from "./tool-state.js";
import { formatToolInput } from "../format-tool.js";
import { truncate } from "../utils.js";
import { COLOR } from "../discord-renderer.js";

function isPassiveToolUse(pm: ProcessedMessage): boolean {
  return pm.type === "tool-use" && !!pm.toolUseId && PASSIVE_TOOLS.has(pm.toolName || "");
}

function passiveGroupSummary(counts: Map<string, number>): string {
  const labels: Record<string, string> = { Read: "file", Grep: "pattern", Glob: "pattern" };
  const parts = [...counts.entries()].map(([name, count]) => {
    const noun = labels[name] || "call";
    return `${name} ${count} ${noun}${count > 1 ? "s" : ""}`;
  });
  return parts.join(", ");
}

async function sendToolInput(ctx: SessionContext, thread: ProviderThread, pm: ProcessedMessage) {
  const provider = ctx.provider;
  if (!hasThreads(provider)) return;
  for (const msg of formatToolInput(pm, COLOR.TOOL)) {
    await provider.sendToThread(thread, msg);
  }
}

export async function closePassiveGroup(ctx: SessionContext) {
  const g = toolState.activePassiveGroup;
  if (!g) return;
  toolState.activePassiveGroup = null;

  const provider = ctx.provider;
  if (!hasThreads(provider)) return;

  try {
    const summary = passiveGroupSummary(g.counts);
    await provider.renameThread(g.thread, truncate(`${summary} ✅`, 100));
  } catch { /* rate limited */ }

  const hasUnresolved = g.toolUseIds.some((id) => !ctx.resolvedToolUseIds.has(id));
  if (!hasUnresolved) {
    try { await provider.archiveThread(g.thread); } catch { /* best effort */ }
  }
}

export class PassiveToolHandler implements MessageHandler {
  name = "passive-tools";
  types = ["tool-use" as const];

  async handle(pm: ProcessedMessage, ctx: SessionContext): Promise<HandlerResult> {
    if (!isPassiveToolUse(pm)) {
      await closePassiveGroup(ctx);
      return "pass";
    }

    const provider = ctx.provider;
    if (!hasThreads(provider)) return "pass";

    const name = pm.toolName || "Unknown";

    // Merge into existing group (no rename — Discord limits to 2 renames/10min per thread)
    if (toolState.activePassiveGroup) {
      const g = toolState.activePassiveGroup;
      g.counts.set(name, (g.counts.get(name) || 0) + 1);
      g.toolUseIds.push(pm.toolUseId!);

      const summary = passiveGroupSummary(g.counts);
      toolState.toolUseThreads.set(pm.toolUseId!, {
        thread: g.thread,
        toolName: name,
        content: summary,
      });

      await sendToolInput(ctx, g.thread, pm);
      return "consumed";
    }

    // Start new group
    const counts = new Map<string, number>([[name, 1]]);
    const summary = passiveGroupSummary(counts);

    try {
      const thread = await provider.createThread(truncate(`⏳ ${summary}`, 100));

      toolState.toolUseThreads.set(pm.toolUseId!, {
        thread,
        toolName: name,
        content: summary,
      });

      toolState.activePassiveGroup = {
        thread,
        counts,
        toolUseIds: [pm.toolUseId!],
      };

      await sendToolInput(ctx, thread, pm);
    } catch (err) {
      console.error("[passive-tools] Failed to create thread:", err);
    }

    return "consumed";
  }

  destroy() {
    toolState.activePassiveGroup = null;
  }
}
