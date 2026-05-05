# Data Flow — End to End

## Phase 1: Mint a Tablet

```mermaid
sequenceDiagram
    participant U as User (家屬)
    participant W as MetaMask
    participant FE as Frontend
    participant BE as Backend
    participant P as Pinata (IPFS)
    participant C as DigitalTablet (Sepolia)

    U->>FE: 進 /mint, 填表 (name/origin/birth/death/descendants)
    U->>FE: 拖入 photos/videos/audios/chatlogs
    FE->>BE: POST /api/uploads/relay (each asset)
    BE->>P: pinFileToIPFS
    P-->>BE: { cid }
    BE-->>FE: { uri: "ipfs://CID" }
    FE->>FE: buildTabletMetadata({ ...form, assetURIs })
    FE->>BE: POST /api/uploads/relay (metadata JSON)
    BE->>P: pinJSONToIPFS
    P-->>BE: { cid: metadataCid }
    BE-->>FE: { uri: "ipfs://metadataCid" }
    FE->>W: 簽 tx: safeMintWithParent(parentId, "ipfs://metadataCid")
    W->>C: send tx
    C-->>W: tokenId, receipt
    W-->>FE: tx hash
    FE->>BE: POST /api/tablets/sync/:tokenId
    BE->>C: ownerOf, tokenURI, parent, children
    BE->>P: fetch metadata
    BE-->>FE: cached row
```

## Phase 2: Offline Training

```mermaid
sequenceDiagram
    participant U as User (本地 GPU)
    participant T as training/ scripts
    participant C as Sepolia
    participant P as Pinata

    U->>T: 01_fetch_assets --token-id 42
    T->>C: tokenURI(42)
    T->>P: fetch metadata + each asset
    T-->>U: workspace/42/raw/

    U->>T: 02_caption_images
    T-->>U: workspace/42/captions/

    U->>T: 03_train_lora
    T-->>U: workspace/42/lora/lora.safetensors

    U->>T: 04_train_voice
    T-->>U: workspace/42/voice/voice_model.bin

    U->>T: 05_build_rag
    T-->>U: workspace/42/rag/index.json

    U->>T: 06_package_artifact
    T-->>U: workspace/42/dist/artifact-v1.tar.gz + manifest.json

    U->>T: 07_upload_artifact --signer $TRAINER_PRIVATE_KEY
    T->>P: pin lora / voice / rag / manifest
    P-->>T: 4× CIDs
    T->>C: setArtifactURI(42, "ipfs://manifestCid")
    C-->>T: tx hash
```

## Phase 3: Live Interaction

```mermaid
sequenceDiagram
    participant U as User
    participant W as MetaMask
    participant FE as Frontend
    participant BE as Backend
    participant K as Compute (FastAPI)
    participant C as Sepolia
    participant P as Pinata

    U->>FE: 進 /tablet/42, 點「啟動數位分身」
    FE->>BE: POST /api/auth/nonce { address }
    BE-->>FE: { nonce }
    FE->>W: signMessage (SIWE)
    W-->>FE: signature
    FE->>BE: POST /api/auth/verify { message, signature }
    BE->>BE: verify SIWE + check nonce
    BE-->>FE: { token: JWT, address }

    FE->>BE: POST /api/personas/42/chat (Bearer JWT) { message }
    BE->>C: ownerOf(42) — equals JWT.address?
    BE->>K: POST /persona/42/chat (relayed)
    K->>K: cache.get(42) ?
    alt cache miss
        K->>C: artifactURI(42)
        K->>P: fetch manifest
        K->>P: fetch lora / voice / rag
    end
    K->>K: RAG retrieve top-5
    K->>K: LLM stream
    K-->>BE: SSE tokens
    BE-->>FE: SSE tokens
    FE->>FE: 顯示文字 + 觸發 portrait + voice 同步
    FE->>BE: POST /api/personas/42/portrait { prompt }
    BE->>K: relay
    K-->>FE: PNG bytes
    FE->>BE: POST /api/personas/42/voice { text }
    BE->>K: relay
    K-->>FE: WAV bytes
```

## Phase 4: Cache Eviction (Privacy)

After SSE connection closes, the compute cache marks the persona's last-access timestamp. After `CACHE_TTL_SECONDS` (default 300s) of inactivity, the in-memory artifacts are GC'd. The on-disk download cache may remain until `MAX_DISK_CACHE_GB` is exceeded. The original assets stay pinned on IPFS forever (or until the family unpins).

This realizes idea.md §六:
> 互動結束 → 快取資料刪除,原始資料永遠留存於 Arweave.
