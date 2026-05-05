# DSAS Prototype 開發規劃書

> 本文件是 [idea.md](idea.md) 的工程落地計畫,將「數位塔位 / 主權數位先祖系統」的三層架構切成可實作的 prototype,涵蓋:**身分層(智能合約)、儲存層(Arweave/Irys)、運算層(AI 推理)、後端服務、前端介面、線下訓練腳本**。

---

## 一、Prototype 範疇與目標

### 1.1 願景 vs Prototype
| 維度 | 完整願景 | Prototype 範圍(本期) |
|---|---|---|
| 鏈 | Mainnet 多鏈部署 | **單一 Testnet**(Sepolia 或 Base Sepolia) |
| NFT 標準 | ERC-721 + ERC-6150 | ERC-721 + 自寫 minimal ERC-6150 |
| 合約工具鏈 | Foundry(部署 mainnet) | **Foundry**(testnet,免費水龍頭領 ETH) |
| 儲存 | Arweave 永久 + 備援節點 | **預設 IPFS (Pinata / web3.storage)**,Arweave/Irys 留 driver 可切換 |
| 視覺生成 | SDXL / Flux + LoRA + LivePortrait | **SDXL + LoRA**(LivePortrait 預留 hook) |
| 聲音 | ElevenLabs / GPT-SoVITS | **GPT-SoVITS**(本地)或 ElevenLabs API(可選) |
| 對話 | RAG + 多模態 LLM | **RAG + 任一 LLM**(OpenAI / 本地 Llama) |
| 算力 | 去中心化 GPU 網路 | 本地單機 GPU(訓練)+ 雲端推理 API |
| 付款驗證 | USDC + 法幣 | **錢包簽名驗證持有 NFT**(免實際扣款) |

### 1.2 為什麼這樣選(關鍵取捨說明)

**身分層為何「真的」上鏈?**
專案核心論述是「鏈上家譜 + NFT 持有 = 數據主權」,用 DB 模擬會直接打臉 idea.md 的價值主張。Sepolia / Base Sepolia testnet 完全免費(水龍頭領 ETH),沒有理由不做真合約。

**儲存層為何 prototype 不直接上 Arweave?**
- Arweave 主網要真錢(AR token);Irys 主網雖便宜也是付費
- Irys devnet 免費但會定期清空,demo 後資料消失,等於整個 NFT 變廢卡
- 開發階段頻繁迭代,每次測試都付費 / 被清空都不可接受

**改採 IPFS + Pinata/web3.storage 的好處**:
1. **免費**(Pinata 1GB / web3.storage 5GB 額度)
2. CID 內容定址,跟 Arweave 一樣不可竄改、可驗證
3. metadata 用 `ipfs://<cid>` 或 `ar://<txid>` 都能塞進 NFT `tokenURI`,前端 gateway 兩種都讀得到
4. 後期切 Arweave 只是換 driver(`storage/src/providers/`) + 改 URI prefix,**合約完全不動,前端只需多加一個 gateway 解析**

> 「永久儲存」是 idea 層的承諾。Prototype 用 IPFS + Pin 證明「資料主權 + 內容可定址」就足以支撐論述,之後再上 Arweave 不會浪費既有實作。

### 1.2 完成定義(Definition of Done)
完成本 prototype 後,使用者可以:
1. 在前端連接錢包,鑄造一張屬於某位「逝者」的塔位 NFT,並建立子代節點(ERC-6150 層級)。
2. 上傳該逝者的照片/音檔/文字,系統將大檔上傳至 Arweave/Irys,小型 metadata 寫入 NFT `tokenURI`。
3. 執行**線下訓練腳本**(獨立 CLI),依該 NFT 的素材訓練出 LoRA 權重 + 聲音模型 + RAG 索引,訓練產物上傳回 Arweave 並回填到 NFT metadata。
4. 在前端點「啟動數位分身」 → 後端驗證錢包持有對應 NFT → 載入訓練產物 → 產出文字回覆 + AI 影像 + AI 語音,於前端串流播放。

---

## 二、Repo 目錄結構

```
Your-Mama-IsDead/
├── idea.md                       # 既有願景文件
├── PROTOTYPE_PLAN.md             # 本文件
├── README.md                     # 開發者入口、quick start
├── .env.example                  # 共用環境變數範本
├── docker-compose.yml            # 本地一鍵起服務(DB / vector store / minio)
│
├── contracts/                    # 【身分層】Hardhat / Foundry 專案
│   ├── src/
│   │   ├── DigitalTablet.sol     # ERC-721 + ERC-6150 主合約
│   │   ├── TabletMinter.sol      # 鑄造權限 / 角色管理
│   │   └── interfaces/
│   ├── script/                   # 部署與 seed 腳本
│   ├── test/                     # Foundry 測試
│   └── foundry.toml
│
├── storage/                      # 【儲存層】Provider 抽象,支援多 driver 切換
│   ├── src/
│   │   ├── providers/
│   │   │   ├── IStorageProvider.ts  # 共用介面
│   │   │   ├── pinata.ts            # ★ prototype 預設(IPFS)
│   │   │   ├── web3storage.ts       # IPFS 備選
│   │   │   ├── irys.ts              # 未來切 Arweave 用
│   │   │   └── local.ts             # MinIO / 本地檔案(離線開發)
│   │   ├── chatlog/
│   │   │   ├── parser.ts            # 各平台對話紀錄轉統一 schema
│   │   │   ├── line.ts
│   │   │   ├── whatsapp.ts
│   │   │   ├── facebook.ts
│   │   │   ├── instagram.ts
│   │   │   ├── telegram.ts
│   │   │   └── discord.ts
│   │   ├── metadata_builder.ts   # 組 NFT tokenURI JSON
│   │   ├── uri.ts                # 統一處理 ipfs:// / ar:// gateway 解析
│   │   └── encryption.ts         # 可選端對端加密(家屬私鑰)
│   ├── test/
│   └── package.json
│
├── compute/                      # 【運算層】推理服務(線上,非訓練)
│   ├── app/
│   │   ├── main.py               # FastAPI 入口
│   │   ├── routers/
│   │   │   ├── persona.py        # 對話 + 圖像生成 + TTS 串流
│   │   │   ├── auth.py           # 錢包簽名 + NFT 持有驗證
│   │   │   └── assets.py         # 從 Arweave 抓取訓練產物
│   │   ├── services/
│   │   │   ├── lora_runner.py    # SDXL + LoRA 推理
│   │   │   ├── tts_runner.py     # GPT-SoVITS / ElevenLabs 呼叫
│   │   │   ├── rag_engine.py     # 向量檢索 + LLM 生成
│   │   │   └── chain_verifier.py # 連 RPC 查 ownerOf / balanceOf
│   │   └── models/
│   ├── Dockerfile
│   └── requirements.txt
│
├── backend/                      # 【應用後端】薄層 API,接前端 / DB / 鏈
│   ├── src/
│   │   ├── server.ts             # Express / Fastify / NestJS
│   │   ├── routes/
│   │   │   ├── tablets.ts        # CRUD 塔位元資料(離鏈快取)
│   │   │   ├── uploads.ts        # 將檔案轉送至 storage 服務
│   │   │   ├── jobs.ts           # 訓練任務狀態查詢
│   │   │   └── personas.ts       # 代理至 compute 服務
│   │   ├── db/                   # Prisma schema(Postgres)
│   │   └── queue/                # BullMQ / Redis 任務佇列
│   └── package.json
│
├── frontend/                     # 【前端】Next.js + wagmi/viem
│   ├── app/
│   │   ├── (marketing)/          # 介紹頁
│   │   ├── tablet/[tokenId]/     # 單一塔位頁(看照片、生平、互動)
│   │   ├── mint/                 # 鑄造流程(三步:基本資料 → 上傳素材 → 簽名)
│   │   ├── lineage/              # ERC-6150 家族樹視覺化
│   │   └── api/                  # Next route handlers(BFF)
│   ├── components/
│   │   ├── WalletConnect.tsx
│   │   ├── ChatInterface.tsx     # 串流文字 + 同步 AI 圖像 + 語音
│   │   ├── MediaUploader.tsx     # 拖拉上傳,回傳 Arweave TXID
│   │   └── FamilyTree.tsx
│   ├── lib/
│   │   ├── wagmi.ts
│   │   └── contract.ts           # 合約 ABI + 互動封裝
│   └── package.json
│
├── training/                     # 【線下訓練腳本】(★ 獨立保留)
│   ├── README.md                 # 訓練流程文件
│   ├── pipelines/
│   │   ├── 01_fetch_assets.py    # 從 Arweave 拉素材至本地 workspace
│   │   ├── 02_caption_images.py  # BLIP-2 / LLaVA 自動打標
│   │   ├── 03_train_lora.py      # SDXL LoRA 訓練(rank 16/32)
│   │   ├── 04_train_voice.py     # GPT-SoVITS 微調
│   │   ├── 05_build_rag.py       # 文本切片 + embedding + 向量庫匯出
│   │   ├── 06_package_artifact.py# 打包 LoRA + voice + RAG 索引
│   │   └── 07_upload_artifact.py # 上傳至 Arweave 並回填 NFT metadata
│   ├── configs/                  # 各模型 YAML 設定(rank、學習率等)
│   ├── workspace/                # 本地暫存(.gitignore)
│   └── requirements.txt          # torch, diffusers, peft, sentence-transformers...
│
├── shared/                       # 跨服務共用型別
│   └── types/
│       ├── tablet.ts             # NFT metadata schema
│       └── artifact.ts           # 訓練產物 manifest schema
│
└── docs/
    ├── architecture.md           # 系統架構圖(mermaid)
    ├── data-flow.md              # 從鑄造 → 訓練 → 互動的時序圖
    ├── contracts.md              # 合約規格與測試策略
    └── threat-model.md           # 安全 / 隱私 / 倫理風險
```

---

## 三、身分層 — 智能合約

### 3.1 合約設計

**`DigitalTablet.sol`** 繼承自 OpenZeppelin `ERC721` 與自實作 `IERC6150`(以及 `IERC6150Enumerable`、`IERC6150ParentTransferable`)。

核心狀態:
- `mapping(uint256 => uint256) parentOf` — 每個 tokenId 指向其父節點
- `mapping(uint256 => uint256[]) childrenOf` — 反向索引
- `mapping(uint256 => string) artifactURI` — 訓練產物的 Arweave URI(可後續更新)

關鍵 function:
```solidity
function mintRoot(address to, string calldata tokenURI_) external onlyMinter returns (uint256);
function safeMintWithParent(address to, uint256 parentId, string calldata tokenURI_) external returns (uint256);
function setArtifactURI(uint256 tokenId, string calldata uri) external onlyHolderOrAdmin;
function isRoot(uint256 tokenId) external view returns (bool);
function parentOf(uint256 tokenId) external view returns (uint256);
function childrenOf(uint256 tokenId) external view returns (uint256[] memory);
```

### 3.2 鑄造權限模型(prototype 用「白名單模式」)
- 部署時 deployer 取得 `MINTER_ROLE`
- 持有者可呼叫 `safeMintWithParent` 為自己持有的塔位開子節點(對應 idea.md §3.4 第二種模式)
- 預留 `setSuccessor(tokenId, address)`,為未來「自動觸發模式」鋪路,但 prototype 不啟用

### 3.3 測試策略
- Foundry unit test:
  - 鑄造 / 父子關係 / 巡訪
  - 權限檢查(非持有者不可開子節點)
  - `tokenURI` 與 `artifactURI` 雙軌可變性
  - Gas 消耗 baseline(避免 6150 巡訪導致 O(n²))
- 部署到 Sepolia / Base Sepolia,以 forge script 驗證

### 3.4 與其他層的接口
- 後端透過 `viem` + RPC 呼叫 `ownerOf(tokenId)` 驗證簽名來源
- 前端透過 `wagmi` 直接呼叫合約進行讀寫
- 訓練腳本完成後呼叫 `setArtifactURI` 更新產物指針

---

## 四、儲存層 — Arweave / Irys

### 4.1 Provider 抽象(prototype 重點)

定義 `IStorageProvider` 介面,實作三個 driver,以 env 切換:

```ts
// storage/src/providers/index.ts
interface IStorageProvider {
  putBlob(data: Buffer, contentType: string, tags?: Tag[]): Promise<string>;  // 回 URI: ipfs://... / ar://...
  putJSON(obj: object, tags?: Tag[]): Promise<string>;
  resolve(uri: string): Promise<Buffer>;        // 從 URI 拉資料(任何 driver 都能讀任何 URI)
  gatewayUrl(uri: string): string;              // 給前端 <img src> 用
}

// 實作:
// - PinataProvider     (預設,prototype 用)
// - Web3StorageProvider (備選)
// - IrysProvider        (上 Arweave 時切換,程式碼已備好)
```

env:`STORAGE_DRIVER=pinata | web3storage | irys`

### 4.2 上傳策略

| 資料類型 | Prototype 走哪 | 未來 |
|---|---|---|
| NFT JSON metadata(<10KB) | IPFS (Pinata) | Arweave |
| 照片 / 影片 / 音檔 / 對話紀錄 | IPFS (Pinata / web3.storage) | Irys → Arweave |
| 訓練產物(LoRA safetensors / RAG index) | IPFS | Irys → Arweave |

Tags(IPFS 沒 native tag,寫進 metadata 內;Irys/Arweave 用 native tag):
`App-Name=DSAS`, `Token-Id=<id>`, `Asset-Type=photo|video|audio|chatlog|artifact`

### 4.3 NFT Metadata Schema(`shared/types/tablet.ts`)

對應使用者需求,塔位**鏈上可見的核心欄位**:逝者照片、姓名、籍貫、生卒年月日、陽世子孫名。

```jsonc
{
  // ─── ERC-721 標準欄位(錢包 / OpenSea 直接顯示)──────────────
  "name": "王大明",
  "description": "1940 年生於台灣彰化,2024 年逝於台北。生前任職教師四十年...",
  "image": "ipfs://<portrait-cid>",            // 逝者代表照(大頭照)
  "external_url": "https://dsas.app/tablet/42",

  // ─── 標準 attributes(可被 OpenSea 等渲染為屬性卡)─────────
  "attributes": [
    { "trait_type": "姓名",     "value": "王大明" },
    { "trait_type": "性別",     "value": "男" },
    { "trait_type": "籍貫",     "value": "台灣彰化" },
    { "trait_type": "出生日期", "display_type": "date", "value": -940204800 },  // unix
    { "trait_type": "逝世日期", "display_type": "date", "value": 1704067200 },
    { "trait_type": "享壽",     "value": 84 },
    { "trait_type": "世代",     "value": 0 }                                    // ERC-6150 深度
  ],

  // ─── DSAS 自定義 namespace ──────────────────────────────────
  "dsas": {
    "version": "1.0",
    "deceased": {
      "name":           "王大明",
      "alias":          ["阿明", "明仔"],
      "gender":         "male",
      "origin":         "台灣彰化縣鹿港鎮",
      "birth":          { "date": "1940-02-15", "place": "彰化鹿港" },
      "death":          { "date": "2024-01-01", "place": "台北" },
      "biography":      "...",
      "epitaph":        "一生清淨,教書育人"
    },

    // 陽世子孫(ERC-6150 鏈上層級為主,此處為快照,方便前端不查鏈也能渲染)
    "descendants": [
      { "name": "王小華", "relation": "長子",   "tokenId": 47, "wallet": "0x..." },
      { "name": "王小美", "relation": "次女",   "tokenId": 48, "wallet": "0x..." },
      { "name": "王孫一", "relation": "長孫",   "tokenId": 53, "wallet": "0x..." }
    ],

    // 上傳的素材(分類)
    "assets": {
      "portrait":  "ipfs://<cid>",                    // 主大頭照(同 image,但保留高解析)
      "photos":    ["ipfs://<cid>", "ipfs://<cid>"],  // 生前照片集
      "videos":    ["ipfs://<cid>"],                  // 生前影片
      "audios":    ["ipfs://<cid>"],                  // 錄音(訪談、語音訊息)
      "texts":     ["ipfs://<cid>"],                  // 日記、文章、信件
      "chatlogs":  [                                   // 對話紀錄(LINE / WhatsApp / FB / IG)
        { "platform": "line",     "uri": "ipfs://<cid>", "format": "json" },
        { "platform": "whatsapp", "uri": "ipfs://<cid>", "format": "txt"  },
        { "platform": "facebook", "uri": "ipfs://<cid>", "format": "html" }
      ]
    },

    // AI 訓練產物
    "artifact": {
      "lora":     "ipfs://<lora-cid>",
      "voice":    "ipfs://<voice-cid>",
      "rag":      "ipfs://<rag-cid>",
      "manifest": "ipfs://<manifest-cid>"
    },

    // 同意聲明(倫理 / 法律)
    "consent": {
      "declaredBy": "0x...",         // 鑄造者錢包
      "statement":  "本人聲明持有逝者之肖像、聲音、文字使用同意...",
      "signedAt":   "2026-05-05T12:00:00Z"
    }
  }
}
```

> **關鍵**:`descendants` 在 metadata 中是「快照」,**權威來源是 ERC-6150 的鏈上父子關係**。家屬新增子孫時走鑄造流程,並可選擇是否同步更新此 metadata(走 `tokenURI` 更新)。

### 4.4 對話紀錄(chatlogs)的處理

社群/通訊軟體匯出格式不一,前端提供 importer:

| 平台 | 匯出方式 | 格式 |
|---|---|---|
| LINE | 聊天室「設定 → 傳送聊天紀錄」 | `.txt`(會夾貼圖標記) |
| WhatsApp | 聊天設定 → 匯出聊天 | `.txt` + 媒體檔 |
| Facebook Messenger | Meta「下載您的資訊」 | `.json` / `.html` |
| Instagram DM | 同上 | `.json` |
| Telegram | 桌面版「Export Chat History」 | `.json` / `.html` |
| Discord | 第三方工具(`DiscordChatExporter`) | `.json` |

**Prototype 上傳流程**:
1. 家屬選平台 → 上傳檔案
2. 前端 `MediaUploader.tsx` 呼叫 `parseChatLog(platform, file)` → 產出統一 schema
3. 統一 schema 上傳 IPFS,原檔案也保留(雙份)
4. 訓練腳本 `05_build_rag.py` 直接吃統一 schema,跨平台對話一視同仁

統一 schema 範例:
```json
{
  "platform": "line",
  "participants": ["王大明", "王小華"],
  "deceasedName": "王大明",
  "messages": [
    { "ts": "2023-12-01T10:00:00+08:00", "from": "王大明", "text": "今天去看醫生了" },
    { "ts": "2023-12-01T10:02:00+08:00", "from": "王小華", "text": "醫生怎麼說?" }
  ]
}
```

> **隱私警告**:對話紀錄含活人,公開上 IPFS = 永久公開。Prototype UI 必須警示家屬,並提供「僅上傳已逝者單方訊息」過濾選項;敏感模式可走 §4.5 加密。

### 4.5 上傳流程(以 IPFS 為例)
1. 前端選檔 → POST `/api/uploads/presign` 後端回傳 Pinata signed JWT
2. 前端直接以 Pinata SDK 上傳(不走後端中轉,省頻寬)
3. 拿到 CID 後,前端組 metadata JSON,再次上傳取得 metadata CID
4. 前端拿 `ipfs://<metadata-cid>` 呼叫合約 `safeMintWithParent(parentId, "ipfs://...")`

### 4.6 隱私考量(預留)
- 公共素材(姓名、生卒、大頭照、生平)預設**公開**(對應「鏈上家譜」精神)
- 對話紀錄、私密音檔等敏感素材,實作 `encryption.ts` 提供可選 AES-256-GCM 加密,key 由家屬主錢包推導(EIP-712 簽名 → HKDF)
- prototype 階段以 flag 切換,不擋主流程

---

## 五、運算層 — AI 推理服務

### 5.1 服務拆分原因
**`compute/`** 與 **`backend/`** 拆兩個服務:
- `backend` (Node/TS):薄、快、處理鏈互動 + 任務排程 + DB
- `compute` (Python/FastAPI):重、吃 GPU,處理 LoRA / TTS / RAG

兩者透過 HTTP + 共享 Redis 任務佇列協作。

### 5.2 線上推理 API(prototype)
| Endpoint | 說明 |
|---|---|
| `POST /persona/{tokenId}/chat` | 串流 SSE 文字回覆(RAG + LLM) |
| `POST /persona/{tokenId}/portrait` | 給 prompt → 回傳 LoRA 生成圖(支援 SD 1.5 / SDXL) |
| `POST /persona/{tokenId}/voice` | 給文字 → 回傳語音檔(GPT-SoVITS / ElevenLabs) |
| `GET  /persona/{tokenId}/manifest` | 該塔位目前載入的 artifact 版本 |

### 5.3 持有驗證流程
1. 前端要求使用者用錢包簽署 nonce(EIP-4361 SIWE)
2. 後端 `auth.py` 驗證簽章 → 從合約查 `ownerOf(tokenId)` → 比對地址
3. 通過則發 JWT(短期),後續呼叫 persona endpoints 帶 token

### 5.4 模型載入策略
- `lora_runner.py` 採 **lazy load + LRU**:第一次互動該 tokenId 才下載 LoRA、TTS 模型,並快取在 `/tmp/persona_cache/<tokenId>/`
- 互動結束(SSE 連線關閉)5 分鐘後 GC,呼應 idea.md §六「快取資料刪除,原始資料永遠留存於 Arweave」

### 5.5 RAG 引擎
- 向量庫:**Chroma**(本地)或 **Qdrant**(docker-compose 起)
- Embedding:`sentence-transformers/multilingual-e5-large`(中英混合語料友善)
- LLM:可切換 OpenAI `gpt-4o-mini` 或本地 `llama-3.1-8b-instruct`
- prompt 模板強制以「逝者口吻」回覆,並夾帶生平摘要 + top-k 檢索段落

---

## 六、後端服務(應用層)

### 6.1 職責
- 接前端 REST/GraphQL,處理 session、付款記錄(prototype 為假錢包簽名)、任務佇列
- DB: **Postgres** 透過 Prisma 管理離鏈快取(NFT 索引、訓練任務狀態)
- Queue: **BullMQ + Redis** 處理上傳、訓練排程通知

### 6.2 主要 schema
```prisma
model Tablet {
  tokenId      BigInt   @id
  owner        String
  parentTokenId BigInt?
  tokenURI     String
  artifactURI  String?
  createdAt    DateTime @default(now())
  trainingJobs TrainingJob[]
}

model TrainingJob {
  id          String   @id @default(cuid())
  tokenId     BigInt
  status      JobStatus // QUEUED | RUNNING | UPLOADED | DONE | FAILED
  artifactCid String?
  startedAt   DateTime?
  finishedAt  DateTime?
  tablet      Tablet   @relation(fields: [tokenId], references: [tokenId])
}
```

### 6.3 任務流程
```
前端上傳完素材 → POST /api/jobs (建立 TrainingJob, status=QUEUED)
                        ↓
              Worker 通知線下訓練機(可手動觸發)
                        ↓
線下機跑完 → POST /api/jobs/:id/complete (帶 artifact TXID)
                        ↓
            backend 呼叫合約 setArtifactURI → status=DONE
```

> **注意**:prototype 訓練不在伺服器自動跑,而是由開發者本地 GPU 執行(避免雲端 GPU 成本)。後端只負責「狀態同步」與「artifact 回填」。

---

## 七、前端

### 7.1 技術選型
- **Next.js 14 (App Router) + TypeScript**
- **wagmi v2 + viem** — 合約互動
- **RainbowKit** — 錢包連線 UI
- **Tailwind + shadcn/ui** — UI 元件
- **react-flow / d3** — 家族樹視覺化
- **@irys/sdk** — 前端直傳大檔(免後端中轉,省頻寬)

### 7.2 主要頁面
| 路由 | 說明 |
|---|---|
| `/` | 介紹頁(願景、運作方式) |
| `/mint` | 鑄造流程(基本資料 → 素材上傳 → 簽名 → 完成) |
| `/tablet/[tokenId]` | 單一塔位頁 — 照片牆、生平、家族脈絡、「啟動數位分身」按鈕 |
| `/tablet/[tokenId]/chat` | 互動介面 — 文字串流 + AI 影像 + 語音播放 |
| `/lineage/[rootId]` | ERC-6150 家族樹 |
| `/dashboard` | 我持有的所有塔位 + 訓練狀態 |

### 7.3 互動 UI 重點
- 聊天介面採 **三軌同步**:文字流(SSE) + 對應段落觸發 portrait 生成 + TTS 朗讀
- 進入頁面預先載入 manifest,避免首次互動冷啟動延遲過久
- 提供「下載 manifest JSON」按鈕,落實「平台倒了也能用 TXID 重現」承諾

### 7.4 錢包支援與簽名場景

**支援的錢包**(透過 RainbowKit 一站式整合):

| 錢包 | 通路 | 主要使用情境 |
|---|---|---|
| **MetaMask** | 瀏覽器擴充 / 手機 app | ★ Prototype 主要 demo 對象,普及率最高 |
| **Rabby** | 瀏覽器擴充 | 多鏈切換體驗較佳,進階用戶 |
| **WalletConnect** | QR code | 讓任何手機錢包(含手機版 MetaMask、imToken、Trust 等)連線 |
| **Coinbase Wallet** | 擴充 / app | 北美用戶常見,RainbowKit 預設帶 |

> idea.md §3.5 原文提到的 Phantom 是 Solana 系錢包,EVM 鏈不適用,prototype 不納入。

**三個會跳錢包簽名的場景**:

| # | 場景 | 觸發點 | 簽名類型 | 是否花 gas |
|---|---|---|---|---|
| 1 | **鑄造塔位** | `/mint` 流程最後一步 | 交易簽名(`safeMintRoot` 或 `safeMintWithParent`) | ✅ Sepolia testnet ETH(免費領) |
| 2 | **登入 / 啟動數位分身** | `/tablet/[tokenId]` 點「啟動互動」 | EIP-4361 SIWE 訊息簽名 | ❌ 純訊息,免 gas |
| 3 | **更新訓練產物 URI** | 線下訓練完成後回填 | 交易簽名(`setArtifactURI`) | ✅ testnet ETH |
| 4 | **(可選)端對端加密金鑰推導** | 上傳敏感對話紀錄前 | EIP-712 typed data 簽名 → HKDF | ❌ 純訊息 |

實作位置:`frontend/lib/wallet.ts` 封裝以下 hook,給其他元件用:
```ts
useConnectWallet()           // RainbowKit ConnectButton
useSiweLogin(tokenId)        // 場景 #2,自動向後端取 nonce → 簽 → 拿 JWT
useMintTablet()              // 場景 #1,wagmi useWriteContract 包裝
useSetArtifactURI(tokenId)   // 場景 #3
useDeriveEncryptionKey()     // 場景 #4,EIP-712 → HKDF
```

**首次連錢包 UX 注意事項**(prototype 必做):
- 偵測到非 Sepolia 鏈時,主動跳 `wallet_switchEthereumChain`,失敗則顯示「請手動切到 Sepolia」教學
- 偵測到餘額為 0 時,直接給 Sepolia 水龍頭連結(如 sepoliafaucet.com)
- 第一次互動先示範一次 SIWE 簽名(不花 gas),降低使用者對「鑄造交易」的恐懼

---

## 八、線下訓練腳本(★ 重點保留)

### 8.1 設計原則
- 完全獨立於 web 服務,可在開發者本地單機 GPU 跑(RTX 4090 / A6000 等級)
- 每支腳本一件事(Unix 哲學),可組成 pipeline 也可單獨呼叫
- 所有產物寫入 `training/workspace/<tokenId>/`,最後一步才上傳

### 8.2 pipeline(指令範例)
```bash
# 0. 設定環境
cd training && python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# 1. 從鏈上 + Arweave 拉素材
python pipelines/01_fetch_assets.py --token-id 42 --rpc $RPC_URL

# 2. 自動打標
python pipelines/02_caption_images.py --token-id 42 --captioner blip2

# 3. LoRA 訓練(SDXL, rank=16, person class)
python pipelines/03_train_lora.py --token-id 42 \
       --base sdxl-1.0 --rank 16 --steps 2000 --resolution 1024

# 4. 聲音模型
python pipelines/04_train_voice.py --token-id 42 --backend gpt-sovits

# 5. RAG 建索引
python pipelines/05_build_rag.py --token-id 42 \
       --embed multilingual-e5-large --chunk 512

# 6. 打包(輸出 manifest.json + 各權重)
python pipelines/06_package_artifact.py --token-id 42 --version v1

# 7. 上傳並回填鏈上
python pipelines/07_upload_artifact.py --token-id 42 \
       --signer $TRAINER_PRIVATE_KEY --network sepolia
```

### 8.3 manifest 範例(訓練產物自描述)
```json
{
  "tokenId": 42,
  "version": "v1",
  "createdAt": "2026-05-05T12:00:00Z",
  "models": {
    "lora": { "uri": "ar://...", "base": "sdxl-1.0", "rank": 16 },
    "voice": { "uri": "ar://...", "backend": "gpt-sovits" },
    "rag": { "uri": "ar://...", "embed": "multilingual-e5-large", "chunks": 387 }
  },
  "checksum": "sha256:..."
}
```

### 8.4 配置與可重現性
- `training/configs/lora_person.yaml` 等 YAML 控制全部超參數,版本化進 git
- 每次訓練自動寫 `run.log` + `config_snapshot.yaml`,確保可重現

---

## 九、開發里程碑

| 週次 | 目標 | 可驗收成果 |
|---|---|---|
| **W1** | 合約 MVP | `DigitalTablet.sol` 通過 Foundry test;部署 Sepolia |
| **W2** | 儲存層 + metadata | Irys 上傳成功,前端可拿 TXID 渲染圖片 |
| **W3** | 前端鑄造流程 | 走通「填表 → 上傳 → 簽名 → 鑄出 NFT」 |
| **W4** | 線下訓練 pipeline | 完成 01–07,產出可上傳 artifact 的逝者 |
| **W5** | 推理服務 | `compute/` 三條 endpoint 通,支援 LRU 載入 |
| **W6** | 互動前端 | 三軌同步聊天介面 demo |
| **W7** | 持有驗證 + ERC-6150 樹 | SIWE + 家族樹視覺化 |
| **W8** | 整合測試 + demo | 端到端錄影 + 部署到 Vercel/Render |

---

## 十、部署與環境

### 10.1 環境變數(`.env.example`)
```bash
# Chain
RPC_URL=...
CHAIN_ID=11155111
CONTRACT_ADDRESS=0x...
TRAINER_PRIVATE_KEY=...        # 線下訓練機回填用

# Storage (切 driver 即可,合約與前端不必動)
STORAGE_DRIVER=pinata           # pinata | web3storage | irys | local
PINATA_JWT=...
WEB3_STORAGE_TOKEN=...
IRYS_NODE=https://node1.irys.xyz       # 未來切 Arweave 用
ARWEAVE_GATEWAY=https://arweave.net
IPFS_GATEWAY=https://gateway.pinata.cloud/ipfs/

# Compute
OPENAI_API_KEY=...             # 可選
HF_TOKEN=...
ELEVENLABS_API_KEY=...         # 可選
GPU_DEVICE=cuda:0

# Backend
DATABASE_URL=postgres://...
REDIS_URL=redis://localhost:6379
JWT_SECRET=...
```

### 10.2 docker-compose(本地一鍵起)
- postgres:14
- redis:7
- qdrant(向量庫)
- minio(本地模擬 S3,當 Arweave 連線受限時的 fallback)
- compute(GPU passthrough)

### 10.3 線上部署
- 合約:Sepolia(後續可加 Base Sepolia 多鏈)
- frontend:Vercel
- backend:Render / Fly.io
- compute:自架 GPU 機(prototype 階段不對外,僅 demo 開放)

---

## 十一、風險與待解問題

| 風險 | 影響 | 緩解 |
|---|---|---|
| Arweave 上傳費高 | 成本爆炸 | prototype 用 Irys devnet,正式環境再切主網 |
| LoRA 訓練 GPU 成本 | 互動體驗卡頓 | 先支援「離線生成 → 結果回傳」,即時模式列為 v2 |
| 倫理:未經逝者同意建模 | 法律 / 聲譽 | 鑄造流程加入「家屬聲明」勾選 + 將同意書寫入 metadata |
| NFT 失竊導致記憶被劫持 | 嚴重 | 預留 social recovery / multisig hook |
| 資料外洩(訓練產物可被任何人用 TXID 取得) | 隱私 | 提供端對端加密選項(§4.4) |
| 平台關閉後 artifact 格式無人能解讀 | 違背初衷 | manifest 採開放格式(safetensors + 標準 RAG schema)+ 文件公開 |

---

## 十二、後續延伸(超出 prototype 範疇)

對應 idea.md §九,以下功能在 prototype 完成後可加掛而不破壞既有架構:
- 祭祀基金 → ERC-6551 TBA + 自動扣款
- 回憶資產化 → 子 NFT
- 跨鏈鏡像 → LayerZero / CCIP
- DAO 治理 → 家族委員會 multisig

---

## 十三、給協作者的指引

1. 三層解耦,任一層可獨立 PR(改合約不該強制改前端)
2. 共享型別 (`shared/types/`) 是跨服務契約,變動需同步 PR
3. 訓練腳本是「離線資產」,**不要**把訓練邏輯偷偷塞進 `compute/` 的線上服務
4. 任何涉及私鑰、家屬個資的程式碼必須 PR 標記 `security` label,額外 review
