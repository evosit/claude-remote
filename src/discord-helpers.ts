import type { MessageCreateOptions } from "discord.js";
import type { OutgoingMessage } from "./provider.js";

/**
 * Convert discord.js MessageCreateOptions to provider-agnostic OutgoingMessage[].
 * Handles both EmbedBuilder instances and plain APIEmbed objects.
 */
export function discordPayloadToOutgoing(payload: MessageCreateOptions): OutgoingMessage[] {
  const messages: OutgoingMessage[] = [];

  if (payload.content) {
    messages.push({ text: payload.content });
  }

  if (payload.embeds) {
    for (const embed of payload.embeds) {
      const data = "toJSON" in embed && typeof embed.toJSON === "function"
        ? embed.toJSON()
        : embed as Record<string, unknown>;

      messages.push({
        embed: {
          title: (data.title as string) ?? undefined,
          description: (data.description as string) ?? "",
          color: data.color as number | undefined,
          footer: typeof data.footer === "object" && data.footer
            ? (data.footer as Record<string, unknown>).text as string
            : undefined,
          author: typeof data.author === "object" && data.author
            ? (data.author as Record<string, unknown>).name as string
            : undefined,
        },
      });
    }
  }

  // If nothing was generated but there was a payload, return at least an empty text
  if (messages.length === 0 && (payload.content || payload.embeds)) {
    messages.push({ text: payload.content || "" });
  }

  return messages;
}
