# DSAS Architecture

```mermaid
flowchart TB
    subgraph User["家屬 (User)"]
        Wallet[MetaMask / Rabby / WalletConnect]
        Browser[Browser]
    end

    subgraph Frontend["frontend/ — Next.js 14"]
        UI[Mint / Tablet / Chat / Lineage]
        WagmiHook[wagmi + RainbowKit]
    end

    subgraph Backend["backend/ — Fastify + TS"]
        AuthSvc[SIWE Auth + JWT]
        TabletAPI[Tablet API]
        UploadAPI[Upload Relay → Pinata]
        BuildAPI[Avatar / Voice Build]
        WSProxy[WS Proxy<br/>/api/avatar/ws]
        Persona[Persona Prompt Builder]
        RenderJWT[HS256 Render JWT signer]
        DB[(Postgres / Prisma)]
    end

    subgraph Render["render machine — RTX 5090 (Tailscale 100.122.149.34:8012)"]
        vLLM[vLLM · Qwen3-14B-AWQ]
        TTS[IndexTTS2 voice clone]
        A2E[LAM Audio2Expression + ARTalk]
        AvatarBuild[3DGS avatar builder<br/>LAM aigc3d]
    end

    subgraph Storage["storage/ — Provider Abstraction"]
        Pinata[Pinata IPFS]
        Arweave[Arweave · future]
    end

    subgraph Chain["contracts/ — Sepolia"]
        NFT[DigitalTablet<br/>ERC-721 + ERC-6150]
    end

    Wallet --> WagmiHook
    Browser --> UI
    UI --> WagmiHook
    WagmiHook -- "mint / setTokenURI / setArtifactURI" --> NFT
    UI -- "fetch / chat / build" --> Backend
    UI == "WS /api/avatar/ws" ==> WSProxy

    AuthSvc -- "ownerOf" --> NFT
    TabletAPI -- "tokenURI / parent / children" --> NFT
    TabletAPI -- "metadata JSON (merge + pin)" --> Pinata
    TabletAPI --> DB
    UploadAPI --> Pinata
    AuthSvc -- "issues short-lived" --> RenderJWT
    RenderJWT -. "aud=ymid-render token" .-> UI

    BuildAPI -- "/upload_avatar" --> AvatarBuild
    BuildAPI -- "/upload_voice" --> TTS
    WSProxy == "/render?token=jwt" ==> vLLM
    vLLM --> TTS
    TTS --> A2E
    AvatarBuild -. "3DGS zip" .-> Storage
```

## Layer Boundaries

| Layer | Owns | Trusts | Notes |
|---|---|---|---|
| Identity (chain) | NFT ownership, family tree, artifact pointers | Nothing | Source of truth for ownership |
| Storage | Bytes addressed by CID | Provider's persistence guarantees | IPFS for prototype; Arweave swap = driver change |
| Render machine | Inference only (LLM / TTS / expression / avatar build) | Backend-signed JWT for every request | Self-hosted on Tailscale; **stateless & persona-agnostic** |
| Backend | Off-chain cache, session, persona prompts, JWT signing | Chain + render + storage | Thin orchestration; sole holder of `RENDER_JWT_SECRET` |
| Frontend | UX | Backend + chain (read) + storage | Wallet is the auth primitive; talks to render only via backend WS proxy |

## Trust & Ownership Invariants

1. **NFT ownership = data sovereignty.** The wallet that owns the NFT is the only authority that can update `tokenURI` / `artifactURI` or mint descendants.
2. **Storage is content-addressed.** A CID change = a new artifact version, not a mutation. Old versions remain pinned until the user unpins.
3. **The render machine is stateless & persona-agnostic.** It holds no per-deceased state; the backend sends the full `messages` array every turn, so persona, RAG, and memory changes touch only the backend. Inference is reproducible from chain + storage.
4. **Artifact updates are owner-signed.** The backend never touches private keys. The owner signs `setTokenURI(tokenId, newUri)` from their wallet on the tablet page when adding or re-uploading assets (生平 / 照片 / 影音 / 子孫 / 對話紀錄), and the backend merges (never replaces) into the existing metadata before re-pinning.
5. **Render auth is backend-mediated.** The browser never talks to the render machine directly (Chrome Private Network Access blocks localhost → private-IP WS). Backend ↔ render uses a shared-secret HS256 JWT (`aud=ymid-render`, TTL ~1800s); the frontend only ever receives a short-lived signed token.
