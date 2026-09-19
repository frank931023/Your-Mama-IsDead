# @dsas/backend

Application backend for **Aeterlux 數位記憶燈塔** (repo code name DSAS). Synced with [docs/Aeterlux_系統概述文件_0914.docx](../docs/Aeterlux_系統概述文件_0914.docx); see [docs/architecture.md](../docs/architecture.md) for the full picture.

Stack: Fastify + TypeScript + Prisma (PostgreSQL + pgvector) + Redis + viem + SIWE + `ws` + LiveKit server SDK.

## Responsibilities

- Off-chain cache of NFT (`Tablet`) state read over RPC (owner, `tokenURI`, `artifactURI`, ERC-6150 parent).
- SIWE (EIP-4361) login → short-lived JWT; owner checks always read `ownerOf` on chain.
- Upload relay to permanent storage: Arweave via Irys (ArDrive Turbo fallback), IPFS via Pinata, or local disk (`STORAGE_DRIVER`).
- RAG memory: e5 embeddings in-process + pgvector; indexes public chat logs, owner-supplied decrypted private chat logs, and approved stories.
- Persona prompt building, render-machine token signing and WebSocket proxy (`/api/avatar/ws`).
- Memorial: visibility / invite codes, story moderation, tributes, and the online ceremony (WebSocket hub or LiveKit tokens).

The backend never sees plaintext of Lit-encrypted assets unless the owner explicitly sends decrypted chat logs for indexing.

## Quick start

The normal path is Docker from the repo root (`docker compose up -d`), which runs `npm install`, `prisma generate`, `prisma migrate deploy` and `npm run dev` inside the container. The server listens on `BACKEND_PORT` (default **14000**).

Running on the host:

```bash
docker compose up -d postgres redis livekit   # from repo root
cd backend
npm install
npx prisma generate
npx prisma migrate deploy
npm run dev                                   # tsx watch src/server.ts
```

Environment is read from the repo-root `.env` (see [.env.example](../.env.example)).

## Environment switches

| Variable | Values | Effect |
|---|---|---|
| `STORAGE_DRIVER` | `arweave` \| `pinata` \| `local` | Where `/api/uploads/relay` stores files. Runtime override via `PUT /api/admin/config` |
| `ARWEAVE_BUNDLER` | `irys` \| `turbo` | Primary bundler; the other one is the automatic fallback |
| `CEREMONY_TRANSPORT` | `ws` \| `livekit` | Online memorial channel. Unset → `livekit` when `LIVEKIT_URL` + key + secret are set, else `ws` |

`NEXT_PUBLIC_LIT_MODE` (`none` / `legacy` / `chipotle`) is a frontend switch; the backend only stores ciphertext.

## REST surface

**Auth & tablets**

| Method | Path | Guard | Purpose |
|---|---|---|---|
| GET | `/api/auth/nonce` | — | Issue SIWE nonce |
| POST | `/api/auth/verify` | — | Verify signature, return JWT |
| GET | `/api/tablets/:tokenId` | — | Tablet (lazy sync from chain) incl. `artifactURI` |
| POST | `/api/tablets/:tokenId/sync` | — | Re-read chain, upsert cache |
| GET | `/api/tablets/:tokenId/lineage` | — | ERC-6150 subtree |
| GET | `/api/tablets/by-owner/:address`, `/api/tablets`, `/api/tablets/registry`, `/api/tablets/registry/public` | — | Listings |
| POST | `/api/tablets/scan` | — | Probe chain for token ids and sync them |
| GET | `/api/tablets/:tokenId/access` | — | Visibility for the memorial page |
| GET | `/api/tablets/:tokenId/invite` | owner | Invite code |
| PATCH | `/api/tablets/:tokenId/visibility` | owner | PUBLIC / UNLISTED / PRIVATE |
| POST | `/api/tablets/:tokenId/invite/regenerate` | owner | New invite code |

**Uploads**

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/uploads/relay` | Multipart upload → Arweave (`ar://…`) / Pinata (`ipfs://…`) / local. Errors: 503 `arweave_not_configured` / `pinata_not_configured`, 502 `arweave_upload_failed` |
| POST | `/api/uploads/presign` | Pinata-signed upload ticket in `pinata` mode; relay pointer otherwise |
| GET | `/api/uploads/local/:hash` | Serve files stored in `local` mode |

**Persona, RAG and avatar**

| Method | Path | Guard | Purpose |
|---|---|---|---|
| GET | `/api/personas/:tokenId/persona-prompt?q=` | owner or invite | System prompt with top-4 retrieved memories (distance ≤ 0.62) and optional memory photos |
| POST | `/api/personas/:tokenId/reindex-memory` | owner | Rebuild the memory index. Body `{ privateChatlogs?: [{ uri, platform, format, text }] }` adds decrypted private chat logs (`MemoryChunk.kind = private_chatlog`, kept across later reindexes) |
| GET | `/api/personas/:tokenId/memory-status` | owner | Number of indexed chunks |
| POST | `/api/personas/:tokenId/cloud-stt` | owner or invite | Speech-to-text (OpenAI `whisper-1`) |
| POST | `/api/personas/:tokenId/avatar-session` | owner or invite | Short-lived render token + avatar / voice labels |
| POST | `/api/avatar/build` | auth | Portrait → LAM 3DGS avatar on the render machine |
| POST | `/api/avatar/build-voice` | auth | Recording → IndexTTS2 voice clone |

**Memorial**

| Method | Path | Guard | Purpose |
|---|---|---|---|
| GET | `/api/stories/:tokenId` | — | Approved stories |
| GET | `/api/stories/:tokenId/all` | owner | All stories incl. pending |
| POST | `/api/stories/:tokenId` | write access | Submit a story (pending review) |
| PATCH / DELETE | `/api/stories/:tokenId/:storyId` | owner | Moderate (approval indexes it into memory) / delete |
| POST | `/api/stories/:tokenId/commit` | owner | Mark stories as committed on chain |
| GET / POST | `/api/tributes/:tokenId` | POST: write access | Tributes; POST also pushes to the live ceremony room |
| DELETE | `/api/tributes/:tokenId/:tributeId` | owner | Remove a tribute |
| GET | `/api/ceremony/:tokenId/connect[?code=]` | visibility | `{transport:"ws"}` or `{transport:"livekit", url, token, identity, room}` |

**Admin** (single password, `ADMIN_PASSWORD`; no frontend page): `POST /api/admin/login`, `GET|PUT /api/admin/config` (storage mode / chain mode), `POST /api/admin/fund` (anvil `setBalance`).

**Other endpoints** (not used by the frontend): `/api/jobs/*` (offline training jobs), `/api/simli/*`, `/api/personas/:tokenId/{chat,portrait,voice,manifest,cloud-chat,cloud-voice,cloud-portrait,cloud-video,simli-session}`, `/api/personas/cloud-status`.

## WebSocket endpoints

| Path | Purpose |
|---|---|
| `/api/avatar/ws?token=` | Pipes to the render machine `/render?token=` (Chrome Private Network Access blocks the browser from reaching the Tailscale IP directly) |
| `/api/ceremony/:tokenId/ws[?code=]` | Ceremony hub for `CEREMONY_TRANSPORT=ws` and as the browser fallback when LiveKit is unreachable |

## Scripts

| Script | Purpose |
|---|---|
| `npx tsx scripts/irys-account.ts [fund <ETH>]` | Show the Irys payer address, balance and price; fund it with mainnet ETH |
| `npx tsx scripts/migrate-to-arweave.ts [--execute] [--token N]` | Copy `ipfs://` assets of existing tablets to Arweave, rewrite metadata, `setTokenURI` (dry run by default) |
| `LIT_CHIPOTLE_ACCOUNT_KEY=… npx tsx scripts/lit-chipotle-setup.ts` | Register the Lit Chipotle Action, group and usage key; prints the frontend `NEXT_PUBLIC_LIT_CHIPOTLE_*` values |

## Tests

```bash
npm test
```

Vitest covers the SIWE roundtrip and viem chain helpers (mock transport).
