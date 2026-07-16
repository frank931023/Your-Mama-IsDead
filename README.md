# DSAS — Data Sovereignty as Soul

> 主權數位先祖系統 / 數位塔位 prototype

結合區塊鏈與生成式 AI 的數位永生服務。家屬透過 NFT 擁有逝者的數位分身，並能與其即時對話 —— 看到會說話的 3D 肖像、聽到本人克隆的聲音、由逝者生前的對話紀錄佐證回答。

- 後端伺服器repo: [Your-Mama-IsDead-Server](https://github.com/box755/Your-Mama-IsDead-Server)
- 願景：[idea.md](idea.md)
- 詳細工程規劃：[PROTOTYPE_PLAN.md](PROTOTYPE_PLAN.md)
- 架構說明：[docs/architecture.md](docs/architecture.md)

## 三層架構

| 層 | 解決什麼 | 用什麼 |
|---|---|---|
| **身分層** | 誰擁有這份記憶、家族關係 | NFT（ERC-721 + ERC-6150）on Sepolia |
| **儲存層** | 照片/影片/音檔/對話紀錄放哪能永存 | IPFS（Pinata），未來可切 Arweave |
| **運算層** | 怎麼讓 AI 用素材重現逝者 | **自建 render 渲染機**（本地開源模型，不出第三方雲） |

運算層全部跑在一台自建 render 渲染機（RTX 5090，Tailscale 內網）：vLLM 跑 **Qwen3-14B**（對話）、**IndexTTS2**（用本人錄音克隆聲音）、**LAM aigc3d**（單張照重建 3DGS 說話頭）、**LAM Audio2Expression**（52 維 ARKit 表情）、**ARTalk**（頭部姿態）。瀏覽器用 WebGL 即時渲染。詳見 [docs/server/YMID-RENDER-API.md](docs/server/YMID-RENDER-API.md)。

## Repo Layout

| 模組 | 技術 | 範圍 | 文件 |
|---|---|---|---|
| [contracts/](contracts/) | Foundry, Solidity 0.8.24 | ERC-721 + ERC-6150 智能合約（`setTokenURI` 支援鑄造後補傳上鏈） | [docs/contracts.md](docs/contracts.md) |
| [storage/](storage/) | TypeScript / ESM | IStorageProvider 抽象 + 多 driver + 6 平台 chatlog parsers | [storage/README.md](storage/README.md) |
| [backend/](backend/) | Node + Fastify + Prisma | SIWE auth、Tablet/Upload routes、render 機 JWT 簽發 + WS 代理、avatar/voice 構建代理、**本地 RAG（pgvector + e5 embedding）**、Postgres | [backend/README.md](backend/README.md) |
| [frontend/](frontend/) | Next.js 14 + wagmi v2 + RainbowKit | Mint 流程、塔位頁就地編輯/補傳上鏈、Chat（LAM WS 即時對話 + 3DGS WebGL 渲染）、家族樹 | [frontend/README.md](frontend/README.md) |
| [shared/types/](shared/types/) | TypeScript types | 跨服務共用型別（TabletMetadata 等） | — |

> 渲染機（運算層）不在本 monorepo 內，是一台獨立的自建機器，見 [docs/server/](docs/server/)。早期的 `compute/`（FastAPI 推理）與 `training/`（離線 LoRA/GPT-SoVITS/RAG pipeline）兩條路**已廢棄**，運算統一改成自建 render 機。

---

## Prerequisites

啟動前你必須先準備好：

| 工具 | 用途 | 怎麼裝 |
|---|---|---|
| **Docker Desktop** | postgres（含 pgvector）/ redis / minio / backend / frontend | https://www.docker.com/products/docker-desktop/ |
| Node.js 20+ *(選擇性)* | 只有想在本機直跑 backend / frontend（不走 Docker）時才需要 | https://nodejs.org/ |
| **Foundry** (`forge`、`cast`) | 編譯 / 部署合約 | `curl -L https://foundry.paradigm.xyz \| bash` 後 `foundryup` |
| **Pinata 帳號** | IPFS 存逝者素材（必要） | https://app.pinata.cloud/ → API Keys → 取 JWT |
| **MetaMask / Rabby** | 連接錢包簽名 mint NFT | 瀏覽器外掛 |
| **自建 render 渲染機** | avatar / 語音 / 對話（運算層） | 一台有 GPU 的機器，掛上同一個 Tailscale tailnet，見 [docs/server/SERVER.md](docs/server/SERVER.md) |
| WalletConnect Cloud projectId *(選擇性)* | 手機錢包掃 QR 連線 | https://cloud.reown.com/ |

> RAG 的 embedding 在 backend 本地用 `@xenova/transformers` 跑（首次會自動下載 ~110MB 模型），**不需要** Python、不需要外部 embedding API。

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

# 後端給前端簽 SIWE 會話用的密鑰（隨機 32+ 字元）
JWT_SECRET=<請改成隨機字串>

# 自建 render 渲染機（avatar/語音/對話;不填則沒有數位分身功能）
RENDER_BASE=http://100.122.149.34:8012        # 你的渲染機 Tailscale 位址
RENDER_JWT_SECRET=<與渲染機共享的同一個密鑰>    # 向渲染機 host admin 取，兩邊必須一致
```

選擇性但建議：

```ini
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=<reown projectId>  # 不填會在 console 噴 403，但 MetaMask 功能不受影響
```

> ⚠️ `DEPLOYER_PRIVATE_KEY` **絕對不要拿主網有錢的錢包私鑰**。產一個新地址，去 faucet 領 0.1 Sepolia ETH 就夠：
> - https://sepoliafaucet.com/
> - https://cloud.google.com/application/web3/faucet/ethereum/sepolia

> ⚠️ `RENDER_JWT_SECRET` 必須與渲染機上的 `JWT_SECRET` **完全一致**，否則 WS 會被 4401 拒。前端不持有此密鑰，只拿後端簽發的短期 token。

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

**一鍵啟動（全部跑在 Docker）：**

```powershell
docker compose up -d
```

一條指令起五個服務：postgres / redis / minio / **backend** (`http://localhost:4000`) / **frontend** (`http://localhost:3000`)。backend 容器啟動時會自動 `npm install + prisma generate + prisma migrate deploy`，frontend 容器會自動 `npm install`，**首次啟動要幾分鐘**（含下載依賴與 RAG embedding 模型）。

```powershell
docker compose logs -f backend frontend   # 看啟動進度 / dev server log
```

Windows 上也可以用 `.\start.ps1`（等同上面，外加 `.env` 存在性檢查）。

打開瀏覽器 → http://localhost:3000，開始用。

原始碼是 bind mount 進容器的，改 code 照樣熱更新；改了 `package.json` 或 `.env` 則 `docker compose up -d` 讓容器重建即可（npm install 在每次容器啟動時都會跑，有 volume 快取所以很快）。

**關閉：** `docker compose down`。

> ℹ️ 容器內的 `DATABASE_URL` / `REDIS_URL` 由 compose 覆寫成 service name（`postgres` / `redis`），`.env` 裡維持 `localhost` 不用改——那是給本機直跑用的。

---

## Manual Startup（本機直跑 backend/frontend）

如果不想讓 app 跑在容器裡（例如要掛 debugger）：

```powershell
# 0. 載入 env（每個新 terminal 都要做一次）
. .\load-env.ps1

# 1. 只起基礎設施（不要用無參數的 up -d，那會連 app 容器一起起、佔掉 3000/4000）
docker compose up -d postgres redis minio   # 或 .\start.ps1 -InfraOnly

# 2. Backend
cd backend
npm install                 # 第一次或改了 package.json
npx prisma generate
npx prisma migrate deploy   # 套用既有 migration（含 pgvector 的 MemoryChunk 表）
npm run dev                 # 跑在 :4000

# 3. Frontend（另開一個 terminal）
. .\load-env.ps1
cd frontend
npm install
npm run dev                 # 跑在 :3000
```

> 運算層（render 渲染機）是另一台機器，不在這裡啟動。它的啟停見 [docs/server/SERVER.md](docs/server/SERVER.md)。本機只要 `RENDER_BASE` / `RENDER_JWT_SECRET` 填對、且在同一 Tailscale tailnet 即可連上。

---

## Demo Flow（端到端走一次）

1. 連 MetaMask（**Sepolia 網路**） → 進 `/mint`
2. 填逝者基本資料（姓名 / 籍貫 / 生卒 / 陽世子孫）
3. 上傳大頭照 → 自動建 3DGS avatar（渲染機 LAM 重建，約 100s）；上傳錄音 → 自動克隆聲音（IndexTTS2）
4. 上傳其他素材（照片 / 影片 / 對話紀錄）→ 釘到 IPFS
5. 簽署同意聲明 → 簽名鑄造 NFT（ERC-721 + ERC-6150）
6. 進 `/tablet/[tokenId]`：
   - 點「**編輯資料**」可就地補傳任何 Tab（生平/照片/影音/子孫/對話紀錄），改完「**保存上鏈**」一次性 `setTokenURI` + 重建 RAG 記憶索引
   - 點「**啟動數位分身**」→ SIWE 簽名驗證 → 即時對話
7. 對話時：LLM 串流文字 + 本人克隆聲音 + 會說話的 3D 肖像（嘴型/頭姿同步）。每輪用問題對逝者對話紀錄做 RAG 檢索，命中的真實語料會佐證回答。

---

## 本地測試模式（免 Pinata、免 faucet）

不申請任何外部服務也能跑通完整 mint 流程。三個零件：

1. **Anvil 本地鏈**：compose 內建 `anvil` 服務（`:8545`，狀態存 volume）。首次要部署一次合約：`./scripts/deploy-local.sh`（冪等，部署到決定性地址，與 `.env` 的 `LOCAL_CONTRACT_ADDRESS` 預設一致）。
2. **Admin 控制台**：http://localhost:3000/admin ，密碼 = `.env` 的 `ADMIN_PASSWORD`。可即時切換 **儲存模式**（Pinata ⟷ 本地磁碟）與 **鏈模式**（Sepolia ⟷ 本地 Anvil），全站自動跟上，不用重啟。本地鏈模式下還能對任意地址「餵 gas」（`anvil_setBalance`，免 faucet）。
3. **Burner 測試錢包**：導覽列燭焰 logo 連點 5 下＝連接/斷開瀏覽器內建的拋棄式錢包（免裝 MetaMask，真簽名，SIWE 可用）。在 admin 頁給它餵一次 ETH 即可 mint。

> 本地模式鑄的塔位其 metadata URI 指向 `localhost:4000`，只在你機器上可解析——是拋棄式測試資料。要對外展示請切回 Pinata + Sepolia（需 `PINATA_JWT` 與一次真部署）。`docker compose down -v` 會把 anvil 鏈狀態、本地上傳、DB 一起歸零。

## Common Pitfalls

開發過程踩過的雷，請對照排除：

| 症狀 | 根因 | 解 |
|---|---|---|
| `forge` 抱怨 `--rpc-url` 沒值 | PowerShell 的 `$RPC_URL` 是空的 | 用 `$env:RPC_URL`（注意 `env:` 前綴），或先 `. .\load-env.ps1` |
| backend 啟動報 `Invalid environment configuration: DATABASE_URL Required...` | cwd 不在根目錄，`dotenv` 讀不到根 `.env` | 從根目錄啟動，或設 `DOTENV_CONFIG_PATH=.env` |
| `Error: unable to determine transport target for "pino-pretty"` | dev mode logger 套件沒裝 | `cd backend; npm install -D pino-pretty` |
| 上傳檔案 → "Network error during upload" | backend 沒啟動 | 確認 `http://localhost:4000` 有回應；沒有就 `npm run dev` |
| 上傳檔案 → 503 `pinata_not_configured` | `.env` 的 `PINATA_JWT` 是空的 | 去 https://app.pinata.cloud/ 申請 JWT 填進去，重啟 backend |
| avatar 對話 WS 連不上（`1006` / `4401`） | `RENDER_BASE`/`RENDER_JWT_SECRET` 沒填或與渲染機不一致，或本機不在 tailnet | 核對兩邊 secret 一致、能 ping 通渲染機；WS 走後端 `/api/avatar/ws` 代理（瀏覽器不直連私網 IP） |
| 生成 avatar/克隆聲音 → 502 `build failed` | 上傳的照片偵測不到正臉 / 音檔不合格 | 照片用清晰正面頭像；錄音用乾淨單人 5–10s |
| avatar 有口型沒聲音 | 早期 bug，binary chunk 被誤丟 | 已修；若重現檢查 render-chat.ts 的 chunk 解碼 |
| 對話沒用克隆聲音（用預設嗓音） | metadata 沒有 `voiceLabel`（只上傳音檔 ≠ 已克隆） | 塔位頁影音 Tab 確認顯示「已生成克隆聲音 ✓」，且**保存上鏈** |
| RAG 都「注入 0 段」 | 沒上傳對話紀錄，或逝者名字對不上 chatlog 裡的發話者 | 上傳對話紀錄並保存上鏈；對話檔裡逝者的名字要與 metadata 姓名一致。後端 console grep `[RAG]` 看實況 |
| Console 噴 `api.web3modal.org ... 403` / `pulse.walletconnect 400` | WalletConnect projectId 是占位值 | 申請 https://cloud.reown.com/ 的 projectId；或忽略（wagmi 自動回退，MetaMask 不受影響） |
| Mint 後合約呼叫失敗 | `CONTRACT_ADDRESS` 沒更新 / 還是 `0x0...0` | 部署後把地址同時貼進 `CONTRACT_ADDRESS` 和 `NEXT_PUBLIC_CONTRACT_ADDRESS`，重啟 frontend |
| 改了 `.env` 但 server 沒讀到 | dev server 啟動時就讀完了 | 重啟對應的 dev server (`Ctrl+C` 後再 `npm run dev`) |

---

## Resetting State

需要全部重來：

```powershell
# 清掉 docker volumes（postgres / redis / minio 全部歸零，含 RAG 向量索引；
# 也會清掉 backend/frontend 的 node_modules volume，下次啟動會重新 npm install）
docker compose down -v

# 清掉 mint 草稿（瀏覽器 DevTools Console）
localStorage.clear()
```

> 渲染機上已生成的 avatar / voice 是另一台機器的狀態，這裡的 reset 不影響它們；要清渲染機資產見 [docs/server/SERVER.md](docs/server/SERVER.md)。

---

## License

MIT
