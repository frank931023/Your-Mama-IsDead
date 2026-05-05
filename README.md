# DSAS — Data Sovereignty as Soul

> 主權數位先祖系統 / 數位塔位 prototype

結合區塊鏈與生成式 AI 的數位永生服務。家屬透過 NFT 擁有逝者的數位分身,並能與其互動(對話、影像、聲音)。

- 願景:[idea.md](idea.md)
- 詳細工程規劃:[PROTOTYPE_PLAN.md](PROTOTYPE_PLAN.md)

## Repo Layout

| 模組 | 技術 | 範圍 | 文件 |
|---|---|---|---|
| [contracts/](contracts/) | Foundry, Solidity 0.8.24 | ERC-721 + ERC-6150 智能合約 + 19 個 Foundry 測試 | [docs/contracts.md](docs/contracts.md) |
| [storage/](storage/) | TypeScript / ESM | IStorageProvider 抽象 + Pinata/web3storage/local/Irys driver + 6 平台 chatlog parsers + AES-256-GCM 加密 | [storage/README.md](storage/README.md) |
| [compute/](compute/) | Python 3.11 + FastAPI | Persona/auth/assets routes + 完整 RAG engine + LoRA/TTS stub + LRU artifact cache | [compute/README.md](compute/README.md) |
| [backend/](backend/) | Node.js + Fastify + Prisma | SIWE auth + Tablet/Upload/Job/Persona routes + Postgres + BullMQ | [backend/README.md](backend/README.md) |
| [frontend/](frontend/) | Next.js 14 + wagmi v2 + RainbowKit | Mint 5-step flow + Chat (SSE 三軌同步) + 家族樹 + Dashboard | [frontend/README.md](frontend/README.md) |
| [training/](training/) | Python pipelines | 7 步離線訓練 (fetch → caption → LoRA → voice → RAG → package → upload) | [training/README.md](training/README.md) |
| [shared/types/](shared/types/) | TypeScript types | 跨服務共用型別 (TabletMetadata / ArtifactManifest) | — |
| [docs/](docs/) | Markdown | [架構](docs/architecture.md) / [資料流](docs/data-flow.md) / [合約](docs/contracts.md) / [威脅模型](docs/threat-model.md) | — |

## Quick Start

```bash
# 1. 環境變數
cp .env.example .env
# 填入 PINATA_JWT, OPENAI_API_KEY, NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID 等

# 2. 起本地服務 (postgres/redis/qdrant/minio)
docker compose up -d

# 3. 部署合約 (Sepolia testnet)
cd contracts
forge install
forge test
forge script script/Deploy.s.sol --rpc-url $RPC_URL --broadcast

# 4. 啟動後端
cd ../backend
pnpm install
pnpm prisma migrate dev
pnpm dev

# 5. 啟動 compute 服務
cd ../compute
python -m venv .venv && source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# 6. 啟動前端
cd ../frontend
pnpm install
pnpm dev  # http://localhost:3000

# 7. 線下訓練 (需 GPU, 在素材已上傳到 IPFS 後執行)
cd ../training
pip install -r requirements.txt
python pipelines/01_fetch_assets.py --token-id 1
# ... 02 ~ 07
```

## End-to-End Demo Flow

1. 連 MetaMask (Sepolia) → 進 `/mint`
2. 填逝者基本資料 (姓名/籍貫/生卒/陽世子孫)
3. 上傳照片/影片/音檔/對話紀錄 → IPFS
4. 簽名鑄造 NFT (ERC-721 + ERC-6150)
5. (離線) 跑 training pipeline → artifact 回填到鏈上
6. 進 `/tablet/[tokenId]` 點「啟動數位分身」
7. SIWE 簽名驗證 → 三軌互動 (文字 + 影像 + 語音)

## Build Status

實機驗證(2026-05-05):

| 模組 | Compile / Typecheck | Tests | 備註 |
|---|---|---|---|
| contracts | ✅ Solc 0.8.24 編譯通過 | ✅ **20/20 forge tests** | OpenZeppelin v5 + ERC-6150 minimal |
| storage | ✅ tsc 通過 | ✅ **27/27 vitest** | 6 平台 chatlog parsers + Pinata 實作 |
| backend | ✅ tsc 通過 | ✅ **8/8 vitest** | Fastify + Prisma client OK |
| compute | ✅ Python 3.11 OK | ✅ **10/10 pytest** | RAG + LRU cache + lock dedup |
| frontend | ✅ tsc 通過 | — | 965 packages, Next.js 14 |
| training | ✅ py_compile 全過 | ✅ CLIs 響應 `--help` | 8 個 pipeline 腳本 |

## What's Next (整合與部署)

Prototype 程式骨架已全部就位。要實際跑通需要:

1. **安裝依賴**
   - `cd contracts && forge install OpenZeppelin/openzeppelin-contracts foundry-rs/forge-std`
   - 各 TypeScript 模組:`pnpm install`
   - 各 Python 模組:`pip install -r requirements.txt`
2. **填 secrets**:`PINATA_JWT`、`OPENAI_API_KEY`、`NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`、`DEPLOYER_PRIVATE_KEY`
3. **領 Sepolia ETH**:[sepoliafaucet.com](https://sepoliafaucet.com)
4. **部署合約**,把地址寫回所有 `.env`
5. **跑 backend / compute / frontend**,在 frontend 鑄第一張塔位
6. **跑 training pipeline**(可在無 GPU 機器先跑 stub 驗證流程,真實訓練再上 GPU 機)

要把 LoRA / TTS 從 stub 換成真實推理,各檔案頂部都有 `REAL IMPLEMENTATION` 註解區塊指引。

## License

MIT
