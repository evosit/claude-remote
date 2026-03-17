import type { MessageHandler, SessionContext, HandlerResult } from "../handler.js";
import type { ProcessedMessage } from "../types.js";
import { hasThreads } from "../provider.js";
import { toolState, INLINE_RESULT_THRESHOLD } from "./tool-state.js";
import { formatToolInput } from "../format-tool.js";
import { renderToolResultThreadMessages } from "../discord-renderer.js";
import { truncate } from "../utils.js";
import { COLOR } from "../discord-renderer.js";

export class ToolResultHandler implements MessageHandler {
  name = "tool-result";
  types = ["tool-result" as const, "tool-result-error" as const];

  async handle(pm: ProcessedMessage, ctx: SessionContext): Promise<HandlerResult> {
    if (!pm.toolUseId) return "pass";

    ctx.resolvedToolUseIds.add(pm.toolUseId);

    // Task tool results handled by TaskHandler
    if (toolState.taskToolUseIds.has(pm.toolUseId)) {
      return "pass"; // Let TaskHandler consume it
    }

    const isError = pm.type === "tool-result-error";
    const entry = toolState.toolUseThreads.get(pm.toolUseId);
    if (!entry) return "consumed"; // Edit/Write or already resolved

    const provider = ctx.provider;

    // Passive group results → always post in thread
    if (toolState.activePassiveGroup && entry.thread &&
        hasThreads(provider) &&
        toolState.activePassiveGroup.thread.id === entry.thread.id) {
      const threadMessages = renderToolResultThreadMessages(pm.content, isError);
      for (const msg of threadMessages) {
        await provider.sendToThread(entry.thread, { text: msg.content });
      }
      toolState.toolUseThreads.delete(pm.toolUseId);
      return "consumed";
    }

    const resultText = pm.content.trim();
    const isEmpty = !resultText || resultText === "undefined";
    const isShort = !isEmpty && resultText.length <= INLINE_RESULT_THRESHOLD;
    const icon = isError ? "❌" : "✅";

    if (isEmpty || isShort) {
      // Short/empty → inline
      if (isEmpty) {
        await provider.send({ text: `${icon} *(no output)*` });
      } else {
        await provider.send({ text: `${icon}\n\`\`\`\n${resultText}\n\`\`\`` });
      }
      // Archive thread if one exists (e.g. permission prompt created it)
      if (entry.thread && hasThreads(provider)) {
        try { await provider.archiveThread(entry.thread); } catch {}
      }
      toolState.toolUseThreads.delete(pm.toolUseId);
    } else if (hasThreads(provider)) {
      // Long result → create thread on demand
      let thread = entry.thread;
      if (!thread) {
        thread = await provider.createThread(truncate(`⏳ ${entry.toolName} — ${entry.content}`, 100));
        entry.thread = thread;
        if (entry.cachedInput) {
          for (const msg of entry.cachedInput) {
            await provider.sendToThread(thread, msg);
          }
          delete entry.cachedInput;
        }
      }

      const threadMessages = renderToolResultThreadMessages(resultText, isError);
      for (const msg of threadMessages) {
        await provider.sendToThread(thread, { text: msg.content });
      }

      toolState.toolUseThreads.delete(pm.toolUseId);

      // Rename and archive if no other tools share this thread
      const sameThread = [...toolState.toolUseThreads.values()].some(
        (e) => e.thread?.id === thread!.id
      );
      if (!sameThread) {
        try { await provider.renameThread(thread, truncate(`${entry.toolName} — ${entry.content} ${icon}`, 100)); } catch {}
        try { await provider.archiveThread(thread); } catch {}
      }
    } else {
      // No thread support — just send inline
      const threadMessages = renderToolResultThreadMessages(resultText, isError);
      for (const msg of threadMessages) {
        await provider.send({ text: msg.content });
      }
      toolState.toolUseThreads.delete(pm.toolUseId);
    }

    return "consumed";
  }
}
