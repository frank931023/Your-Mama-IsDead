/**
 * RenderChatClient — WebSocket 對話客戶端 + 音訊/表情同步播放器
 *
 * 直連自建 LAM 渲染機 (YMID-RENDER-API) 做即時說話頭對話。一條 WS 同時承載:
 *   - 文字:LLM token 以 TEXT frame (JSON) 串流回來 → onTextDelta。
 *   - 語音+表情:每「一句」一個 BINARY frame,內含該句的 WAV 音訊 + 逐幀
 *     ARKit 52 維 blendshape + 頭姿。我們把音訊排隊用 WebAudio 無縫播放,
 *     並維護一個「當前該顯示的表情 dict」,讓渲染器每幀來「拉」。
 *
 * 為什麼是「拉」不是「推」(關鍵架構)
 * ─────────────────────────────────────
 *   渲染器 (gaussian-splat-renderer-for-lam) 內部有自己的 rAF 30fps 時鐘,
 *   每一幀會主動 call 我們傳進去的 getExpressionData()。所以這個 class 不去
 *   push 表情給渲染器,而是隨音訊播放進度即時算出「此刻該顯示哪一幀的 52 維」,
 *   存成 currentExpression,由 getCurrentExpression() 同步回傳。表情與音訊的
 *   對齊完全以 AudioContext.currentTime 為準 (見下方表情時鐘)。
 *
 * 為什麼要 prebuffer ~3 秒才開播 (文件明確要求)
 * ─────────────────────────────────────────────
 *   TTS 是整條 pipeline 的瓶頸:chunk0 一到就播的話,後面的句子常常還沒生出來,
 *   會出現句與句之間的靜音斷層 (而且表情時鐘也會跟著卡)。所以累積已解碼音訊
 *   ≥ PREBUFFER_SEC,或收到 done 時 (整段已收完) 才開始播,換取連續不斷的輸出。
 */

// ── 渲染機二進位 chunk 的 meta ────────────────────────────────────────────────
// BINARY frame 佈局 (見 YMID-RENDER-API):
//   [4 bytes] uint32 LE  meta_len
//   [meta_len] UTF-8 JSON  meta (下面這個 interface)
//   [meta.audio_len] bytes  audio_wav (24kHz mono PCM16 WAV)
//   [meta.frames_len] bytes  float32 LE, shape (num_frames, 52) row-major
//   [meta.pose_len]   bytes  float32 LE, shape (num_frames, 3)  row-major (可能為 0)
interface ChunkMeta {
  type: "chunk";
  chunk_id: number;
  /** 實測:渲染機的 binary meta 不含此欄位,標為可選。 */
  request_id?: string;
  audio_len: number;
  frames_len: number;
  pose_len: number;
  pose_dim: number;
  num_frames: number;
  fps: number;
  sentence?: string;
}

/** 解出來的一句:已解碼音訊 + 對齊用的表情幀資料。 */
interface DecodedChunk {
  requestId: string;
  /** WebAudio 解碼後的可播放 buffer。 */
  audioBuffer: AudioBuffer;
  /** float32, 攤平的 (num_frames * 52)。取第 i 幀 = 子陣列 [i*52, i*52+52)。 */
  frames: Float32Array;
  /** float32, 攤平的 (num_frames * 3) 頭姿 axis-angle;沒有就是 null。 */
  pose: Float32Array | null;
  numFrames: number;
  fps: number;
}

/** 已排程在播 (或將播) 的一句,連同它在 AudioContext 時間軸上的起播時刻。 */
interface ScheduledChunk extends DecodedChunk {
  /** 這句音訊在 audioContext.currentTime 座標下的起播時刻 (秒)。 */
  startTime: number;
  /** 對應的 AudioBufferSourceNode,interrupt() 時用來 stop。 */
  source: AudioBufferSourceNode;
}

export interface RenderChatCallbacks {
  /** LLM 串流 token。 */
  onTextDelta?: (text: string) => void;
  /** 該 request 的文字串流結束 (對應 server 的 "done")。 */
  onDone?: () => void;
  /** server 回報錯誤,或本地解碼/播放異常。 */
  onError?: (msg: string) => void;
  /** 開始/結束出聲。供 UI 顯示「分身回應中…」之類狀態。 */
  onSpeakingChange?: (speaking: boolean) => void;
}

export interface SendChatOptions {
  messages: { role: string; content: string }[];
  voice?: string;
  temperature?: number;
  /** 由呼叫方 (LamAvatar.sendChat) 用 crypto.randomUUID() 生。 */
  requestId: string;
}

// Prebuffer:攢夠這麼多秒的音訊才開播,換取句與句之間不斷頓 (TTS RTF≈2.7,
// 合成比播放慢,文件建議預緩衝)。權衡:3s 首句太慢;1.2s 又太激進→句間斷頓。
// 1.8s 是平衡點。配合「AI 回覆變短」(見後端 persona prompt 的 conversation style),
// 句子變少、TTS 壓力小,斷頓會進一步緩解。
// 注:收到 done (整段已收完) 時無論是否攢夠都會立刻開播,短回覆不受此值拖延。
const PREBUFFER_SEC = 1.8;
// 兩句之間留一點 schedule 餘裕,避免極端情況下 source.start 落在過去時刻被丟棄。
const SCHEDULE_LOOKAHEAD_SEC = 0.05;
// ping 保活間隔。
const PING_INTERVAL_MS = 30_000;

/**
 * 52 維 ARKit 通道順序 (index → 名字)。照抄自 YMID-RENDER-API appendix。
 * index 51 文件未命名 → 留 null,轉 dict 時略過。
 */
const ARKIT_CHANNELS: readonly (string | null)[] = [
  "browDownLeft", // 0
  "browDownRight", // 1
  "browInnerUp", // 2
  "browOuterUpLeft", // 3
  "browOuterUpRight", // 4
  "cheekPuff", // 5
  "cheekSquintLeft", // 6
  "cheekSquintRight", // 7
  "eyeBlinkLeft", // 8
  "eyeBlinkRight", // 9
  "eyeLookDownLeft", // 10
  "eyeLookDownRight", // 11
  "eyeLookInLeft", // 12
  "eyeLookInRight", // 13
  "eyeLookOutLeft", // 14
  "eyeLookOutRight", // 15
  "eyeLookUpLeft", // 16
  "eyeLookUpRight", // 17
  "eyeSquintLeft", // 18
  "eyeSquintRight", // 19
  "eyeWideLeft", // 20
  "eyeWideRight", // 21
  "jawForward", // 22
  "jawLeft", // 23
  "jawOpen", // 24
  "jawRight", // 25
  "mouthClose", // 26
  "mouthDimpleLeft", // 27
  "mouthDimpleRight", // 28
  "mouthFrownLeft", // 29
  "mouthFrownRight", // 30
  "mouthFunnel", // 31
  "mouthLeft", // 32
  "mouthLowerDownLeft", // 33
  "mouthLowerDownRight", // 34
  "mouthPressLeft", // 35
  "mouthPucker", // 36
  "mouthRight", // 37
  "mouthRollLower", // 38
  "mouthRollUpper", // 39
  "mouthShrugLower", // 40
  "mouthShrugUpper", // 41
  "mouthSmileLeft", // 42
  "mouthSmileRight", // 43
  "mouthStretchLeft", // 44
  "mouthStretchRight", // 45
  "mouthUpperUpLeft", // 46
  "mouthUpperUpRight", // 47
  "noseSneerLeft", // 48
  "noseSneerRight", // 49
  "tongueOut", // 50
  null, // 51 (文件未命名,保留,忽略)
];

/**
 * 把某句 frames 的第 frameIndex 幀 (52 維) 轉成 渲染器要的 ARKit dict。
 *
 * 純函數,方便單測。遍歷 min(52, 該幀可用長度),只對有命名的 channel 寫入,
 * index 51 (null) 與超界一律略過。回傳 dict 的值即原始權重 (一般 0–1)。
 */
export function arkitFrameToDict(
  frames: Float32Array,
  frameIndex: number,
): Record<string, number> {
  const dict: Record<string, number> = {};
  const base = frameIndex * 52;
  const limit = Math.min(52, frames.length - base);
  for (let i = 0; i < limit; i++) {
    const name = ARKIT_CHANNELS[i];
    if (!name) continue; // index 51 或未命名 → 略過
    // noUncheckedIndexedAccess:frames[base+i] 型別是 number|undefined,
    // 但 i < limit 已保證在界內,用 ?? 0 收一下型別。
    dict[name] = frames[base + i] ?? 0;
  }
  return dict;
}

export class RenderChatClient {
  private ws: WebSocket | null = null;
  private readonly wsUrl: string;
  private readonly cbs: RenderChatCallbacks;

  // ── WebAudio ──
  // 懶建 + 需在使用者手勢後 resume (瀏覽器自動播放策略)。
  private audioCtx: AudioContext | null = null;

  // ── 播放佇列與時鐘 ──
  // decoded:已解碼、等待排程進播放序列的句子。
  private decoded: DecodedChunk[] = [];
  // scheduled:已 source.start() 排進音訊時間軸的句子 (含起播時刻),用來算當前幀。
  private scheduled: ScheduledChunk[] = [];
  // 下一句該接在哪個 audioContext 時刻起播 (無縫銜接)。
  private nextStartTime = 0;
  // 是否已經跨過 prebuffer 門檻、開始實際播放。
  private playbackStarted = false;
  // 已 decode 但尚未排程的音訊總時長 (秒),用來判斷 prebuffer 是否滿。
  private bufferedSec = 0;
  // 目前對外回報的 speaking 狀態,避免重複觸發 onSpeakingChange。
  private speaking = false;
  // 收到 done 後置 true:即使沒到 3s 也立刻開播 (整段已收完)。
  private streamDone = false;
  // 目前正在處理的 request,interrupt/新一輪對話時用來丟棄舊的殘留 frame。
  private activeRequestId: string | null = null;

  // 串接二進位 chunk 的解碼是非同步 (decodeAudioData),用一條 promise 鏈
  // 保證「解碼完成 → 入列」的順序和到達順序一致 (否則句子會錯亂)。
  private decodeChain: Promise<void> = Promise.resolve();

  // 監看播放進度的 rAF id (推進佇列、更新 speaking、算當前表情)。
  private rafId: number | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  constructor(wsUrl: string, callbacks: RenderChatCallbacks = {}) {
    this.wsUrl = wsUrl;
    this.cbs = callbacks;
  }

  // ── 連線 ──────────────────────────────────────────────────────────────────
  connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(this.wsUrl);
      } catch (err) {
        reject(err instanceof Error ? err : new Error("WebSocket 建立失敗"));
        return;
      }
      ws.binaryType = "arraybuffer";
      this.ws = ws;

      ws.onopen = (): void => {
        this.startPing();
        resolve();
      };
      ws.onerror = (): void => {
        // onopen 之前的 error → reject connect();之後的 → 轉成 onError。
        if (ws.readyState !== WebSocket.OPEN) {
          reject(new Error("WebSocket 連線失敗"));
        } else {
          this.cbs.onError?.("WebSocket 連線錯誤");
        }
      };
      ws.onclose = (): void => {
        this.stopPing();
      };
      ws.onmessage = (ev: MessageEvent): void => {
        this.handleMessage(ev.data);
      };
    });
  }

  // ── 發一輪對話 ───────────────────────────────────────────────────────────
  sendChat(opts: SendChatOptions): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      this.cbs.onError?.("WebSocket 尚未連線");
      return;
    }
    // 新一輪:先打斷上一輪殘留的音訊/表情,並標記新的 activeRequestId,
    // 之後到達的 frame 只認這個 id。
    this.interrupt();
    this.activeRequestId = opts.requestId;
    this.streamDone = false;

    const frame: Record<string, unknown> = {
      type: "chat",
      request_id: opts.requestId,
      messages: opts.messages,
    };
    if (opts.voice !== undefined) frame.voice = opts.voice;
    if (opts.temperature !== undefined) frame.temperature = opts.temperature;
    ws.send(JSON.stringify(frame));
  }

  // ── 訊息分流 ─────────────────────────────────────────────────────────────
  private handleMessage(data: unknown): void {
    if (typeof data === "string") {
      this.handleTextFrame(data);
    } else if (data instanceof ArrayBuffer) {
      this.handleBinaryFrame(data);
    }
    // 其餘 (Blob 等) 不會發生:binaryType 已設為 arraybuffer。
  }

  private handleTextFrame(text: string): void {
    let msg: { type?: string; text?: string; msg?: string; request_id?: string };
    try {
      msg = JSON.parse(text) as typeof msg;
    } catch {
      return; // 非 JSON 一律忽略
    }
    switch (msg.type) {
      case "text_delta":
        if (typeof msg.text === "string") this.cbs.onTextDelta?.(msg.text);
        break;
      case "done":
        // 文字串流結束。把 streamDone 拉起,讓 prebuffer 即使沒滿 3s 也開播。
        this.streamDone = true;
        this.maybeStartPlayback();
        this.cbs.onDone?.();
        break;
      case "error":
        this.cbs.onError?.(msg.msg ?? "render error");
        break;
      case "pong":
        break;
      default:
        break;
    }
  }

  // 解二進位 chunk:切出 meta / audio / frames / pose,然後丟去非同步解碼入列。
  private handleBinaryFrame(buf: ArrayBuffer): void {
    let meta: ChunkMeta;
    let audioBytes: ArrayBuffer;
    let frames: Float32Array;
    let pose: Float32Array | null;
    try {
      const view = new DataView(buf);
      const metaLen = view.getUint32(0, true); // LE
      let offset = 4;
      const metaBytes = new Uint8Array(buf, offset, metaLen);
      meta = JSON.parse(new TextDecoder("utf-8").decode(metaBytes)) as ChunkMeta;
      offset += metaLen;

      // audio (WAV bytes)。slice 出獨立的 ArrayBuffer 給 decodeAudioData
      // (decodeAudioData 會 detach 傳入的 buffer,所以必須是切出來的副本)。
      audioBytes = buf.slice(offset, offset + meta.audio_len);
      offset += meta.audio_len;

      // frames:float32 LE。用 slice 保證 4-byte 對齊 (Float32Array 直接套在
      // 非 4 對齊的 offset 上會 throw)。
      const framesSlice = buf.slice(offset, offset + meta.frames_len);
      frames = new Float32Array(framesSlice);
      offset += meta.frames_len;

      // pose:可能為 0 / 缺失。
      if (meta.pose_len > 0) {
        const poseSlice = buf.slice(offset, offset + meta.pose_len);
        pose = new Float32Array(poseSlice);
      } else {
        pose = null;
      }
    } catch (err) {
      this.cbs.onError?.(
        `解碼 chunk 失敗:${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }

    // 重要:渲染機的 binary chunk meta **不含 request_id**(實測確認:只有
    // type/chunk_id/audio_len/frames_len/pose_len/pose_dim/num_frames/fps/sentence)。
    // 早期版本誤以為 meta 有 request_id 並拿它過濾,導致 meta.request_id=undefined
    // 永遠 !== activeRequestId,所有 chunk 在解碼前被丟棄 → 沒聲音、不動嘴。
    // 改用「到達當下的 activeRequestId 快照」做 in-flight 判斷:同一輪內快照恆等於
    // activeRequestId (不丟);被 interrupt / 開新一輪後 activeRequestId 變了,舊
    // 閉包的快照不等 → 正確丟棄殘留。
    const reqSnapshot = this.activeRequestId;
    const numFrames = meta.num_frames;
    const fps = meta.fps;

    // 串行解碼:保證入列順序 = 到達順序 (decodeAudioData 是非同步的,
    // 若並行 await 後 push,句子可能亂序)。
    this.decodeChain = this.decodeChain.then(async () => {
      // 解碼前若已被 interrupt / 切到新一輪,丟棄這顆 (快照 != 當前 active)。
      if (reqSnapshot !== this.activeRequestId) return;
      const ctx = this.ensureAudioContext();
      let audioBuffer: AudioBuffer;
      try {
        audioBuffer = await ctx.decodeAudioData(audioBytes);
      } catch (err) {
        this.cbs.onError?.(
          `音訊解碼失敗:${err instanceof Error ? err.message : String(err)}`,
        );
        return;
      }
      if (reqSnapshot !== this.activeRequestId) return;

      this.decoded.push({ requestId: reqSnapshot ?? "", audioBuffer, frames, pose, numFrames, fps });
      this.bufferedSec += audioBuffer.duration;
      this.maybeStartPlayback();
    });
  }

  // ── 播放排程 ─────────────────────────────────────────────────────────────
  // 在 prebuffer 滿 (≥3s) 或串流已 done 時,把 decoded 佇列全部排進音訊時間軸。
  private maybeStartPlayback(): void {
    if (!this.playbackStarted) {
      const ready = this.bufferedSec >= PREBUFFER_SEC || this.streamDone;
      if (!ready || this.decoded.length === 0) return;
      this.playbackStarted = true;
      const ctx = this.ensureAudioContext();
      // 從「現在 + 一點點 lookahead」開始第一句。
      this.nextStartTime = ctx.currentTime + SCHEDULE_LOOKAHEAD_SEC;
      this.setSpeaking(true);
      this.startClock();
    }
    // 已開播:把目前 decoded 裡的句子全部接著排程上去。
    this.flushDecodedToSchedule();
  }

  // 把 decoded 佇列裡的句子依序 source.start() 排到 nextStartTime 之後,無縫銜接。
  private flushDecodedToSchedule(): void {
    if (!this.playbackStarted) return;
    const ctx = this.ensureAudioContext();
    while (this.decoded.length > 0) {
      const chunk = this.decoded.shift();
      if (!chunk) break;
      const source = ctx.createBufferSource();
      source.buffer = chunk.audioBuffer;
      source.connect(ctx.destination);
      // 起播時刻不能落在過去 (那會被瀏覽器立刻播,破壞對齊),取 max。
      const startTime = Math.max(this.nextStartTime, ctx.currentTime + SCHEDULE_LOOKAHEAD_SEC);
      source.start(startTime);
      this.scheduled.push({ ...chunk, startTime, source });
      // 下一句接在這句結束之後。
      this.nextStartTime = startTime + chunk.audioBuffer.duration;
    }
  }

  // ── 表情時鐘 ─────────────────────────────────────────────────────────────
  // 渲染器每幀來「拉」此刻該顯示的 52 維 dict。沒在說話 → 回空 dict (渲染器補 0)。
  getCurrentExpression(): Record<string, number> {
    const ctx = this.audioCtx;
    if (!ctx || !this.playbackStarted) return {};
    const now = ctx.currentTime;
    // 找出「現在正在播」的那一句:startTime ≤ now < startTime + 時長。
    for (const chunk of this.scheduled) {
      const end = chunk.startTime + chunk.audioBuffer.duration;
      if (now >= chunk.startTime && now < end) {
        const elapsed = now - chunk.startTime;
        let frameIndex = Math.floor(elapsed * chunk.fps);
        if (frameIndex < 0) frameIndex = 0;
        if (frameIndex >= chunk.numFrames) frameIndex = chunk.numFrames - 1;
        if (frameIndex < 0) return {}; // numFrames 為 0 的防呆
        return arkitFrameToDict(chunk.frames, frameIndex);
      }
    }
    return {};
  }

  // ── 頭姿時鐘 ─────────────────────────────────────────────────────────────
  // 回傳此刻 head bone 該套用的 axis-angle [x,y,z] (弧度)。
  //   - 正在說話且該句有 pose → 取對齊當前音訊幀的 backend 頭姿
  //   - 否則 (靜默 / 該句無 pose) → Lissajous 漂移,避免頭僵死
  // 與 getCurrentExpression 同一套音訊時鐘 (AudioContext.currentTime)。
  getCurrentHeadPose(): [number, number, number] {
    const ctx = this.audioCtx;
    if (ctx && this.playbackStarted) {
      const now = ctx.currentTime;
      for (const chunk of this.scheduled) {
        const end = chunk.startTime + chunk.audioBuffer.duration;
        if (now >= chunk.startTime && now < end) {
          if (chunk.pose && chunk.numFrames > 0) {
            let f = Math.floor((now - chunk.startTime) * chunk.fps);
            if (f < 0) f = 0;
            if (f >= chunk.numFrames) f = chunk.numFrames - 1;
            const off = f * 3;
            return [chunk.pose[off] ?? 0, chunk.pose[off + 1] ?? 0, chunk.pose[off + 2] ?? 0];
          }
          break; // 正在播但該句沒 pose → 落到 idle 漂移
        }
      }
    }
    // Idle Lissajous:三個略微錯開的頻率,永不重複。振幅對齊 chat.html
    // (pitch ±~1°, yaw ±~1.25°, roll ±~0.46°)。用 audio 時鐘,沒 ctx 時用 0。
    const t = ctx ? ctx.currentTime : 0;
    return [
      0.018 * Math.sin(t * 0.4),
      0.022 * Math.sin(t * 0.27 + 1.3),
      0.008 * Math.sin(t * 0.19 + 2.4),
    ];
  }

  // 監看時鐘:推進佇列 (排新句、回收播完的句)、維護 speaking 狀態。
  private startClock(): void {
    if (this.rafId != null) return;
    const tick = (): void => {
      this.advance();
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private stopClock(): void {
    if (this.rafId != null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private advance(): void {
    const ctx = this.audioCtx;
    if (!ctx) return;
    const now = ctx.currentTime;
    // 回收已經播完的句子 (now 超過其結束時刻)。保留尾巴 schedule 的句子。
    this.scheduled = this.scheduled.filter(
      (c) => now < c.startTime + c.audioBuffer.duration,
    );
    // 還有 decoded 待排 (例如剛 decode 出新句) → 接著排。
    if (this.decoded.length > 0) this.flushDecodedToSchedule();

    // 沒有正在播也沒有待排的句子,且串流已結束 → 視為說完。
    if (this.scheduled.length === 0 && this.decoded.length === 0 && this.streamDone) {
      this.setSpeaking(false);
      this.playbackStarted = false;
      this.bufferedSec = 0;
      this.nextStartTime = 0;
      this.stopClock();
    }
  }

  private setSpeaking(v: boolean): void {
    if (this.speaking === v) return;
    this.speaking = v;
    this.cbs.onSpeakingChange?.(v);
  }

  // ── 打斷 ─────────────────────────────────────────────────────────────────
  // 停掉所有音訊源 + 清空佇列 + 表情歸零。用於使用者打斷,或新一輪對話開頭。
  interrupt(): void {
    for (const c of this.scheduled) {
      try {
        c.source.stop();
        c.source.disconnect();
      } catch {
        /* 已停 / 已 disconnect */
      }
    }
    this.scheduled = [];
    this.decoded = [];
    this.bufferedSec = 0;
    this.nextStartTime = 0;
    this.playbackStarted = false;
    this.streamDone = false;
    // 不清 activeRequestId:sendChat 會在 interrupt 之後自己設新的;
    // 純使用者打斷時,清掉它讓殘留 in-flight chunk 被丟棄。
    this.activeRequestId = null;
    this.setSpeaking(false);
    this.stopClock();
  }

  // ── AudioContext 生命週期 ────────────────────────────────────────────────
  private ensureAudioContext(): AudioContext {
    if (!this.audioCtx) {
      const AC =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      this.audioCtx = new AC();
    }
    if (this.audioCtx.state === "suspended") {
      void this.audioCtx.resume();
    }
    return this.audioCtx;
  }

  /**
   * 在使用者手勢內呼叫:同步 resume AudioContext + 靜音播一個空 buffer,
   * 滿足瀏覽器自動播放策略 (否則之後 await 完 TTS 再播時 context 仍 suspended,
   * 不出聲也不動嘴)。可重複呼叫。
   */
  unlockAudio(): void {
    const ctx = this.ensureAudioContext();
    try {
      const buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);
      src.start(0);
    } catch {
      /* best-effort unlock */
    }
  }

  // ── ping 保活 ────────────────────────────────────────────────────────────
  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      const ws = this.ws;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "ping" }));
      }
    }, PING_INTERVAL_MS);
  }

  private stopPing(): void {
    if (this.pingTimer != null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  // ── 關閉 ─────────────────────────────────────────────────────────────────
  close(): void {
    this.interrupt();
    this.stopPing();
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onopen = null;
      ws.onclose = null;
      ws.onerror = null;
      ws.onmessage = null;
      try {
        ws.close();
      } catch {
        /* best-effort */
      }
    }
    const ctx = this.audioCtx;
    this.audioCtx = null;
    if (ctx && ctx.state !== "closed") {
      void ctx.close();
    }
  }
}
