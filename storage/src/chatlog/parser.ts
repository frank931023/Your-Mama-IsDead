import type { Buffer } from "node:buffer";
import { parseLine } from "./line.js";
import { parseWhatsApp } from "./whatsapp.js";
import { parseFacebook } from "./facebook.js";
import { parseInstagram } from "./instagram.js";
import { parseTelegram } from "./telegram.js";
import { parseDiscord } from "./discord.js";

export type Platform =
  | "line"
  | "whatsapp"
  | "facebook"
  | "instagram"
  | "telegram"
  | "discord";

export interface UnifiedMessage {
  /** ISO 8601 timestamp string. */
  ts: string;
  from: string;
  text: string;
  mediaUri?: string;
}

export interface UnifiedChatLog {
  platform: string;
  participants: string[];
  deceasedName: string;
  messages: UnifiedMessage[];
}

export type ChatLogInput = Buffer | string;

export type PlatformParser = (
  raw: ChatLogInput,
  deceasedName: string,
) => UnifiedChatLog;

const PARSERS: Record<Platform, PlatformParser> = {
  line: parseLine,
  whatsapp: parseWhatsApp,
  facebook: parseFacebook,
  instagram: parseInstagram,
  telegram: parseTelegram,
  discord: parseDiscord,
};

export async function parseChatLog(
  platform: Platform,
  file: ChatLogInput,
  deceasedName: string,
): Promise<UnifiedChatLog> {
  const fn = PARSERS[platform];
  if (!fn) {
    throw new Error(`parseChatLog: unsupported platform "${platform}"`);
  }
  if (!deceasedName || deceasedName.trim().length === 0) {
    throw new Error("parseChatLog: deceasedName is required");
  }
  return fn(file, deceasedName);
}

/** Convert Buffer | string input to a UTF-8 string. */
export function toText(input: ChatLogInput): string {
  return typeof input === "string" ? input : input.toString("utf8");
}

/** Collect a sorted-unique participants list. */
export function collectParticipants(messages: UnifiedMessage[]): string[] {
  const set = new Set<string>();
  for (const m of messages) set.add(m.from);
  return [...set].sort();
}
