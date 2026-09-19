# Data Flow — End to End

規格依據:[Aeterlux_系統概述文件_0914.docx](Aeterlux_系統概述文件_0914.docx)。以下流程以 Arweave 主要儲存路徑、啟用 Lit 加密與 LiveKit 公祭通道的設定說明。Lit 加密為選用功能;未啟用時,Phase 1 / 2 的私密素材會像大頭照一樣直接上傳並寫進公開 metadata。

## Phase 1: 鑄造燈塔(Mint)

大頭照與基本資料是公開的;照片 / 影音 / 文字 / 對話紀錄是私密素材,選檔後只暫存在瀏覽器,拿到 tokenId 後才加密上傳。

```mermaid
sequenceDiagram
    participant U as 家屬
    participant W as MetaMask
    participant FE as Frontend
    participant BE as Backend
    participant AR as Irys → Arweave
    participant L as Lit
    participant C as DigitalTablet (Sepolia)

    U->>FE: 進 /mint 填生平、家族脈絡、同意聲明
    U->>FE: 上傳大頭照
    FE->>BE: POST /api/uploads/relay
    BE->>AR: Irys 打包上傳 (失敗改走 Turbo)
    AR-->>BE: 交易 ID
    BE-->>FE: uri ar://ID
    U->>FE: 選照片 / 影音 / 對話紀錄 (只暫存在瀏覽器, local: 佔位)

    FE->>L: 鑄造前檢查 Lit 可用 (公鑰已在環境變數時不呼叫)
    FE->>FE: 組公開 metadata (只含大頭照與基本資料)
    FE->>BE: POST /api/uploads/relay (metadata JSON)
    BE->>AR: 上傳
    BE-->>FE: ar://metadataId
    FE->>W: 簽第 1 筆: mintRoot 或 safeMintWithParent
    W->>C: send tx
    FE->>C: 等收據, 從 Transfer(from=0) 讀出 tokenId

    rect rgb(245, 240, 255)
    note over FE,L: 封存私密素材 (lib/lit/artifact.ts)
    FE->>FE: 建立存取條件: ownerOf(tokenId) == 請求者
    loop 每個檔案
        FE->>FE: 以 Lit 網路公鑰 + 存取條件在瀏覽器內加密 (檔名一併加密)
        FE->>BE: POST /api/uploads/relay (只有密文 .enc)
        BE->>AR: 上傳密文
    end
    FE->>BE: 上傳 manifest (密文位置 + 資料雜湊 + 存取條件)
    BE->>AR: 上傳
    end

    FE->>W: 簽第 2 筆: setArtifactURI(tokenId, ar://manifestId)
    W->>C: send tx

    opt 有私密對話紀錄
        FE->>BE: SIWE 登入後 POST /api/personas/:tokenId/reindex-memory {privateChatlogs 原文}
        BE->>BE: 切片 → e5 embedding → MemoryChunk (kind=private_chatlog)
    end
```

- 公開 metadata:`tokenURI` 指向的 JSON(ERC-721 metadata + `dsas` 擴充)。
- 私密素材清單:`artifactURI` 指向的 manifest(`type: "aeterlux-encrypted-artifact"`),任何人都下載得到,但裡面只有密文位置、資料雜湊與存取條件。
- 封存失敗時燈塔已鑄造,暫存檔仍在分頁中,可按「重試加密上傳」,不會重複鑄造。

## Phase 2: 補傳上鏈(Asset Re-upload)

燈塔頁「編輯資料」:公開欄位(生平、墓誌銘、子孫)合併進現有 metadata 後 `setTokenURI`;新加的照片 / 影音 / 對話紀錄走加密封存,**append** 一把新金鑰與新項目進現有 manifest 後 `setArtifactURI`,不必解開舊的。只補私密素材時不會多簽 `setTokenURI`。

```mermaid
sequenceDiagram
    participant U as 持有者
    participant W as MetaMask
    participant FE as Frontend
    participant BE as Backend
    participant AR as Irys → Arweave
    participant C as DigitalTablet (Sepolia)

    U->>FE: /tablet/42 編輯資料, 加照片 / 錄音 / 對話紀錄 (暫存)
    opt 新錄音
        FE->>BE: 用瀏覽器裡的原檔克隆聲音 (IndexTTS2)
    end
    U->>FE: 保存上鏈
    FE->>AR: 讀目前 manifest (讀不到就中止, 避免蓋掉舊指標)
    FE->>FE: 以同一組存取條件加密新檔案, append 進 manifest
    FE->>BE: 上傳密文與新 manifest
    BE->>AR: 上傳
    FE->>W: setArtifactURI(42, ar://newManifest)
    W->>C: send tx
    opt 公開欄位有變
        FE->>BE: 上傳合併後的 metadata
        FE->>W: setTokenURI(42, ar://newMetadata)
        W->>C: send tx
    end
    FE->>BE: POST /api/tablets/42/sync (等收據後)
    FE->>BE: POST /api/personas/42/reindex-memory (含新私密對話紀錄原文)
```

## Phase 3: 解鎖私密記憶(Unlock)

```mermaid
sequenceDiagram
    participant U as 持有者
    participant W as MetaMask
    participant FE as Frontend
    participant L as Lit
    participant C as DigitalTablet (Sepolia)
    participant AR as Arweave

    U->>FE: 私密記憶分頁 → 解鎖
    FE->>AR: 讀 artifactURI 的 manifest
    FE->>W: 簽名證明身分 (一次簽名, 整個解鎖流程共用)
    loop manifest 裡每個密文
        FE->>AR: 下載密文
        FE->>L: 解密請求 (存取條件 + 資料雜湊 + 簽名)
        L->>L: 各節點驗簽
        L->>C: 各節點查 ownerOf(tokenId) == 簽名者?
        L-->>FE: 簽章分片 (湊滿門檻)
        FE->>FE: 組合出解密金鑰, 瀏覽器內解密內容與檔名
    end
    FE->>FE: 顯示
    opt 用解鎖的對話紀錄更新 AI 記憶
        note over FE: SIWE 登入後 POST /api/personas/:tokenId/reindex-memory {privateChatlogs}
    end
```

簽名者不是這座燈塔目前的持有者、簽名過期,或存取條件與密文對不上,Lit 節點都不會交出分片。

## Phase 4: 預構建數位分身(Avatar / Voice)

每位逝者一次性構建,可在鑄造時或燈塔頁補傳時觸發。

```mermaid
sequenceDiagram
    participant U as 持有者
    participant FE as Frontend
    participant BE as Backend
    participant R as GPU 推理伺服器 (RTX 5090)

    rect rgb(235, 245, 255)
    note over U,R: 3DGS 人物 (阻塞約 100 秒)
    U->>FE: 大頭照 → 生成專屬分身
    FE->>BE: POST /api/avatar/build
    BE->>R: POST /upload_avatar
    R->>R: LAM 單張照重建高斯潑濺說話頭
    R-->>BE: avatarLabel, avatarUrl
    BE-->>FE: labels
    end

    rect rgb(240, 255, 240)
    note over U,R: 克隆聲音
    U->>FE: 上傳本人錄音
    FE->>BE: POST /api/avatar/build-voice
    BE->>R: POST /upload_voice
    R->>R: IndexTTS2 克隆
    R-->>BE: voiceLabel
    BE-->>FE: labels
    end

    FE->>FE: labels 寫進 metadata.dsas.avatar (保存上鏈時)
```

GPU 伺服器是**無狀態、persona 無關**的:只暴露構建 / 推理介面,不存任何家族記憶。

## Phase 5: 即時對話(RAG + 串流)

瀏覽器不直連 GPU 伺服器(Chrome Private Network Access 會攔公開網頁 → 私網 IP 的 WS),而是連後端 `/api/avatar/ws?token=…`,由後端轉發到 `/render?token=…`。token 是後端用 `RENDER_JWT_SECRET` 簽的 HS256(aud=`ymid-render`,TTL 1800 秒)。

```mermaid
sequenceDiagram
    participant U as 家屬
    participant FE as Frontend
    participant BE as Backend
    participant DB as PostgreSQL + pgvector
    participant R as GPU 推理伺服器

    U->>FE: 啟動數位分身互動 (持有者 SIWE 或邀請碼)
    FE->>BE: POST /api/personas/42/avatar-session
    BE-->>FE: 短期 render token + avatar / voice labels
    FE->>BE: WS /api/avatar/ws?token (後端 pipe 到 /render)

    loop 每輪對話
        opt 語音輸入
            FE->>BE: POST /api/personas/42/cloud-stt (錄音)
            BE-->>FE: Whisper 逐字稿
        end
        FE->>BE: GET /api/personas/42/persona-prompt?q=問題
        BE->>BE: e5 把問題轉成向量
        BE->>DB: cosine top-4 (對話紀錄 + 私密對話紀錄 + 已核可回憶)
        BE->>BE: 距離 ≤ 0.62 的片段注入 system prompt
        BE-->>FE: prompt + 可浮現的回憶照片
        FE->>R: chat {messages: [system, …完整歷史]} (經 WS 代理)
        R->>R: vLLM Qwen3-14B 串流
        R-->>FE: text_delta
        R->>R: IndexTTS2 + Audio2Expression (52 維) + ARTalk 頭姿
        R-->>FE: 二進位幀 (WAV 24kHz + 表情 + 頭姿)
        FE->>FE: WebGL 渲染 3DGS 人物, 預緩衝約 1.8–3 秒音訊再播放
    end
```

效能:LLM 首 token 約 100ms;TTS 是瓶頸(IndexTTS2 RTF≈2.7),所以前端預緩衝音訊。遇到記憶裡沒有的事,persona prompt 要求溫和承認記憶有限、不編造事實。

## Phase 6: 線上公祭(LiveKit)

```mermaid
sequenceDiagram
    participant A as 親友 A
    participant B as 親友 B
    participant BE as Backend
    participant LK as LiveKit SFU

    A->>BE: GET /api/ceremony/42/connect (可見度 / 邀請碼檢查)
    BE-->>A: {transport: livekit, url, token}
    A->>LK: 加入房間 aeterlux-ceremony-42
    B->>BE: GET /api/ceremony/42/connect
    B->>LK: 加入房間
    LK-->>A: B 進場 → 在線人數 +1, A 把自己的化身位置補發給 B
    A->>LK: data: ritual / chat / pos (10Hz)
    LK-->>B: 轉送 (B 端做白名單、節流、範圍夾限)
    A->>LK: 開麥克風 (語音軌)
    LK-->>B: 訂閱 A 的聲音, 顯示誰正在說話
    B->>BE: POST /api/tributes/42 (留言獻供)
    BE->>LK: server API sendData (供品留言)
    LK-->>A: 即時看到新供品
```

`CEREMONY_TRANSPORT=ws` 或 LiveKit 連不上時,同樣的事件改走後端 WebSocket hub(`/api/ceremony/:tokenId/ws`,由後端驗證與節流),沒有語音。私人(PRIVATE)燈塔不開放公祭;不公開(UNLISTED)需邀請碼。

## Phase 7: 隱私

- **私密素材**:在瀏覽器加密,Arweave 上只有密文;解密金鑰只交給鏈上持有者。公開 metadata 只有墓碑級資訊。
- **AI 記憶**:後端讀不到加密的對話紀錄;只有持有者解密後主動送來的原文會被切片、向量化,存成 `MemoryChunk`(保存逝者發言的切片文字與向量,供檢索與注入 prompt;不保存原始檔案)。
- **推理**:對話生成、克隆聲音、表情 / 頭姿都在自建 GPU 伺服器,不交給第三方 AI 平台;互動內容仍需經網路傳到自建服務(「本機推理」不代表資料不離開家屬裝置)。語音辨識(Whisper)使用 OpenAI `whisper-1` API。
- **永久性**:Arweave 上的資料無法刪除。隱藏內容或停止 AI 使用,不等於移除已封存的資料。
