import type { MessageHandler, SessionContext, HandlerResult } from "../handler.js";
import type { ProcessedMessage } from "../types.js";
import { renderMessage } from "../discord-renderer.js";
import { discordPayloadToOutgoing } from "../discord-helpers.js";
import { closePassiveGroup } from "./passive-tools.js";

export class DefaultHandler implements MessageHandler {
  name = "default";

  async handle(pm: ProcessedMessage, ctx: SessionContext): Promise<HandlerResult> {
    await closePassiveGroup(ctx);

    for (const payload of renderMessage(pm)) {
      for (const msg of discordPayloadToOutgoing(payload)) {
        await ctx.provider.send(msg);
      }
    }

    return "consumed";
  }
}
