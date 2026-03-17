import type { MessageHandler, SessionContext, HandlerResult } from "../handler.js";
import type { ProcessedMessage } from "../types.js";
import { hasThreads } from "../provider.js";
import { toolState } from "./tool-state.js";
import { formatToolInput } from "../format-tool.js";
import { truncate, ID_PREFIX } from "../utils.js";
import { COLOR } from "../discord-renderer.js";

export class ToolUseHandler implements MessageHandler {
  name = "tool-use";
  types = ["tool-use" as const];

  async handle(pm: ProcessedMessage, ctx: SessionContext): Promise<HandlerResult> {
    if (!pm.toolUseId) return "pass";

    const cleanContent = pm.content.replace(/`/g, "");
    const provider = ctx.provider;

    // Cache formatted input for thread context (only shown in thread, not inline)
    const inputMessages = formatToolInput(pm, COLOR.TOOL);

    // Defer thread creation — no inline embed, thread only created if result is long
    toolState.toolUseThreads.set(pm.toolUseId, {
      thread: null,
      toolName: pm.toolName || "Unknown",
      content: cleanContent,
      cachedInput: inputMessages,
    });

    // Permission prompt (only if not in bypass mode)
    if (ctx.permissionMode !== "bypassPermissions" && hasThreads(provider)) {
      const toolUseId = pm.toolUseId;
      const entry = toolState.toolUseThreads.get(toolUseId);
      setTimeout(async () => {
        if (ctx.resolvedToolUseIds.has(toolUseId)) return;
        if (!entry) return;

        // Create thread lazily for permission prompt
        if (!entry.thread) {
          entry.thread = await provider.createThread(
            truncate(`⏳ ${entry.toolName} — ${entry.content}`, 100)
          );
          if (entry.cachedInput) {
            for (const msg of entry.cachedInput) {
              await provider.sendToThread(entry.thread, msg);
            }
            delete entry.cachedInput;
          }
        }

        // Permission prompt as provider-agnostic message
        await provider.sendToThread(entry.thread, {
          embed: {
            title: "⚠️ Permission needed",
            description: `**${entry.toolName}** ${entry.content}`,
            color: COLOR.PERMISSION,
          },
          actions: [
            { id: `${ID_PREFIX.ALLOW}${toolUseId}`, label: "Allow", style: "success" },
            { id: `${ID_PREFIX.DENY}${toolUseId}`, label: "Deny", style: "danger" },
          ],
        });
      }, 5000);
    }

    return "consumed";
  }
}
