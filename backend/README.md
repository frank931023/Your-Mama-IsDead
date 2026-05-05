# @dsas/backend

Application backend for the DSAS (Decentralized Sovereign Ancestor System) prototype.

Stack: Fastify + TypeScript + Prisma (Postgres) + BullMQ (Redis) + viem + SIWE.

## Responsibilities

- Off-chain cache of NFT (`Tablet`) state queried over RPC.
- SIWE (EIP-4361) authentication: signs nonce, verifies against `ownerOf(tokenId)`, mints a short-lived JWT.
- Upload relay to Pinata (IPFS).
- Training-job lifecycle (queue + status + completion callback from offline trainer).
- Thin proxy to the Python `compute/` service for persona inference.

## Quick start

Prerequisites: Node 20+, pnpm (or npm), Docker.

```bash
# from repo root: bring up postgres + redis
docker compose up -d postgres redis

cd backend
pnpm install
cp ../.env.example .env       # then fill DATABASE_URL, REDIS_URL, JWT_SECRET, RPC_URL, CONTRACT_ADDRESS, CHAIN_ID, SIWE_DOMAIN
pnpm prisma:generate
pnpm prisma:migrate            # creates tables
pnpm dev                       # tsx watch src/server.ts
```

The server listens on `BACKEND_PORT` (default `4000`).

## REST surface

| Method | Path                                | Purpose                                       |
|--------|-------------------------------------|-----------------------------------------------|
| POST   | `/api/auth/nonce`                   | Issue SIWE nonce                              |
| POST   | `/api/auth/verify`                  | Verify signature, return JWT                  |
| GET    | `/api/tablets/:tokenId`             | Read tablet (chain + cache + metadata JSON)   |
| GET    | `/api/tablets/by-owner/:address`    | List cached tablets owned by address          |
| POST   | `/api/tablets/sync/:tokenId`        | Re-read chain, upsert cache                   |
| GET    | `/api/tablets/:tokenId/lineage`     | BFS subtree of ERC-6150 children (depth ≤ 6)  |
| POST   | `/api/uploads/presign`              | Backend-issued upload ticket (see below)      |
| POST   | `/api/uploads/relay`                | Multipart relay → Pinata pinFileToIPFS        |
| POST   | `/api/jobs`                         | Create TrainingJob (auth + ownerOf check)     |
| GET    | `/api/jobs/:id`                     | Job status + artifactCid                      |
| POST   | `/api/jobs/:id/complete`            | Trainer callback (X-Trainer-Key header)       |
| GET    | `/api/jobs/by-tablet/:tokenId`      | Jobs for a tablet                             |
| POST   | `/api/personas/:tokenId/chat`       | Proxy → compute (auth + ownerOf)              |
| POST   | `/api/personas/:tokenId/portrait`   | Proxy → compute (auth + ownerOf)              |
| POST   | `/api/personas/:tokenId/voice`      | Proxy → compute (auth + ownerOf)              |
| GET    | `/api/personas/:tokenId/manifest`   | Proxy → compute (public)                      |

## Architectural decision: presign vs relay for uploads

Pinata's V3 `POST /v3/files/sign` issues short-lived upload URLs but the spec
churns; we provide **both** endpoints and let the frontend choose:

- `POST /api/uploads/presign` — returns either a Pinata-signed JWT (when
  `PINATA_JWT` is configured and the v3 sign endpoint succeeds) or a
  backend `uploadId` that points the client at the relay.
- `POST /api/uploads/relay` — accepts multipart, posts the file to
  `https://api.pinata.cloud/pinning/pinFileToIPFS` server-side using
  `PINATA_JWT`, and returns `{ cid, uri, size }`.

For the prototype the relay path is the safer default (one credential, server-side
control of size limits). Presign is wired up for production cost reduction.

## Tests

```bash
pnpm test
```

Vitest covers SIWE roundtrip and viem chain helpers (mock transport).
