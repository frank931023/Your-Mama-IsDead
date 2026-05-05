import type { UnifiedChatLog, UnifiedMessage, ChatLogInput } from "./parser.js";
import { collectParticipants, toText } from "./parser.js";

/**
 * LINE chat-room export (`.txt`).
 *
 * Real exports look like:
 *
 *   [LINE] 與 王小華 的聊天紀錄
 *   儲存日期：2024/01/05 12:34
 *
 *   2023/12/01(週五)
 *   上午10:00\t王大明\t今天去看醫生了
 *   上午10:02\t王小華\t醫生怎麼說？
 *   下午03:15\t王大明\t[貼圖]
 *
 * The date appears as a stand-alone line; subsequent message lines carry
 * only `<時段時:分>\t<sender>\t<text>` until the next date line. Continuation
 * lines (no leading time) are appended to the previous message.
 */
export function parseLine(
  raw: ChatLogInput,
  deceasedName: string,
): UnifiedChatLog {
  const text = toText(raw).replace(/\r\n/g, "\n");
  const lines = text.split("\n");

  const messages: UnifiedMessage[] = [];
  let currentDate: string | null = null; // YYYY-MM-DD

  // header forms tested:
  //   2023/12/01(週五)
  //   2023.12.01 週五
  //   2023/12/01
  const dateRe = /^(\d{4})[\/.](\d{1,2})[\/.](\d{1,2})(?:[（(\s].*)?$/;

  // message:  上午10:00\t王大明\t內容    OR    10:00\t王大明\t內容
  // also allow space-separated (some exports use spaces, not tabs)
  const msgRe =
    /^(上午|下午|AM|PM)?\s*(\d{1,2}):(\d{2})[\t ]+([^\t]+?)[\t ]+(.*)$/;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (line.length === 0) continue;

    const dm = dateRe.exec(line);
    if (dm) {
      const yy = dm[1];
      const mo = dm[2];
      const dd = dm[3];
      if (yy && mo && dd) {
        currentDate = `${yy}-${mo.padStart(2, "0")}-${dd.padStart(2, "0")}`;
      }
      continue;
    }

    const lm = msgRe.exec(line);
    if (lm && currentDate) {
      const period = lm[1];
      const hStr = lm[2];
      const minStr = lm[3];
      const from = lm[4]?.trim() ?? "";
      const body = lm[5] ?? "";
      if (!hStr || !minStr || !from) continue;

      let h = parseInt(hStr, 10);
      const min = parseInt(minStr, 10);
      if (period === "下午" || period === "PM") {
        if (h < 12) h += 12;
      } else if (period === "上午" || period === "AM") {
        if (h === 12) h = 0;
      }
      const ts = `${currentDate}T${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}:00`;
      messages.push({ ts, from, text: body });
      continue;
    }

    // Continuation line — append to previous message body.
    if (messages.length > 0) {
      const last = messages[messages.length - 1];
      if (last) {
        last.text = last.text.length > 0 ? `${last.text}\n${line}` : line;
      }
    }
  }

  return {
    platform: "line",
    participants: collectParticipants(messages),
    deceasedName,
    messages,
  };
}
