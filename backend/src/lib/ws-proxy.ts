/**
 * Avatar WebSocket 代理
 *
 * 為什麼需要:渲染機在 Tailscale 私有 IP (100.x)。瀏覽器直連 ws://100.x 會被
 * Chrome 的 Private Network Access (PNA) 擋掉 —— localhost 頁面連私有網段的
 * WebSocket 直接 1006 失敗 (Node 端不受此限,所以後端能連)。
 *
 * 解法:瀏覽器改連同源的 ws://<backend>/api/avatar/ws?token=<renderToken>
 * (localhost,PNA 豁免),後端把它原樣 pipe 到渲染機的 ws://.../render?token=...
 * 後端在 tailnet,能連渲染機;對瀏覽器則是同源連線,不觸發 PNA。
 *
 * 設計:純雙向轉發 (text + binary)。token 由前端 avatar-session 取得 (後端已用
 * RENDER_JWT_SECRET 簽好),這裡只透傳給上游,讓渲染機自己驗 —— 代理不重簽不解析,
 * 降低出錯面。用 `ws` 套件直接掛在 Fastify 底層 http server 的 upgrade 事件上,
 * 不引入 @fastify/websocket。
 */
import type { Server as HttpServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { env } from "./env.js";

const PROXY_PATH = "/api/avatar/ws";

/**
 * 安全關閉一個 WebSocket，永不 throw。
 *
 * `ws.close(code)` 只接受合法的 application close code —— 1000 或 3000-4999。
 * 保留碼 (1005 / 1006 / 1015 等) 禁止透過 close() 送出,傳進去 `ws` 會直接
 * throw「First argument must be a valid error code number」;而 1006 (異常斷線)
 * 正是連線掉線時最常見的碼。上游斷線把它原樣轉發給下游就會炸掉整個 process。
 *
 * 這裡把不合法的碼一律正規化成 1011 (internal error),reason 截到 123 bytes
 * (ws 對 reason 長度也有限制),並整個包在 try/catch,保證代理絕不因對端亂關而崩。
 */
function safeCloseWs(sock: WebSocket, code?: number, reason?: unknown): void {
  try {
    const valid = typeof code === "number" && (code === 1000 || (code >= 3000 && code <= 4999));
    const safeCode = valid ? code : 1011;
    let safeReason: string | undefined;
    if (reason != null) {
      const s = Buffer.isBuffer(reason) ? reason.toString("utf8") : String(reason);
      if (s) safeReason = Buffer.byteLength(s) > 123 ? s.slice(0, 60) : s;
    }
    sock.close(safeCode, safeReason);
  } catch {
    try {
      sock.close();
    } catch {
      /* 最後手段:連無參數 close 都失敗就放棄,別讓它冒泡崩 process */
    }
  }
}

export function attachAvatarWsProxy(server: HttpServer, log?: { info: (o: unknown, m?: string) => void; warn: (o: unknown, m?: string) => void; error: (o: unknown, m?: string) => void }): void {
  // noServer 模式:我們自己處理 upgrade,只接管 PROXY_PATH,其餘交還 (避免和
  // 未來其他 ws 用途衝突)。
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    let pathname: string;
    let token: string | null;
    try {
      const url = new URL(req.url ?? "", "http://localhost");
      pathname = url.pathname;
      token = url.searchParams.get("token");
    } catch {
      socket.destroy();
      return;
    }
    if (pathname !== PROXY_PATH) return; // 不是我們的路徑,放手

    if (!env.RENDER_BASE) {
      socket.write("HTTP/1.1 503 Service Unavailable\r\n\r\n");
      socket.destroy();
      return;
    }
    if (!token) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (client) => {
      // 客戶端 (瀏覽器) 已升級。現在建到渲染機的上游連線。
      const upstreamUrl = `${env.RENDER_BASE!.replace(/^http/, "ws")}/render?token=${encodeURIComponent(token!)}`;
      const upstream = new WebSocket(upstreamUrl);
      upstream.binaryType = "arraybuffer";

      // 上游連上前,瀏覽器可能已經要發訊息 → 暫存,連上後 flush。
      const pending: Array<string | Buffer | ArrayBuffer> = [];
      let upstreamOpen = false;

      upstream.on("open", () => {
        upstreamOpen = true;
        for (const m of pending) upstream.send(m);
        pending.length = 0;
      });

      // 渲染機 → 瀏覽器 (text + binary 原樣轉)。
      upstream.on("message", (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(data, { binary: isBinary });
        }
      });
      upstream.on("close", (code, reason) => {
        if (client.readyState === WebSocket.OPEN) safeCloseWs(client, code, reason);
      });
      upstream.on("error", (err) => {
        log?.warn({ err }, "avatar ws proxy: upstream error");
        if (client.readyState === WebSocket.OPEN) safeCloseWs(client, 1011, "upstream error");
      });

      // 瀏覽器 → 渲染機。
      client.on("message", (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
        // ws 收到的 data 可能是 Buffer[];統一成可 send 的型別。
        const payload: string | Buffer = isBinary
          ? (Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as Buffer))
          : data.toString();
        if (upstreamOpen && upstream.readyState === WebSocket.OPEN) {
          upstream.send(payload);
        } else {
          pending.push(payload);
        }
      });
      client.on("close", () => {
        if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) {
          upstream.close();
        }
      });
      client.on("error", () => {
        if (upstream.readyState === WebSocket.OPEN) upstream.close();
      });
    });
  });

  log?.info({ path: PROXY_PATH }, "avatar ws proxy attached");
}
