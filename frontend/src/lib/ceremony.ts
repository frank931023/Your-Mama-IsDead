"use client";

/**
 * 線上公祭即時通道
 *
 * 兩種通道,由後端 CEREMONY_TRANSPORT 決定 (GET /api/ceremony/:tokenId/connect):
 *   ws      — backend 的 ws://…/api/ceremony/:tokenId/ws (ceremony-hub.ts)
 *   livekit — LiveKit 房間:同樣的事件走 data channel,另外支援多人語音
 * LiveKit 連不上時自動退回 ws。兩種通道的事件格式相同,共用 handleMessage。
 *
 * 提供五種即時性:
 *   onlineCount   目前同在這頁追思的人數(presence)
 *   onTribute     有人(含自己)送出供品留言 — 以 id 去重後即時插入列表
 *   onRitual      「別人」的儀式動作(三鞠躬/點香) — 顯示氛圍通知
 *   peers         3D 靈堂化身:別人的位置/朝向/名字,持續同步
 *   voice         (僅 LiveKit) 麥克風開關、誰在說話
 *
 * 化身位置的效能設計:pos 更新走 ref(peersRef)原地改,**不觸發 React
 * re-render** — R3F 的 useFrame 每幀直接讀 ref 做內插;只有「名冊變動」
 * (有人進場/離場)才 bump peersVersion 讓元件列表重建。
 *
 * ws 模式由後端驗證與節流;LiveKit 模式訊息點對點轉送,改由接收端做同樣的
 * 白名單、長度限制、範圍夾限與節流 (sanitizePeerMessage)。
 *
 * sendRitual() 廣播儀式動作;sendPos() 廣播自己的化身位置(內建 10Hz 節流)。
 * 連線斷掉每 3 秒自動重連;unmount 時乾淨收掉。
 */
import * as React from "react";
import type { Room } from "livekit-client";
import { BACKEND_URL, fetchCeremonyConnect, ApiError, type CeremonyConnectInfo } from "./api";
import type { Tribute } from "./api";
import { getStoredInviteCode } from "./invite";

export type RitualKind = "bow" | "incense";
export type CeremonyTransport = "ws" | "livekit";

export interface PeerState {
  id: string;
  name?: string;
  /** 最新目標位置/朝向(網路值);渲染端向它內插。y = 跳躍高度(地面 0) */
  x: number;
  y: number;
  z: number;
  ry: number;
  /** 渲染端內插用的當前值(由 useFrame 原地更新) */
  cx: number;
  cy: number;
  cz: number;
  cry: number;
  /** 行禮動畫播到什麼時候(ms epoch);ritual 事件觸發 */
  bowUntil: number;
  lastSeen: number;
}

/** 多人語音 (只有 LiveKit 通道有)。 */
export interface CeremonyVoice {
  micOn: boolean;
  toggleMic: () => Promise<void>;
  micError: string | null;
  /** 瀏覽器擋了自動播放:要使用者點一下才聽得到別人的聲音 */
  needsAudioStart: boolean;
  startAudio: () => Promise<void>;
  /** 正在說話的其他人 (peer id) */
  speakingIds: ReadonlySet<string>;
}

interface UseCeremonyOptions {
  onTribute?: (t: Tribute) => void;
  onRitual?: (ritual: RitualKind, name?: string) => void;
  /** 別人的聊天氣泡(自己的本地即時顯示,不吃回音) */
  onChat?: (peerId: string, text: string, name?: string) => void;
  /** 是否加入語音 (3D 靈堂要;追悼頁只看人數與留言,不收聲音) */
  voice?: boolean;
}

interface CeremonyChannel {
  /** 目前在線追思人數(含自己);連線建立前為 0 */
  onlineCount: number;
  connected: boolean;
  transport: CeremonyTransport | null;
  sendRitual: (ritual: RitualKind, name?: string) => void;
  /** 廣播自己的化身位置(走動模式用);內建節流,可每幀呼叫。y = 跳躍高度 */
  sendPos: (x: number, y: number, z: number, ry: number, name?: string) => void;
  /** 退出走動模式:收掉自己的身影(連線與 presence 保留) */
  sendPosLeave: () => void;
  /** 發一則聊天氣泡(顯示在化身頭上,不落 DB) */
  sendChat: (text: string, name?: string) => void;
  /** 別人的化身(不含自己)。位置原地更新,名冊變動看 peersVersion */
  peersRef: React.MutableRefObject<Map<string, PeerState>>;
  /** 有人進場/離場時遞增 — 給 R3F 元件當 key 重建列表 */
  peersVersion: number;
  /** 語音控制;ws 通道或未要求語音時為 null */
  voice: CeremonyVoice | null;
}

/** 兩種通道共用的事件格式 (與 ceremony-hub.ts 廣播的相同)。 */
type InboundMessage =
  | { type: "presence"; count: number }
  | {
      type: "welcome";
      id?: string;
      peers?: Array<{ id: string; x: number; y?: number; z: number; ry: number; name?: string }>;
    }
  | { type: "pos"; id: string; x: number; y?: number; z: number; ry?: number; name?: string }
  | { type: "peer_leave"; id: string }
  | { type: "chat"; id: string; text: string; name?: string }
  | { type: "tribute"; tribute: Tribute }
  | { type: "ritual"; ritual: RitualKind; id?: string; name?: string };

type SendFn = (msg: Record<string, unknown>, opts?: { lossy?: boolean; to?: string[] }) => void;

const POS_SEND_INTERVAL_MS = 100; // 10Hz
const RETRY_MS = 3_000;
const LIVEKIT_TOPIC = "ceremony";

// 與 ceremony-hub.ts 相同的限制 (LiveKit 模式在接收端執行)
const RITUAL_MIN_INTERVAL_MS = 1_500;
const CHAT_MIN_INTERVAL_MS = 800;
const POS_MIN_INTERVAL_MS = 45;
const CHAT_MAX_LEN = 120;
const POS_RANGE = { x: 6, z: 10 };

interface PeerGuard {
  ritualAt?: number;
  chatAt?: number;
  posAt?: number;
  name?: string;
}

const clamp = (v: number, range: number): number => Math.max(-range, Math.min(range, v));
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const shortName = (v: unknown): string | undefined =>
  typeof v === "string" && v ? v.slice(0, 32) : undefined;

/** LiveKit 模式:把別人送來的原始訊息驗證、節流、夾限成標準事件;不合格回 null。 */
function sanitizePeerMessage(
  raw: Record<string, unknown>,
  id: string,
  guards: Map<string, PeerGuard>,
): InboundMessage | null {
  const guard = guards.get(id) ?? {};
  guards.set(id, guard);
  const now = Date.now();

  if (raw.type === "ritual" && (raw.ritual === "bow" || raw.ritual === "incense")) {
    if (guard.ritualAt && now - guard.ritualAt < RITUAL_MIN_INTERVAL_MS) return null;
    guard.ritualAt = now;
    return { type: "ritual", ritual: raw.ritual, id, name: shortName(raw.name) };
  }
  if (raw.type === "chat" && typeof raw.text === "string") {
    const text = raw.text.trim().slice(0, CHAT_MAX_LEN);
    if (!text) return null;
    if (guard.chatAt && now - guard.chatAt < CHAT_MIN_INTERVAL_MS) return null;
    guard.chatAt = now;
    return { type: "chat", id, text, name: shortName(raw.name) ?? guard.name };
  }
  if (raw.type === "pos_leave") return { type: "peer_leave", id };
  if (raw.type === "pos" && finite(raw.x) && finite(raw.z)) {
    if (guard.posAt && now - guard.posAt < POS_MIN_INTERVAL_MS) return null;
    guard.posAt = now;
    guard.name = shortName(raw.name) ?? guard.name;
    return {
      type: "pos",
      id,
      x: clamp(raw.x, POS_RANGE.x),
      y: finite(raw.y) ? Math.max(0, Math.min(4, raw.y)) : 0,
      z: clamp(raw.z, POS_RANGE.z),
      ry: finite(raw.ry) ? raw.ry : 0,
      name: guard.name,
    };
  }
  return null;
}

export function useCeremony(
  tokenId: string | number | undefined,
  opts: UseCeremonyOptions = {},
): CeremonyChannel {
  const wantVoice = opts.voice ?? false;
  const [onlineCount, setOnlineCount] = React.useState(0);
  const [connected, setConnected] = React.useState(false);
  const [transport, setTransport] = React.useState<CeremonyTransport | null>(null);
  const [peersVersion, setPeersVersion] = React.useState(0);
  const peersRef = React.useRef<Map<string, PeerState>>(new Map());
  const lastPosSentAt = React.useRef(0);
  const sendRef = React.useRef<SendFn | null>(null);
  /** 自己目前的化身位置;LiveKit 有新人進房時補發給他 (ws 版由後端的 welcome 名冊負責) */
  const ownPosRef = React.useRef<Record<string, unknown> | null>(null);

  // 語音 (LiveKit)
  const roomRef = React.useRef<Room | null>(null);
  const [micOn, setMicOn] = React.useState(false);
  const [micError, setMicError] = React.useState<string | null>(null);
  const [needsAudioStart, setNeedsAudioStart] = React.useState(false);
  const [speakingIds, setSpeakingIds] = React.useState<ReadonlySet<string>>(() => new Set());

  // callback 走 ref,避免呼叫端每次 render 傳新函式導致重連
  const optsRef = React.useRef(opts);
  optsRef.current = opts;

  React.useEffect(() => {
    if (tokenId === undefined || tokenId === null || `${tokenId}` === "") return;

    let disposed = false;
    let retryTimer: number | undefined;
    let teardown: (() => void) | null = null;
    const runTeardown = (): void => {
      const fn = teardown;
      teardown = null;
      fn?.();
    };

    const bumpPeers = (): void => setPeersVersion((v) => v + 1);

    const handleMessage = (msg: InboundMessage): void => {
      if (msg.type === "presence") {
        setOnlineCount(msg.count);
      } else if (msg.type === "welcome") {
        // 進房拿名冊:重建 peers map
        peersRef.current.clear();
        for (const p of msg.peers ?? []) {
          peersRef.current.set(p.id, {
            ...p,
            y: p.y ?? 0,
            cx: p.x,
            cy: p.y ?? 0,
            cz: p.z,
            cry: p.ry,
            bowUntil: 0,
            lastSeen: Date.now(),
          });
        }
        bumpPeers();
      } else if (msg.type === "pos") {
        const existing = peersRef.current.get(msg.id);
        if (existing) {
          existing.x = msg.x;
          existing.y = msg.y ?? 0;
          existing.z = msg.z;
          existing.ry = msg.ry ?? existing.ry;
          if (msg.name) existing.name = msg.name;
          existing.lastSeen = Date.now();
        } else {
          // 第一次看到這個化身 → 名冊變動
          peersRef.current.set(msg.id, {
            id: msg.id,
            name: msg.name,
            x: msg.x,
            y: msg.y ?? 0,
            z: msg.z,
            ry: msg.ry ?? 0,
            cx: msg.x,
            cy: msg.y ?? 0,
            cz: msg.z,
            cry: msg.ry ?? 0,
            bowUntil: 0,
            lastSeen: Date.now(),
          });
          bumpPeers();
        }
      } else if (msg.type === "peer_leave") {
        if (peersRef.current.delete(msg.id)) bumpPeers();
      } else if (msg.type === "chat") {
        optsRef.current.onChat?.(msg.id, msg.text, msg.name);
      } else if (msg.type === "tribute") {
        optsRef.current.onTribute?.(msg.tribute);
      } else if (msg.type === "ritual") {
        // 行禮的人有化身在場 → 讓他的身影行禮
        if (msg.ritual === "bow" && msg.id) {
          const peer = peersRef.current.get(msg.id);
          if (peer) peer.bowUntil = Date.now() + 2_600;
        }
        optsRef.current.onRitual?.(msg.ritual, msg.name);
      }
    };

    const resetState = (): void => {
      sendRef.current = null;
      setConnected(false);
      setOnlineCount(0);
      peersRef.current.clear();
      bumpPeers();
    };

    const scheduleRetry = (): void => {
      if (disposed) return;
      window.clearTimeout(retryTimer);
      retryTimer = window.setTimeout(() => void start(), RETRY_MS);
    };

    // ── ws 通道 ────────────────────────────────────────────────────────
    const startWs = (): void => {
      setTransport("ws");
      // 不公開塔位的公祭房間要驗邀請碼 (?code=);公開塔位帶了也無妨。
      const code = getStoredInviteCode(tokenId);
      const url = `${BACKEND_URL.replace(/^http/, "ws")}/api/ceremony/${tokenId}/ws${
        code ? `?code=${encodeURIComponent(code)}` : ""
      }`;
      const ws = new WebSocket(url);
      ws.onopen = () => {
        setConnected(true);
        sendRef.current = (msg) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
        };
      };
      ws.onmessage = (ev) => {
        try {
          handleMessage(JSON.parse(String(ev.data)) as InboundMessage);
        } catch {
          /* 格式不對的訊息直接略過 */
        }
      };
      ws.onclose = () => {
        resetState();
        scheduleRetry();
      };
      ws.onerror = () => ws.close();
      teardown = () => {
        ws.onclose = null;
        ws.close();
      };
    };

    // ── LiveKit 通道 ───────────────────────────────────────────────────
    const startLivekit = async (
      info: Extract<CeremonyConnectInfo, { transport: "livekit" }>,
    ): Promise<void> => {
      const lk = await import("livekit-client");
      const room = new lk.Room();
      const guards = new Map<string, PeerGuard>();
      const audioEls = new Set<HTMLMediaElement>();
      const encoder = new TextEncoder();
      const decoder = new TextDecoder();
      // 連線失敗時 Room 也會發 Disconnected;只有連上之後的斷線才走重連
      let established = false;

      const presence = (): void => handleMessage({ type: "presence", count: room.remoteParticipants.size + 1 });
      const publish: SendFn = (msg, { lossy = false, to } = {}) => {
        if (room.state !== lk.ConnectionState.Connected) return;
        room.localParticipant
          .publishData(encoder.encode(JSON.stringify(msg)), {
            reliable: !lossy,
            topic: LIVEKIT_TOPIC,
            ...(to ? { destinationIdentities: to } : {}),
          })
          .catch(() => undefined);
      };

      room
        .on(lk.RoomEvent.DataReceived, (payload, participant, _kind, topic) => {
          if (topic !== LIVEKIT_TOPIC) return;
          let raw: Record<string, unknown>;
          try {
            raw = JSON.parse(decoder.decode(payload)) as Record<string, unknown>;
          } catch {
            return;
          }
          if (!participant) {
            // 沒有發送者 = 後端 server API 推的,只接受供品留言
            if (raw.type === "tribute" && raw.tribute) {
              handleMessage({ type: "tribute", tribute: raw.tribute as Tribute });
            }
            return;
          }
          const msg = sanitizePeerMessage(raw, participant.identity, guards);
          if (msg) handleMessage(msg);
        })
        .on(lk.RoomEvent.ParticipantConnected, (participant) => {
          presence();
          // 新人看不到已站定的化身 → 補發自己的位置給他
          if (ownPosRef.current) publish(ownPosRef.current, { to: [participant.identity] });
        })
        .on(lk.RoomEvent.ParticipantDisconnected, (participant) => {
          presence();
          guards.delete(participant.identity);
          handleMessage({ type: "peer_leave", id: participant.identity });
        })
        .on(lk.RoomEvent.TrackSubscribed, (track) => {
          if (track.kind !== lk.Track.Kind.Audio) return;
          const el = track.attach();
          el.style.display = "none";
          document.body.appendChild(el);
          audioEls.add(el);
        })
        .on(lk.RoomEvent.TrackUnsubscribed, (track) => {
          for (const el of track.detach()) {
            el.remove();
            audioEls.delete(el);
          }
        })
        .on(lk.RoomEvent.AudioPlaybackStatusChanged, () => setNeedsAudioStart(!room.canPlaybackAudio))
        .on(lk.RoomEvent.ActiveSpeakersChanged, (speakers) => {
          setSpeakingIds(
            new Set(
              speakers.filter((s) => s.identity !== room.localParticipant.identity).map((s) => s.identity),
            ),
          );
        })
        .on(lk.RoomEvent.Disconnected, () => {
          if (disposed || !established) return;
          for (const el of audioEls) el.remove();
          audioEls.clear();
          roomRef.current = null;
          setMicOn(false);
          setSpeakingIds(new Set());
          resetState();
          scheduleRetry();
        });

      teardown = () => {
        // 先拔掉監聽,主動斷線才不會觸發 Disconnected → 重連
        room.removeAllListeners();
        for (const el of audioEls) el.remove();
        audioEls.clear();
        roomRef.current = null;
        void room.disconnect();
      };
      await room.connect(info.url, info.token, { autoSubscribe: wantVoice });
      if (disposed) {
        void room.disconnect();
        return;
      }
      established = true;
      roomRef.current = room;
      setTransport("livekit");
      setConnected(true);
      setNeedsAudioStart(wantVoice && !room.canPlaybackAudio);
      sendRef.current = publish;
      handleMessage({ type: "welcome", id: room.localParticipant.identity, peers: [] });
      presence();
    };

    const start = async (): Promise<void> => {
      if (disposed) return;
      runTeardown();
      let info: CeremonyConnectInfo = { transport: "ws" };
      try {
        info = await fetchCeremonyConnect(tokenId, getStoredInviteCode(tokenId));
      } catch (err) {
        // 公祭關閉 (私人塔位 / 邀請碼不對):不連線、不重試
        if (err instanceof ApiError && err.status === 403) return;
        /* 其他錯誤 (舊版後端沒有這個端點等) → 走 ws */
      }
      if (disposed) return;
      if (info.transport === "livekit") {
        try {
          await startLivekit(info);
          return;
        } catch (err) {
          console.warn("[ceremony] LiveKit 連線失敗,改用 WebSocket", err);
          runTeardown();
        }
      }
      if (!disposed) startWs();
    };

    void start();
    return () => {
      disposed = true;
      window.clearTimeout(retryTimer);
      runTeardown();
      sendRef.current = null;
    };
  }, [tokenId, wantVoice]);

  const sendRitual = React.useCallback((ritual: RitualKind, name?: string) => {
    sendRef.current?.({ type: "ritual", ritual, name });
  }, []);

  const sendPos = React.useCallback((x: number, y: number, z: number, ry: number, name?: string) => {
    const msg = { type: "pos", x, y, z, ry, name };
    ownPosRef.current = msg;
    const now = Date.now();
    if (now - lastPosSentAt.current < POS_SEND_INTERVAL_MS) return;
    if (!sendRef.current) return;
    lastPosSentAt.current = now;
    sendRef.current(msg, { lossy: true });
  }, []);

  const sendPosLeave = React.useCallback(() => {
    ownPosRef.current = null;
    sendRef.current?.({ type: "pos_leave" });
  }, []);

  const sendChat = React.useCallback((text: string, name?: string) => {
    sendRef.current?.({ type: "chat", text, name });
  }, []);

  const toggleMic = React.useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    setMicError(null);
    try {
      await room.localParticipant.setMicrophoneEnabled(!room.localParticipant.isMicrophoneEnabled);
    } catch (err) {
      setMicError(err instanceof Error ? err.message : String(err));
    }
    setMicOn(room.localParticipant.isMicrophoneEnabled);
  }, []);

  const startAudio = React.useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    await room.startAudio();
    setNeedsAudioStart(!room.canPlaybackAudio);
  }, []);

  const voice = React.useMemo<CeremonyVoice | null>(
    () =>
      transport === "livekit" && connected && wantVoice
        ? { micOn, toggleMic, micError, needsAudioStart, startAudio, speakingIds }
        : null,
    [transport, connected, wantVoice, micOn, toggleMic, micError, needsAudioStart, startAudio, speakingIds],
  );

  return {
    onlineCount,
    connected,
    transport,
    sendRitual,
    sendPos,
    sendPosLeave,
    sendChat,
    peersRef,
    peersVersion,
    voice,
  };
}
