import { BACKEND_URL } from "./api";

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface StreamChatOptions {
  signal?: AbortSignal;
  onToken: (delta: string) => void;
  onEvent?: (event: { type: string; data: string }) => void;
}

/**
 * Consume SSE chat stream from `POST /api/personas/:id/chat`.
 *
 * Yields token deltas via `onToken` and resolves with the concatenated full
 * assistant message once the stream ends. Throws on HTTP error or abort.
 */
export async function streamChat(
  tokenId: string | number,
  message: string,
  history: ChatMessage[],
  jwt: string,
  opts: StreamChatOptions,
): Promise<string> {
  const res = await fetch(`${BACKEND_URL}/api/personas/${tokenId}/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({ message, history }),
    signal: opts.signal,
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(`chat stream failed (${res.status}): ${text || res.statusText}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let full = "";

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by double newlines
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const parsed = parseSseFrame(frame);
        if (!parsed) continue;
        opts.onEvent?.(parsed);
        if (parsed.type === "token") {
          full += parsed.data;
          opts.onToken(parsed.data);
        } else if (parsed.type === "done") {
          return full;
        } else if (parsed.type === "error") {
          throw new Error(parsed.data || "stream error");
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return full;
}

function parseSseFrame(frame: string): { type: string; data: string } | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of frame.split(/\r?\n/)) {
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).replace(/^ /, ""));
    }
  }
  if (dataLines.length === 0) return null;
  return { type: event, data: dataLines.join("\n") };
}
