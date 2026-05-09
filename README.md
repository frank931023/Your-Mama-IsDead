# DSAS — Data Sovereignty as Soul

> 主權數位先祖系統 / 數位塔位 prototype

結合區塊鏈與生成式 AI 的數位永生服務。家屬透過 NFT 擁有逝者的數位分身，並能與其互動（對話、影像、聲音）。

- 願景：[idea.md](idea.md)
- 詳細工程規劃：[PROTOTYPE_PLAN.md](PROTOTYPE_PLAN.md)
- 架構說明：[docs/architecture.md](docs/architecture.md)

## Repo Layout

| 模組 | 技術 | 範圍 | 文件 |
|---|---|---|---|
| [contracts/](contracts/) | Foundry, Solidity 0.8.24 | ERC-721 + ERC-6150 智能合約 | [docs/contracts.md](docs/contracts.md) |
| [storage/](storage/) | TypeScript / ESM | IStorageProvider 抽象 + 多 driver + 6 平台 chatlog parsers | [storage/README.md](storage/README.md) |
| [compute/](compute/) | Python 3.11 + FastAPI | Persona / RAG / LoRA / TTS（GPU 推理服務） | [compute/README.md](compute/README.md) |
| [backend/](backend/) | Node + Fastify + Prisma | SIWE auth、Tablet/Upload/Job/Persona routes、Postgres、BullMQ | [backend/README.md](backend/README.md) |
| [frontend/](frontend/) | Next.js 14 + wagmi v2 + RainbowKit | Mint 5-step flow、Chat（SSE 三軌）、家族樹、Dashboard | [frontend/README.md](frontend/README.md) |
| [training/](training/) | Python pipelines | 7 步離線訓練（fetch → caption → LoRA → voice → RAG → package → upload） | [training/README.md](training/README.md) |
| [shared/types/](shared/types/) | TypeScript types | 跨服務共用型別（TabletMetadata / ArtifactManifest） | — |

---

## Prerequisites

啟動前你必須先準備好：

| 工具 | 用途 | 怎麼裝 |
|---|---|---|
| **Node.js 20+** | backend / frontend | https://nodejs.org/ |
| **Docker Desktop** | postgres / redis / qdrant / minio | https://www.docker.com/products/docker-desktop/ |
| **Foundry** (`forge`、`cast`) | 編譯 / 部署合約 | `curl -L https://foundry.paradigm.xyz \| bash` 後 `foundryup` |
| **Python 3.11+** *(僅當你要跑 compute / training)* | GPU 推理 + 離線訓練 | https://www.python.org/ |
| **Pinata 帳號** | IPFS 存逝者素材（必要） | https://app.pinata.cloud/ → API Keys → 取 JWT |
| **MetaMask / Rabby** | 連接錢包簽名 mint NFT | 瀏覽器外掛 |
| WalletConnect Cloud projectId *(選擇性)* | 手機錢包掃 QR 連線 | https://cloud.reown.com/ |
| OpenAI / ElevenLabs API key *(選擇性)* | LLM 對話 + 語音合成 | 各自官網 |

---

## First-Time Setup

### 1. 複製 `.env`

```powershell
Copy-Item .env.example .env
```

### 2. 填入必要 secrets

打開 [.env](.env)，**至少填這幾個**才能跑通基本流程：

```ini
# 鏈上（用 Sepolia 測試網）
RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
DEPLOYER_PRIVATE_KEY=0x<你的測試錢包私鑰>

# IPFS（不填會 503）
PINATA_JWT=eyJhbGciOi...

# JWT 簽名密鑰（隨機 32+ 字元）
JWT_SECRET=<請改成隨機字串>
```

選擇性但建議：

```ini
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=<reown projectId>  # 不填會在 console 噴 403，但功能不受影響
OPENAI_API_KEY=sk-...                                    # 沒有就不能跑 chat
```

> ⚠️ `DEPLOYER_PRIVATE_KEY` **絕對不要拿主網有錢的錢包私鑰**。產一個新地址，去 faucet 領 0.1 Sepolia ETH 就夠：
> - https://sepoliafaucet.com/
> - https://cloud.google.com/application/web3/faucet/ethereum/sepolia

### 3. 部署合約（一次性）

需要先部署一次拿到 `CONTRACT_ADDRESS`：

```powershell
# 重新載入 .env 到當前 PowerShell session
. .\load-env.ps1

# 編譯 + 部署
cd contracts
forge install
forge script script/Deploy.s.sol --rpc-url $env:RPC_URL --broadcast
```

跑完最後幾行會印：

```
DigitalTablet deployed at: 0xAbCd1234...
```

把這個地址貼回 [.env](.env) **兩個** 欄位：

```ini
CONTRACT_ADDRESS=0xAbCd1234...
NEXT_PUBLIC_CONTRACT_ADDRESS=0xAbCd1234...
```

---

## Daily Startup（每次開發）

**一鍵啟動：**

```powershell
.\start.ps1
```

[start.ps1](start.ps1) 會自動完成：

1. 載入 `.env`
2. `docker compose up -d`（postgres / redis / qdrant / minio）
3. 等 postgres 健康
4. 兩個專案沒裝過就 `npm install`
5. `prisma generate + migrate`
6. **彈一個 PowerShell 視窗跑 backend** (`http://localhost:4000`)
7. **彈另一個 PowerShell 視窗跑 frontend** (`http://localhost:3000`)

打開瀏覽器 → http://localhost:3000，開始用。

**選用旗標：**

```powershell
.\start.ps1 -InfraOnly    # 只起 docker，不跑 app
.\start.ps1 -SkipInstall  # 跳過 npm install
.\start.ps1 -SkipMigrate  # 跳過 prisma migrate
```

**關閉：** 兩個 dev 視窗各自 `Ctrl+C`，再 `docker compose down` 收 db。

---

## Manual Startup（一個一個跑）

如果不想用 `start.ps1`：

```powershell
# 0. 載入 env（每個新 terminal 都要做一次）
. .\load-env.ps1

# 1. 起基礎設施
docker compose up -d

# 2. Backend
cd backend
npm install                 # 第一次或改了 package.json
npx prisma generate
npx prisma migrate dev      # 第一次或改了 schema.prisma
npm run dev                 # 跑在 :4000

# 3. Frontend（另開一個 terminal）
. .\load-env.ps1
cd frontend
npm install
npm run dev                 # 跑在 :3000
```

要跑 compute / training（GPU 推理）：

```powershell
cd compute
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

---

## Demo Flow（端到端走一次）

1. 連 MetaMask（**Sepolia 網路**） → 進 `/mint`
2. 填逝者基本資料（姓名 / 籍貫 / 生卒 / 陽世子孫）
3. 上傳大頭照 + 其他素材 → 自動釘到 IPFS
4. 簽署同意聲明 → 簽名鑄造 NFT（ERC-721 + ERC-6150）
5. *(離線)* 跑 [training/](training/) pipeline → artifact 回填到鏈上
6. 進 `/tablet/[tokenId]` → 點「啟動數位分身」
7. SIWE 簽名驗證 → 三軌互動（文字 + 影像 + 語音）

---

## Common Pitfalls

開發過程踩過的雷，請對照排除：

| 症狀 | 根因 | 解 |
|---|---|---|
| `forge` 抱怨 `--rpc-url` 沒值 | PowerShell 的 `$RPC_URL` 是空的 | 用 `$env:RPC_URL`（注意 `env:` 前綴），或先 `. .\load-env.ps1` |
| `npm run dev` → `Queue name cannot contain :` | BullMQ 不允許 queue 名稱含冒號 | 已修，名稱固定為 `dsas-training` |
| `Error: unable to determine transport target for "pino-pretty"` | dev mode logger 套件沒裝 | `cd backend; npm install -D pino-pretty` |
| 上傳檔案 → "Network error during upload" | backend 沒啟動 | 確認 `http://localhost:4000` 有回應；沒有就 `npm run dev` |
| 上傳檔案 → 503 `pinata_not_configured` | `.env` 的 `PINATA_JWT` 是空的 | 去 https://app.pinata.cloud/ 申請 JWT 填進去，重啟 backend |
| Console 噴 `api.web3modal.org ... 403` | `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` 是空的 | 申請 https://cloud.reown.com/ 的 projectId 填進去；或忽略（不影響 MetaMask） |
| Mint 後合約呼叫失敗 | `CONTRACT_ADDRESS` 沒更新 / 還是 `0x0...0` | 部署後把地址同時貼進 `CONTRACT_ADDRESS` 和 `NEXT_PUBLIC_CONTRACT_ADDRESS`，重啟 frontend |
| `pnpm: 無法辨識` | 這個專案實際用 npm | 直接用 `npm install` / `npm run dev` |
| 改了 `.env` 但 server 沒讀到 | dev server 啟動時就讀完了 | 重啟對應的 dev server (`Ctrl+C` 後再 `npm run dev`) |
| Frontend 渲染縮圖崩 `toLowerCase of undefined` | localStorage 有舊版上傳 metadata | DevTools Console：`localStorage.removeItem('dsas:mint-draft:v1'); location.reload();` |

---

## Resetting State

需要全部重來：

```powershell
# 清掉 docker volumes（postgres / redis / minio / qdrant 全部歸零）
docker compose down -v

# 清掉 mint 草稿（瀏覽器 DevTools Console）
localStorage.clear()

# 清掉 prisma migration history（如果 schema 大改）
Remove-Item backend\prisma\migrations -Recurse -Force
```

---

## License

MIT
