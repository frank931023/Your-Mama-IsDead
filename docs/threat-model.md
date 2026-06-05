# Threat & Privacy Model — Prototype

| # | Threat | Surface | Mitigation (prototype) | Mitigation (future) |
|---|---|---|---|---|
| T1 | NFT 被竊 → 數位人格被冒用 | Wallet | 使用者責任;UI 警示 | Social recovery / multisig hooks |
| T2 | IPFS 內容被未授權瀏覽 | Public CIDs | 預設公開(同願景),敏感檔可走 §4.6 加密 | Lit Protocol / token-gated decryption |
| T3 | 對話紀錄含活人 → 隱私洩漏 | chatlogs upload | UI 警示 + 「只上傳逝者單方訊息」過濾 | 自動 NER 檢測活人姓名/電話 |
| T4 | 上傳素材(照片/錄音/對話紀錄)含 PII | Upload → render 機 | 經 backend 轉發到自建 render 渲染機做 3DGS 重建 / 聲音克隆,本機處理不出第三方雲;UI 警示 | 差分隱私 / scrubbing 工具 |
| T5 | 偽造逝者同意 | Mint flow | 強制勾選聲明 + 簽名寫入 metadata.consent | 數位遺囑驗證 / KYC |
| T6 | 訪問自建 render 渲染機未經授權 | Render WS / build API | backend 簽短期 HS256 JWT(aud=ymid-render, exp 30min)+ render 機僅在 Tailscale 內網、瀏覽器只經 backend WS 代理可達;SIWE + ownerOf 比對仍在 backend 把關 | token 綁 persona scope, rate-limit |
| T7 | LLM hallucination 編造逝者言論 | Chat endpoint | backend `buildPersonaSystemPrompt` 以鏈上 metadata 約束人格與口吻;UI 註明「AI 重現可能與本人不符」 | RAG 檢索真實語料佐證 + 出處引用 + 信心分數 |
| T8 | 平台關閉 → artifact 無人解讀 | All | manifest 開放 schema, README 公開, 工具 OSS | 多平台鏡像實作 |
| T9 | RPC 被審查 | Read path | 多 RPC fallback | 自架節點 |
| T10 | 服務端私鑰外洩 → 任意改 tokenURI | Server key / MINTER role | 補傳上鏈由 owner 錢包簽 `setTokenURI`,**無服務端私鑰**;若仍保留 MINTER 角色則角色最小化 | 用 multisig 做 setTokenURI / 角色最小化 |

## Hard Truths

- **這是 prototype**:不要把真實逝者資料放 testnet。Sepolia 上的 metadata 任何人可看,且 testnet 雖無經濟價值,資料仍永久在那邊。
- **AI 重現有倫理風險**。家屬同意 ≠ 逝者同意。UI 必須有「這是 AI 模擬,可能不完全符合本人意願」的免責聲明。
- **IPFS 並非真正永久**。Pin 的服務商若關閉,資料可能消失。生產階段應切到 Arweave。
