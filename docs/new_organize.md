# 新版架構整理 · Onboarding 筆記

> 你剛 clone 下來的版本,跟你之前看過的差很多。這份文件把所有改動 + 新技術一次說清楚。讀完應該能心裡有底,不會盲飛。

---

## 0. 一頁摘要

| 面向 | 舊版本(你之前的) | 新版本(同學改的) |
|---|---|---|
| LLM | 雲端(OpenAI / Anthropic) | **本地 Qwen3-14B**(可選,vLLM 推理)+ 雲端 fallback |
| 對話「真實感」 | 純 metadata system prompt | **+ RAG**:從逝者真實對話紀錄中檢索片段注入 prompt |
| 視訊頭像 | Simli (純雲端服務,綁信用卡) | **+ 自建 LAM 3DGS**:一張照片建出 3D 模型,瀏覽器 WebGL 直接渲染 |
| 語音 | OpenAI TTS / ElevenLabs | **+ IndexTTS2**:本地語音克隆,聲音真的像本人 |
| 表情同步 | Simli 黑箱處理 | **+ LAM Audio2Expression + ArTalk**:語音 → 嘴型 blendshape + 頭部姿勢,前端 WebGL 自己渲 |
| 對話紀錄上傳 | 有,但只是釘 IPFS 沒用 | **真的拿去用** — chunk + embed + 存 pgvector 做 RAG |
| 向量資料庫 | Qdrant(原本規劃) | **pgvector**(Postgres 內建擴充,簡單很多) |

**最大的單一改動**:多了一台「自建渲染機」(YMID-RENDER-API),把 Qwen、IndexTTS2、LAM、ArTalk 全部裝在一台 GPU 機器上,backend 當作中介幫前端代理請求並簽 JWT 授權。

---

## 1. 新架構圖

```
       ┌─────────────────────────────────────────────────────┐
       │ 家屬瀏覽器 (Next.js + WebGL)                          │
       │                                                       │
       │  ┌──────────────┐    ┌────────────────────────────┐  │
       │  │ ChatInterface│ ←→ │ LamAvatar(3DGS WebGL 渲染) │  │
       │  └──────┬───────┘    └────────────┬───────────────┘  │
       └─────────┼─────────────────────────┼───────────────────┘
                 │ (SIWE 簽 JWT)            │ WebSocket
                 ▼                          │ (帶 render JWT)
       ┌──────────────────────┐             │
       │ Backend (Fastify)    │             │
       │ ─ /api/auth/*        │             │
       │ ─ /api/tablets/*     │             │
       │ ─ /api/personas/*    │             │
       │ ─ /api/avatar/*      │ ←─代理建構─→│
       │                      │             │
       │ ─ lib/rag.ts (RAG)   │←─embed───┐  │
       │ ─ lib/render.ts (JWT)│          │  │
       └──────┬────────┬──────┘          │  │
              │        │                 │  │
              ▼        ▼                 ▼  ▼
       ┌──────────┐ ┌──────────┐  ┌──────────────────────────┐
       │ Postgres │ │  Redis   │  │ 自建渲染機 (Tailscale)    │
       │+pgvector │ │ (BullMQ) │  │ 100.122.149.34:8012      │
       │ Tablet   │ │          │  │                          │
       │ Memory   │ │          │  │ ┌────────────────────┐   │
       │ Chunk(VEC)│ │          │  │ │ vLLM + Qwen3-14B   │   │
       └──────────┘ └──────────┘  │ │ IndexTTS2 (語音)   │   │
                                  │ │ LAM AIGC3D (3DGS)  │   │
       ┌──────────────────────┐   │ │ LAM Audio2Expr     │   │
       │ IPFS (Pinata)        │   │ │ ARTalk (頭部姿勢)  │   │
       │ ├─ tablet metadata   │   │ └────────────────────┘   │
       │ ├─ 大頭照              │   └──────────────────────────┘
       │ ├─ 影音                │
       │ └─ 對話紀錄(LINE etc.) │   ┌──────────────────────────┐
       └──────────────────────┘   │ 可選雲端 fallback         │
                                  │ ─ OpenAI / Anthropic     │
       ┌──────────────────────┐   │ ─ ElevenLabs / Simli      │
       │ Ethereum Sepolia     │   │ ─ fal.ai (圖/短片)        │
       │ DigitalTablet NFT    │   └──────────────────────────┘
       └──────────────────────┘
```

**讀法**:
- 左半邊都是你已經熟的東西(瀏覽器/backend/Postgres/IPFS/Ethereum)
- 右邊那一團「自建渲染機」是這版的核心新增
- 雲端 fallback 都還在,沒接 GPU 也能跑(品質差一點)

---

## 2. 自建渲染機是什麼 — **最大的新東西**

### 為什麼要自己架?

之前用 Simli + OpenAI 全部走雲:
- 每次對話都送資料給 OpenAI/Simli,**隱私性零**
- 每分鐘 ~$0.15,demo 5 分鐘就燒掉 $0.75
- 語音是 Simli 預設臉 + OpenAI 標準音色,**不是逝者本人**

自建渲染機解決三件事:
1. **逝者的真實素材不出機房**(只在 Tailscale 內網,backend ↔ render 之間)
2. **一次付清 GPU 成本**,推理不再每次計費
3. **真的克隆出本人的聲音 + 臉**,而不是套模板

### 實體與網路

```
┌────────────────────┐
│ 同學家裡的 GPU 機    │     ←── 跑了 6 個服務的一台機器
│ (RTX 3090/4090 之類) │
│                    │
│ • vLLM + Qwen3-14B │  ←── 量化 AWQ 版,~7GB VRAM
│ • IndexTTS2        │  ←── 語音克隆
│ • LAM AIGC3D       │  ←── 3DGS 頭像建模
│ • LAM Audio2Expr   │  ←── 嘴型/blendshape
│ • ArTalk           │  ←── 頭部姿勢
│ • FastAPI :8012    │  ←── 統一暴露這幾個服務的 endpoint
└────────────────────┘
        ▲
        │ Tailscale (encrypted private network)
        │
┌────────────────────┐
│ 你跑 backend 的電腦   │
└────────────────────┘
```

Tailscale 是個「VPN-as-a-service」,讓兩台不同 NAT 後的電腦能直接互相連線。同學的 GPU 機器 IP 對你而言就是 `100.122.149.34`,只要你裝了同個 Tailscale 帳號就連得到。

### Backend 怎麼跟它溝通?

`backend/src/lib/render.ts` 是專屬 client。三件事:

1. **單次資產建構**(mint 時):
   - 家屬上傳照片 → backend `/api/avatar/build` → 轉送 render `/upload_avatar` → 等 ~100 秒 → 拿到一份 3DGS zip URL → 寫進 metadata
   - 家屬上傳語音樣本 → `/api/avatar/build-voice` → IndexTTS2 訓出 voice profile → 拿到 label

2. **聊天時開 WebSocket**:
   - 前端打 `POST /api/personas/:tokenId/avatar-session`
   - Backend 用 `RENDER_JWT_SECRET`(跟 render 機器共享)**簽一個短時效 HS256 JWT**,內含 `persona/voice/avatar` 資訊
   - 把 `wss://...?token=<jwt>` 回給前端
   - 前端用 `gaussian-splat-renderer-for-lam` 開 WS,直連 render 機

3. **為什麼不讓前端直接連 render?**:Chrome 會擋「公網 → 私網 IP」的 WS 連線(私網位址洩漏防護),所以 WebSocket 走 backend `/api/avatar/ws` 做反向代理。

---

## 3. 六大新技術逐個說明

### 3.1 vLLM + Qwen3-14B-AWQ(本地 LLM)

**是什麼**:
- **Qwen3** 是阿里通義千問的開源 LLM 系列,14B 參數(中等大小,跟 GPT-3.5 規模相近)
- **AWQ** 是一種量化方法,把 16-bit float 壓到 4-bit,記憶體佔用從 ~28GB 降到 ~7GB,效能損失很小
- **vLLM** 是推理引擎,專門優化 LLM serving 的吞吐量(continuous batching + paged attention),比 transformers 直接跑快 10 倍以上

**在我們系統的位置**:取代 OpenAI / Anthropic 當「逝者對話的腦」。前端送一串 messages 過去,vLLM 串流回 token。**對話內容完全不離開渲染機**。

**為什麼選 Qwen 不選 Llama**:中文回答品質明顯較好,而我們的家屬講中文。

---

### 3.2 RAG + pgvector(讓 LLM 真的記得逝者怎麼說話)

**是什麼**:
- **RAG**(Retrieval-Augmented Generation)的核心邏輯是:**LLM 回答前先查資料庫找相關內容,把找到的塞進 prompt 再讓 LLM 回**
- 為什麼這比「全部塞 system prompt」好?LLM 的 context length 有限,塞不下幾百則 LINE 對話。RAG 只塞最相關的 4 條,精準又省 token

**怎麼運作**:

```
家屬把逝者的 LINE 訊息 export 出來 → 上傳到 IPFS
                ↓ (mint 後一鍵 reindex)
   1. backend 從 IPFS 拉下 chatlog
   2. 解析 → 只保留「逝者本人說的那些」訊息
   3. 切成 ~120 字的小段(chunk)
   4. 用 multilingual-e5-small 模型把每段轉成 384 維向量
   5. 存進 pgvector(Postgres 的向量擴充)
   
家屬在 chat 問:「爸,你還記得我國中時嗎?」
                ↓
   1. 把這句問題也 embed 成 384 維向量
   2. SQL 找 top-4 距離最近的 chunk(餘弦相似)
   3. 把這 4 條注入 system prompt
   4. LLM 看到「以下是這個人真實說過的話 [...]」+ 使用者問題 → 回答
                ↓
   回答的語氣、口頭禪、用詞,真的會像本人
```

**pgvector 是什麼**:Postgres 的擴充模組,新增 `vector(N)` 欄位型別 + 向量距離函數(`<->` cosine, `<#>` inner product)。優點是不用另外架 Qdrant / Pinecone,SQL 就能查。

**程式碼位置**:
- 嵌入模型:`backend/src/lib/embedding.ts`(`@xenova/transformers` 在 Node 本地跑,模型 ~110MB 首次自動下載)
- RAG 主邏輯:`backend/src/lib/rag.ts`
- 資料表:`MemoryChunk`(Prisma schema)

---

### 3.3 LAM 3DGS(3D Gaussian Splatting 頭像)

**是什麼**:
- **3D Gaussian Splatting**(3DGS)是 2023 年發表的 3D 場景表示法。傳統 3D 模型用三角網格 + 紋理,3DGS 改用幾百萬顆「高斯橢球」雲堆出來。優點是渲染極快、可微分(對 AI 訓練友善)、品質高
- **LAM**(Large Animatable Models,亦稱 LAM AIGC3D)是 AlibabaResearch 的工作,可以從**一張單獨照片**重建出一個可動畫的 3DGS 頭像

**在我們的流程**:
1. 家屬 mint 時上傳逝者的清晰正面照
2. backend 轉送 LAM,backend block 等 ~100 秒
3. LAM 回一個 .zip 內含這個頭像的 splat 資料(幾百萬顆高斯橢球的位置 / 顏色 / 透明度)
4. 把這個 zip 的 URL 寫進 metadata.dsas.avatar
5. 之後家屬開 chat,瀏覽器**直接下載這個 zip**,在 WebGL 渲染

**為什麼比 Simli 強**:
- Simli 是 2D 影片串流(雲端算好,串給你),頻寬高、互動延遲約 200ms
- 3DGS 是真 3D 模型,**本地渲染**,可以旋轉視角、零延遲、不串影片
- 缺點:首次載入 zip 比較慢(~5-10MB)

---

### 3.4 IndexTTS2(本人語音克隆)

**是什麼**:Bilibili 開源的中英文 TTS 模型,可以**少量樣本**(5-30 秒參考音檔)就克隆出一個聲音。發出來的語音品質接近 ElevenLabs,但不用付每月訂閱。

**怎麼用**:
1. 家屬上傳逝者的語音檔(訪談 / LINE 語音 / 影片擷取的音檔都行)
2. backend 轉送 render `/upload_voice`
3. IndexTTS2 抽取聲紋(voice profile),回一個 label
4. 寫進 metadata.dsas.avatar.voiceLabel
5. 之後 chat 每次 LLM 回應,render 機用這個 label 把文字轉成「本人聲音」的 PCM 音訊

---

### 3.5 LAM Audio2Expression + ArTalk(嘴型同步 + 頭部姿勢)

光有 3D 頭像和聲音還不夠,**嘴要跟著音訊動才像活的**。這兩個模型分工:

- **LAM Audio2Expression**:輸入語音 PCM,輸出 ARKit 標準的 **52 維 blendshape** 序列(blendshape 是 3D 角色臉部變形係數,例如「眼睛閉 0.3」「左嘴角上揚 0.7」)。每秒生成 ~30 frame 的表情
- **ArTalk**:輸入語音,輸出**頭部 3D 旋轉**(pitch / yaw / roll),讓頭隨節奏微微擺動,不會看起來像殭屍

兩者的輸出跟著音訊 PCM 一起透過 WebSocket binary frame 傳給前端,前端的 WebGL 渲染器在每個 rAF 把當下對應的 blendshape + 頭部旋轉套到 3DGS 上。

---

### 3.6 WebGL + gaussian-splat-renderer-for-lam(前端渲染)

**是什麼**:`gaussian-splat-renderer-for-lam` 是個 npm 套件(Three.js 寫的),專門渲染 LAM 格式的 3DGS,**並接受 blendshape + 頭部姿勢輸入**。

**為什麼非要 WebGL2**:3DGS 渲染需要 GPU shader 排序幾百萬顆高斯橢球,純 CPU 慢到不能看。WebGL2 才有夠用的 compute capability。

**Fallback**:`WebGLGuard.tsx` 元件偵測瀏覽器不支援 WebGL2 → 顯示「請用最新版 Chrome / Edge」,避免直接黑屏。

---

### 3.7 LiveKit?(澄清:沒用)

你提到 LiveKit,但實際上**這專案沒有自建 LiveKit server**。LiveKit 只在一個地方出現:

```ts
// frontend/src/components/SimliAvatar.tsx
client.start(..., "livekit");
```

那是告訴 Simli SDK「請用 LiveKit 當 WebRTC SFU 後端」 — Simli 自家服務內部用 LiveKit 的開源 SFU,但對我們而言**是黑箱**。你不需要懂或自己跑 LiveKit。

我們的 LAM 流程**沒走 WebRTC**,走的是 **WebSocket binary frame**(PCM + blendshape + 頭部姿勢),簡單很多。

---

## 4. 端到端資料流

### Mint 階段(只做一次)

```
家屬開 /mint
   ↓ 填基本資料 + 上傳大頭照 + 上傳語音樣本 + 上傳對話紀錄
   ↓
   ├─→ 大頭照 → IPFS (Pinata)
   ├─→ 語音樣本 → IPFS
   ├─→ 對話紀錄 (LINE export 等) → IPFS
   ↓
   ├─→ /api/avatar/build (大頭照)
   │     └─→ LAM AIGC3D 建 3DGS(~100s)
   │           └─→ 拿到 avatarLabel + avatarUrl
   ├─→ /api/avatar/build-voice (語音)
   │     └─→ IndexTTS2 抽聲紋
   │           └─→ 拿到 voiceLabel
   ↓
   組裝 TabletMetadata {
     deceased: {...},
     assets: { portrait, photos, audios, chatlogs },
     avatar: { avatarLabel, avatarUrl, voiceLabel }
   }
   ↓
   metadata.json → IPFS → 拿到 metadata CID
   ↓
   合約 mintRoot(family wallet, "ipfs://<metadata CID>")
   ↓
   交易上鏈 ✓
   ↓
家屬點塔位詳情頁的 [重建記憶索引]:
   ↓ POST /api/personas/:id/reindex-memory
   ↓ backend 把 chatlogs 全部 chunk + embed → MemoryChunk
   ↓ 完成,顯示「已索引 N 段記憶」
```

### Chat 階段(每次對話)

```
家屬進塔位詳情頁 → 點【啟動數位分身】→ 選「雲端即時喚起」
   ↓ SIWE 簽名 (要證明是 owner)
   ↓ 拿到 backend JWT (Authorization Bearer)
   ↓
進入 /tablet/:id/chat?mode=cloud
   ↓
ChatInterface 偵測 cloudStatus.avatarProvider:
   ├─ "lam"   → 走自建渲染機 (LamAvatar 元件)
   └─ "simli" → 走 Simli 雲端 (SimliAvatar 元件,fallback)
   ↓
LAM 路徑:
   1. GET /api/personas/:id/persona-prompt (取 system prompt,不含 RAG)
   2. POST /api/personas/:id/avatar-session
      └─→ backend 簽 render JWT
      └─→ 回傳 wss://.../render?token=<JWT>
   3. 前端 WebSocket 連 render 機 (走 backend proxy)
   4. 載入 avatarUrl 的 3DGS zip → WebGL 初始化頭像
   
家屬打字 → 送出:
   1. GET /api/personas/:id/persona-prompt?q=<question>  ★ 帶 q!
        └─→ backend 對問題做 RAG 檢索
        └─→ 拿到 4 條相關記憶
        └─→ 回 prompt = base + "[記憶]\n...真實對話片段..." 
   2. 把 messages = [system: prompt, ...history, user: question] 全部送 WS
   3. render 機 vLLM 跑 Qwen → 串流回 token
      同時 IndexTTS2 把句子轉成 PCM,LAM Audio2Expr 算 blendshape,ArTalk 算頭部
      全部透過 WS binary frame 送回前端
   4. 前端:
      - LLM token → 顯示對話 bubble
      - PCM → AudioContext 排程播放
      - blendshape + head pose → 渲染器每 frame 套到 3DGS
   5. 家屬看到:逝者的臉真的在說話,聲音是本人的,口氣帶著上傳對話紀錄裡的影子
```

---

## 5. DB / Metadata 結構變動

### Prisma(`backend/prisma/schema.prisma`)

新增 model:

```prisma
model MemoryChunk {
  id        String   @id
  tokenId   BigInt              // 屬於哪個塔位
  text      String   @db.Text   // 切片後的對話片段(~120字)
  sourceUri String              // 來自哪個 chatlog IPFS URI
  platform  String?             // "line" / "telegram" / ...
  speaker   String?             // 通常是逝者本人姓名
  embedding Unsupported("vector(384)")?  // pgvector 384 維
  createdAt DateTime @default(now())
  @@index([tokenId])
}
```

Postgres 需要先裝 pgvector 擴充。`docker-compose.yml` 已經改用 `pgvector/pgvector:pg16` image 自帶。

Tablet model 也加了 `simliFaceId` / `simliFaceStatus`(舊版 Simli 路徑相容,新版主路徑是 LAM,這些欄位 LAM 模式用不到)。

### Metadata schema(`shared/types/tablet.ts`)

`Assets` 加 `chatlogs`:
```ts
chatlogs?: ChatLogEntry[];  // [{ platform, uri, format }, ...]
```

`AvatarConfig` 擴充(這是 mint 時就寫進 metadata,給 chat 時讀):
```ts
interface AvatarConfig {
  // 舊 Simli 路徑
  simliFaceId?: string;
  
  // 新 LAM 路徑
  avatarLabel?: string;     // render 機回傳的識別碼
  avatarUrl?: string;       // 3DGS zip 完整 URL
  voiceLabel?: string;      // IndexTTS2 voice profile 識別碼
}
```

---

## 6. 新增 .env 必填項

整理 `backend/src/lib/env.ts` 新欄位:

```ini
# ── 自建渲染機(必要,沒設則 LAM 路徑全部不可用)──
RENDER_BASE=http://100.122.149.34:8012
RENDER_JWT_SECRET=<跟同學要,要跟 render 機共用>
RENDER_JWT_AUDIENCE=ymid-render        # 預設值
RENDER_TOKEN_TTL_SECONDS=1800           # 30 分鐘

# ── 可選雲端 fallback(沒 render 機就靠這些)──
ANTHROPIC_API_KEY=...
OPENAI_API_KEY=...
ELEVENLABS_API_KEY=...
SIMLI_API_KEY=...
FAL_API_KEY=...
```

**怎麼判斷你能不能用 LAM 路徑**:
1. 你的電腦得安裝 Tailscale,加入同學的 tailnet
2. `ping 100.122.149.34` 通了才算
3. 然後填上 `RENDER_BASE` + `RENDER_JWT_SECRET`(跟同學要,**別貼到網路**)

沒 Tailscale 也能跑 — 系統會自動降到雲端 fallback(OpenAI + Simli 那套),但效果會差很多。

---

## 7. 你現在要做什麼

### 想跑起來看(雲端 fallback 模式,最簡單)

```powershell
# 1. 確認 docker / postgres 啟動
.\start.ps1

# 2. backend 用 npm run dev 跑起來(前提是 .env 至少有 OPENAI 或 ANTHROPIC key)
# 3. 前端 npm run dev
# 4. 進 /baibai 或 /mint 體驗
```

LAM 那塊會自動降級成 Simli / 純文字。

### 想跑完整 LAM 路徑

跟同學要這幾個:
- Tailscale 邀請(讓你加入他的 tailnet,能直連 render 機)
- `RENDER_JWT_SECRET` 的值
- 確認 `RENDER_BASE` 指向他的 render 機 IP / port

設好 .env → backend 視窗 Ctrl+C 重啟 → 進 /tablet/:id/chat?mode=cloud 應該就會看到 3DGS 頭像。

### 想了解 RAG 怎麼運作

最快路徑:
1. 讀 [backend/src/lib/rag.ts](../backend/src/lib/rag.ts)(~364 行) — 是整個 RAG 邏輯的單一檔案
2. 讀 [backend/src/lib/embedding.ts](../backend/src/lib/embedding.ts)(~78 行) — 模型載入
3. 觀察 `MemoryChunk` 表跟 `<->` 向量距離 SQL

### 想了解 render 機通訊協議

1. [docs/server/YMID-RENDER-API.md](server/YMID-RENDER-API.md) — render 機 API 規格,binary frame 格式都在這
2. [frontend/src/lib/render-chat.ts](../frontend/src/lib/render-chat.ts) — 前端 WS 客戶端,看怎麼解析 binary frame
3. [backend/src/lib/render.ts](../backend/src/lib/render.ts) — backend JWT 簽發 + 資產建構代理

---

## 8. 重要術語對照表

| 術語 | 全名 | 一句話 |
|---|---|---|
| RAG | Retrieval-Augmented Generation | LLM 答題前先檢索資料庫找相關片段塞 prompt |
| 3DGS | 3D Gaussian Splatting | 用幾百萬顆高斯橢球表示 3D 場景,渲染快、品質高 |
| LAM | Large Animatable Models | Alibaba 從單張照片重建可動畫 3D 頭像的模型族 |
| ArTalk | (Audio-driven head pose) | 從音訊推估說話時的頭部 3D 旋轉 |
| IndexTTS2 | (TTS by Bilibili) | 開源語音克隆 TTS,中英文都行 |
| vLLM | (LLM serving engine) | LLM 推理的高吞吐引擎,paged attention + continuous batching |
| pgvector | Postgres vector extension | SQL 直接做向量相似度搜尋的擴充 |
| AWQ | Activation-aware Weight Quantization | LLM 4-bit 量化方法,品質損失小、記憶體省 4 倍 |
| blendshape | (3D animation primitive) | 一組 0-1 的臉部變形係數,例:眼閉、嘴角上揚 |
| ARKit blendshape | Apple ARKit's 52-dim spec | 業界事實標準的 blendshape 命名(Apple 帶頭) |
| Tailscale | (Mesh VPN) | 不用設定的 VPN,讓不同網路的電腦點對點直連 |
| SFU | Selective Forwarding Unit | WebRTC 多人通訊的中繼伺服器(Simli 內部用,我們不用) |

---

## 9. 你可能會踩的雷

1. **`docker compose up` 失敗 "Bind for ... port already allocated"**: Windows Hyper-V 動態保留 port。修法在之前的 PowerShell 對話裡(用 admin 重啟 winnat,或改 docker-compose 用 127.0.0.1:15432)。

2. **`Error: P1001: Can't reach database server`**: 同上,通常是 port 沒對。確認 `docker port your-mama-isdead-postgres-1` 跟 `.env` DATABASE_URL 對得起來。

3. **`@xenova/transformers` 第一次跑很慢**: 它會自動下載 multilingual-e5-small 模型(~110MB),只發生一次。不要中斷。

4. **WebGL 黑屏**: 用 Edge 或 Chrome 最新版。Firefox 對 WebGL2 compute 支援不完整。

5. **Render WS 連不上**: 99% 是 Tailscale 沒裝、沒加入,或 `RENDER_BASE` 寫成 mDNS 名稱而非 IP。

6. **`prisma migrate dev` 失敗 "extension vector does not exist"**: Postgres image 沒換成 pgvector 版。檢查 `docker-compose.yml` 的 postgres image 是不是 `pgvector/pgvector:pg16`。

---

## 10. 一句話總結每個目錄

| 目錄 | 重點 |
|---|---|
| `contracts/` | DigitalTablet NFT (ERC-721 + ERC-6150 家族樹) — 跟前一版差不多 |
| `backend/` | 多了 RAG (`lib/rag.ts` + `embedding.ts`)、render 機 client (`lib/render.ts`)、`/api/avatar/*` 路由 |
| `frontend/` | 多了 `LamAvatar.tsx` (WebGL 3DGS)、`render-chat.ts` (WS client)、`WebGLGuard.tsx` |
| `shared/types/` | TabletMetadata 加 `chatlogs` + 擴充 `AvatarConfig` |
| `docs/` | `server/YMID-RENDER-API.md` 是 render 機協議規格,值得讀一次 |
| `compute/` | 跟舊版差不多,本來規劃的 Python 推理服務,LAM 出現後角色變模糊 |
| `training/` | 離線 LoRA 訓練腳本,**現在主路徑用 LAM 即時推理,訓練 pipeline 用得少了** |
| `storage/` | IStorageProvider + 多 driver(Pinata / Arweave / local),沒大變動 |

---

如果讀完還有不懂的地方,把具體檔名 / 段落丟給我,我可以再展開講。
