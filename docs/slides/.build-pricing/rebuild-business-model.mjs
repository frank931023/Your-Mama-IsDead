import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {PresentationFile,FileBlob} from '@oai/artifact-tool';
const work='C:/Users/kk865/OneDrive/Desktop/your-mama-is-dead/Your-Mama-IsDead/docs/slides';
const tmp=work+'/.build-pricing';
const skill='C:/Users/kk865/.codex/plugins/cache/openai-primary-runtime/presentations/26.905.11957/skills/presentations';
const runtime='C:/Users/kk865/.cache/codex-runtimes/codex-primary-runtime/dependencies';
process.env.RUNTIME_NODE_MODULES=runtime+'/node/node_modules';
const {finalizePresentation}=await import(pathToFileURL(skill+'/container_tools/artifact_tool_utils.mjs').href);
const q={checkedAt:'2026-09-15T20:57:04.7959249+08:00',rates:{winc:'13980480526047',fiat:{usd:57.857680946256},perDataItemFeeWinc:'7434945'},oneGiB:{winc:'13980487960992'}};
await fs.writeFile(tmp+'/business-model-quote.json',JSON.stringify(q,null,2));
const usd=Number(q.oneGiB.winc)/Number(q.rates.winc)*q.rates.fiat.usd;
const raw=usd*32, archiveBudget=Math.ceil((raw+5)*1.2), capex=269800;
const depreciation=capex/36, idle=.15*730*5*1.2;
const fixed=depreciation+idle+7500, fee=p=>p*.03+1;
const stdHours=300*2/3600,premHours=600*2/3600+60*3.5/60;
const stdVar=stdHours*4.5+20+fee(299),premVar=premHours*4.5+30+40+fee(899);
const stdMargin=299/1.05-stdVar,premMargin=899/1.05-premVar;
const weighted=.6*stdMargin+.4*premMargin;
const archiveCost=archiveBudget+600+150+100+fee(4990)+200;
const extraCost=archiveBudget+100+50+fee(3490);
const n=v=>v.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const notes=`# Aeterlux 收費模式與成本來源｜講稿及計算備註

更新日期：2026-09-15。幣別均為新臺幣，GiB 為二進位容量單位。這是試營運商業模式提案，非已上線的付費功能或確定售價。頁面區間是預算情境，非廠商保價。以下精確數字用來說明推算方法，仍包含待驗證假設。

## 一、台上講稿（約 90 秒）

我們把收費拆成持續服務、實際用量，以及永久封存。

持續服務採 SaaS 訂閱，以每位逝者的塔位為單位，家屬共用服務與額度，提供 AI 記憶對話、邀請與回憶管理。基本公開追思功能保留免費入口，讓家屬先使用，再依需求開啟付費服務。

AI 的實際使用以 credits 記錄。文字依成功回覆計量，語音依成功生成的秒數計量。訂閱包含基本額度，用完後可以主動加購。播放同一份聲音不重複扣點，生成失敗也不扣點，避免使用者難以掌握支出。

儲存則採一次性收費。素材加密後上傳 Arweave，按實際新增的封存量報價。已封存的資料不重複收儲存月租。即使停止訂閱，先前完成的永久封存仍依儲存協議保留。新增素材或上傳新版本，才產生新的封存費用。

成本主要有本地 GPU 電腦、Arweave 上傳、電費與散熱，以及平台維運。本地設備先投入，再逐月攤提。Arweave 隨新增封存量發生一次成本。電費和維運則持續發生。因此，訂閱支應平台持續運作，credits 反映運算使用量，封存費對應一次性儲存成本。定價會依實際測得的負載和服務成本調整。

## 二、收費模式與計量規則

三個膠囊表示可搭配使用的收費機制，並非三個互斥的會員等級。

1. SaaS 訂閱：每位逝者／塔位一份訂閱，家屬共享，按月提供管理功能與基本 AI 額度。訂閱含的 credits 先扣，用完才由使用者選擇加購，不再對同一筆用量收第二次費用。
2. Credits 計量：採兩種獨立餘額，避免文字與聲音算力不同卻混用同一點值。一次成功文字回覆扣 1 文字 credit；成功生成音訊的秒數扣語音 credits，1 秒等於 1 語音 credit。語音回答會同時消耗其文字生成額度及音訊額度，使用前清楚顯示。文字與語音 credits 不任意互換。輸入語音辨識另記秒数，不以觀看或開著頁面的時長計費。
3. 失敗請求不扣點，同一 request ID 重送不重複扣點，重播既有音訊不扣生成點數，使用者主動重新生成則屬新工作。後端需實作去重、用量帳本與失敗返還。
4. 每則回覆上限 300 個輸出 token、總上下文上限 8K token，單段生成音訊上限 60 秒，這些是預算模型的限制條件。每塔位同時一個 AI 工作，尖峰排隊。
5. 訂閱附贈額度每月重置。另購 credits 的到期、退費與餘額保留規則須在商用條款確認，本計算不靠未用完或到期沒收來創造收益，按用滿估成本。
6. 永久封存：以加密、封裝後實際新增 bytes 計量，包含索引清單與新版本。取消月費不撤回已完成封存或 NFT。讀取 gateway、網站、索引與 AI 運作仍是持續服务，不將永久保存說成所有前端與算力終身免費。
7. 首次分身建立可另收一次性處理費，對應照片、錄音檢查和頭像建立及驗收，與永久儲存費分開。

## 三、內部定價假設（不展示於投影片）

以下沿用先前方案作比較基準，加入 credits 計量說明，未經付費意願或正式營運驗證：

基本追思：NT$0，提供公開生平、基本照片展示、親友留言，永久封存與 AI 另購。
文字訂閱：NT$299／月／塔位，含 300 文字 credits、邀請及回憶審核。
聲影訂閱：NT$899／月／塔位，含 600 文字 credits、3,600 語音 credits（60 分鐘輸出）、3,600 秒輸入語音辨識額度與頭像互動。
用量加購示例：NT$199，增加 1,800 語音 credits（30 分鐘）、300 文字 credits，以及 1,800 秒輸入辨識額度。僅主動購買，不自動超額扣款。
首次分身建立：NT$1,990，含一張合格正面照、一段合格錄音、一次驗收與一次重試，額外修復另報價。
永久封存服務：首 1 GiB 暫以 NT$4,990，包含整理、校驗與交付協助；新增量暫以 NT$3,490／GiB，按 0.1 GiB 向上計算。這是服務售價，不是 Arweave 原始成本。付款前依最新上傳成本確認報價，未封存容量不視為可循環使用的磁碟。
稅與金流試算：售價為含稅假設，不含稅收入以售價／1.05估算；金流預算以售價×3%＋1計算。這是規劃口徑，非正式支付合約或稅務認定。不計進項扣抵，不扣所得稅。

## 四、本地設備：頁面約 NT$25–30 萬／套

基準採 RTX 5090 32 GB 整機一套，含 UPS、備份與網路設備。以同級新機重置預算估算，不宣稱為團隊實際購買發票。
欣亞 MSI MEG Vision X AI 2NVZ9-016TW，Ultra 9-285K／RTX5090 32G／DDR5 64G／2TB SSD，查價 NT$249,800，頁面為貨到通知。
整機249,800＋UPS預留10,000＋備份碟6,000＋網路設備4,000＝NT$269,800。整機已含 GPU、CPU、RAM、電源和散熱，不再重複加購顯卡成本。
頁面區間25–30萬元是採購預算帶，中心值269,800。36個月直線攤提、殘值0：269,800／36＝NT$${n(depreciation)}／月。對應區間250,000／36至300,000／36＝6,944.44–8,333.33／月。
購入款為一次現金支出；採折舊估每月成本時不再將整筆購入款當月費成本。未含第二台備援、辦公室及冷氣裝機。

## 五、電費與散熱：頁面約 NT$1,500–6,000／月／台

假設整機待機0.15 kW，推理忙碌0.90 kW，每月730小時，冷卻及供電損耗係數1.20。功耗須日後以電表量測，1200W電源供應器額定值不等於持續耗電。
月電費＝[0.15＋(0.90−0.15)×忙碌占比]×730×每度電預算×1.20。
區間低情境：忙碌30%、每度5元，電費＝0.375×730×5×1.20＝NT$1,642.50。
區間高情境：忙碌100%、每度7元，電費＝0.90×730×7×1.20＝NT$5,518.80。
頁面向外取整為1,500–6,000元。這是情境範圍，非保證上下限，停機或較低使用時可更低。5–7元是預算單價，不是台電統一費率，實際取決於用戶別、用量與季節。
固定／變動拆分採每度5元：待機0.15×730×5×1.20＝NT$657／月；額外忙碌成本(0.90−0.15)×5×1.20＝NT$4.50／GPU忙碌小時。採此拆分後不再疊加整月電費，避免重複計入。

## 六、Arweave：頁面約 NT$1,800–2,600／GiB，一次性

以專案已有的 ArDrive Turbo 上傳路徑作預算基準，這是 Turbo 接入 Arweave 的成本，不是直傳 Arweave 或 Irys 的通用固定單價。
本次API報價時間：${q.checkedAt}。
1 GiB＝1,073,741,824 bytes。
GET /v1/rates：每GiB WINC=${q.rates.winc}、USD=${q.rates.fiat.usd}、perDataItemFeeWinc=${q.rates.perDataItemFeeWinc}。
GET /v1/price/bytes/1073741824：WINC=${q.oneGiB.winc}。
美元成本＝bytes報價WINC／rates.winc×rates.fiat.usd＝US$${usd.toFixed(8)}／GiB。WINC以整數精度處理為正式實作要求，本估算此級距仍在JavaScript安全整數範圍。
規劃匯率32元／美元，原始成本＝${usd.toFixed(8)}×32＝NT$${n(raw)}／GiB。
另預留每GiB 5元小檔管理差額，價格／匯率／重試緩衝20%：ceil[(${n(raw)}＋5)×1.20]＝NT$${archiveBudget}／GiB。
單檔bytes報價已含該data item費用，不重複加計。正式訂單需按加密與封裝後各data item逐筆估價，分片及大量小檔可能改變結果。
頁面區間以本次美元報價、匯率30–35及最多20%緩衝作情境：原始成本約${n(usd*30)}–${n(usd*35)}元；高情境(美元成本×35＋5)×1.20約${n((usd*35+5)*1.2)}元，取概略展示帶1,800–2,600元。它不是報價承諾或價格統計信賴區間。
舊版08:55快照為US$60.625148／GiB，舊基準成本1,940元、含緩衝2,335元。本次已改用20:57報價，不將兩個時間點混算。
更新檔案是新增不可覆寫的上傳，會再產生成本；既有成功封存不因新價格上漲而補收月租。小檔免費補貼不作長期商業前提。每筆付款前重新取價並確認，成本超出預算帶則更新新單報價。

## 七、平台維運：頁面約 NT$5,000–10,000／月

以單機、小規模試營運、低流量免費追思頁的假設編列：網路1,200＋主站／DB／備份／CDN1,800＋RPC／金鑰服務預留1,000＋維修準備2,000＋公益免費池1,500＝NT$7,500／月。
這個區間是預算，不是已簽供應商報價。涵蓋RAG索引、快取、備份和傳輸等持續工作，不重複購買已封存的Arweave容量。
不含設備折舊、電費、全職人事、研發、行銷、租金、大量影音流量或正式模型商業授權。RPC／金鑰服務僅為预留，Lit是否正式使用及費率仍待確認。

## 八、AI用量、credits與單位成本的精算

Chatterbox Multilingual V3目前仍在評估，未於本地5090實測。本講稿不使用H100宣傳速度推算本機收益，也不把更换模型的效能改善預先列為已實現節省。
暫沿用原方案保守預算：每1分鐘生成音訊含表情／頭姿共用3.5 GPU忙碌分鐘；每次文字回覆2秒。前者是原IndexTTS2文件RTF2.7之上的規劃餘裕，後者也是假設。更換TTS後須重測完整工作、暖機、併發、顯存與P95延遲，再修改此係數。
每文字credit增量電費＝2／3600×4.50＝NT$0.0025。
每語音credit代表1秒音訊，增量GPU時間3.5秒，增量電費＝3.5／3600×4.50＝NT$0.004375。這只是增量電費，不是完整服務成本。
文字訂閱滿額GPU時間＝300×2／3600＝${n(stdHours)}小時；電費${n(stdHours*4.5)}元。
聲影訂閱滿額GPU時間＝600×2／3600＋60×3.5／60＝${n(premHours)}小時；電費${n(premHours*4.5)}元。
輸入語音辨識另留每分鐘0.50元，60分鐘為30元，這是預算非指定供應商報價。若改本地辨識，移除此API預留並加回GPU時間。
文字戶每月變動成本：電費${n(stdHours*4.5)}＋客服／處理20＋金流${n(fee(299))}＝NT$${n(stdVar)}。不含稅收入扣變動成本＝299／1.05−${n(stdVar)}＝NT$${n(stdMargin)}。
聲影戶每月變動成本：電費${n(premHours*4.5)}＋辨識30＋客服／處理40＋金流${n(fee(899))}＝NT$${n(premVar)}。貢獻餘額＝899／1.05−${n(premVar)}＝NT$${n(premMargin)}。
加購199元示例：GPU時間＝30×3.5／60＋300×2／3600＝1.916667小時；增量電費8.625＋辨識15＋處理10＋金流6.97＝40.595元。貢獻餘額199／1.05−40.595＝148.93元。仍需負擔固定成本與容量，不等於利潤。

## 九、一次性服務售價為何高於原始儲存費

首1GiB服務售價4,990元：Arweave成本預算${archiveBudget}＋人工整理1.5小時×400＝600＋鏈上交易預留150＋校驗交付100＋金流150.70＋重做／售後準備200＝NT$${n(archiveCost)}。貢獻餘額＝4990／1.05−${n(archiveCost)}＝NT$${n(4990/1.05-archiveCost)}。
新增1GiB售價3,490元：${archiveBudget}＋處理100＋校驗50＋金流105.70＝NT$${n(extraCost)}，貢獻餘額＝3490／1.05−${n(extraCost)}＝NT$${n(3490/1.05-extraCost)}。
分身建置售價1,990元：人工600＋10分鐘GPU增量電費0.75＋臨時輸出50＋金流60.70＋修正預留200＝911.45元，貢獻餘額1990／1.05−911.45＝983.79元。折舊已列月固定成本，不重複攤入此式。
人工400元／小時、鏈上150元、重做準備均為假設。主網gas、正式部署鏈與模型授權需另查，測試網免費不代表商用零成本。

## 十、固定成本、損益與容量示例

月固定成本＝設備折舊${n(depreciation)}＋待機電費657＋平台維運7,500＝NT$${n(fixed)}。
假設100個付費塔位，文字60戶、聲影40戶，全部用滿：含稅月收60×299＋40×899＝53,900；不含稅收入51,333.33；變動成本60×${n(stdVar)}＋40×${n(premVar)}＝${n(60*stdVar+40*premVar)}；扣固定後餘額＝NT$${n(53900/1.05-60*stdVar-40*premVar-fixed)}。
此餘額未扣全職人事、研發、獲客、租金及所得稅，不是淨利，也未把一次性封存收入當訂閱收入。
60／40組合平均單戶貢獻＝NT$${n(weighted)}，覆蓋本表基本成本約需ceil(${n(fixed)}／${n(weighted)})＝${Math.ceil(fixed/weighted)}戶。加入每月100,000元人事開發預算，紙上需${Math.ceil((fixed+100000)/weighted)}戶，但尚受單機容量限制。
100戶GPU月忙碌時數＝60×${stdHours.toFixed(6)}＋40×${premHours.toFixed(6)}＝${n(60*stdHours+40*premHours)}小時。規劃可出售容量730×40%＝292小時，預留尖峰、維護與建立分身。此時同組合滿額理論約${Math.floor(292/(.6*stdHours+.4*premHours))}戶，不能推成可同時在線數或延遲保證。更換TTS後必須重新估算。

## 十一、評審追問

問：儲存一次付費，為什麼還收訂閱？
答：訂閱支付AI推論、檢索、管理及網站維運。既有Arweave封存不收儲存月租，新增封存才再按量付費。

問：訂閱和credits會不會重複收？
答：訂閱含基本額度，先用內含點數；額度不足時才自願加購。不同服務的計量和扣點明列，失敗和重播不扣生成點數。

問：有自己的電腦，不就只剩電費？
答：仍有設備折舊、維修、網路、資料庫與備份、人力，以及尖峰容量成本。credits不能只依幾元電費定價。

問：為什麼現在不報確定價格？
答：本頁先說明收入如何對應成本。備註中的試算用於檢查可持續性，正式售價仍需用本機效能、供應商報價及付費意願驗證。

## 十二、來源與查核口徑

Arweave/Turbo原始API，2026-09-15 20:57取得：https://payment.ardrive.io/v1/rates
單GiB報價：https://payment.ardrive.io/v1/price/bytes/1073741824
換算公式與SDK：https://raw.githubusercontent.com/ardriveapp/turbo-sdk/main/packages/turbo-sdk/src/common/payment.ts
Turbo credits說明：https://docs.ar.io/build/upload/turbo-credits
RTX5090整機參考，2026-09-15頁面249,800元：https://www.sinya.com.tw/prod/214584
電價制度參考：https://www.taipower.com.tw/ （正式估價依實際用戶帳單，本計算5–7元是預算）
本機部署與IndexTTS2既有記錄：docs/server/SERVER.md，第11、12節。
Chatterbox V3目前仍待本機測試：https://github.com/resemble-ai/chatterbox
本次沒重新取得金流、RPC、Lit或雲端正式合約，相关數字明列為預留，不能引用為廠商定價。
未列入主頁區間：全職人事與研發、模型及FLAME等素材商業授權、主網gas、正式金鑰服務、資安稽核、第二台備援、大量LiveKit媒體傳輸。這些不得因開源或自架就視為零，正式商用需另編。
`;
const p=await PresentationFile.importPptx(await FileBlob.load(work+'/output/Aeterlux-SaaS-Pricing-Final.pptx'));
const s=p.resolve('sl/y90nupkv');
// Preserve the reference brand and three capsule shapes; replace the pricing contents.
for(const a of [...s.shapes.items]) if(a.name!=='brand'&&!a.name.startsWith('capsule-')) s.shapes.deleteById(a.id);
const red='#812D2A',ink='#282B29',muted='#74766F',green='#426147';
function text(name,str,x,y,w,h,size=28,color=ink,bold=false,align='left'){
 const a=s.shapes.add({name,geometry:'textbox',position:{left:x,top:y,width:w,height:h},fill:'none',line:{fill:'none',width:0}});
 a.text=str;a.text.style={typeface:'Microsoft JhengHei',fontSize:size,color,bold,alignment:align,verticalAlignment:'middle',autoFit:'none',insets:{left:0,right:0,top:0,bottom:0}};return a;
}
text('brand-subtitle','數位記憶燈塔',66,80,245,30,23,red);
text('title','收費模式與成本來源',415,38,800,80,52,red,true,'center');
text('proposal','商業模式提案',1300,42,235,34,23,muted,false,'right');
text('billing-heading','收費模式',64,149,220,40,29,red,true);
const xs=[64,580,1096],colors=['#656C63',green,red];
const content=[
 ['SaaS 訂閱','持續服務','AI 記憶對話與管理功能','每個塔位訂閱，家屬共用','內含基本使用額度'],
 ['Credits 計量','依用量扣點','文字按回覆，語音按生成秒數','額度用完，可主動加購','失敗與重播不扣生成點數'],
 ['永久封存','一次性收費','照片、錄音與分身素材','依新增封存量上傳 Arweave','已封存資料不收儲存月租']
];
for(let i=0;i<3;i++){
 const a=s.shapes.items.find(a=>a.name==='capsule-'+i);
 a.position.left=xs[i];a.position.top=204;a.position.width=440;a.position.height=330;a.borderRadius=64;
 const x=xs[i]+36,c=colors[i],words=content[i];
 text('mode-'+i,words[0],x,231,368,50,36,c,true);
 text('model-'+i,words[1],x,293,368,46,30,c,true);
 text('description-'+i,words[2],x,365,370,38,24,ink);
 text('meter-'+i,words[3],x,409,370,38,24,ink);
 text('rule-'+i,words[4],x,477,370,32,22,c,true);
}
text('storage-policy','停止訂閱後，已完成的永久封存仍保留。新增素材或版本另按量封存。',64,557,1472,42,25,ink);
text('cost-heading','成本來源（概估）',64,625,600,43,29,red,true);
const cx=[64,444,824,1204];
const costs=[
 ['本地設備','GPU 電腦、UPS 與備份','約 NT$25–30 萬／套','一次投入，逐月攤提'],
 ['Arweave 封存','按新增上傳量發生成本','約 NT$1,800–2,600／GiB','一次性，依即時報價'],
 ['電費與散熱','隨機器負載與電價變動','約 NT$1,500–6,000／月','單台電腦情境估算'],
 ['平台維運','網路、資料庫與備份等','約 NT$5,000–10,000／月','持續支出，不含人事']
];
for(let i=0;i<4;i++){
 const [a,b,c,d]=costs[i],x=cx[i];
 text('cost-name-'+i,a,x,687,352,39,29,green,true);
 text('cost-detail-'+i,b,x,733,352,32,23,muted);
 text('cost-range-'+i,c,x,777,360,37,25,green,true);
 text('cost-basis-'+i,d,x,820,352,29,21,muted);
}
text('footnote','單機試營運預算，非固定報價。設備不重複列為月支出，封存依新增量另計。詳細假設與試算見備註。',64,867,1472,23,17,muted);
s.speakerNotes.textFrame.setText(notes);
await fs.writeFile(work+'/output/Aeterlux-Billing-Model-Speaker-Notes.md',notes);
const candidate=tmp+'/candidate-business-model.pptx';
const final=work+'/output/Aeterlux-Billing-Model.pptx';
await (await PresentationFile.exportPptx(p)).save(candidate);
const result=await finalizePresentation({workspaceDir:work,candidatePath:candidate,finalPath:final,pythonExecutable:runtime+'/python/python.exe',integrityValidatorPath:skill+'/container_tools/inspect_presentation_package_integrity.py',layoutValidatorPath:skill+'/container_tools/inspect_presentation_layout_geometry.py',layoutArgs:['--expected-slide-size-emu','15240000,8572500','--validate-heading-fit'],explicitTotalSlideCount:1,requiredNativeTableOwnerSlides:[],requiredNativeChartOwnerSlides:[],fontPolicy:{basis:'design',families:['Microsoft JhengHei']},verifyArtifactToolImport:true,receiptPath:tmp+'/validation-business-model.json'});
const verified=await PresentationFile.importPptx(await FileBlob.load(final));
await fs.writeFile(work+'/output/Aeterlux-Billing-Model.png',new Uint8Array(await (await verified.export({slide:verified.slides.items[0],format:'png',scale:1})).arrayBuffer()));
await fs.writeFile(tmp+'/business-model.layout.json',await(await verified.slides.items[0].export({format:'layout'})).text());
console.log(JSON.stringify({finalPath:result.finalPath,package:result.packageIntegrity.status,layoutFindings:result.presentationLayout.finding_count,raw,archiveBudget}));
