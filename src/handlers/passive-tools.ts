import type { MessageHandler, SessionContext, HandlerResult } from "../handler.js";
import type { ProcessedMessage } from "../types.js";
import type { ProviderMessage } from "../provider.js";
import { hasThreads, editOrSend } from "../provider.js";
import { toolState, PASSIVE_TOOLS, INLINE_RESULT_THRESHOLD } from "./tool-state.js";
import { renderToolResultThreadMessages, resultColor, COLOR } from "../discord-renderer.js";
import { truncate } from "../utils.js";

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

export async function closePassiveGroup(ctx: SessionContext) {
  const g = toolState.activePassiveGroup;
  if (!g) return;
  toolState.activePassiveGroup = null;

  const provider = ctx.provider;
  const summary = passiveGroupSummary(g.counts);
  const hasError = g.results.some((r) => r.isError);
  const icon = hasError ? "❌" : "✅";

  // Combine non-empty results (trim once per entry)
  const trimmedResults = g.results
    .map((r) => r.content.trim())
    .filter((t) => t && t !== "undefined");
  const combinedResult = trimmedResults.join("\n");

  const isShort = combinedResult.length <= INLINE_RESULT_THRESHOLD;

  if (isShort) {
    const desc = combinedResult
      ? `${icon} ${summary}\n\`\`\`\n${combinedResult}\n\`\`\``
      : `${icon} ${summary}`;
    await editOrSend(provider, g.inlineMessage, {
      embed: { description: desc, color: resultColor(hasError) },
    });
  } else if (hasThreads(provider)) {
    // Long → delete inline embed, create thread with full results
    if (g.inlineMessage) {
      try { await provider.delete(g.inlineMessage); } catch { /* already gone */ }
    }

    const thread = await provider.createThread(truncate(`${summary} ${icon}`, 100));
    for (const r of g.results) {
      for (const msg of renderToolResultThreadMessages(r.content, r.isError)) {
        await provider.sendToThread(thread, { text: msg.content });
      }
    }
    try { await provider.archiveThread(thread); } catch { /* best effort */ }
  } else {
    // No thread support — truncate into embed
    const desc = `${icon} ${summary}\n\`\`\`\n${truncate(combinedResult, 3900)}\n\`\`\``;
    await editOrSend(provider, g.inlineMessage, {
      embed: { description: desc, color: resultColor(hasError) },
    });
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

    const name = pm.toolName || "Unknown";

    // Merge into existing group — no API call needed
    if (toolState.activePassiveGroup) {
      const g = toolState.activePassiveGroup;
      g.counts.set(name, (g.counts.get(name) || 0) + 1);
      g.toolUseIds.add(pm.toolUseId!);

      toolState.toolUseThreads.set(pm.toolUseId!, {
        thread: null,
        toolName: name,
        content: "",
      });

      return "consumed";
    }

    // Start new group — send inline embed
    const counts = new Map<string, number>([[name, 1]]);

    let inlineMessage: ProviderMessage | null = null;
    try {
      inlineMessage = await ctx.provider.send({
        embed: {
          description: `⏳ ${passiveGroupSummary(counts)}`,
          color: COLOR.TOOL,
        },
      });
    } catch (err) {
      console.error("[passive-tools] Failed to send inline embed:", err);
    }

    toolState.toolUseThreads.set(pm.toolUseId!, {
      thread: null,
      toolName: name,
      content: "",
    });

    toolState.activePassiveGroup = {
      inlineMessage,
      counts,
      toolUseIds: new Set([pm.toolUseId!]),
      results: [],
    };

    return "consumed";
  }

  destroy() {
    toolState.activePassiveGroup = null;
  }
}
