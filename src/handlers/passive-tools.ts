import type { MessageHandler, SessionContext, HandlerResult } from "../handler.js";
import type { ProcessedMessage } from "../types.js";
import { hasThreads } from "../provider.js";
import { toolState, PASSIVE_TOOLS } from "./tool-state.js";
import { renderToolResultThreadMessages, resultColor, COLOR } from "../discord-renderer.js";
import { truncate, mimeToExt } from "../utils.js";

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

  if (!hasThreads(provider)) {
    // No thread support — inline fallback
    const combinedResult = g.results.map((r) => r.content.trim()).filter((t) => t && t !== "undefined").join("\n");
    const desc = combinedResult
      ? `${icon} ${summary}\n\`\`\`\n${truncate(combinedResult, 3900)}\n\`\`\``
      : `${icon} ${summary}`;
    await provider.send({
      embed: { description: desc, color: resultColor(hasError) },
    });
    return;
  }

  const thread = await provider.createThread(truncate(`${summary} ${icon}`, 100));
  for (const r of g.results) {
    for (const msg of renderToolResultThreadMessages(r.content, r.isError)) {
      await provider.sendToThread(thread, { text: msg.content });
    }
    if (r.images?.length) {
      for (let i = 0; i < r.images.length; i++) {
        const img = r.images[i];
        const ext = mimeToExt(img.mediaType);
        const buf = Buffer.from(img.data, "base64");
        if (buf.length > 8 * 1024 * 1024) continue;
        await provider.sendToThread(thread, {
          files: [{ name: `image-${i + 1}.${ext}`, data: buf }],
        });
      }
    }
  }
  try { await provider.archiveThread(thread); } catch { /* best effort */ }
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

    // Merge into existing group
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

    // Start new group (no inline embed — thread created on close)
    const counts = new Map<string, number>([[name, 1]]);

    toolState.toolUseThreads.set(pm.toolUseId!, {
      thread: null,
      toolName: name,
      content: "",
    });

    toolState.activePassiveGroup = {
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
