# @dsas/frontend

Next.js 14 (App Router) front-end for **Aeterlux 數位記憶燈塔**. Synced with [docs/Aeterlux_系統概述文件_0914.docx](../docs/Aeterlux_系統概述文件_0914.docx); architecture in [docs/architecture.md](../docs/architecture.md).

## Quickstart

The normal path is `docker compose up -d` from the repo root (the container reads the root `.env`). To run on the host:

```bash
npm install
cp .env.local.example .env.local
# fill in NEXT_PUBLIC_CONTRACT_ADDRESS (+ NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID, Lit settings if used)
npm run dev
```

Open http://localhost:3000. `NEXT_PUBLIC_*` values are baked in when the dev server starts — restart (or `docker compose up -d frontend`) after changing them.

## Scripts

| script | what |
|---|---|
| `dev` | `next dev` |
| `build` | `next build` |
| `start` | `next start` |
| `lint` | `next lint` |
| `typecheck` | `tsc --noEmit` |

## Stack

- Next.js 14 App Router + TypeScript (strict), Tailwind CSS (components inline under `src/components/ui/`)
- wagmi v2 + viem + RainbowKit, React Query
- React Three Fiber / drei for the 3D memorial hall; `gaussian-splat-renderer-for-lam` for the 3DGS talking head
- `livekit-client` for the multi-person ceremony (loaded on demand)
- Lit SDK v8 (loaded from esm.sh at runtime) for threshold encryption of private assets; WebCrypto AES-256-GCM + `@noble/curves` (secp256k1 ECDH) for the chipotle key-wrapping mode
- react-flow for the family tree

## Routes

| route | purpose |
|---|---|
| `/` | landing |
| `/mint` | 5-step mint flow; with Lit enabled, private media is stashed in the tab and sealed after the mint (second tx `setArtifactURI`) |
| `/tablet/[tokenId]` | tablet page: biography / photos / media / descendants / chat logs / **private memories** (unlock with the owner wallet); in-place editing and "save on chain" |
| `/tablet/[tokenId]/chat` | real-time chat with the digital persona (3DGS head, cloned voice, RAG) |
| `/memorial/[tokenId]` | memorial board: stories, tributes; entry to the **3D hall** (multi-person ceremony) |
| `/dashboard`, `/dashboard/[tokenId]` | tablets owned by the wallet; manage memorial (theme, visibility, invite code, story moderation, reindex memory) |
| `/registry` | public tablet registry / online memorial list (`/baibai` redirects here) |
| `/lineage/[rootId]` | ERC-6150 family tree |
| `/admin/replace-image` | one-off tool to replace a registry portrait |

## Environment switches

| Variable | Values | Notes |
|---|---|---|
| `NEXT_PUBLIC_LIT_MODE` | `none` \| `legacy` \| `chipotle` | `none` = no encryption; `legacy` = Lit threshold network (SDK loaded from esm.sh at runtime); `chipotle` = Lit Action, needs `NEXT_PUBLIC_LIT_CHIPOTLE_ACTION_CID` / `…_ACTION_PUBKEY` / `…_USAGE_KEY` from `backend/scripts/lit-chipotle-setup.ts` |
| `NEXT_PUBLIC_ARWEAVE_GATEWAY` / `NEXT_PUBLIC_IPFS_GATEWAY` | URLs | How `ar://` / `ipfs://` URIs are displayed; freshly uploaded ciphertext falls back to `gateway.irys.xyz` |

The ceremony transport (`ws` / `livekit`) is chosen by the backend (`CEREMONY_TRANSPORT`); the browser asks `GET /api/ceremony/:tokenId/connect` and falls back to the WebSocket hub if LiveKit cannot connect.

## Key modules

| Path | Role |
|---|---|
| `src/lib/lit/` | `config.ts` (mode switch), `legacy.ts` + `legacy-sdk.ts` (Lit threshold encryption, SDK loaded from CDN), `payload.ts` (file name + bytes container), `chipotle.ts` + `envelope.ts` (chipotle mode: file-key wrapping + AES-GCM), `artifact.ts` (seal / unlock / decrypt), `pending-files.ts` (in-tab stash for files awaiting encryption) |
| `src/components/PrivateMemories.tsx` | Unlock, decrypt and view private memories; send decrypted chat logs to the AI memory |
| `src/lib/tablet-save.ts` | Merge metadata, seal new private files, `setTokenURI` / `setArtifactURI`, sync, reindex |
| `src/lib/ceremony.ts` | Ceremony channel (LiveKit data channel + voice, or WebSocket) behind one hook |
| `src/components/baibai/MemorialHall.tsx` | 3D hall: avatars, rituals, chat bubbles, voice controls |
| `src/components/ChatInterface.tsx` | Persona chat (per-turn RAG prompt, render-machine WebSocket) |
