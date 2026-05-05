# DSAS Architecture

```mermaid
flowchart TB
    subgraph User["家屬 (User)"]
        Wallet[MetaMask / Rabby / WalletConnect]
        Browser[Browser]
    end

    subgraph Frontend["frontend/ — Next.js"]
        UI[Mint / Tablet / Chat / Lineage]
        WagmiHook[wagmi + RainbowKit]
    end

    subgraph Backend["backend/ — Fastify"]
        AuthSvc[SIWE Auth]
        TabletAPI[Tablet API]
        UploadAPI[Upload Relay]
        JobAPI[Training Jobs]
        Proxy[Persona Proxy]
        DB[(Postgres / Prisma)]
        Queue[(Redis / BullMQ)]
    end

    subgraph Compute["compute/ — FastAPI"]
        PersonaAPI[Persona Endpoints]
        Cache[Persona LRU Cache]
        RAG[RAG Engine]
        LoRA[LoRA Runner]
        TTS[TTS Runner]
        LLM[LLM Client]
    end

    subgraph Storage["storage/ — Provider Abstraction"]
        Pinata[Pinata IPFS]
        Web3Storage[web3.storage]
        Irys[Irys → Arweave]
        Local[Local FS]
    end

    subgraph Chain["contracts/ — Sepolia"]
        NFT[DigitalTablet<br/>ERC-721 + ERC-6150]
    end

    subgraph Training["training/ — Offline GPU"]
        P1[01_fetch_assets]
        P2[02_caption_images]
        P3[03_train_lora]
        P4[04_train_voice]
        P5[05_build_rag]
        P6[06_package]
        P7[07_upload]
    end

    Wallet --> WagmiHook
    Browser --> UI
    UI --> WagmiHook
    WagmiHook -- "mint / setArtifactURI" --> NFT
    UI -- "fetch / chat / mint" --> Backend
    UI -- "presign / direct upload" --> Pinata

    AuthSvc -- "ownerOf" --> NFT
    TabletAPI -- "tokenURI / parent / children" --> NFT
    TabletAPI -- "metadata JSON" --> Pinata
    UploadAPI --> Pinata
    Proxy --> PersonaAPI

    JobAPI --> Queue
    JobAPI --> DB
    TabletAPI --> DB

    PersonaAPI --> Cache
    Cache -- "manifest URI" --> NFT
    Cache -- "lora / voice / rag files" --> Pinata
    PersonaAPI --> RAG
    PersonaAPI --> LoRA
    PersonaAPI --> TTS
    RAG --> LLM

    P1 -- "tokenURI + assets" --> NFT
    P1 -- "download" --> Pinata
    P7 -- "upload" --> Pinata
    P7 -- "setArtifactURI" --> NFT
```

## Layer Boundaries

| Layer | Owns | Trusts | Notes |
|---|---|---|---|
| Identity (chain) | NFT ownership, family tree, artifact pointers | Nothing | Source of truth for ownership |
| Storage | Bytes addressed by CID | Provider's persistence guarantees | IPFS for prototype; Arweave swap = driver change |
| Compute | Inference only | Chain + storage for inputs | Stateless except LRU cache |
| Backend | Off-chain cache, session, jobs | Chain + compute + storage | Thin orchestration |
| Frontend | UX | Backend + chain (read) + storage (direct upload) | Wallet is the auth primitive |
| Training | Offline artifact production | Chain + storage | Runs on user's GPU, never on the server |

## Trust & Ownership Invariants

1. **NFT ownership = data sovereignty.** The wallet that owns the NFT is the only authority that can update `artifactURI` or mint descendants.
2. **Storage is content-addressed.** A CID change = a new artifact version, not a mutation. Old versions remain pinned until the user unpins.
3. **The compute service caches but never owns.** All artifacts are reproducible from chain + storage; cache loss is recoverable.
4. **Training is user-controlled.** The backend never touches private keys for `setArtifactURI`; the user signs that transaction from their offline training machine using `TRAINER_PRIVATE_KEY`.
