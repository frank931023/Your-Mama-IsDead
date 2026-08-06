/**
 * 線上公祭 hub — 每座塔位一個即時「祭拜房間」
 *
 * 讓同時在追悼頁 / 3D 靈堂的訪客彼此「看得見」:
 *   - presence:任何人進出房間,全房間收到最新在線人數
 *   - tribute:有人送出供品留言(走既有 POST /api/tributes),全房間即時收到
 *   - ritual:短暫儀式動作(三鞠躬 / 點香),不落 DB,純廣播(帶發送者 id,
 *     讓 3D 靈堂能讓「那個人的身影」行禮)
 *   - pos:3D 靈堂的化身位置同步 — 進入走動模式的訪客以 ~10Hz 廣播
 *     自己的位置/朝向,其他人畫面上就能看到他的身影移動
 *
 * 連線:ws://<backend>/api/ceremony/:tokenId/ws
 *   進房即發 {type:"welcome", id, peers:[目前有位置的化身…]} 給新客,
 *   離房廣播 {type:"peer_leave", id}。
 * 免驗證(與 tributes「來客即賓」一致);ritual/pos 均有節流防洗版。
 *
 * 沿用 ws-proxy 的掛法:ws 套件 noServer 模式掛 http server 的 upgrade
 * 事件,只接管自己的路徑,其餘放行給其他 ws 用途(avatar proxy)。
 * 房間狀態存 in-process Map — 單 instance 原型夠用;要水平擴充時把
 * broadcast 換成 Redis pub/sub 即可,介面不變。
 */
import { randomUUID } from "node:crypto";
import type { Server as HttpServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { codeGrantsAccess, loadTabletAccess } from "./access.js";

const PATH_RE = /^\/api\/ceremony\/(\d+)\/ws$/;

/** 客戶端可送上來的儀式動作(白名單,其他一律丟棄) */
const RITUALS = new Set(["bow", "incense"]);
/** 同一 socket 兩次 ritual 之間的最小間隔(防洗版) */
const RITUAL_MIN_INTERVAL_MS = 1_500;
/** pos 更新節流:最高 ~20Hz(前端自己是 10Hz,這裡是防惡意) */
const POS_MIN_INTERVAL_MS = 45;
/** 化身活動範圍(涵蓋前端 WALK_BOUNDS + 餘裕,越界值直接夾住) */
const POS_RANGE = { x: 6, z: 10 };
/** 聊天氣泡:長度上限與節流 */
const CHAT_MAX_LEN = 120;
const CHAT_MIN_INTERVAL_MS = 800;

interface PeerPos {
  x: number;
  /** 垂直高度(跳躍用);地面為 0 */
  y: number;
  z: number;
  ry: number;
  name?: string;
}

interface RoomSocket extends WebSocket {
  peerId?: string;
  isAlive?: boolean;
  lastRitualAt?: number;
  lastPosAt?: number;
  lastChatAt?: number;
  pos?: PeerPos;
}

type Logger = {
  info: (o: unknown, m?: string) => void;
  warn: (o: unknown, m?: string) => void;
};

const rooms = new Map<string, Set<RoomSocket>>();

function roomOf(tokenId: string): Set<RoomSocket> {
  let room = rooms.get(tokenId);
  if (!room) {
    room = new Set();
    rooms.set(tokenId, room);
  }
  return room;
}

function broadcast(tokenId: string, payload: unknown, exclude?: RoomSocket): void {
  const room = rooms.get(tokenId);
  if (!room || room.size === 0) return;
  const data = JSON.stringify(payload);
  for (const ws of room) {
    if (ws !== exclude && ws.readyState === WebSocket.OPEN) ws.send(data);
  }
}

function broadcastPresence(tokenId: string): void {
  broadcast(tokenId, { type: "presence", count: rooms.get(tokenId)?.size ?? 0 });
}

/**
 * 給 tributes POST 路由呼叫:留言寫入 DB 後,即時推給房間內所有人。
 * (送出者自己也會收到 — 前端以 id 去重,不會重複顯示。)
 */
export function broadcastTribute(tokenId: string, tribute: unknown): void {
  broadcast(tokenId, { type: "tribute", tribute });
}

const clamp = (v: number, range: number): number => Math.max(-range, Math.min(range, v));

export function attachCeremonyHub(server: HttpServer, log?: Logger): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    let match: RegExpExecArray | null;
    let inviteCode: string | null = null;
    try {
      const url = new URL(req.url ?? "", "http://localhost");
      match = PATH_RE.exec(url.pathname);
      inviteCode = url.searchParams.get("code");
    } catch {
      return; // 交給其他 upgrade handler
    }
    if (!match) return; // 不是公祭路徑,放手

    const tokenId = match[1]!;

    // 可見度閘門:PUBLIC 放行;UNLISTED 需有效邀請碼 (?code=);PRIVATE 一律關閉
    // (私人模式沒有「多人」— 屋主獨自追思不需公祭房間)。查 DB 是 async,
    // 先驗完再 handleUpgrade。
    void (async () => {
      try {
        const row = await loadTabletAccess(BigInt(tokenId));
        const ok =
          !!row &&
          (row.visibility === "PUBLIC" ||
            (row.visibility === "UNLISTED" && codeGrantsAccess(row, inviteCode)));
        if (!ok) {
          socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
          socket.destroy();
          return;
        }
      } catch (err) {
        log?.warn({ err, tokenId }, "ceremony gate check failed");
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (client: RoomSocket) => {
      const room = roomOf(tokenId);
      client.peerId = randomUUID().slice(0, 8);
      room.add(client);
      client.isAlive = true;

      // 新客先拿到自己的 id + 房裡已在走動的化身名冊
      const peers = [...room]
        .filter((w) => w !== client && w.pos)
        .map((w) => ({ id: w.peerId, ...w.pos }));
      client.send(JSON.stringify({ type: "welcome", id: client.peerId, peers }));
      broadcastPresence(tokenId);

      client.on("pong", () => {
        client.isAlive = true;
      });

      client.on("message", (data, isBinary) => {
        if (isBinary) return;
        let msg: {
          type?: string;
          ritual?: string;
          name?: string;
          text?: string;
          x?: number;
          y?: number;
          z?: number;
          ry?: number;
        };
        try {
          msg = JSON.parse(data.toString());
        } catch {
          return;
        }

        if (msg.type === "ritual" && msg.ritual && RITUALS.has(msg.ritual)) {
          const now = Date.now();
          if (client.lastRitualAt && now - client.lastRitualAt < RITUAL_MIN_INTERVAL_MS) return;
          client.lastRitualAt = now;
          // 儀式動作只給「別人」看 — 自己的動畫在本地早就播了
          broadcast(
            tokenId,
            {
              type: "ritual",
              ritual: msg.ritual,
              id: client.peerId,
              name: typeof msg.name === "string" ? msg.name.slice(0, 32) : undefined,
            },
            client,
          );
          return;
        }

        // 聊天氣泡:顯示在化身頭上,不落 DB(留言板才是永久紀錄)
        if (msg.type === "chat" && typeof msg.text === "string") {
          const text = msg.text.trim().slice(0, CHAT_MAX_LEN);
          if (!text) return;
          const now = Date.now();
          if (client.lastChatAt && now - client.lastChatAt < CHAT_MIN_INTERVAL_MS) return;
          client.lastChatAt = now;
          broadcast(
            tokenId,
            {
              type: "chat",
              id: client.peerId,
              text,
              name:
                typeof msg.name === "string" && msg.name
                  ? msg.name.slice(0, 32)
                  : client.pos?.name,
            },
            client, // 自己的泡泡本地即時顯示,不吃回音
          );
          return;
        }

        // 退出走動模式(頁面還開著):收掉化身但保留連線/presence
        if (msg.type === "pos_leave") {
          if (client.pos) {
            client.pos = undefined;
            broadcast(tokenId, { type: "peer_leave", id: client.peerId }, client);
          }
          return;
        }

        if (
          msg.type === "pos" &&
          typeof msg.x === "number" &&
          typeof msg.z === "number" &&
          Number.isFinite(msg.x) &&
          Number.isFinite(msg.z)
        ) {
          const now = Date.now();
          if (client.lastPosAt && now - client.lastPosAt < POS_MIN_INTERVAL_MS) return;
          client.lastPosAt = now;
          client.pos = {
            x: clamp(msg.x, POS_RANGE.x),
            y: typeof msg.y === "number" && Number.isFinite(msg.y) ? Math.max(0, Math.min(4, msg.y)) : 0,
            z: clamp(msg.z, POS_RANGE.z),
            ry: typeof msg.ry === "number" && Number.isFinite(msg.ry) ? msg.ry : 0,
            name: typeof msg.name === "string" ? msg.name.slice(0, 32) : client.pos?.name,
          };
          broadcast(tokenId, { type: "pos", id: client.peerId, ...client.pos }, client);
        }
      });

      const leave = (): void => {
        const hadPos = Boolean(client.pos);
        room.delete(client);
        if (room.size === 0) {
          rooms.delete(tokenId);
          return;
        }
        broadcastPresence(tokenId);
        // 有化身的人離開,要通知大家把身影收掉
        if (hadPos) broadcast(tokenId, { type: "peer_leave", id: client.peerId });
      };
      client.on("close", leave);
      client.on("error", leave);
      });
    })();
  });

  // 心跳:30 秒 ping 一次,收不到 pong 的殭屍連線直接收掉,
  // 避免 presence 人數虛胖。
  const heartbeat = setInterval(() => {
    for (const room of rooms.values()) {
      for (const ws of room) {
        if (ws.isAlive === false) {
          ws.terminate();
          continue;
        }
        ws.isAlive = false;
        ws.ping();
      }
    }
  }, 30_000);
  wss.on("close", () => clearInterval(heartbeat));

  log?.info({ path: "/api/ceremony/:tokenId/ws" }, "ceremony hub attached");
}
