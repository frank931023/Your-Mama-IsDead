# Aeterlux 數位記憶燈塔

> Aeterlux: Digital Memory Lighthouse(repo 代號 DSAS)

家族數位記憶網絡:整合照片、影片、聲音、文字與家族關係,提供記憶保存、AI 數位分身互動與線上共同追思。家屬以 NFT 持有一座「記憶燈塔」,公開的生平資料任何人可瀏覽;私密的照片、錄音與對話紀錄加密保存,只有燈塔持有者能解鎖。數位分身以逝者生前資料為基礎,用本人克隆的聲音與會說話的 3D 肖像回應,並由檢索到的真實語料佐證回答。

- **系統規格**:[docs/Aeterlux_系統概述文件_0914.docx](docs/Aeterlux_系統概述文件_0914.docx)
- 架構說明:[docs/architecture.md](docs/architecture.md) · 資料流:[docs/data-flow.md](docs/data-flow.md) · 威脅模型:[docs/threat-model.md](docs/threat-model.md)
- 中文完整概述:[docs/project-overview-zh.md](docs/project-overview-zh.md)
- 後端伺服器 repo:[Your-Mama-IsDead-Server](https://github.com/box755/Your-Mama-IsDead-Server)

## 系統架構(系統概述文件 圖二)

| 區塊 | 負責什麼 | 用什麼 |
|---|---|---|
| **前端** | 操作介面、3D 靈堂、數位分身渲染 | Next.js 14(React)+ Tailwind CSS;HTTPS / REST、WebSocket;WebGL 渲染 3DGS 說話頭與靈堂 |
| **後端** | 驗證、資料管理、投稿審核、服務協調 | Node.js(Fastify + Prisma);PostgreSQL + **pgvector**(記憶向量檢索);Redis(背景任務、執行期設定);**LiveKit**(多人公祭) |
| **GPU 推理伺服器** | 對話生成、聲音、人物動態 | 自建 render 機(RTX 5090,Tailscale 內網),Python / FastAPI:vLLM 跑 **Qwen3-14B**、**LAM**(高斯潑濺人物)、**IndexTTS2**(克隆聲音)、**Audio2Expression**(嘴型表情)、**ARTalk**(頭部動作) |
| **Web3** | 持有關係、家族階層、私密素材解密控制 | Solidity + Foundry;**ERC-721** 記錄燈塔持有、**ERC-6150** 表達家族節點(Sepolia);**Lit Protocol** 依錢包簽章與 NFT 持有關係控制私密素材的解密(可選擇啟用) |
| **永久儲存** | 照片 / 影音 / 對話紀錄 / metadata | 兩條路徑:主要路徑為 **Arweave**,經 **Irys** 打包上傳(ArDrive Turbo 備援),以 `ar://<交易 ID>` 定位;備援路徑為 IPFS(Pinata) |

對話一輪的流程:Whisper 語音轉文字(後端呼叫 OpenAI `whisper-1` API)→ E5(multilingual-e5-small,在後端執行)把問題轉成向量 → pgvector 檢索**最多 4 段**相關記憶 → Qwen3-14B 生成回覆 → IndexTTS2 合成個人化語音 → Audio2Expression 產生嘴型表情、ARTalk 產生頭部動作 → 瀏覽器同步呈現。

渲染機 API 見 [docs/server/YMID-RENDER-API.md](docs/server/YMID-RENDER-API.md)。

## 三個環境變數開關

| 開關 | 值 | 說明 |
|---|---|---|
| `STORAGE_DRIVER`(後端) | `arweave` \| `pinata` \| `local` | `arweave`(預設)主要路徑:經 Irys 存 Arweave;`pinata` 備援路徑:釘 IPFS,並 best-effort 同步一份到 Arweave;`local` 存本機磁碟(離線開發)。後端 `/api/admin/config` 可在執行期切換 |
| `NEXT_PUBLIC_LIT_MODE`(前端) | `none` \| `chipotle` \| `legacy` | 私密素材加密:`none` 不啟用;`chipotle` 以 Lit Action 驗證持有關係(需先完成下方設定);`legacy` 使用 Lit 門檻網路 |
| `CEREMONY_TRANSPORT`(後端) | `ws` \| `livekit` | 線上公祭的即時通道。`livekit` 另外支援多人語音;LiveKit 連不上時前端自動退回 `ws` |

## Repo Layout

| 模組 | 技術 | 範圍 | 文件 |
|---|---|---|---|
| [contracts/](contracts/) | Foundry, Solidity 0.8.24 | DigitalTablet:ERC-721 + ERC-6150 + AccessControl;鏈上只存 `tokenURI` / `artifactURI` 字串 | [docs/contracts.md](docs/contracts.md) |
| [backend/](backend/) | Node + Fastify + Prisma | SIWE 登入、上傳中繼(Arweave / IPFS / 本機)、RAG(pgvector + e5)、render 機 token 與 WS 代理、公祭(WebSocket hub / LiveKit token)、投稿審核 | [backend/README.md](backend/README.md) |
| [frontend/](frontend/) | Next.js 14 + wagmi v2 + RainbowKit | 鑄造流程、燈塔頁就地編輯、私密記憶加密 / 解鎖(Lit)、數位分身對話、哀悼版、3D 靈堂、家族樹 | [frontend/README.md](frontend/README.md) |
| [lit-actions/](lit-actions/) | Lit Action(JavaScript) | 私密記憶的解鎖規則:驗證錢包簽章與 `ownerOf` 後才交出檔案金鑰(`chipotle` 模式使用) | 檔內註解 |
| [storage/](storage/) | TypeScript / ESM | 獨立的儲存抽象套件(IStorageProvider)與 6 平台對話紀錄 parser;應用程式的上傳由 backend 處理 | [storage/README.md](storage/README.md) |
| [shared/types/](shared/types/) | TypeScript types | 跨服務共用型別(TabletMetadata、加密 artifact manifest 等) | — |

> 渲染機(GPU 推理伺服器)不在本 monorepo,是一台獨立的自建機器,見 [docs/server/](docs/server/)。`compute/` 與 `training/` 是獨立的實驗目錄,不在系統的執行路徑上。

---

## Prerequisites

| 工具 | 用途 | 怎麼裝 |
|---|---|---|
| **Docker Desktop** | postgres(含 pgvector)/ redis / minio / anvil / livekit / backend / frontend | https://www.docker.com/products/docker-desktop/ |
| Node.js 20+ *(選擇性)* | 本機直跑 backend / frontend、跑 `backend/scripts/*` | https://nodejs.org/ |
| **Foundry**(`forge`、`cast`) | 編譯 / 部署合約 | `curl -L https://foundry.paradigm.xyz \| bash` 後 `foundryup` |
| **Irys 儲值的 Ethereum 私鑰** | Arweave 永久儲存(預設儲存層) | 私鑰填 `IRYS_PRIVATE_KEY`,用**主網** ETH 儲值(約 0.000033 ETH / MB),見下方步驟 |
| Pinata 帳號 *(選擇性)* | 使用 IPFS 備援路徑時(`STORAGE_DRIVER=pinata`) | https://app.pinata.cloud/ → API Keys → JWT |
| Lit Chipotle 帳號 *(選擇性)* | 啟用私密素材加密(`NEXT_PUBLIC_LIT_MODE=chipotle`),依執行秒數計費、最低儲值 US$5 | Lit Protocol 的 Chipotle 後台申請 account key |
| **MetaMask / Rabby** | 連接錢包、簽名鑄造 | 瀏覽器外掛 |
| **自建 render 渲染機** | 數位分身的對話、聲音、人物動態 | 有 GPU 的機器,掛上同一個 Tailscale tailnet,見 [docs/server/SERVER.md](docs/server/SERVER.md) |
| WalletConnect Cloud projectId *(選擇性)* | 手機錢包掃 QR 連線 | https://cloud.reown.com/ |

> RAG 的 embedding 在 backend 本機用 `@xenova/transformers` 跑(首次會自動下載約 110MB 模型),**不需要** Python 或外部 embedding API。

---

## First-Time Setup

### 1. 複製 `.env`

```powershell
Copy-Item .env.example .env
```

### 2. 填入必要設定

打開 [.env](.env),**至少填這幾個**才能跑通基本流程:

```ini
# 鏈上(Sepolia 測試網)
RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
DEPLOYER_PRIVATE_KEY=0x<你的測試錢包私鑰>

# 永久儲存:Arweave(經 Irys)
STORAGE_DRIVER=arweave
IRYS_PRIVATE_KEY=0x<用來付 Irys 儲存費的私鑰>

# 後端簽 SIWE 會話用的密鑰(隨機 32+ 字元)
JWT_SECRET=<請改成隨機字串>

# 自建 render 渲染機(數位分身;不填則沒有對話功能)
RENDER_BASE=http://100.122.149.34:8012        # 你的渲染機 Tailscale 位址
RENDER_JWT_SECRET=<與渲染機共享的同一個密鑰>    # 向渲染機 host admin 取,兩邊必須一致
```

Irys 需要先儲值才能上傳(餘額為 0 時上傳會回 502 `arweave_upload_failed`):

```powershell
cd backend
npx tsx scripts/irys-account.ts            # 顯示付款地址、餘額與價格
npx tsx scripts/irys-account.ts fund 0.0005  # 從該地址轉 0.0005 主網 ETH 進 Irys
```

Irys 尚未儲值時,可先切到 IPFS 備援路徑(`STORAGE_DRIVER=pinata`,填 `PINATA_JWT`)或 `local`。

選擇性但建議:

```ini
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=<reown projectId>  # 不填會在 console 噴 403,但 MetaMask 不受影響
```

> ⚠️ `DEPLOYER_PRIVATE_KEY` **絕對不要拿主網有錢的錢包私鑰**。產一個新地址,去 faucet 領 Sepolia ETH:
> - https://sepoliafaucet.com/
> - https://cloud.google.com/application/web3/faucet/ethereum/sepolia

> ⚠️ `RENDER_JWT_SECRET` 必須與渲染機上的 `JWT_SECRET` **完全一致**,否則 WS 會被 4401 拒。前端不持有此密鑰,只拿後端簽發的短期 token。

### 3. 部署合約(一次性)

```powershell
. .\load-env.ps1
cd contracts
forge install
forge script script/Deploy.s.sol --rpc-url $env:RPC_URL --broadcast
```

跑完會印 `DigitalTablet deployed at: 0x...`,把地址貼回 [.env](.env) **兩個**欄位:

```ini
CONTRACT_ADDRESS=0xAbCd1234...
NEXT_PUBLIC_CONTRACT_ADDRESS=0xAbCd1234...
```

### 4. (選擇性)啟用私密素材加密(Lit)

私密素材加密以 `NEXT_PUBLIC_LIT_MODE` 啟用,不設定就是 `none`(不加密)。`chipotle` 模式的設定步驟:

1. 在 Chipotle 後台建立帳號並儲值,取得 **account key**。
2. 註冊 Action(會把 [lit-actions/aeterlux-artifact-key.js](lit-actions/aeterlux-artifact-key.js) 填入合約地址後算出 CID、建群組與只能執行該 Action 的 usage key):

   ```powershell
   cd backend
   $env:LIT_CHIPOTLE_ACCOUNT_KEY="<account key>"; npx tsx scripts/lit-chipotle-setup.ts
   ```

3. 把腳本印出的四行貼進 `.env`(`NEXT_PUBLIC_LIT_MODE=chipotle`、`..._ACTION_CID`、`..._ACTION_PUBKEY`、`..._USAGE_KEY`),然後 `docker compose up -d frontend` 重建前端容器。

Action 的身分金鑰由程式碼內容雜湊(CID)推導:規則改一個字金鑰就不同,已加密的資料只能由原本那份 Action 解開,平台無法事後放寬規則。

### 5. (已預設)線上公祭:LiveKit

`docker compose` 內建 LiveKit dev server(`:7880`,金鑰 `devkey` / `secret`,只適合本機)。`.env` 設 `CEREMONY_TRANSPORT=livekit` 與 `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` 即可;要讓區網其他裝置加入語音,設 `LIVEKIT_NODE_IP=<這台電腦的區網 IP>`。對外展示建議用 LiveKit Cloud(見 `.env.example`)。

---

## Daily Startup(每次開發)

```powershell
docker compose up -d
```

起七個服務:postgres / redis / minio / anvil / livekit / **backend**(`http://localhost:14000`)/ **frontend**(`http://localhost:3000`)。backend 容器啟動時會自動 `npm install + prisma generate + prisma migrate deploy`,frontend 容器會自動 `npm install`,**首次啟動要幾分鐘**(含下載依賴與 RAG embedding 模型)。

```powershell
docker compose logs -f backend frontend   # 看啟動進度 / dev server log
```

Windows 上也可以用 `.\start.ps1`(等同上面,外加 `.env` 存在性檢查)。

原始碼是 bind mount 進容器的;改了 `package.json` 或 `.env`(包含 `NEXT_PUBLIC_*`)要 `docker compose up -d` 讓容器重建。Windows 檔案系統上熱更新偶爾不觸發,改完沒生效就 `docker compose restart frontend`。

**關閉:** `docker compose down`。

> ℹ️ 容器內的 `DATABASE_URL` / `REDIS_URL` / `LIVEKIT_HOST_URL` 由 compose 覆寫成 service name,`.env` 裡維持 `localhost` 不用改——那是給本機直跑用的。

---

## Manual Startup(本機直跑 backend/frontend)

```powershell
# 0. 載入 env(每個新 terminal 都要做一次)
. .\load-env.ps1

# 1. 只起基礎設施
docker compose up -d postgres redis minio livekit   # 或 .\start.ps1 -InfraOnly

# 2. Backend
cd backend
npm install
npx prisma generate
npx prisma migrate deploy   # 套用既有 migration(含 pgvector 的 MemoryChunk 表)
npm run dev                 # 跑在 :14000

# 3. Frontend(另開一個 terminal)
. .\load-env.ps1
cd frontend
npm install
npm run dev                 # 跑在 :3000
```

> 本機直跑 backend 時 `LIVEKIT_HOST_URL` 不用設,會由 `LIVEKIT_URL` 推得 `http://localhost:7880`(compose 內才覆寫成 `http://livekit:7880`)。運算層(render 渲染機)是另一台機器,啟停見 [docs/server/SERVER.md](docs/server/SERVER.md)。

---

## Demo Flow(端到端走一次)

1. 連 MetaMask(**Sepolia 網路**)→ 進 `/mint`
2. 填逝者基本資料(姓名 / 籍貫 / 生卒 / 生平)
3. 上傳大頭照(公開,作為 NFT 圖片)→ 可生成 3DGS 數位分身(渲染機 LAM 重建,約 100 秒)
4. 上傳照片 / 影音 / 文字 / 對話紀錄:
   - 未啟用 Lit:直接存進 Arweave,寫在公開 metadata
   - 啟用 Lit:檔案先暫存在瀏覽器,鑄造後在瀏覽器加密、只上傳密文,清單寫進合約 `artifactURI`(需簽第二筆交易)
5. 填家族紀錄與家族脈絡(根節點或既有家族的子節點)、簽署同意聲明 → 簽名鑄造 NFT(ERC-721 + ERC-6150)
6. 進 `/tablet/[tokenId]`:
   - 「**編輯資料**」可補生平 / 照片 / 影音 / 子孫 / 對話紀錄,上傳錄音會自動克隆聲音(IndexTTS2);「**保存上鏈**」會 `setTokenURI`(私密素材則 `setArtifactURI`)並重建 RAG 記憶索引
   - 「**私密記憶**」分頁:持有者用錢包簽名解鎖,在瀏覽器解密檢視;可把解密後的對話紀錄送去建立 AI 記憶
   - 「**啟動數位分身互動**」→ SIWE 簽名驗證 → 即時對話
7. 對話時:串流文字 + 本人克隆聲音 + 會說話的 3D 肖像;每輪以問題檢索記憶(最多 4 段),命中的真實語料佐證回答
8. 哀悼版 `/memorial/[tokenId]`:親友投稿回憶(屋主核可後才公開並進入 AI 記憶)、留言獻供;進入 3D 靈堂可點香、三鞠躬、走動、聊天,LiveKit 模式下可開麥克風與同在靈堂的親友說話

---

## 本地測試模式(免 Irys、免 faucet)

1. **本機儲存**:`STORAGE_DRIVER=local`,上傳落在 backend 容器的 volume,URI 指向 `localhost:14000`(只在你的機器上可解析)。
2. **Anvil 本地鏈**:compose 內建 `anvil` 服務(`:8545`,狀態存 volume)。首次部署:`./scripts/deploy-local.sh`(冪等,部署到與 `LOCAL_CONTRACT_ADDRESS` 預設一致的決定性地址)。
3. **Admin API**(沒有前端頁面):密碼 = `.env` 的 `ADMIN_PASSWORD`。
   - `POST /api/admin/login {password}` → admin token
   - `GET / PUT /api/admin/config`:查詢 / 切換 `storageMode`(arweave / pinata / local)與 `chainMode`(real / local)
   - `POST /api/admin/fund {address, eth}`:本地鏈模式下用 `anvil_setBalance` 餵 gas

> 前端的錢包連線固定在 `NEXT_PUBLIC_CHAIN_ID` 那條鏈(預設 Sepolia);`chainMode=local` 只影響後端讀鏈。`docker compose down -v` 會把 anvil 鏈狀態、本地上傳、DB 一起歸零。

## Common Pitfalls

| 症狀 | 根因 | 解 |
|---|---|---|
| `forge` 抱怨 `--rpc-url` 沒值 | PowerShell 的 `$RPC_URL` 是空的 | 用 `$env:RPC_URL`,或先 `. .\load-env.ps1` |
| backend 啟動報 `Invalid environment configuration` | cwd 不在根目錄,`dotenv` 讀不到根 `.env` | 從根目錄啟動,或設 `DOTENV_CONFIG_PATH=.env` |
| 上傳檔案 → "Network error during upload" | backend 沒啟動 | 確認 `http://localhost:14000` 有回應 |
| 上傳 → 503 `arweave_not_configured` | `STORAGE_DRIVER=arweave` 但沒有 `IRYS_PRIVATE_KEY` / `TURBO_PRIVATE_KEY` | 填私鑰,或改 `STORAGE_DRIVER=pinata` / `local` |
| 上傳 → 502 `arweave_upload_failed` | Irys 餘額不足(且 Turbo 備援也失敗) | `npx tsx scripts/irys-account.ts fund <ETH>` 儲值 |
| 上傳 → 503 `pinata_not_configured` | `STORAGE_DRIVER=pinata` 但 `PINATA_JWT` 是空的 | 填 JWT,或改用 arweave / local |
| `legacy` 模式下鑄造前的 Lit 連線檢查失敗 | 連不上 Lit 門檻網路 | 改用 `chipotle` 或 `none`,重建 frontend 容器 |
| 「Lit Chipotle 未設定」 | chipotle 模式缺 Action CID / usage key | 跑 `backend/scripts/lit-chipotle-setup.ts`,把輸出貼進 `.env` |
| 解鎖私密記憶 → `not_owner` | 簽名的錢包不是這座燈塔目前的持有者 | 換成持有者錢包 |
| 3D 靈堂沒有「語音」按鈕 | 公祭走的是 `ws` 通道(未設 LiveKit 或 LiveKit 連不上) | 確認 `CEREMONY_TRANSPORT=livekit`、`docker compose ps` 有 livekit;瀏覽器 console 會印退回 WebSocket 的原因 |
| 其他電腦加入靈堂聽不到聲音 | LiveKit 只對 127.0.0.1 公告 WebRTC 位址 | `.env` 設 `LIVEKIT_NODE_IP=<區網 IP>`,`docker compose up -d livekit` |
| avatar 對話 WS 連不上(`1006` / `4401`) | `RENDER_BASE` / `RENDER_JWT_SECRET` 沒填或與渲染機不一致,或本機不在 tailnet | 核對兩邊 secret、能 ping 通渲染機;WS 走後端 `/api/avatar/ws` 代理 |
| 生成 avatar / 克隆聲音 → 502 `build failed` | 照片偵測不到正臉 / 音檔不合格 | 用清晰正面頭像;錄音用乾淨單人 5–10 秒 |
| 對話沒用克隆聲音 | metadata 沒有 `voiceLabel`(只上傳音檔 ≠ 已克隆) | 影音 Tab 確認「已生成克隆聲音 ✓」並**保存上鏈** |
| RAG 都「注入 0 段」 | 沒上傳對話紀錄,或逝者名字對不上對話紀錄裡的發話者 | 對話檔裡逝者的名字要與 metadata 姓名一致;私密對話紀錄要在「私密記憶」解鎖後按「用這些對話紀錄更新 AI 記憶」。後端 console grep `[RAG]` |
| Console 噴 `api.web3modal.org ... 403` | WalletConnect projectId 是占位值 | 申請 projectId,或忽略(MetaMask 不受影響) |
| 鑄造後合約呼叫失敗 | `CONTRACT_ADDRESS` 沒更新 / 還是 `0x0...0` | 地址同時貼進 `CONTRACT_ADDRESS` 與 `NEXT_PUBLIC_CONTRACT_ADDRESS`,重建 frontend |

---

## Resetting State

```powershell
# 清掉 docker volumes(postgres / redis / minio / anvil 全部歸零,含 RAG 向量索引;
# 也會清掉 node_modules volume,下次啟動會重新 npm install)
docker compose down -v

# 清掉鑄造草稿(瀏覽器 DevTools Console)
localStorage.clear()
```

> Arweave 上的資料無法刪除(隱藏或停止 AI 使用,不等於移除已封存的資料)。渲染機上的 avatar / voice 是另一台機器的狀態,見 [docs/server/SERVER.md](docs/server/SERVER.md)。

---

## License

MIT
