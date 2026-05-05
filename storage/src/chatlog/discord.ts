import type { UnifiedChatLog, UnifiedMessage, ChatLogInput } from "./parser.js";
import { collectParticipants, toText } from "./parser.js";

interface DiscordAuthor {
  name?: string;
  nickname?: string;
}

interface DiscordAttachment {
  url?: string;
}

interface DiscordMessage {
  timestamp?: string;
  timestampEdited?: string | null;
  author?: DiscordAuthor;
  content?: string;
  attachments?: DiscordAttachment[];
  type?: string;
}

interface DiscordExport {
  guild?: { name?: string };
  channel?: { name?: string };
  messages?: DiscordMessage[];
}

/**
 * DiscordChatExporter JSON export.
 *
 * Reference: https://github.com/Tyrrrz/DiscordChatExporter
 *   { messages: [{ timestamp, author: { name, nickname }, content, attachments: [{ url }] }] }
 */
export function parseDiscord(
  raw: ChatLogInput,
  deceasedName: string,
): UnifiedChatLog {
  const data = JSON.parse(toText(raw)) as DiscordExport;
  const messages: UnifiedMessage[] = [];

  for (const m of data.messages ?? []) {
    // skip non-text system messages where present (Default = normal)
    if (m.type && m.type !== "Default" && m.type !== "Reply") continue;
    if (!m.timestamp) continue;
    const t = Date.parse(m.timestamp);
    if (Number.isNaN(t)) continue;
    const from = m.author?.nickname || m.author?.name;
    if (!from) continue;
    const ts = new Date(t).toISOString();
    const msg: UnifiedMessage = { ts, from, text: m.content ?? "" };
    const media = m.attachments?.[0]?.url;
    if (media) msg.mediaUri = media;
    messages.push(msg);
  }

  return {
    platform: "discord",
    participants: collectParticipants(messages),
    deceasedName,
    messages,
  };
}
