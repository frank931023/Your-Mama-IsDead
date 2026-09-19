# Aeterlux QA 03｜從素材到分身

5頁簡報講稿與參考來源。

## 第 1 頁｜素材到分身總覽

【45 秒講稿】
建立分身時，我們把素材分成三條路。對話紀錄及家屬核可的回憶，先辨別來源、切成短片段，再透過 E5 建立可搜尋的記憶索引。一張清楚的正面照交給 LAM，產生可以用表情和姿態參數驅動的 3D 頭像。一段本人錄音則提供聲音參考，後續讓 TTS 用這個音色說出新文字。這三條路都使用已訓練好的模型，不必為每位逝者重新訓練一套模型。

【建立後重用的範圍】
建立的是可重用資產及索引，不代表一輩子只做一次。新增或修正回憶需更新索引，更換照片可能重建頭像，更換錄音或模型版本可能重算聲音條件。每次新對話仍需檢索、語言模型生成及 TTS 推論。不能將聲音登記說成預先生成所有未來對話。

【Arweave 與權限】
本組聚焦 QA 第3頁的素材處理。延續 Arweave 目標架構，私密原素材、頭像與聲音條件應加密封存並由 manifest 索引。pgvector 是持續運作的資料庫，不應說成索引已全數存進 Arweave。授權後若後端處理明文，必須說明其存取邊界，不能同時主張平台在所有階段都看不到內容。Lit 整合仍屬規劃，非本組證明已完成。

【模型狀態】
原 QA 使用 IndexTTS2。依本次對話將聲音頁改為 Chatterbox Multilingual V3 替換候選，但沒有改程式、安裝或完成5090實測。LAM依原專案保留。若非中國來源限制擴及所有模型，LAM來自Alibaba Tongyi Lab仍須另行評估，不能暗示整套模型已符合該限制。

【來源】
docs/architecture-qa-4pages.md 第3頁；docs/architecture-qa.md Q9–Q10、Q15–Q16、Q20–Q22。
backend/src/lib/embedding.ts、backend/src/lib/rag.ts。
https://github.com/resemble-ai/chatterbox

---

## 第 2 頁｜LAM 重建成果與單張照片的限制

【40 秒講稿】
這張是 LAM 論文的成果原圖。左邊是一張輸入照片，右邊是重建頭像在不同表情與姿勢下的樣子。頭像使用 3D 高斯點表示外觀：每個點有位置、形狀、方向、顏色和透明度，渲染時依視角投影並合成。預訓練模型提供人頭的先驗知識，照片提供這個人的外觀線索。

【界線】
這是研究作者的展示，不是Aeterlux實際使用者或本機測試成果。單張照片未提供的側面、後方和遮蔽區域屬推測，不能保證精準還原；頭髮、眼鏡、遮擋、表情與照片品質皆可能影響結果。建議先選清楚、少遮擋的正面照，以家屬驗收決定是否可用。
3D高斯點不是會發光的粒子；高斯的柔邊及透明度是在渲染時計算的外觀表示。

【可能追問】
Q：只有正面照，側面是怎麼來的？
A：模型結合照片線索和先前學到的人頭分布推測，因此看不到的部位不是從照片直接量測而得。
Q：這就是一段影片嗎？
A：輸出為可驅動的頭像資產，之後依表情與姿勢產生畫面。本圖以靜態畫面展示其不同驅動狀態。

【來源】
He et al., LAM: Large Avatar Model for One-shot Animatable Gaussian Head, 2025, Figure 1。
https://arxiv.org/abs/2502.17796
https://arxiv.org/html/2502.17796v2/teaser.png
3DGS概念背景：Kerbl et al., 3D Gaussian Splatting for Real-Time Radiance Field Rendering, SIGGRAPH 2023。
https://repo-sam.inria.fr/fungraph/3d-gaussian-splatting/
本圖完整保留比例、標註與內容，2026-09-15取得。

---

## 第 3 頁｜LAM 方法原圖

【50 秒講稿】
先看左半邊。LAM以FLAME標準人頭的點作為查詢，搭配照片的多層影像特徵，用Transformer推測每個高斯點的外觀。這一步產生標準姿態下的頭像。再看右邊，同一份頭像接收表情與姿態參數，做變形並渲染，因此不必每次講話都重新從照片建模。

【圖中名詞】
FLAME是參數化的人頭模型，包含形狀、表情、姿態及變形關係，不能只簡化成幾根骨架。Q來自FLAME點的查詢，KV來自影像特徵。MLP預測高斯屬性。右側Gaussian Morph利用變形關係產生當前姿態，最後由渲染器呈現。論文預設細分兩次取得81,424點，頁面四捨五入為約8萬。這是論文設定，不宣稱每份專案輸出都相同。

【效能口徑】
原QA提到M1 Pro 120 FPS；此組不將该數字放在主頁，以免被解讀為本專案端到端效能。論文渲染效能排除頭像重建和驅動參數估計，不能等同家屬說完話至AI回覆的延遲。

【可能追問】
Q：為什麼說不用重新訓練？
A：使用已訓練的LAM做推論，產生個人化資產，並非替此人再訓練一個模型。
Q：後面真的完全沒有神經網路？
A：這個結論僅指論文頭像的變形與渲染不需要額外外觀重建／後處理網路。整體對話仍有語言模型、TTS與表情／頭姿模型。

【來源】
He et al., LAM, 2025, Figure 2及§3.2–3.3。
https://arxiv.org/html/2502.17796v2/framework.png
https://arxiv.org/html/2502.17796v2
FLAME：Li et al., Learning a Model of Facial Shape and Expression from 4D Scans, SIGGRAPH Asia 2017。
https://flame.is.tue.mpg.de/
圖片2026-09-15取得，未改內容。

---

## 第 4 頁｜E5 記憶索引及原始論文圖

【50 秒講稿】
這張圖來自E5原始研究，右半邊顯示問題與段落透過共享編碼器轉為可以比較的向量。左半邊是作者訓練模型時的資料準備，我們不會重跑這段訓練。專案直接使用多語E5-small，把逝者原話和已核可回憶切成片段，保留來源，再存成pgvector索引。提問時用同一模型編碼問題，找出語意相關的片段，供後續語言模型參考。

【已核對程式】
backend/src/lib/embedding.ts使用Xenova/multilingual-e5-small，EMBEDDING_DIM=384。文件片段加passage:，問題加query:，採mean pooling和L2 normalization。384維是small版本設定，不應推廣為所有E5。
backend/src/lib/rag.ts的reindexMemory分別處理chatlog及核可stories。對話紀錄嘗試辨認逝者發話；親友回憶另走piecesFromStory，不能在整合後一律說是本人親口講過。姓名模糊比對或缺少發話者時仍可能有辨識風險，需要家屬校對。

【圖源界線】
這是2022年E5原始論文的Figure1，不是2024 Multilingual E5技術報告的圖，也不是專案的上線架構截圖。用它補充雙編碼器與對比學習的研究基礎。多語E5是專案採用的後續模型，另列報告及程式來源。

【例子】
早餐與虱目魚粥的例子是解說情境，非實測檢索結果。原QA說兩句完全沒有相同字並不正確，因此改成「比較語意找候選片段」。語意相近不等於歷史真實，也不保證排名正確。回覆時必須保留不確定性，避免將親友描述冒充逝者原話。

【可能追問】
Q：這算訓練逝者的模型嗎？
A：不算。使用現成模型將資料建索引，新回憶只需更新相關索引。
Q：E5會直接回答問題嗎？
A：不會。E5輸出向量，pgvector找資料，生成回覆是後續語言模型的工作，屬第4頁QA。

【來源】
Wang et al., Text Embeddings by Weakly-Supervised Contrastive Pre-training, 2022, Figure1。
https://arxiv.org/abs/2212.03533
https://arxiv.org/html/2212.03533v1/procedure.png
Wang et al., Multilingual E5 Text Embeddings: A Technical Report, 2024。
https://arxiv.org/abs/2402.05672
backend/src/lib/embedding.ts；backend/src/lib/rag.ts；docs/architecture-qa-4pages.md。
https://github.com/pgvector/pgvector
圖於2026-09-15取得。

---

## 第 5 頁｜Chatterbox Multilingual V3 聲音複製

【45 秒講稿】
聲音路線以短錄音提供「誰的聲音」的線索，之後把新的回覆文字交給TTS，生成以參考音色說出的聲音。現在評估的替換候選是Chatterbox Multilingual V3。它可以使用參考錄音而不為每個人重新訓練，但聲音像不像本人、中文是否自然，仍要用我們的素材做驗收。

【與原QA的變更】
原文件寫IndexTTS2，使用者後續提出改評估Chatterbox V3。本頁據此更新展示方向，並保留「評估中」狀態，不表示程式已換完。沒有使用IndexTTS2論文圖冒充Chatterbox架構。此次未找到可確認對應V3的正式架構論文圖，改用Resemble AI官方Multilingual模型宣傳圖，並清楚註記不是論文圖。

【依官方程式理解】
ChatterboxMultilingualTTS可以透過prepare_conditionals處理參考錄音；新文字與聲音條件經T3生成語音token，再由S3Gen產生波形，最後套用官方水印。若同一角色多句對話，可設計條件快取；多角色須隔離狀態，不能共用錯誤條件。
截至此次核對，載入V3需明確指定t3_model='v3'，預設可能仍是V2。官方公開generate是一次輸入完成後回傳波形，可沿用逐句生成；不把H100或商用API低延遲數字當成本機5090表現。國語專用微調版可列入比較。

【素材與驗收】
建議以10–15秒乾淨國語錄音作為第一輪測試素材，這是測試建議而非最低長度保證。需比較發音、人名、台灣用語、長者沙啞／氣音、停頓及跨句音色穩定性。控制exaggeration與cfg_weight並不等於精準指定0.9倍語速。若後處理變速，要先完成音訊變速，再生成表情／頭姿，確保同步。

【來源限制】
發布者是Resemble AI，但官方程式與致謝涉及S3Tokenizer／CosyVoice。若禁止中國來源的範圍包含上游元件，尚不能認定合格；本頁不宣稱通過來源審查，也不宣稱比IndexTTS2全面更好。

【可能追問】
Q：每個人都要另外訓練聲音模型嗎？
A：零樣本流程以本人錄音提供條件，無需為每人微調模型。
Q：聲音是建立時就全部算好了嗎？
A：建立時保存錄音與聲音條件，每次新文字仍需合成。
Q：是否一定比原本更快更像？
A：目前只有文件與原始碼評估，仍須同機同素材A/B測試。

【來源】
https://github.com/resemble-ai/chatterbox
https://raw.githubusercontent.com/resemble-ai/chatterbox/master/Chatterbox-Multilingual.png
https://github.com/resemble-ai/chatterbox/blob/master/src/chatterbox/mtl_tts.py
https://www.resemble.ai/resources/chatterbox-multilingual-v3-tts-with-embedded-watermarking-for-25-languages
https://huggingface.co/ResembleAI/Chatterbox-Multilingual-zh-cmn
官方圖2026-09-15取得，保留完整內容和比例。