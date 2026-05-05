import type { UnifiedChatLog, UnifiedMessage, ChatLogInput } from "./parser.js";
import { collectParticipants, toText } from "./parser.js";

interface TgEntity {
  type?: string;
  text?: string;
}

interface TgMessage {
  type?: string;
  date?: string;
  date_unixtime?: string | number;
  from?: string;
  text?: string | Array<string | TgEntity>;
  photo?: string;
  file?: string;
}

interface TgExport {
  name?: string;
  type?: string;
  messages?: TgMessage[];
}

/**
 * Telegram desktop "Export Chat History → JSON" file.
 *
 * `text` may be a plain string or an array mixing strings and entity
 * objects (`{ type: "bold", text: "..." }`, links, mentions, etc.). We
 * flatten everything to plain text — entity types are kept inline as raw
 * text so they end up in the RAG index untouched.
 */
export function parseTelegram(
  raw: ChatLogInput,
  deceasedName: string,
): UnifiedChatLog {
  const data = JSON.parse(toText(raw)) as TgExport;
  const messages: UnifiedMessage[] = [];

  for (const m of data.messages ?? []) {
    if (m.type !== "message") continue; // skip "service" messages (joined, pinned…)
    if (!m.from) continue;
    const ts = isoFromTelegramDate(m);
    if (!ts) continue;
    const text = flattenText(m.text);
    const msg: UnifiedMessage = { ts, from: m.from, text };
    if (m.photo) msg.mediaUri = m.photo;
    else if (m.file) msg.mediaUri = m.file;
    messages.push(msg);
  }

  return {
    platform: "telegram",
    participants: collectParticipants(messages),
    deceasedName,
    messages,
  };
}

function isoFromTelegramDate(m: TgMessage): string | null {
  if (m.date_unixtime !== undefined) {
    const n =
      typeof m.date_unixtime === "string"
        ? parseInt(m.date_unixtime, 10)
        : m.date_unixtime;
    if (!Number.isNaN(n)) return new Date(n * 1000).toISOString();
  }
  if (m.date) {
    // Telegram's `date` is local-time without offset, e.g. "2023-12-01T10:00:00"
    const t = Date.parse(m.date);
    if (!Number.isNaN(t)) return new Date(t).toISOString();
  }
  return null;
}

function flattenText(t: TgMessage["text"]): string {
  if (t === undefined || t === null) return "";
  if (typeof t === "string") return t;
  if (!Array.isArray(t)) return "";
  const parts: string[] = [];
  for (const part of t) {
    if (typeof part === "string") parts.push(part);
    else if (part && typeof part.text === "string") parts.push(part.text);
  }
  return parts.join("");
}
