import { Buffer } from "node:buffer";
import type { UnifiedChatLog, UnifiedMessage, ChatLogInput } from "./parser.js";
import { collectParticipants } from "./parser.js";

interface MetaMessage {
  sender_name?: string;
  timestamp_ms?: number;
  content?: string;
  photos?: Array<{ uri?: string }>;
  videos?: Array<{ uri?: string }>;
  audio_files?: Array<{ uri?: string }>;
  type?: string;
}

interface MetaExport {
  participants?: Array<{ name?: string }>;
  messages?: MetaMessage[];
  title?: string;
}

/**
 * Meta (Facebook Messenger / Instagram DM) JSON export.
 *
 * Meta saves UTF-8 bytes but tags the JSON file as Latin-1, so non-ASCII
 * characters arrive as mojibake (e.g. "王大明" → "ç‹å¤§æ"). The fix is to
 * re-encode each string by reading its bytes back as Latin-1 and decoding
 * as UTF-8.
 *
 * Reference: https://github.com/Vinaib1/facebook-messenger-utility-1
 */
export function parseFacebook(
  raw: ChatLogInput,
  deceasedName: string,
): UnifiedChatLog {
  return parseMetaJson(raw, deceasedName, "facebook");
}

export function parseMetaJson(
  raw: ChatLogInput,
  deceasedName: string,
  platform: "facebook" | "instagram",
): UnifiedChatLog {
  const text = typeof raw === "string" ? raw : raw.toString("utf8");
  const data = JSON.parse(text) as MetaExport;

  const fixed: MetaExport = fixMojibake(data);

  const messages: UnifiedMessage[] = [];
  for (const m of fixed.messages ?? []) {
    if (typeof m.timestamp_ms !== "number") continue;
    const from = (m.sender_name ?? "").trim();
    if (!from) continue;
    const ts = new Date(m.timestamp_ms).toISOString();
    const text = m.content ?? "";
    const media =
      m.photos?.[0]?.uri ?? m.videos?.[0]?.uri ?? m.audio_files?.[0]?.uri;
    const msg: UnifiedMessage = { ts, from, text };
    if (media) msg.mediaUri = media;
    messages.push(msg);
  }

  // Meta orders newest-first; flip to chronological.
  messages.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));

  const participants =
    fixed.participants
      ?.map((p) => p.name?.trim())
      .filter((n): n is string => !!n && n.length > 0) ?? [];

  return {
    platform,
    participants:
      participants.length > 0 ? participants : collectParticipants(messages),
    deceasedName,
    messages,
  };
}

function fixMojibakeString(s: string): string {
  // Re-interpret the JS string's code-points as Latin-1 bytes, then decode
  // them as UTF-8. If the input is already clean UTF-8 the round trip is
  // a no-op (Buffer.from("ascii", "latin1") + toString("utf8") = ascii).
  try {
    return Buffer.from(s, "latin1").toString("utf8");
  } catch {
    return s;
  }
}

function fixMojibake<T>(value: T): T {
  if (typeof value === "string") {
    return fixMojibakeString(value) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => fixMojibake(v)) as unknown as T;
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = fixMojibake(v);
    }
    return out as unknown as T;
  }
  return value;
}
