import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {Presentation,PresentationFile,FileBlob} from '@oai/artifact-tool';
const work='C:/Users/kk865/OneDrive/Desktop/your-mama-is-dead/Your-Mama-IsDead/docs/slides',tmp=work+'/.build-qa3';
const skill='C:/Users/kk865/.codex/plugins/cache/openai-primary-runtime/presentations/26.905.11957/skills/presentations';
const runtime='C:/Users/kk865/.cache/codex-runtimes/codex-primary-runtime/dependencies';
process.env.RUNTIME_NODE_MODULES=runtime+'/node/node_modules';
const {finalizePresentation}=await import(pathToFileURL(skill+'/container_tools/artifact_tool_utils.mjs').href);
const p=Presentation.create({slideSize:{width:1600,height:900}});
const c={bg:'#F4F2EB',red:'#812D2A',ink:'#282B29',muted:'#676B63',green:'#426147',blue:'#426B79'};
const font='Microsoft JhengHei',links={},scripts=[];
function txt(s,name,str,x,y,w,h,size=28,color=c.ink,bold=false){
 const a=s.shapes.add({name,geometry:'textbox',position:{left:x,top:y,width:w,height:h},fill:'none',line:{fill:'none',width:0}});
 a.text=str;a.text.style={typeface:font,fontSize:size,color,bold,verticalAlignment:'middle',autoFit:'none',insets:{left:0,right:0,top:0,bottom:0}};return a;
}
function page(title,sub,part){
 const s=p.slides.add();s.background.fill=c.bg;
 txt(s,'brand','AETERLUX',64,32,330,46,34,c.red,true);
 txt(s,'brand-sub','數位記憶燈塔',66,79,330,28,22,c.red);
 txt(s,'page',`QA 03　${part}　${p.slides.items.length} / 5`,1070,43,465,37,23,c.muted);
 txt(s,'title',title,64,131,1472,77,54,c.red,true);
 txt(s,'subtitle',sub,64,218,1472,47,28);
 return s;
}
async function pic(s,file,x,y,w,h,alt){s.images.add({blob:new Uint8Array(await fs.readFile(tmp+'/assets/'+file)),contentType:'image/png',alt,fit:'contain',position:{left:x,top:y,width:w,height:h}});}
function cite(s,name,label,url,x=64,y=851,w=1472){txt(s,name,label,x,y,w,30,19,c.blue);(links[p.slides.items.indexOf(s)+1]??={})[name]=url;}
function note(s,title,body){s.speakerNotes.textFrame.setText(title+'\n\n'+body);scripts.push('## '+title+'\n\n'+body);}

// 1. Summary: source / operation / reusable output; no per-person model training.
{
const s=page('素材如何變成數位分身？','以預訓練模型處理素材，建立可重用的記憶、外觀與聲音條件。','建立流程');
const xs=[64,580,1096];
const rows=[
 ['記憶','對話紀錄與核可回憶','multilingual-E5-small','分辨來源、切片、轉為向量','pgvector 記憶索引','之後依問題找相關片段'],
 ['臉孔','一張清楚的正面照','LAM','單次推理，重建高斯頭像','可驅動的 3D 頭像','之後依表情與姿態參數動作'],
 ['聲音','一段清楚的本人錄音','Chatterbox V3（評估中）','提取聲音參考條件','聲音參考／條件資料','之後搭配新文字生成聲音']
];
for(let i=0;i<3;i++){
 const x=xs[i],r=rows[i];
 txt(s,'route-'+i,r[0],x,315,440,55,39,i===2?c.red:c.green,true);
 txt(s,'input-label-'+i,'素材',x,393,440,30,22,c.muted);
 txt(s,'input-'+i,r[1],x,436,440,42,29,c.ink,true);
 txt(s,'model-'+i,r[2],x,519,440,44,i===2?28:32,c.green,true);
 txt(s,'process-'+i,r[3],x,567,440,38,25);
 txt(s,'output-'+i,r[4],x,657,440,44,30,c.red,true);
 txt(s,'reuse-'+i,r[5],x,710,440,37,25);
}
txt(s,'takeaway','不需為每位逝者重新訓練模型。產物建立後重用，素材更新時再處理。',64,795,1472,40,28,c.ink,true);
cite(s,'reference','來源：architecture-qa-4pages.md 第 3 頁；聲音模型依最新討論列為替換候選。','../../architecture-qa-4pages.md');
note(s,'第 1 頁｜素材到分身總覽',`【45 秒講稿】\n建立分身時，我們把素材分成三條路。對話紀錄及家屬核可的回憶，先辨別來源、切成短片段，再透過 E5 建立可搜尋的記憶索引。一張清楚的正面照交給 LAM，產生可以用表情和姿態參數驅動的 3D 頭像。一段本人錄音則提供聲音參考，後續讓 TTS 用這個音色說出新文字。這三條路都使用已訓練好的模型，不必為每位逝者重新訓練一套模型。\n\n【建立後重用的範圍】\n建立的是可重用資產及索引，不代表一輩子只做一次。新增或修正回憶需更新索引，更換照片可能重建頭像，更換錄音或模型版本可能重算聲音條件。每次新對話仍需檢索、語言模型生成及 TTS 推論。不能將聲音登記說成預先生成所有未來對話。\n\n【Arweave 與權限】\n本組聚焦 QA 第3頁的素材處理。延續 Arweave 目標架構，私密原素材、頭像與聲音條件應加密封存並由 manifest 索引。pgvector 是持續運作的資料庫，不應說成索引已全數存進 Arweave。授權後若後端處理明文，必須說明其存取邊界，不能同時主張平台在所有階段都看不到內容。Lit 整合仍屬規劃，非本組證明已完成。\n\n【模型狀態】\n原 QA 使用 IndexTTS2。依本次對話將聲音頁改為 Chatterbox Multilingual V3 替換候選，但沒有改程式、安裝或完成5090實測。LAM依原專案保留。若非中國來源限制擴及所有模型，LAM來自Alibaba Tongyi Lab仍須另行評估，不能暗示整套模型已符合該限制。\n\n【來源】\ndocs/architecture-qa-4pages.md 第3頁；docs/architecture-qa.md Q9–Q10、Q15–Q16、Q20–Q22。\nbackend/src/lib/embedding.ts、backend/src/lib/rag.ts。\nhttps://github.com/resemble-ai/chatterbox`);
}

// 2. Full original paper teaser with interpretation kept separate.
{
const s=page('一張照片，建立可驅動的頭像','3D 高斯潑濺以帶顏色、透明度與形狀的柔邊點，疊出可渲染的外觀。','LAM 成果');
await pic(s,'lam-teaser.png',64,292,1472,412,'LAM paper Figure 1: one-shot images, reconstructed avatars, reenactment and mobile rendering.');
txt(s,'caption','論文 Figure 1 原圖：左側是輸入照片，右側是重建後不同表情與姿態的結果。',64,712,1472,34,23,c.muted);
txt(s,'answer','評審問：一張照片真的夠嗎？',64,765,680,39,29,c.red,true);
txt(s,'answer-body','可產生頭像；照片未呈現的部分由模型推測，仍需家屬驗收。',64,807,1472,36,26);
cite(s,'paper','論文圖源：He et al., LAM, 2025, Figure 1（點擊開啟論文）','https://arxiv.org/html/2502.17796v2#S0.F1');
note(s,'第 2 頁｜LAM 重建成果與單張照片的限制',`【40 秒講稿】\n這張是 LAM 論文的成果原圖。左邊是一張輸入照片，右邊是重建頭像在不同表情與姿勢下的樣子。頭像使用 3D 高斯點表示外觀：每個點有位置、形狀、方向、顏色和透明度，渲染時依視角投影並合成。預訓練模型提供人頭的先驗知識，照片提供這個人的外觀線索。\n\n【界線】\n這是研究作者的展示，不是Aeterlux實際使用者或本機測試成果。單張照片未提供的側面、後方和遮蔽區域屬推測，不能保證精準還原；頭髮、眼鏡、遮擋、表情與照片品質皆可能影響結果。建議先選清楚、少遮擋的正面照，以家屬驗收決定是否可用。\n3D高斯點不是會發光的粒子；高斯的柔邊及透明度是在渲染時計算的外觀表示。\n\n【可能追問】\nQ：只有正面照，側面是怎麼來的？\nA：模型結合照片線索和先前學到的人頭分布推測，因此看不到的部位不是從照片直接量測而得。\nQ：這就是一段影片嗎？\nA：輸出為可驅動的頭像資產，之後依表情與姿勢產生畫面。本圖以靜態畫面展示其不同驅動狀態。\n\n【來源】\nHe et al., LAM: Large Avatar Model for One-shot Animatable Gaussian Head, 2025, Figure 1。\nhttps://arxiv.org/abs/2502.17796\nhttps://arxiv.org/html/2502.17796v2/teaser.png\n3DGS概念背景：Kerbl et al., 3D Gaussian Splatting for Real-Time Radiance Field Rendering, SIGGRAPH 2023。\nhttps://repo-sam.inria.fr/fungraph/3d-gaussian-splatting/\n本圖完整保留比例、標註與內容，2026-09-15取得。`);
}

// 3. Large method figure and compact reading guide.
{
const s=page('LAM：外觀重建與表情驅動','左半部從照片估計外觀，右半部用參數驅動同一個頭像。','LAM 方法');
await pic(s,'lam-framework.png',64,296,1028,466,'LAM paper Figure 2: canonical reconstruction using FLAME queries and image features, then Gaussian morph and WebGL render.');
txt(s,'step1','01　標準人頭作為起點',1130,309,406,43,29,c.green,true);
txt(s,'step1body','FLAME 頂點細分後，\n約 8 萬個點對應高斯點。',1130,360,406,78,25);
txt(s,'step2','02　從照片估計外觀',1130,466,406,43,29,c.green,true);
txt(s,'step2body','Transformer 對照影像特徵，\n預測顏色、形狀與位移等屬性。',1130,516,406,82,25);
txt(s,'step3','03　依參數變形與渲染',1130,626,406,43,29,c.green,true);
txt(s,'step3body','輸入表情與姿態參數，\n即可驅動已建立的頭像。',1130,677,406,78,25);
txt(s,'boundary','頭像變形與渲染可不再跑外觀重建網路；語音與表情參數仍由其他模型生成。',64,795,1472,41,27,c.red,true);
cite(s,'paper','論文圖源：He et al., LAM, 2025, Figure 2（點擊開啟方法章節）','https://arxiv.org/html/2502.17796v2#S3');
note(s,'第 3 頁｜LAM 方法原圖',`【50 秒講稿】\n先看左半邊。LAM以FLAME標準人頭的點作為查詢，搭配照片的多層影像特徵，用Transformer推測每個高斯點的外觀。這一步產生標準姿態下的頭像。再看右邊，同一份頭像接收表情與姿態參數，做變形並渲染，因此不必每次講話都重新從照片建模。\n\n【圖中名詞】\nFLAME是參數化的人頭模型，包含形狀、表情、姿態及變形關係，不能只簡化成幾根骨架。Q來自FLAME點的查詢，KV來自影像特徵。MLP預測高斯屬性。右側Gaussian Morph利用變形關係產生當前姿態，最後由渲染器呈現。論文預設細分兩次取得81,424點，頁面四捨五入為約8萬。這是論文設定，不宣稱每份專案輸出都相同。\n\n【效能口徑】\n原QA提到M1 Pro 120 FPS；此組不將该數字放在主頁，以免被解讀為本專案端到端效能。論文渲染效能排除頭像重建和驅動參數估計，不能等同家屬說完話至AI回覆的延遲。\n\n【可能追問】\nQ：為什麼說不用重新訓練？\nA：使用已訓練的LAM做推論，產生個人化資產，並非替此人再訓練一個模型。\nQ：後面真的完全沒有神經網路？\nA：這個結論僅指論文頭像的變形與渲染不需要額外外觀重建／後處理網路。整體對話仍有語言模型、TTS與表情／頭姿模型。\n\n【來源】\nHe et al., LAM, 2025, Figure 2及§3.2–3.3。\nhttps://arxiv.org/html/2502.17796v2/framework.png\nhttps://arxiv.org/html/2502.17796v2\nFLAME：Li et al., Learning a Model of Facial Shape and Expression from 4D Scans, SIGGRAPH Asia 2017。\nhttps://flame.is.tue.mpg.de/\n圖片2026-09-15取得，未改內容。`);
}

// 4. E5 research origin clearly distinct from application indexing.
{
const s=page('記憶：把原話變成可搜尋的向量','使用現成的 multilingual-E5-small，保留原文與來源，再建立檢索索引。','E5 記憶');
await pic(s,'e5-procedure.png',64,305,934,269,'Original E5 paper Figure 1: contrastive pretraining data curation and shared query-passage encoder.');
txt(s,'fig-caption','E5 原始研究 Figure 1：訓練資料與雙編碼器概念。',64,594,934,35,23,c.muted);
txt(s,'fig-scope','本專案使用已訓練的多語版本，不重跑左側訓練流程。',64,634,934,38,24,c.red,true);
txt(s,'project-title','本專案如何建立記憶',1060,301,476,44,31,c.green,true);
txt(s,'project-1','先分清楚本人原話與親友回憶',1060,365,476,42,26);
txt(s,'project-2','切成短片段，保留來源標籤',1060,427,476,42,26);
txt(s,'project-3','E5-small 編碼為 384 維向量',1060,489,476,42,26);
txt(s,'project-4','存入 pgvector，建立 HNSW 索引',1060,551,476,42,25);
txt(s,'example-title','怎麼找到相關回憶？',64,703,1472,43,30,c.green,true);
txt(s,'example','家屬問「奶奶平常愛吃哪種早餐？」　記憶原文「我最愛吃虱目魚粥」。',64,756,1472,42,29);
txt(s,'example-note','向量比較語意，找出候選片段；仍需相關性門檻，不能保證每次都找對。',64,804,1472,33,25,c.muted);
cite(s,'paper','圖源：Wang et al., E5, arXiv:2212.03533, Figure 1','https://arxiv.org/html/2212.03533v1#S3.F1',64,851,810);
cite(s,'multilingual','多語模型：Multilingual E5 技術報告（2024）','https://arxiv.org/abs/2402.05672',940,851,596);
note(s,'第 4 頁｜E5 記憶索引及原始論文圖',`【50 秒講稿】\n這張圖來自E5原始研究，右半邊顯示問題與段落透過共享編碼器轉為可以比較的向量。左半邊是作者訓練模型時的資料準備，我們不會重跑這段訓練。專案直接使用多語E5-small，把逝者原話和已核可回憶切成片段，保留來源，再存成pgvector索引。提問時用同一模型編碼問題，找出語意相關的片段，供後續語言模型參考。\n\n【已核對程式】\nbackend/src/lib/embedding.ts使用Xenova/multilingual-e5-small，EMBEDDING_DIM=384。文件片段加passage:，問題加query:，採mean pooling和L2 normalization。384維是small版本設定，不應推廣為所有E5。\nbackend/src/lib/rag.ts的reindexMemory分別處理chatlog及核可stories。對話紀錄嘗試辨認逝者發話；親友回憶另走piecesFromStory，不能在整合後一律說是本人親口講過。姓名模糊比對或缺少發話者時仍可能有辨識風險，需要家屬校對。\n\n【圖源界線】\n這是2022年E5原始論文的Figure1，不是2024 Multilingual E5技術報告的圖，也不是專案的上線架構截圖。用它補充雙編碼器與對比學習的研究基礎。多語E5是專案採用的後續模型，另列報告及程式來源。\n\n【例子】\n早餐與虱目魚粥的例子是解說情境，非實測檢索結果。原QA說兩句完全沒有相同字並不正確，因此改成「比較語意找候選片段」。語意相近不等於歷史真實，也不保證排名正確。回覆時必須保留不確定性，避免將親友描述冒充逝者原話。\n\n【可能追問】\nQ：這算訓練逝者的模型嗎？\nA：不算。使用現成模型將資料建索引，新回憶只需更新相關索引。\nQ：E5會直接回答問題嗎？\nA：不會。E5輸出向量，pgvector找資料，生成回覆是後續語言模型的工作，屬第4頁QA。\n\n【來源】\nWang et al., Text Embeddings by Weakly-Supervised Contrastive Pre-training, 2022, Figure1。\nhttps://arxiv.org/abs/2212.03533\nhttps://arxiv.org/html/2212.03533v1/procedure.png\nWang et al., Multilingual E5 Text Embeddings: A Technical Report, 2024。\nhttps://arxiv.org/abs/2402.05672\nbackend/src/lib/embedding.ts；backend/src/lib/rag.ts；docs/architecture-qa-4pages.md。\nhttps://github.com/pgvector/pgvector\n圖於2026-09-15取得。`);
}

// 5. Official model artwork, not falsely attributed as an academic figure.
{
const s=page('聲音：用短錄音提供音色參考','Chatterbox Multilingual V3 是目前替換候選，採零樣本聲音複製。','TTS 聲音');
await pic(s,'chatterbox.png',64,304,680,340,'Resemble AI official Chatterbox Multilingual model artwork; not a paper architecture figure.');
txt(s,'image-caption','Resemble AI 官方模型圖（非論文架構圖）',64,658,680,34,23,c.muted);
txt(s,'step1','建立時：準備參考聲音',820,310,716,48,33,c.green,true);
txt(s,'body1','由清楚的本人錄音提取聲音條件，\n不需為每個人重新訓練模型。',820,370,716,82,28);
txt(s,'step2','對話時：讓新文字以參考音色說出',820,494,716,48,31,c.green,true);
txt(s,'body2','T3 生成語音 token，S3Gen 轉為波形，\n再將聲音交給表情與頭姿模型。',820,554,716,84,28);
txt(s,'quality','驗收重點：中文發音、本人音色與自然停頓',64,735,1472,46,32,c.red,true);
txt(s,'status','尚未完成本機替換與效能實測。國語與長者聲線需以相同素材比較驗收。',64,797,1472,41,27);
cite(s,'official','來源：Resemble AI 官方 repo、V3 說明與推論程式（點擊開啟）','https://github.com/resemble-ai/chatterbox');
note(s,'第 5 頁｜Chatterbox Multilingual V3 聲音複製',`【45 秒講稿】\n聲音路線以短錄音提供「誰的聲音」的線索，之後把新的回覆文字交給TTS，生成以參考音色說出的聲音。現在評估的替換候選是Chatterbox Multilingual V3。它可以使用參考錄音而不為每個人重新訓練，但聲音像不像本人、中文是否自然，仍要用我們的素材做驗收。\n\n【與原QA的變更】\n原文件寫IndexTTS2，使用者後續提出改評估Chatterbox V3。本頁據此更新展示方向，並保留「評估中」狀態，不表示程式已換完。沒有使用IndexTTS2論文圖冒充Chatterbox架構。此次未找到可確認對應V3的正式架構論文圖，改用Resemble AI官方Multilingual模型宣傳圖，並清楚註記不是論文圖。\n\n【依官方程式理解】\nChatterboxMultilingualTTS可以透過prepare_conditionals處理參考錄音；新文字與聲音條件經T3生成語音token，再由S3Gen產生波形，最後套用官方水印。若同一角色多句對話，可設計條件快取；多角色須隔離狀態，不能共用錯誤條件。\n截至此次核對，載入V3需明確指定t3_model='v3'，預設可能仍是V2。官方公開generate是一次輸入完成後回傳波形，可沿用逐句生成；不把H100或商用API低延遲數字當成本機5090表現。國語專用微調版可列入比較。\n\n【素材與驗收】\n建議以10–15秒乾淨國語錄音作為第一輪測試素材，這是測試建議而非最低長度保證。需比較發音、人名、台灣用語、長者沙啞／氣音、停頓及跨句音色穩定性。控制exaggeration與cfg_weight並不等於精準指定0.9倍語速。若後處理變速，要先完成音訊變速，再生成表情／頭姿，確保同步。\n\n【來源限制】\n發布者是Resemble AI，但官方程式與致謝涉及S3Tokenizer／CosyVoice。若禁止中國來源的範圍包含上游元件，尚不能認定合格；本頁不宣稱通過來源審查，也不宣稱比IndexTTS2全面更好。\n\n【可能追問】\nQ：每個人都要另外訓練聲音模型嗎？\nA：零樣本流程以本人錄音提供條件，無需為每人微調模型。\nQ：聲音是建立時就全部算好了嗎？\nA：建立時保存錄音與聲音條件，每次新文字仍需合成。\nQ：是否一定比原本更快更像？\nA：目前只有文件與原始碼評估，仍須同機同素材A/B測試。\n\n【來源】\nhttps://github.com/resemble-ai/chatterbox\nhttps://raw.githubusercontent.com/resemble-ai/chatterbox/master/Chatterbox-Multilingual.png\nhttps://github.com/resemble-ai/chatterbox/blob/master/src/chatterbox/mtl_tts.py\nhttps://www.resemble.ai/resources/chatterbox-multilingual-v3-tts-with-embedded-watermarking-for-25-languages\nhttps://huggingface.co/ResembleAI/Chatterbox-Multilingual-zh-cmn\n官方圖2026-09-15取得，保留完整內容和比例。`);
}

await fs.writeFile(work+'/output/Aeterlux-QA03-Avatar-Speaker-Notes.md','# Aeterlux QA 03｜從素材到分身\n\n5頁簡報講稿與參考來源。\n\n'+scripts.join('\n\n---\n\n'));
await fs.writeFile(tmp+'/links.json',JSON.stringify(links));
const unlinked=tmp+'/candidate-unlinked.pptx',candidate=tmp+'/candidate.pptx';
const final=work+'/output/Aeterlux-QA03-Avatar.pptx';
await(await PresentationFile.exportPptx(p)).save(unlinked);
execFileSync(runtime+'/python/python.exe',[tmp+'/link-sources.py',unlinked,candidate,tmp+'/links.json']);
const result=await finalizePresentation({workspaceDir:work,candidatePath:candidate,finalPath:final,pythonExecutable:runtime+'/python/python.exe',integrityValidatorPath:skill+'/container_tools/inspect_presentation_package_integrity.py',layoutValidatorPath:skill+'/container_tools/inspect_presentation_layout_geometry.py',layoutArgs:['--expected-slide-size-emu','15240000,8572500','--validate-heading-fit'],explicitTotalSlideCount:5,requiredNativeTableOwnerSlides:[],requiredNativeChartOwnerSlides:[],fontPolicy:{basis:'design',families:[font]},verifyArtifactToolImport:true,receiptPath:tmp+'/validation.json'});
const verified=await PresentationFile.importPptx(await FileBlob.load(final));
for(let i=0;i<verified.slides.items.length;i++){
 await fs.writeFile(work+`/output/Aeterlux-QA03-Avatar-${i+1}.png`,new Uint8Array(await(await verified.export({slide:verified.slides.items[i],format:'png',scale:1})).arrayBuffer()));
}
console.log(JSON.stringify({finalPath:result.finalPath,slides:verified.slides.items.length,layout:result.presentationLayout.finding_count}));
