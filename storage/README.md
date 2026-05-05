# @dsas/storage

Storage layer for the DSAS (Digital Sovereign Ancestor System) prototype.

Provides:

- A pluggable `IStorageProvider` interface with three drivers (`pinata`, `web3storage`, `local`, plus an `irys` skeleton for future Arweave migration).
- Chat-log parsers for six platforms (LINE / WhatsApp / Facebook / Instagram / Telegram / Discord) that all emit a single `UnifiedChatLog` schema.
- A `buildTabletMetadata()` helper that produces ERC-721 + DSAS-extension JSON conforming to `shared/types/tablet.ts`.
- A small `encryption.ts` module for optional AES-256-GCM at-rest encryption (HKDF-derived keys).

The contract layer and the front-end never need to know which storage driver is active — they only see `ipfs://...` / `ar://...` / `file://...` URIs.

## Install

```bash
pnpm install
pnpm run build
```

## Usage — pick a provider

```ts
import { getProvider } from "@dsas/storage/providers";

// Driver picked from STORAGE_DRIVER env var (default: pinata).
const storage = getProvider();

const photo = await storage.putBlob(buffer, "image/jpeg", [
  { name: "App-Name", value: "DSAS" },
  { name: "Asset-Type", value: "photo" },
]);
console.log(photo.uri);          // ipfs://bafy...
console.log(storage.gatewayUrl(photo.uri));  // https://gateway.pinata.cloud/ipfs/bafy...
```

Drivers:

| driver        | env var(s)                                | notes                                           |
| ------------- | ----------------------------------------- | ----------------------------------------------- |
| `pinata`      | `PINATA_JWT`, `IPFS_GATEWAY`              | default, prototype                              |
| `web3storage` | (TBD)                                     | skeleton — throws `Not implemented`             |
| `local`       | none                                      | writes to `./.local-storage/<sha256>.bin`       |
| `irys`        | (TBD)                                     | skeleton — throws `Not implemented`             |

## Usage — parse a chat log

```ts
import { parseChatLog } from "@dsas/storage/chatlog";
import { readFile } from "node:fs/promises";

const raw = await readFile("./line_export.txt");
const log = await parseChatLog("line", raw, "王大明");

// log.platform === "line"
// log.messages: { ts, from, text }[]
```

All six platforms collapse to:

```ts
interface UnifiedChatLog {
  platform: string;
  participants: string[];
  deceasedName: string;
  messages: { ts: string; from: string; text: string; mediaUri?: string }[];
}
```

## Usage — build NFT metadata

```ts
import { buildTabletMetadata } from "@dsas/storage/metadata";

const meta = buildTabletMetadata({
  deceased: {
    name: "王大明",
    gender: "male",
    origin: "台灣彰化",
    birth: { date: "1940-02-15" },
    death: { date: "2024-01-01" },
    biography: "...",
  },
  generation: 0,
  image: "ipfs://bafyPortrait",
});
```

## Test

```bash
pnpm run test
```

Provider tests are skipped — they require live Pinata / web3.storage credentials.
