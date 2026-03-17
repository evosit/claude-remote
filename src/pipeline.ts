import type { ProcessedMessage } from "./types.js";
import type { MessageHandler, SessionContext } from "./handler.js";

export class HandlerPipeline {
  private handlers: MessageHandler[] = [];

  register(handler: MessageHandler): void {
    this.handlers.push(handler);
  }

  init(ctx: SessionContext): void {
    for (const h of this.handlers) {
      h.init?.(ctx);
    }
  }

  async process(pm: ProcessedMessage, ctx: SessionContext): Promise<void> {
    for (const handler of this.handlers) {
      if (handler.types && !handler.types.includes(pm.type)) continue;
      const result = await handler.handle(pm, ctx);
      if (result === "consumed") return;
    }
  }

  destroy(): void {
    for (const h of this.handlers) {
      h.destroy?.();
    }
  }
}
