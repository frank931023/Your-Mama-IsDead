import type { UnifiedChatLog, UnifiedMessage, ChatLogInput } from "./parser.js";
import { collectParticipants, toText } from "./parser.js";

/**
 * WhatsApp `.txt` export.
 *
 * Common formats:
 *   [12/1/23, 10:00:00 AM] 王大明: 今天去看醫生了
 *   [01/12/2023, 10:00:00] 王大明: 今天去看醫生了
 *   12/1/23, 10:00 AM - 王大明: 今天去看醫生了        (legacy Android)
 *
 * Tolerates left-to-right marks (‎) and narrow no-break spaces ( )
 * that WhatsApp inserts around the meridiem.
 */
export function parseWhatsApp(
  raw: ChatLogInput,
  deceasedName: string,
): UnifiedChatLog {
  const text = toText(raw)
    .replace(/\r\n/g, "\n")
    .replace(/[‎‏]/g, "")
    .replace(/ /g, " ");
  const lines = text.split("\n");

  // [date, time] sender: body  (iOS / WhatsApp Web)
  const bracketRe =
    /^\[(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4}),\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM|am|pm)?\]\s*([^:]+?):\s*(.*)$/;
  // date, time - sender: body  (legacy)
  const dashRe =
    /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4}),\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM|am|pm)?\s*-\s*([^:]+?):\s*(.*)$/;

  const messages: UnifiedMessage[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (line.length === 0) continue;

    const m = bracketRe.exec(line) ?? dashRe.exec(line);
    if (!m) {
      if (messages.length > 0) {
        const last = messages[messages.length - 1];
        if (last) last.text = `${last.text}\n${line}`;
      }
      continue;
    }

    const [, d1, d2, yRaw, hRaw, minRaw, secRaw, mer, sender, body] = m;
    if (!d1 || !d2 || !yRaw || !hRaw || !minRaw || !sender) continue;

    // WhatsApp uses the device locale, so the export can be M/D/Y (US) or
    // D/M/Y (most others). Bracket-form (iOS / Web) defaults to M/D/Y; the
    // legacy dash-form is more often D/M/Y. We auto-detect: if a number is
    // > 12 it must be the day; otherwise we trust the bracket vs. dash hint.
    const a = parseInt(d1, 10);
    const b = parseInt(d2, 10);
    const isBracket = line.startsWith("[");
    let day: number;
    let month: number;
    if (a > 12 && b <= 12) {
      day = a;
      month = b;
    } else if (b > 12 && a <= 12) {
      month = a;
      day = b;
    } else if (isBracket) {
      // M/D/Y default for bracket form
      month = a;
      day = b;
    } else {
      // D/M/Y default for dash form
      day = a;
      month = b;
    }
    const yearN =
      yRaw.length === 2 ? 2000 + parseInt(yRaw, 10) : parseInt(yRaw, 10);
    let h = parseInt(hRaw, 10);
    const min = parseInt(minRaw, 10);
    const sec = secRaw ? parseInt(secRaw, 10) : 0;
    if (mer) {
      const upper = mer.toUpperCase();
      if (upper === "PM" && h < 12) h += 12;
      if (upper === "AM" && h === 12) h = 0;
    }

    const ts = `${yearN.toString().padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(
      day,
    ).padStart(2, "0")}T${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;

    messages.push({ ts, from: sender.trim(), text: body ?? "" });
  }

  return {
    platform: "whatsapp",
    participants: collectParticipants(messages),
    deceasedName,
    messages,
  };
}
