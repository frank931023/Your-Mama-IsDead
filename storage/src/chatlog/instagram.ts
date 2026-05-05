import type { UnifiedChatLog, ChatLogInput } from "./parser.js";
import { parseMetaJson } from "./facebook.js";

/**
 * Instagram DM JSON export — same Meta schema as Facebook Messenger.
 * Reuses the Facebook parser via thin wrapper.
 */
export function parseInstagram(
  raw: ChatLogInput,
  deceasedName: string,
): UnifiedChatLog {
  return parseMetaJson(raw, deceasedName, "instagram");
}
