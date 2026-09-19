/**
 * 線上公祭的 LiveKit 房間 (CEREMONY_TRANSPORT=livekit)
 *
 * 每座塔位一個 LiveKit 房間 (aeterlux-ceremony-<tokenId>)。後端只做兩件事:
 *   1. 依追悼頁可見度驗證後簽發入房 token (routes/ceremony.ts)
 *   2. 供品留言寫進 DB 後,用 server API 把它推進房間 (broadcastTributeLivekit)
 * 在線人數、儀式、化身走動、聊天氣泡由瀏覽器直接走 LiveKit data channel;
 * 語音由 LiveKit SFU 轉送,不經過後端。
 *
 * 協定與 ceremony-hub.ts 的 WebSocket 版相同,前端 lib/ceremony.ts 兩種通道共用
 * 同一套事件處理。
 */
import { AccessToken, DataPacket_Kind, RoomServiceClient, TrackSource } from "livekit-server-sdk";
import { env } from "./env.js";

export type CeremonyTransport = "ws" | "livekit";

/** data message 的 topic;前端只處理這個 topic 的訊息。 */
export const CEREMONY_TOPIC = "ceremony";

export function livekitConfigured(): boolean {
  return Boolean(env.LIVEKIT_URL && env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET);
}

export function ceremonyTransport(): CeremonyTransport {
  if (env.CEREMONY_TRANSPORT === "ws") return "ws";
  if (env.CEREMONY_TRANSPORT === "livekit") return livekitConfigured() ? "livekit" : "ws";
  return livekitConfigured() ? "livekit" : "ws";
}

export function ceremonyRoomName(tokenId: string): string {
  return `aeterlux-ceremony-${tokenId}`;
}

/** 入房 token:可收發 data、可開麥克風,不能開鏡頭或分享螢幕。 */
export async function createCeremonyToken(tokenId: string, identity: string): Promise<string> {
  const token = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
    identity,
    ttl: env.LIVEKIT_TOKEN_TTL_SECONDS,
  });
  token.addGrant({
    roomJoin: true,
    room: ceremonyRoomName(tokenId),
    canSubscribe: true,
    canPublish: true,
    canPublishData: true,
    canPublishSources: [TrackSource.MICROPHONE],
  });
  return token.toJwt();
}

let roomService: RoomServiceClient | null = null;

function service(): RoomServiceClient {
  if (!roomService) {
    const host = env.LIVEKIT_HOST_URL ?? env.LIVEKIT_URL!.replace(/^ws/, "http");
    roomService = new RoomServiceClient(host, env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);
  }
  return roomService;
}

/**
 * 供品留言即時推進房間。房間沒人 (尚未建立) 時 LiveKit 會回錯,直接忽略 ——
 * 之後進來的人本來就會從 API 載入留言列表。
 */
export async function broadcastTributeLivekit(tokenId: string, tribute: unknown): Promise<void> {
  if (ceremonyTransport() !== "livekit") return;
  const data = new TextEncoder().encode(JSON.stringify({ type: "tribute", tribute }));
  try {
    await service().sendData(ceremonyRoomName(tokenId), data, DataPacket_Kind.RELIABLE, {
      topic: CEREMONY_TOPIC,
    });
  } catch {
    /* 房間不存在或 LiveKit 暫時連不上:留言已存 DB,不影響 */
  }
}
