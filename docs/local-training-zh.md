# DSAS 本地離線訓練模式 — 補充說明

> 本份是 [project-overview-zh.md](project-overview-zh.md) 的姊妹文件,專門講解「親身打造的記憶」(離線訓練)模式的技術細節。
>
> 主文件聚焦在「雲端模式」(直接打 OpenAI / Anthropic / fal.ai),已經能端到端 demo;本文件講的是專案的「另一條路」,把鏈上素材轉成**只屬於這位逝者**的 AI 模型。

---

## 目錄

1. [離線模式想解決什麼問題](#離線模式想解決什麼問題)
2. [雲端 vs 離線:差別在哪](#雲端-vs-離線差別在哪)
3. [整體流程概覽](#整體流程概覽)
4. [離線訓練 7 步 pipeline](#離線訓練-7-步-pipeline)
5. [使用的模型清單](#使用的模型清單)
6. [硬體與軟體需求](#硬體與軟體需求)
7. [訓練產物 (artifact) 的結構](#訓練產物-artifact-的結構)
8. [鏈上回填:setArtifactURI](#鏈上回填setartifacturi)
9. [推理服務 (compute/) 怎麼接上](#推理服務-compute-怎麼接上)
10. [目前進度與已知問題](#目前進度與已知問題)

---

## 離線模式想解決什麼問題

雲端模式很方便,但它有三個**根本上**的限制:

### 1. 對話品質受限於通用 LLM

雲端模式做的是「把鏈上 metadata(姓名、生卒、傳記)塞進 system prompt」+「請 Claude 假裝是這個人」。LLM 沒看過逝者的真實對話、文章、信件,所以它會用「合理」的方式回答 — 但不會真的像本人。

例如:逝者習慣講台語,LLM 不一定會接;逝者愛講某句口頭禪,LLM 不會自己冒出來;逝者個性很內斂,LLM 還是可能講得很熱情。

→ **離線模式做的事**:把逝者的所有日記、信件、LINE 對話、訪談錄音逐字稿,切成片段,做成向量資料庫(RAG index)。每次對話前先檢索相關片段,**強迫**模型在回答時參考這些真實素材。

### 2. 肖像生成靠文字 prompt 不夠像

fal.ai 的 FLUX 是通用模型。給「memorial portrait of 王大明 in 彰化」它會畫一個「合理的亞洲老人在彰化」 — 但**不是真的王大明**。

→ **離線模式做的事**:用逝者的 15-30 張照片,訓一個 **LoRA**(專屬微調權重),讓 SDXL / FLUX 學會「王大明這個人長什麼樣」。之後給任何 prompt(在海邊、在書桌前、年輕時、穿西裝),都能畫出**真的是王大明**的圖。

### 3. 聲音不是本人

雲端模式的 ElevenLabs 雖然支援聲音複製,但需要把錄音上傳到 ElevenLabs 雲端 — 等於把逝者的聲音樣本交給第三方。

→ **離線模式做的事**:用 **GPT-SoVITS** 在本機訓練聲音模型。需要 5-30 分鐘乾淨參考音訊。訓完後本機推理,完全不出網。

### 4. 資料隱私

雲端模式每次對話內容、生成的 prompt 都會經過 OpenAI / Anthropic / fal.ai。對「敏感家族對話」這是不可接受的。

→ **離線模式**:對話完全本機。模型 weights 也是本機產生。除非家屬主動要更新鏈上 `artifactURI`,否則訓練結果可以選擇**不上鏈、只在自家機器上跑**。

---

## 雲端 vs 離線:差別在哪

| 維度 | ☁️ 雲端模式(主文件) | 🖥️ 離線模式(本文) |
|---|---|---|
| **啟動延遲** | 即時 | 需先跑數小時訓練 |
| **對話品質** | 通用 LLM + prompt 注入鏈上 metadata | RAG 檢索逝者真實文字 + LLM 生成 |
| **肖像** | FLUX 文字描述 | LoRA(學會逝者外貌) |
| **聲音** | OpenAI TTS / ElevenLabs(預設音色或雲端聲音複製)| GPT-SoVITS 本機聲音複製 |
| **隱私** | 對話經過商業 API | 完全本機推理 |
| **設備** | 任何瀏覽器 | RTX 4090 / A6000 (24GB+ VRAM) |
| **成本** | 逐次 API 計費 | 一次訓練成本(電費),後續免費 |
| **artifactURI** | 留空 | 指向 IPFS 上的訓練產物 manifest |
| **目前狀態** | ✅ 已完成 | 🚧 7 步 pipeline 已寫,實際 LoRA / voice 訓練調校中(目前 stub 模式可走通流程) |

---

## 整體流程概覽

```mermaid
flowchart TD
    Start([家屬已鑄造塔位 NFT,素材已 pin 在 IPFS]) --> Choose[在 PersonaActivationModal<br/>選「親身打造的記憶」]
    Choose --> Local[家屬在自家 GPU 機器上<br/>cd training/]

    Local --> S1[01 fetch_assets<br/>從鏈上+IPFS 拉素材到 workspace/]
    S1 --> S2[02 caption_images<br/>BLIP-2 / LLaVA 自動打標]
    S2 --> S3[03 train_lora<br/>SDXL + PEFT LoRA<br/>~1h on RTX 4090]
    S3 --> S4[04 train_voice<br/>GPT-SoVITS 微調<br/>~10min ref audio]
    S4 --> S5[05 build_rag<br/>multilingual-e5-large<br/>切片+embedding]
    S5 --> S6[06 package_artifact<br/>打包成 tar.gz + manifest.json]
    S6 --> S7[07 upload_artifact<br/>Pin 到 IPFS<br/>→ setArtifactURI]

    S7 --> Chain[(Sepolia 鏈上<br/>artifactURI 更新)]

    Chain --> Compute[家屬點互動 → 後端 proxy 到 compute/<br/>FastAPI :8000]
    Compute --> Cache{LRU cache 有<br/>這個 tokenId 嗎?}
    Cache -->|miss| FetchArt[從 IPFS 拉 artifact<br/>下載 LoRA + voice + RAG index]
    Cache -->|hit| Run
    FetchArt --> Run[載入到 GPU 記憶體]

    Run --> Chat[/persona/{id}/chat<br/>RAG 檢索 → LLM 生成 → SSE/]
    Run --> Portrait[/persona/{id}/portrait<br/>SDXL + LoRA → PNG/]
    Run --> Voice[/persona/{id}/voice<br/>GPT-SoVITS → WAV/]

    Chat --> User([家屬看到對話 / 圖 / 語音])
    Portrait --> User
    Voice --> User

    User --> Idle[5 分鐘無互動]
    Idle --> GC[(快取 GC,釋放 VRAM<br/>原始素材永留 IPFS)]
```

---

## 離線訓練 7 步 pipeline

對應 [training/pipelines/](../training/pipelines/) 的 7 個腳本。所有腳本都:
- 接 `--token-id <id>` 參數
- 共用 `_common.py`(讀 `.env`、設定 logger、計算 hash)
- **冪等(idempotent)**:重複跑只會跳過已完成的步驟,除非 `--force`
- 結果寫進 `training/workspace/<tokenId>/`(已加進 .gitignore)

### Step 1 — `01_fetch_assets.py`:從鏈上 + IPFS 拉素材

做的事:
1. 連到 RPC,呼叫 `tokenURI(tokenId)` 拿到 metadata 的 IPFS URI
2. 透過 IPFS gateway 下載 metadata.json
3. 解析 metadata 裡的 `dsas.assets`(photos / videos / audios / texts / chatlogs)
4. 逐一下載到 `workspace/<id>/raw/{photos,videos,audios,texts,chatlogs}/`
5. 寫一份 `manifest.fetched.json` 記錄每個檔案的本地路徑 + sha256 hash

關鍵環境變數:`RPC_URL`、`CONTRACT_ADDRESS`、`IPFS_GATEWAY`

### Step 2 — `02_caption_images.py`:自動打標

LoRA 訓練需要每張照片有對應「文字描述」(caption)。手動寫 30 張太累,所以用 vision-language 模型自動產生。

兩種 backend:
- **`--captioner blip2`**:Salesforce 的 [BLIP-2](https://huggingface.co/Salesforce/blip2-opt-2.7b),需要 ~16 GB VRAM
- **`--captioner llava`**:[LLaVA](https://github.com/haotian-liu/LLaVA),較大但描述更詳細
- **`--captioner stub`**:CPU 上跑,輸出檔名 + metadata 拼湊的假 caption,讓 pipeline 可以在沒 GPU 的 laptop 上端到端跑通

輸出:
- `workspace/<id>/captions/<basename>.txt` — 每張圖的 caption
- `workspace/<id>/captions/captions.jsonl` — 彙總

例如一張照片的 caption 可能是:`"a photograph of an elderly Asian man, 80 years old, wearing a white shirt, sitting in a wooden chair, soft natural light, medium close-up portrait, dignified expression"`。

### Step 3 — `03_train_lora.py`:訓練 LoRA

這是離線模式**最重的步驟**。

#### 什麼是 LoRA?

**LoRA = Low-Rank Adaptation**。原本 Stable Diffusion / SDXL / FLUX 模型有幾十億參數,要重新訓一個「會畫王大明的模型」太貴。LoRA 的洞察:**不要動主模型,只在每層 attention 旁邊插一對小矩陣**(rank 16 / 32 通常就夠),只訓那一小組就好。

- 主模型保持不動(數十 GB)
- LoRA 權重通常只有 50-200 MB
- 訓練 30 張照片 / 2000 步 / RTX 4090 → ~1 小時
- 推理時把 LoRA 「插」回主模型,就能畫出有訓練人的長相

#### 程式碼選擇

prototype 先寫了 **stub 版**(寫一個正確結構的 `lora.safetensors`,但所有 weights 都是零 — 推理等於沒插),這樣可以在 CPU laptop 上端到端跑通整條 pipeline,專心調 packaging / upload / 鏈上回填邏輯。

正式訓練的兩個選項(註解中標記 `# TODO: replace stub with real training`):
1. **kohya-ss/sd-scripts**(`train_network.py --network_module networks.lora`)— 業界 SDXL LoRA 標準 trainer
2. **diffusers + peft**(`peft.LoraConfig` + 自寫訓練 loop)— Hugging Face 官方棧,可控制度高

訓練 hyperparameters 寫在 [`configs/lora_person.yaml`](../training/configs/) 裡,版本化進 git。建議值:
- base = `sdxl-1.0`
- rank = 16
- steps = 2000
- resolution = 1024
- learning rate = 1e-4(text encoder)、1e-4(unet)
- network class = "person"

輸出:
- `workspace/<id>/lora/lora.safetensors`(最終權重)
- `workspace/<id>/lora/config_snapshot.yaml`(這次跑的完整設定)
- `workspace/<id>/lora/run.log`(訓練 log,方便 reproduce)

### Step 4 — `04_train_voice.py`:訓練聲音模型

#### 什麼是 GPT-SoVITS?

[GPT-SoVITS](https://github.com/RVC-Boss/GPT-SoVITS) 是開源聲音複製模型。給 5-30 分鐘的乾淨參考音訊,fine-tune 出一個能用該人音色講任意文字的模型。

- 比 ElevenLabs 隱私性好(完全本機)
- 訓練 ~10-15 分鐘(RTX 4090,12 GB VRAM)
- 推理 ~1 秒生成一段話

#### 流程

1. 從 `workspace/<id>/raw/audios/` 抓所有音檔
2. 自動去除靜音、切成適合長度的 chunks
3. 跑 GPT-SoVITS 的 fine-tune 腳本
4. 輸出 `workspace/<id>/voice/voice_model.bin` + `voice_config.json`

prototype 階段同樣是 stub(寫一個 1KB placeholder),正式版需要安裝 GPT-SoVITS 完整環境。

#### 替代選項

`--backend elevenlabs` 可以改打 ElevenLabs IVC API(把音檔上傳、取得 voice ID),但這樣等於放棄離線優勢,只剩在 prototype 開發階段方便用。

### Step 5 — `05_build_rag.py`:建立 RAG 向量索引

#### 什麼是 RAG?

**RAG = Retrieval-Augmented Generation**。LLM 對話時:
1. 把使用者問題先轉成向量(embedding)
2. 在「逝者所有文字資料」的向量資料庫中找出最相似的 top-k 片段
3. 把這些片段塞進 prompt 一起給 LLM
4. LLM 生成答案時就有了**真實素材**作參考

這比純 prompt 注入強得多 — 因為:
- 可放幾百萬字逝者文字(LLM context window 裝不下)
- 每次只丟「跟這個問題相關」的部分
- LLM 比較不會胡謅(hallucinate)

#### 流程

1. 收集 `workspace/<id>/raw/texts/` + `chatlogs/` 所有文字資料
2. 切片(chunk size = 512 tokens,有 overlap)
3. 每個 chunk 用 `sentence-transformers/multilingual-e5-large` 算 embedding(1024 維向量)
4. 寫進向量索引

> 這一步**已經是真實實作**,不是 stub(只要裝了 `sentence-transformers`)。沒裝會 fallback 到 deterministic hash embedding 並 log warning,但建議一定要裝真模型。

選 `multilingual-e5-large` 是因為:
- 中英混合語料友善(很多家庭對話混台、中、英)
- 1024 維,品質夠
- CPU 上跑得動,不一定要 GPU

#### 輸出

- `workspace/<id>/rag/index.json` — 每個 chunk 的 metadata(來源檔、時間戳、文本)
- `workspace/<id>/rag/embeddings.npy` — N × 1024 的 numpy array

### Step 6 — `06_package_artifact.py`:打包

把上面四步的產物收成一份 tarball:

```
workspace/<id>/dist/
├── artifact-v1.tar.gz   # 內含 lora/ voice/ rag/
└── manifest.json        # 自描述
```

`manifest.json` 結構:
```json
{
  "tokenId": 42,
  "version": "v1",
  "createdAt": "2026-05-09T10:00:00Z",
  "models": {
    "lora":  { "uri": "ipfs://...", "base": "sdxl-1.0", "rank": 16, "sha256": "..." },
    "voice": { "uri": "ipfs://...", "backend": "gpt-sovits", "sha256": "..." },
    "rag":   { "uri": "ipfs://...", "embed": "multilingual-e5-large", "chunks": 387, "sha256": "..." }
  },
  "checksum": "sha256:..."
}
```

注意 `models.*.uri` 在這一步還是空的 — Step 7 才會 pin 到 IPFS 拿到真 URI。

### Step 7 — `07_upload_artifact.py`:上傳 + 鏈上回填

1. 把 `lora.safetensors` / `voice_model.bin` / `rag` 三個產物分別 pin 到 Pinata,各拿一個 CID
2. 把 manifest.json 補上這三個 CID,再 pin 一次,拿 manifest CID
3. 用 `TRAINER_PRIVATE_KEY`(寫在 `.env` 的離線訓練機私鑰)簽一筆 `setArtifactURI(tokenId, "ipfs://<manifestCid>")` 交易,送到 Sepolia

完成後:
- 鏈上的 `_artifactURI[tokenId]` 從空字串變成 `"ipfs://<manifestCid>"`
- 任何 compute 服務拿著 tokenId,可以從鏈上查到 manifest URI、從 IPFS 抓 manifest、再順著 manifest 抓三個產物

---

## 使用的模型清單

| 步驟 | 模型 | 大小 / VRAM | 用途 |
|---|---|---|---|
| 02 captioning | **BLIP-2 OPT-2.7B** (`Salesforce/blip2-opt-2.7b`) | ~16 GB(8-bit ~8 GB)| 看照片產生英文 caption |
| 02 captioning(替代)| **LLaVA-1.5** | ~14 GB | 描述更細,prompt-following 較好 |
| 03 LoRA(主模型)| **Stable Diffusion XL 1.0** (`stabilityai/stable-diffusion-xl-base-1.0`)| ~12 GB | 待微調的基礎模型 |
| 03 LoRA(替代)| **FLUX.1 schnell / dev** | ~24 GB | 更新更強的開源 diffusion |
| 03 LoRA(訓練棧)| `kohya-ss/sd-scripts` 或 `diffusers + peft` | ~24 GB(訓練)| LoRA 微調主程式 |
| 04 voice | **GPT-SoVITS** | ~12 GB | 聲音複製 |
| 04 voice(替代)| ElevenLabs IVC API | 雲端 | prototype 開發階段方便用 |
| 05 RAG embedding | **`sentence-transformers/multilingual-e5-large`** | ~2 GB | 文字片段向量化 |
| compute 推理時 LLM | OpenAI GPT-4o-mini / 本地 Llama-3.1-8B-Instruct | 視選擇 | RAG 檢索後生成最終回答 |
| compute 推理時 SDXL | SDXL 1.0 + LoRA(從 IPFS 拉)| ~12 GB | 即時生肖像 |

---

## 硬體與軟體需求

### 硬體

| 步驟 | 最低 | 建議 |
|---|---|---|
| 02 captioning | RTX 3090 24 GB | RTX 4090 / A6000 |
| 03 LoRA SDXL @ 1024px | RTX 3090 24 GB | RTX 4090 / A100 40 GB |
| 04 GPT-SoVITS | RTX 3060 12 GB | RTX 4090 |
| 05 RAG embedding | CPU 也行 | 任何 GPU 加速 |
| 06-07 打包 / 上傳 | CPU 即可 | — |

整套訓練(02+03+04)在 **RTX 4090** 上約 ~1.5-2 小時。在 stub 模式下 CPU laptop 5 分鐘內跑完。

### 軟體

`training/requirements.txt` 列了輕量套件(`numpy`、`yaml`、`safetensors`、`tqdm`、`sentence-transformers`、`web3`)。

**重 ML 套件**(`torch`、`diffusers`、`transformers`、`peft`、`bitsandbytes`)**故意不放進 requirements**,因為它們需要對應 CUDA 版本的 wheel,在 stub mode 完全用不到。實際要訓練時,在訓練主機另外裝:

```bash
# 範例(CUDA 12.1)
pip install torch==2.4.0 --index-url https://download.pytorch.org/whl/cu121
pip install diffusers transformers peft accelerate bitsandbytes
pip install kohya_ss  # 或自己 clone sd-scripts
```

---

## 訓練產物 (artifact) 的結構

對應 [shared/types/artifact.ts](../shared/types/artifact.ts):

```
artifact-v1.tar.gz
├── manifest.json          # 入口檔,描述其他三個產物
├── lora/
│   ├── lora.safetensors   # LoRA 權重 (~50-200 MB)
│   └── config.yaml        # 訓練超參數 snapshot
├── voice/
│   ├── voice_model.bin    # GPT-SoVITS fine-tune 權重 (~100 MB)
│   └── voice_config.json
└── rag/
    ├── index.json         # 每個 chunk 的 metadata
    └── embeddings.npy     # N × 1024 向量
```

**為什麼分開 pin 三個產物 + 一個 manifest?**

- compute 推理時可能只需要其中一個(只想生圖 → 只下載 lora;只想對話 → 只下載 rag)
- 分開 pin 之後快取顆粒度更細
- manifest 是「目錄頁」,小、能快速拿到、再決定下載哪些

---

## 鏈上回填:setArtifactURI

合約端([DigitalTablet.sol:96-104](../contracts/src/DigitalTablet.sol#L96-L104))長這樣:

```solidity
function setArtifactURI(uint256 tokenId, string calldata uri) external {
    if (!_tokenExists(tokenId)) revert TokenDoesNotExist(tokenId);
    address owner_ = _ownerOf(tokenId);
    if (msg.sender != owner_ && !hasRole(MINTER_ROLE, msg.sender)) {
        revert NotTokenOwnerOrMinter(msg.sender, tokenId);
    }
    _artifactURI[tokenId] = uri;
    emit ArtifactURIUpdated(tokenId, uri);
}
```

兩個關鍵設計:

1. **必須是 owner 才能設**:訓練機簽交易用的 `TRAINER_PRIVATE_KEY` 必須對應到 NFT owner 地址 — 也就是**家屬自己的私鑰**。我們**不要求**家屬把主錢包私鑰丟到訓練機。實務做法是:
   - 家屬產一個獨立 EOA 給訓練機用
   - 把該 NFT 暫時 `transferFrom` 到訓練機地址 → 跑 step 7 → 再 `transferFrom` 回主錢包
   - 或:設計一個 `setArtifactURIBySig`(EIP-712,離線簽授權,訓練機代發)— 留給後續迭代

2. **artifactURI 跟 tokenURI 完全獨立**:tokenURI 是 metadata(姓名、生卒、素材索引);artifactURI 是訓練產物。可以分別更新,訓練 v2 不會動到 metadata。

---

## 推理服務 (compute/) 怎麼接上

`compute/` 是一支獨立的 FastAPI 服務(port 8000),專為「離線模式啟動」設計。

### 為什麼跟 backend 拆開?

- backend 用 Node + TypeScript,薄、快、處理鏈互動 + DB
- compute 用 Python + FastAPI,重、要 GPU,跑 diffusers + transformers
- 兩者透過 HTTP 協作 — backend 用 [proxy 函式](../backend/src/routes/personas.ts)轉送

### 推理流程

家屬點「啟動數位分身」(離線模式)→ 進入 ChatInterface → SIWE 登入 → POST `/api/personas/42/chat`(注意是 `/chat` 不是 `/cloud-chat`)→ backend 認證 + 鏈上 ownerOf 驗證 → proxy 到 `compute :8000/persona/42/chat`。

compute 收到後:
1. 查 LRU cache:`tokenId=42` 的 LoRA / voice / RAG 已經載入 GPU 記憶體了嗎?
2. **Cache miss**:
   - 從鏈上查 `artifactURI(42)` → 拿到 manifest URI
   - 從 IPFS 抓 manifest,順著抓 lora / voice / rag 三個產物
   - 載入到 GPU 記憶體
3. **Cache hit**:跳過載入
4. 跑 RAG 檢索 → 把 top-5 片段塞進 prompt → 呼叫 LLM
5. LLM 串流回 token → SSE 推回 backend → backend 推回 frontend

### 快取策略

- LRU 大小固定(預設 4 個 persona)
- 5 分鐘無互動 → 釋放 GPU 記憶體(對應 idea.md「快取資料刪除,原始資料永遠留存於儲存層」的承諾)
- 磁碟快取直到 `MAX_DISK_CACHE_GB` 才驅逐

### 端點清單

| Method | Path | 用途 |
|---|---|---|
| GET | `/health` | 健檢 |
| GET | `/persona/{tokenId}/manifest` | 公開查詢目前載入的 artifact 版本 |
| POST | `/persona/{tokenId}/chat` | RAG + LLM 對話 SSE 串流(JWT 守護) |
| POST | `/persona/{tokenId}/portrait` | SDXL + LoRA 即時生圖(JWT 守護) |
| POST | `/persona/{tokenId}/voice` | GPT-SoVITS TTS(JWT 守護) |

JWT 從 backend SIWE 流程拿,內含 `address` claim,compute 用同一個 `JWT_SECRET` 驗證。

---

## 目前進度與已知問題

### 已完成

- ✅ 7 步骨架腳本全部寫好,`--token-id` 參數一致、idempotent
- ✅ Step 5 RAG embedding 是**真實**實作(`multilingual-e5-large`)
- ✅ Step 6 / 7 打包 + Pinata pin + 鏈上 `setArtifactURI` 真實可跑
- ✅ Workspace 結構規範(`workspace/<id>/{raw,captions,lora,voice,rag,dist}`)
- ✅ compute 服務骨架(FastAPI + JWT auth + LRU cache 設計)

### 仍是 stub(待換實作)

| Step | 目前 | 待做 |
|---|---|---|
| 02 captioning | 用檔名 + metadata 拼湊假 caption | 接上 BLIP-2 / LLaVA |
| 03 LoRA | 寫一個全零 weights 的正確結構 safetensors | 接 kohya-ss/sd-scripts 或 diffusers + peft |
| 04 voice | 寫 1KB binary placeholder | 接 GPT-SoVITS |

### 為什麼用 stub 開發?

- 大部分時間在調 packaging / IPFS pin / 鏈上回填邏輯
- 重 ML 訓練每跑一次 ~1 小時,iteration loop 太慢
- stub 寫對「結構 / 檔名 / hash」就能讓下游所有 step 跑通,專心打磨上下游接縫
- 真實訓練只在最後階段在訓練機上跑,確認端到端品質

### 已知 issue

1. **TRAINER_PRIVATE_KEY 安全模型**:目前要求家屬把私鑰丟到訓練機,實務上不可接受。需做 `setArtifactURIBySig` 或多簽機制
2. **artifact 大小**:LoRA + voice + RAG 加起來約 200-400 MB。Pinata 免費額度 1 GB → 一個帳號可裝 2-5 個塔位,正式版需要付費或自架 IPFS
3. **compute 沒做用量計費**:GPU 推理成本很高,prototype 階段對外免費 demo,正式版需要訂閱 / 預付費機制
4. **聲音複製需要乾淨樣本**:逝者錄音常常背景吵,音質不夠 GPT-SoVITS 訓不好。需要前處理腳本(降噪、去靜音、切片)— 列在後續迭代
5. **多語言聲音**:逝者可能講台語 + 中文混合,GPT-SoVITS 對台語 fine-tune 經驗不多,效果未知

---

> 後續這份文件會跟著實際訓練腳本的迭代更新。任何同學在自己 GPU 機跑出有趣結果,歡迎回來補進「實測值」表格。
