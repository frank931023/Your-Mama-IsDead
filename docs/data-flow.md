# Data Flow — End to End

## Phase 1: Mint a Tablet

```mermaid
sequenceDiagram
    participant U as User (家屬)
    participant W as MetaMask
    participant FE as Frontend
    participant BE as Backend
    participant R as Render 機 (RTX 5090)
    participant P as Pinata (IPFS)
    participant C as DigitalTablet (Sepolia)

    U->>FE: 進 /mint, 填表 (name/origin/birth/death/descendants)
    U->>FE: 拖入 photos/videos/audios/chatlogs
    FE->>BE: POST /api/uploads/relay (each asset)
    BE->>P: pinFileToIPFS
    P-->>BE: { cid }
    BE-->>FE: { uri: "ipfs://CID" }

    opt 鑄造時預構建 avatar / voice (可選)
        FE->>BE: POST /api/avatar/build (正面照)
        BE->>R: POST /upload_avatar (阻塞 ~100s, LAM 重建 3DGS)
        R-->>BE: { avatarLabel, avatarUrl (zip) }
        FE->>BE: POST /api/avatar/build-voice (本人錄音)
        BE->>R: POST /upload_voice (IndexTTS2 克隆)
        R-->>BE: { voiceLabel }
        BE-->>FE: avatar/voice labels
    end

    FE->>FE: buildTabletMetadata({ ...form, assetURIs, dsas.avatar })
    FE->>BE: POST /api/uploads/relay (metadata JSON)
    BE->>P: pinJSONToIPFS
    P-->>BE: { cid: metadataCid }
    BE-->>FE: { uri: "ipfs://metadataCid" }
    FE->>W: 簽 tx: safeMintWithParent(parentId, "ipfs://metadataCid")
    W->>C: send tx
    C-->>W: tokenId, receipt
    W-->>FE: tx hash
    FE->>BE: POST /api/tablets/:tokenId/sync
    BE->>C: ownerOf, tokenURI, parent, children
    BE->>P: fetch metadata
    BE-->>FE: cached row
```

avatar/voice 兩個 label 寫進 NFT `metadata.dsas.avatar { avatarLabel, avatarUrl, voiceLabel, ... }`。
若鑄造時沒傳照片/錄音,可之後到塔位頁補傳(見 Phase 2)。

## Phase 2: 資產補傳上鏈 (Asset Re-upload)

塔位頁 5 個 Tab(生平 / 照片 / 影音 / 子孫 / 對話紀錄)owner 可就地編輯上傳;新資產 **合併**(merge,不 replace)進現有 metadata,重新 pin 後 `setTokenURI` 上鏈。

```mermaid
sequenceDiagram
    participant U as User (owner)
    participant W as MetaMask
    participant FE as Frontend
    participant BE as Backend
    participant R as Render 機 (RTX 5090)
    participant P as Pinata (IPFS)
    participant C as DigitalTablet (Sepolia)

    U->>FE: 進 /tablet/42, 某個 Tab 編輯/上傳新資產
    FE->>BE: POST /api/uploads/relay (new asset)
    BE->>P: pinFileToIPFS
    P-->>BE: { cid }
    BE-->>FE: { uri: "ipfs://CID" }

    opt 補傳照片 / 錄音時順便建 avatar / voice
        FE->>BE: POST /api/avatar/build / build-voice
        BE->>R: /upload_avatar (~100s) / /upload_voice (IndexTTS2)
        R-->>BE: { avatarLabel, avatarUrl } / { voiceLabel }
        BE-->>FE: labels
    end

    FE->>FE: merge 進現有 metadata (不 replace)
    FE->>BE: POST /api/uploads/relay (merged metadata JSON)
    BE->>P: pinJSONToIPFS
    P-->>BE: { cid: newMetadataCid }
    BE-->>FE: { uri: "ipfs://newMetadataCid" }
    FE->>W: 簽 tx: setTokenURI(42, "ipfs://newMetadataCid")
    W->>C: send tx
    C-->>W: receipt (event TokenURIUpdated)
    W-->>FE: tx hash
    FE->>BE: POST /api/tablets/:tokenId/sync
    BE->>C: tokenURI(42)
    BE->>P: fetch metadata
    BE-->>FE: cached row
```

聲音克隆用的是鑄造/補傳時上傳的音頻(`metadata.dsas.assets.audios`);若當初沒傳,聊天頁會提示用戶來這裡補傳。

## Phase 3: 預構建 Avatar / Voice (Pre-build)

每位逝者一次性構建,可在鑄造時或塔位頁補傳時觸發。

```mermaid
sequenceDiagram
    participant U as User (owner)
    participant FE as Frontend
    participant BE as Backend
    participant R as Render 機 (RTX 5090)

    rect rgb(235, 245, 255)
    note over U,R: 3DGS Avatar (阻塞 ~100s)
    U->>FE: 上傳正面照
    FE->>BE: POST /api/avatar/build
    BE->>R: POST /upload_avatar (正面照)
    R->>R: LAM aigc3d 單張照重建 3D Gaussian Splat 說話頭
    R-->>BE: { avatarLabel, avatarUrl (zip) }
    BE-->>FE: labels
    end

    rect rgb(240, 255, 240)
    note over U,R: Voice 克隆
    U->>FE: 上傳本人錄音
    FE->>BE: POST /api/avatar/build-voice
    BE->>R: POST /upload_voice (錄音)
    R->>R: IndexTTS2 克隆聲音 (本機推理, 不出網)
    R-->>BE: { voiceLabel }
    BE-->>FE: labels
    end

    FE->>FE: 把 labels 寫進 metadata.dsas.avatar
```

> Render 機是【無狀態、persona 無關】的:它只暴露構建/推理接口,不存任何家族記憶。
> 構建結果(`avatarLabel` / `voiceLabel` / `avatarUrl`)由 backend 落到 NFT metadata。

## Phase 4: Live Interaction (WS 流式)

前端不直連 render 機 —— Chrome Private Network Access 會攔 localhost→私網 IP 的 ws,所以 **WS 走 backend 代理**(`/api/avatar/ws`)轉發到 render 機 `/render?token=<jwt>`。backend 用共享密鑰 **HS256 JWT**(`RENDER_JWT_SECRET`,aud=`ymid-render`,TTL 1800s)簽 token,前端只拿短期 token。

```mermaid
sequenceDiagram
    participant U as User
    participant W as MetaMask
    participant FE as Frontend
    participant BE as Backend
    participant R as Render 機 (Tailscale 100.122.149.34:8012)
    participant C as Sepolia

    U->>FE: 進 /tablet/42, 點「啟動數位分身」
    FE->>BE: POST /api/auth/nonce { address }
    BE-->>FE: { nonce }
    FE->>W: signMessage (SIWE)
    W-->>FE: signature
    FE->>BE: POST /api/auth/verify { message, signature }
    BE->>BE: verify SIWE + check nonce
    BE-->>FE: { token: JWT, address }

    FE->>BE: WS connect /api/avatar/ws (Bearer JWT)
    BE->>C: ownerOf(42) — equals JWT.address?
    BE->>BE: 簽 HS256 render JWT (aud=ymid-render, TTL 1800s)
    BE->>R: WS connect /render?token=<renderJwt> (代理)

    loop 每輪對話
        FE->>BE: { type:'chat', request_id, messages:[...完整數組...], voice, temperature }
        BE->>R: 轉發 (backend buildPersonaSystemPrompt 產生 system prompt)
        R->>R: vLLM 跑 Qwen3-14B-AWQ 流式 (<think> 服務端剝掉)
        R-->>BE: text_delta 文本幀 (流式 token)
        BE-->>FE: text_delta
        R->>R: IndexTTS2 合成 + LAM Audio2Expression (52維 ARKit) + ARTalk 頭姿
        R-->>BE: 二進制幀 (每句一幀)
        BE-->>FE: [uint32 LE meta_len][meta JSON][WAV 24kHz mono PCM16][float32 (n,52) 表情][float32 (n,3) 頭姿(可選)]
        FE->>FE: WebGL 渲染 3DGS avatar + 預緩衝 ~1.8-3s 音頻再播放
        R-->>BE: done / error
        BE-->>FE: done / error
    end
```

性能:LLM 首 token ~100ms;TTS 是瓶頸(IndexTTS2 RTF≈2.7),所以前端需預緩衝約 1.8-3s 音頻再播放,否則句間有空白。persona system prompt 要求「像家人朋友般口語閒聊、回覆短(通常 1-2 句)」。

## Phase 5: Privacy (隱私)

對話經過自建 render 機(自己的機器,Tailscale 內網),不再經過第三方雲 API(Simli / OpenAI / fal.ai / ElevenLabs 都已不用),敏感家族對話隱私更好。LLM、語音克隆、表情/頭姿全部本機推理,不出網。

原始資產(照片 / 影片 / 音頻 / 對話紀錄)永久留在 IPFS(直到家屬取消 pin),生產應切 Arweave。render 機本身【無狀態】,不留任何對話或記憶。

這呼應 idea.md §六:
> 互動結束 → 不在第三方雲端留存,原始資料永遠留存於 IPFS / Arweave.
