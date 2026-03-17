import type { MessageHandler, SessionContext, HandlerResult } from "../handler.js";
import type { ProcessedMessage } from "../types.js";
import type { ProviderThread } from "../provider.js";
import { hasThreads } from "../provider.js";
import { toolState, INLINE_RESULT_THRESHOLD } from "./tool-state.js";
import { renderToolResultThreadMessages, COLOR } from "../discord-renderer.js";
import { truncate } from "../utils.js";

/** Send result content to a thread */
async function sendResultToThread(
  ctx: SessionContext,
  thread: ProviderThread,
  content: string,
  isError: boolean,
) {
  const provider = ctx.provider;
  if (!hasThreads(provider)) return;
  for (const msg of renderToolResultThreadMessages(content, isError)) {
    await provider.sendToThread(thread, { text: msg.content });
  }
}

/** Rename thread with result icon and archive it */
async function finalizeThread(
  ctx: SessionContext,
  thread: ProviderThread,
  toolName: string,
  content: string,
  icon: string,
) {
  const provider = ctx.provider;
  if (!hasThreads(provider)) return;
  try { await provider.renameThread(thread, truncate(`${toolName} — ${content} ${icon}`, 100)); } catch {}
  try { await provider.archiveThread(thread); } catch {}
}

export class ToolResultHandler implements MessageHandler {
  name = "tool-result";
  types = ["tool-result" as const, "tool-result-error" as const];

  async handle(pm: ProcessedMessage, ctx: SessionContext): Promise<HandlerResult> {
    if (!pm.toolUseId) return "pass";

    ctx.resolvedToolUseIds.add(pm.toolUseId);

    // Clean up progress timer
    await toolState.cleanupProgress(pm.toolUseId, ctx.provider);

    // Task tool results handled by TaskHandler
    if (toolState.taskToolUseIds.has(pm.toolUseId)) {
      return "pass";
    }

    const isError = pm.type === "tool-result-error";
    const entry = toolState.toolUseThreads.get(pm.toolUseId);
    if (!entry) return "consumed"; // Edit/Write or already resolved

    const provider = ctx.provider;
    const icon = isError ? "❌" : "✅";
    const label = `**${entry.toolName}** — \`${truncate(entry.content, 80)}\``;

    // Passive group results → send to group thread, don't close group
    // Group is closed by idle callback, DefaultHandler, or non-passive tool-use
    const group = toolState.activePassiveGroup;
    if (group && entry.thread &&
        hasThreads(provider) &&
        group.thread.id === entry.thread.id) {
      try {
        await sendResultToThread(ctx, entry.thread, pm.content, isError);
      } catch { /* best effort */ }
      toolState.toolUseThreads.delete(pm.toolUseId);
      return "consumed";
    }

    const resultText = pm.content.trim();
    const isEmpty = !resultText || resultText === "undefined";
    const isShort = !isEmpty && resultText.length <= INLINE_RESULT_THRESHOLD;

    // Already escalated to thread → put result there, no inline
    if (entry.thread && hasThreads(provider)) {
      await sendResultToThread(ctx, entry.thread, resultText, isError);
      toolState.toolUseThreads.delete(pm.toolUseId);

      // Rename and archive if no other tools share this thread
      const sameThread = [...toolState.toolUseThreads.values()].some(
        (e) => e.thread?.id === entry.thread!.id
      );
      if (!sameThread) {
        await finalizeThread(ctx, entry.thread, entry.toolName, entry.content, icon);
      }
      return "consumed";
    }

    // No thread yet — result came fast
    if (isEmpty || isShort) {
      // Short/empty → inline embed with tool name
      const desc = isEmpty
        ? `${icon} ${label} *(no output)*`
        : `${icon} ${label}\n\`\`\`\n${resultText}\n\`\`\``;
      await provider.send({ embed: { description: desc, color: isError ? 0xed4245 : COLOR.TOOL_OK } });
      toolState.toolUseThreads.delete(pm.toolUseId);
    } else if (hasThreads(provider)) {
      // Long result, no thread yet → create thread (no inline)
      const thread = await provider.createThread(
        truncate(`⏳ ${entry.toolName} — ${entry.content}`, 100)
      );
      if (entry.cachedInput) {
        for (const msg of entry.cachedInput) {
          await provider.sendToThread(thread, msg);
        }
      }

      await sendResultToThread(ctx, thread, resultText, isError);
      await finalizeThread(ctx, thread, entry.toolName, entry.content, icon);
      toolState.toolUseThreads.delete(pm.toolUseId);
    } else {
      // No thread support — inline embed with tool name + result
      await provider.send({ embed: { description: `${icon} ${label}`, color: isError ? 0xed4245 : COLOR.TOOL_OK } });
      for (const msg of renderToolResultThreadMessages(resultText, isError)) {
        await provider.send({ text: msg.content });
      }
      toolState.toolUseThreads.delete(pm.toolUseId);
    }

    return "consumed";
  }
}
