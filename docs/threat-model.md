# Threat & Privacy Model — Prototype

對應 [Aeterlux_系統概述文件_0914.docx](Aeterlux_系統概述文件_0914.docx) 的「系統特色」:家屬掌握記憶、鏈上可驗證 / 鏈下可擴充、AI 有來源與邊界。

| # | Threat | Surface | Mitigation (prototype) | Mitigation (future) |
|---|---|---|---|---|
| T1 | NFT 被竊 → 數位人格與私密記憶被冒用 | Wallet | 使用者責任;UI 警示。私密記憶的解密權跟著 NFT 走,轉手後新持有者即可解鎖 | Social recovery / multisig hooks |
| T2 | 儲存層內容被未授權瀏覽 | Arweave 交易 ID / IPFS CID 公開可下載 | 公開 metadata 只放墓碑級資訊;啟用 Lit 後照片 / 影音 / 文字 / 對話紀錄在瀏覽器以 Lit 門檻加密,連檔名也在密文裡;Lit 節點各自驗證錢包簽章 + 鏈上 `ownerOf` 後才交出解密分片 | 更細的授權條件(家族成員、繼承人) |
| T3 | 對話紀錄含活人 → 隱私洩漏 | chatlogs upload | UI 警示「只上傳逝者單方訊息或已取得同意」;RAG 只索引逝者本人的發言 | 自動 NER 檢測活人姓名 / 電話 |
| T4 | 上傳素材(照片 / 錄音 / 對話紀錄)含 PII | Upload → GPU 伺服器 | 3DGS 重建 / 聲音克隆在自建 GPU 伺服器處理,不交給第三方 AI 平台;UI 警示 | 差分隱私 / scrubbing 工具 |
| T5 | 偽造逝者同意 | Mint flow | 強制勾選聲明 + 簽名寫入 metadata.consent | 數位遺囑驗證 / KYC |
| T6 | 未經授權存取 GPU 伺服器 | Render WS / build API | backend 簽短期 HS256 JWT(aud=ymid-render,30 分鐘)+ GPU 伺服器只在 Tailscale 內網、瀏覽器只經 backend WS 代理可達;SIWE + ownerOf / 邀請碼在 backend 把關 | token 綁 persona scope、rate-limit |
| T7 | LLM 幻覺編造逝者言論 | Chat | 每輪 RAG 檢索(最多 4 段、距離門檻 0.62)注入真實語料;prompt 要求不知道的事溫和承認記憶有限、不編造;UI 註明數位分身是模擬內容,不代表逝者真實意志 | 出處引用 + 信心分數 |
| T8 | 平台關閉 → 資料無人解讀 | All | 公開資料在 Arweave、指標在鏈上;manifest 為開放 schema(`shared/types/artifact.ts`),Action 原始碼公開 | 多平台鏡像實作 |
| T9 | RPC 被審查 | Read path | 多 RPC fallback;Lit 端的持有者檢查使用公共 RPC(publicnode) | 自架節點 |
| T10 | 服務端私鑰外洩 → 任意改 tokenURI / artifactURI | Server key / MINTER role | 補傳上鏈由 owner 錢包簽 `setTokenURI` / `setArtifactURI`,**不需服務端私鑰**;MINTER 角色最小化 | 用 multisig 管 MINTER |
| T11 | **Lit 服務停止 → 加密素材解不開** | Lit | 解鎖規則綁在密文裡,平台無法放寬;但解密仍依賴 Lit 節點持續運作 | 同一份素材另以備援條件(例如家族多簽)加密一份作為備援 |
| T12 | 前端 usage key 被濫用 → Lit 費用被刷 | `NEXT_PUBLIC_LIT_CHIPOTLE_USAGE_KEY`(`chipotle` 模式) | usage key 只能執行本專案群組內的 Action,不能管理帳號;帳號預付制(餘額即上限);公鑰放環境變數,加密不必呼叫 Action | 改由 backend 代呼叫並 rate-limit |
| T13 | 私密對話紀錄送進 AI 記憶後外洩 | Backend DB(`MemoryChunk`) | 只有持有者解鎖後主動送出才會索引;只保存逝者發言的切片文字與向量,不存原檔 | 資料庫欄位加密;可一鍵清除私密記憶 |
| T14 | 陌生人闖入線上公祭 / 竊聽語音 | LiveKit 房間 / ceremony WS | 入房 token 依可見度簽發:PUBLIC 放行、UNLISTED 需邀請碼、PRIVATE 關閉;麥克風預設關閉,需本人按下才開;LiveKit 模式在接收端做白名單、長度、範圍與節流檢查 | 屋主踢人 / 靜音權限、每場公祭一次性邀請碼 |

## Hard Truths

- **這是 prototype**:不要把真實逝者資料放 testnet。Sepolia 上的 metadata 任何人可看,資料仍永久在那邊。
- **AI 重現有倫理風險**。家屬同意 ≠ 逝者同意;持有 NFT 不自動等於取得所有肖像、聲音及第三方資料的使用授權。數位分身不取代家人及專業支持。
- **Arweave 無法刪除**。隱藏內容或停止 AI 使用,不等於移除已封存的資料;「一次付費」依賴儲存基金與儲存成本持續下降的假設,不等同無條件的永久保證。
- **加密可解性取決於 Lit**。見 T11:加密素材能否解開,取決於 Lit 服務是否持續運作。
