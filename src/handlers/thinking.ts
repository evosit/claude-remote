import type { MessageHandler, SessionContext, HandlerResult } from "../handler.js";
import type { ProcessedMessage } from "../types.js";
import type { ProviderMessage } from "../provider.js";
import { renderMessage } from "../discord-renderer.js";
import { discordPayloadToOutgoing } from "../discord-helpers.js";

let thinkingMessage: ProviderMessage | null = null;

async function show(ctx: SessionContext) {
  if (thinkingMessage) return;
  thinkingMessage = await ctx.provider.send({ text: "💭 **Thinking…**" });
}

async function clear(ctx: SessionContext) {
  if (!thinkingMessage) return;
  try { await ctx.provider.delete(thinkingMessage); } catch { /* already gone */ }
  thinkingMessage = null;
}

export class ThinkingHandler implements MessageHandler {
  name = "thinking";

  async handle(pm: ProcessedMessage, ctx: SessionContext): Promise<HandlerResult> {
    if (pm.type === "user-prompt") {
      for (const payload of renderMessage(pm)) {
        for (const msg of discordPayloadToOutgoing(payload)) {
          await ctx.provider.send(msg);
        }
      }
      await show(ctx);
      return "consumed";
    }

    if (pm.type === "assistant-text" || pm.type === "tool-use") {
      await clear(ctx);
    }

    return "pass";
  }

  destroy() {
    thinkingMessage = null;
  }
}

export { show as showThinking, clear as clearThinking };
