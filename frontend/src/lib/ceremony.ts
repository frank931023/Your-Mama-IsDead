"use client";

/**
 * 線上公祭即時通道 — 連 backend 的 ws://…/api/ceremony/:tokenId/ws
 *
 * 提供四種即時性:
 *   onlineCount   目前同在這頁追思的人數(presence)
 *   onTribute     有人(含自己)送出供品留言 — 以 id 去重後即時插入列表
 *   onRitual      「別人」的儀式動作(三鞠躬/點香) — 顯示氛圍通知
 *   peers         3D 靈堂化身:別人的位置/朝向/名字,持續同步
 *
 * 化身位置的效能設計:pos 更新走 ref(peersRef)原地改,**不觸發 React
 * re-render** — R3F 的 useFrame 每幀直接讀 ref 做內插;只有「名冊變動」
 * (有人進場/離場)才 bump peersVersion 讓元件列表重建。
 *
 * sendRitual() 廣播儀式動作;sendPos() 廣播自己的化身位置(內建 10Hz 節流)。
 * 連線斷掉每 3 秒自動重連;unmount 時乾淨收掉。
 */
import * as React from "react";
import { BACKEND_URL } from "./api";
import type { Tribute } from "./api";
import { getStoredInviteCode } from "./invite";

export type RitualKind = "bow" | "incense";

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

interface UseCeremonyOptions {
  onTribute?: (t: Tribute) => void;
  onRitual?: (ritual: RitualKind, name?: string) => void;
  /** 別人的聊天氣泡(自己的本地即時顯示,不吃回音) */
  onChat?: (peerId: string, text: string, name?: string) => void;
}

interface CeremonyChannel {
  /** 目前在線追思人數(含自己);連線建立前為 0 */
  onlineCount: number;
  connected: boolean;
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
}

const POS_SEND_INTERVAL_MS = 100; // 10Hz

export function useCeremony(
  tokenId: string | number | undefined,
  opts: UseCeremonyOptions = {},
): CeremonyChannel {
  const [onlineCount, setOnlineCount] = React.useState(0);
  const [connected, setConnected] = React.useState(false);
  const [peersVersion, setPeersVersion] = React.useState(0);
  const wsRef = React.useRef<WebSocket | null>(null);
  const peersRef = React.useRef<Map<string, PeerState>>(new Map());
  const lastPosSentAt = React.useRef(0);

  // callback 走 ref,避免呼叫端每次 render 傳新函式導致重連
  const optsRef = React.useRef(opts);
  optsRef.current = opts;

  React.useEffect(() => {
    if (tokenId === undefined || tokenId === null || `${tokenId}` === "") return;

    let disposed = false;
    let retryTimer: number | undefined;

    const connect = (): void => {
      if (disposed) return;
      // 不公開塔位的公祭房間要驗邀請碼 (?code=);公開塔位帶了也無妨。
      const code = getStoredInviteCode(tokenId);
      const url = `${BACKEND_URL.replace(/^http/, "ws")}/api/ceremony/${tokenId}/ws${
        code ? `?code=${encodeURIComponent(code)}` : ""
      }`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => setConnected(true);
      ws.onmessage = (ev) => {
        let msg: {
          type?: string;
          count?: number;
          tribute?: Tribute;
          ritual?: string;
          name?: string;
          id?: string;
          text?: string;
          x?: number;
          y?: number;
          z?: number;
          ry?: number;
          peers?: Array<{ id: string; x: number; y?: number; z: number; ry: number; name?: string }>;
        };
        try {
          msg = JSON.parse(String(ev.data));
        } catch {
          return;
        }

        if (msg.type === "presence" && typeof msg.count === "number") {
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
          setPeersVersion((v) => v + 1);
        } else if (msg.type === "pos" && msg.id && typeof msg.x === "number" && typeof msg.z === "number") {
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
            setPeersVersion((v) => v + 1);
          }
        } else if (msg.type === "peer_leave" && msg.id) {
          if (peersRef.current.delete(msg.id)) setPeersVersion((v) => v + 1);
        } else if (msg.type === "chat" && msg.id && typeof msg.text === "string") {
          optsRef.current.onChat?.(msg.id, msg.text, msg.name);
        } else if (msg.type === "tribute" && msg.tribute) {
          optsRef.current.onTribute?.(msg.tribute);
        } else if (msg.type === "ritual" && (msg.ritual === "bow" || msg.ritual === "incense")) {
          // 行禮的人有化身在場 → 讓他的身影行禮
          if (msg.ritual === "bow" && msg.id) {
            const peer = peersRef.current.get(msg.id);
            if (peer) peer.bowUntil = Date.now() + 2_600;
          }
          optsRef.current.onRitual?.(msg.ritual, msg.name);
        }
      };
      ws.onclose = () => {
        setConnected(false);
        setOnlineCount(0);
        peersRef.current.clear();
        setPeersVersion((v) => v + 1);
        if (!disposed) retryTimer = window.setTimeout(connect, 3_000);
      };
      ws.onerror = () => ws.close();
    };

    connect();
    return () => {
      disposed = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [tokenId]);

  const sendRitual = React.useCallback((ritual: RitualKind, name?: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "ritual", ritual, name }));
    }
  }, []);

  const sendPos = React.useCallback((x: number, y: number, z: number, ry: number, name?: string) => {
    const now = Date.now();
    if (now - lastPosSentAt.current < POS_SEND_INTERVAL_MS) return;
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      lastPosSentAt.current = now;
      ws.send(JSON.stringify({ type: "pos", x, y, z, ry, name }));
    }
  }, []);

  const sendPosLeave = React.useCallback(() => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "pos_leave" }));
    }
  }, []);

  const sendChat = React.useCallback((text: string, name?: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "chat", text, name }));
    }
  }, []);

  return { onlineCount, connected, sendRitual, sendPos, sendPosLeave, sendChat, peersRef, peersVersion };
}
