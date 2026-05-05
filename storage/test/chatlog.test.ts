import { describe, it, expect } from "vitest";
import { parseChatLog } from "../src/chatlog/index.js";

describe("chatlog parsers", () => {
  it("parses LINE export", async () => {
    const sample = [
      "[LINE] 與 王小華 的聊天紀錄",
      "儲存日期：2024/01/05 12:34",
      "",
      "2023/12/01(週五)",
      "上午10:00\t王大明\t今天去看醫生了",
      "上午10:02\t王小華\t醫生怎麼說？",
      "下午03:15\t王大明\t沒事,只是普通感冒",
    ].join("\n");

    const log = await parseChatLog("line", sample, "王大明");

    expect(log.platform).toBe("line");
    expect(log.deceasedName).toBe("王大明");
    expect(log.messages).toHaveLength(3);
    expect(log.messages[0]?.ts).toBe("2023-12-01T10:00:00");
    expect(log.messages[0]?.from).toBe("王大明");
    expect(log.messages[0]?.text).toBe("今天去看醫生了");
    expect(log.messages[2]?.ts).toBe("2023-12-01T15:15:00");
    expect(log.participants).toEqual(expect.arrayContaining(["王大明", "王小華"]));
  });

  it("parses WhatsApp export (bracket form)", async () => {
    const sample = [
      "[12/1/23, 10:00:00 AM] 王大明: 今天去看醫生了",
      "[12/1/23, 10:02:00 AM] 王小華: 醫生怎麼說？",
      "[12/1/23, 3:15:00 PM] 王大明: 沒事",
    ].join("\n");

    const log = await parseChatLog("whatsapp", sample, "王大明");

    expect(log.platform).toBe("whatsapp");
    expect(log.messages).toHaveLength(3);
    expect(log.messages[0]?.from).toBe("王大明");
    expect(log.messages[0]?.text).toBe("今天去看醫生了");
    expect(log.messages[0]?.ts).toBe("2023-12-01T10:00:00");
    expect(log.messages[2]?.ts).toBe("2023-12-01T15:15:00");
  });

  it("parses Facebook Messenger JSON and undoes mojibake", async () => {
    const original = {
      participants: [{ name: "王大明" }, { name: "王小華" }],
      messages: [
        {
          sender_name: "王小華",
          timestamp_ms: 1701385200000,
          content: "醫生怎麼說？",
        },
        {
          sender_name: "王大明",
          timestamp_ms: 1701385080000,
          content: "今天去看醫生了",
        },
      ],
      title: "王大明",
    };
    // Simulate Meta's mojibake encoding: UTF-8 bytes interpreted as Latin-1.
    const json = JSON.stringify(original);
    const mojibake = Buffer.from(json, "utf8").toString("latin1");

    const log = await parseChatLog("facebook", mojibake, "王大明");

    expect(log.platform).toBe("facebook");
    expect(log.messages).toHaveLength(2);
    // Sorted chronologically
    expect(log.messages[0]?.from).toBe("王大明");
    expect(log.messages[0]?.text).toBe("今天去看醫生了");
    expect(log.messages[1]?.from).toBe("王小華");
    expect(log.participants).toEqual(["王大明", "王小華"]);
  });

  it("parses Instagram JSON", async () => {
    const json = JSON.stringify({
      participants: [{ name: "Alice" }, { name: "Bob" }],
      messages: [
        { sender_name: "Alice", timestamp_ms: 1701385200000, content: "hi" },
      ],
    });

    const log = await parseChatLog("instagram", json, "Alice");
    expect(log.platform).toBe("instagram");
    expect(log.messages).toHaveLength(1);
    expect(log.messages[0]?.from).toBe("Alice");
  });

  it("parses Telegram JSON with text entities", async () => {
    const json = JSON.stringify({
      name: "Family",
      type: "personal_chat",
      messages: [
        {
          type: "service",
          date: "2023-11-30T09:00:00",
          from: "王大明",
          text: "joined",
        },
        {
          type: "message",
          date: "2023-12-01T10:00:00",
          date_unixtime: "1701385200",
          from: "王大明",
          text: "今天去看醫生了",
        },
        {
          type: "message",
          date: "2023-12-01T10:02:00",
          date_unixtime: "1701385320",
          from: "王小華",
          text: ["醫生", { type: "bold", text: "怎麼" }, "說？"],
        },
      ],
    });

    const log = await parseChatLog("telegram", json, "王大明");

    expect(log.platform).toBe("telegram");
    expect(log.messages).toHaveLength(2); // service skipped
    expect(log.messages[0]?.text).toBe("今天去看醫生了");
    expect(log.messages[1]?.text).toBe("醫生怎麼說？");
  });

  it("parses Discord JSON (DiscordChatExporter)", async () => {
    const json = JSON.stringify({
      guild: { name: "Family" },
      channel: { name: "general" },
      messages: [
        {
          timestamp: "2023-12-01T10:00:00+00:00",
          author: { name: "wangdaming", nickname: "王大明" },
          content: "今天去看醫生了",
          attachments: [],
          type: "Default",
        },
        {
          timestamp: "2023-12-01T10:02:00+00:00",
          author: { name: "wangxiaohua", nickname: "王小華" },
          content: "醫生怎麼說？",
          attachments: [{ url: "https://cdn.discordapp.com/x.png" }],
          type: "Default",
        },
      ],
    });

    const log = await parseChatLog("discord", json, "王大明");

    expect(log.platform).toBe("discord");
    expect(log.messages).toHaveLength(2);
    expect(log.messages[0]?.from).toBe("王大明");
    expect(log.messages[1]?.mediaUri).toBe(
      "https://cdn.discordapp.com/x.png",
    );
  });

  it("rejects empty deceasedName", async () => {
    await expect(parseChatLog("line", "", "")).rejects.toThrow(/deceasedName/);
  });
});
