import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {Presentation, PresentationFile, FileBlob} from '@oai/artifact-tool';
const root='C:/Users/kk865/OneDrive/Desktop/your-mama-is-dead/Your-Mama-IsDead';
const work=root+'/docs/slides', tmp=work+'/.build-pricing';
const skill='C:/Users/kk865/.codex/plugins/cache/openai-primary-runtime/presentations/26.905.11957/skills/presentations';
const runtime='C:/Users/kk865/.cache/codex-runtimes/codex-primary-runtime/dependencies';
process.env.RUNTIME_NODE_MODULES=runtime+'/node/node_modules';
const {finalizePresentation}=await import(pathToFileURL(skill+'/container_tools/artifact_tool_utils.mjs').href);
const q=JSON.parse((await fs.readFile(tmp+'/turbo-quote.json','utf8')).replace(/^\uFEFF/,''));
const usd=Number(q.oneGiB.winc)/Number(q.rates.winc)*q.rates.fiat.usd;
const fx=32, raw=usd*fx, archiveBudget=Math.ceil((raw+5)*1.2);
const capex=249800+10000+6000+4000;
const depreciation=capex/36, idle=.15*730*5*1.2;
const fixed=depreciation+idle+1200+1800+1000+2000+1500;
const fee=p=>p*.03+1;
const stdHours=300*2/3600, premiumHours=600*2/3600+60*3.5/60;
const stdVariable=stdHours*4.5+20+fee(299);
const premiumVariable=premiumHours*4.5+30+40+fee(899);
const stdContribution=299/1.05-stdVariable, premiumContribution=899/1.05-premiumVariable;
const weighted=.6*stdContribution+.4*premiumContribution;
const extraServer=depreciation+idle+1000;
const archiveCost=archiveBudget+600+150+100+fee(4990)+200;
const extraArchiveCost=archiveBudget+100+50+fee(3490);
const setupCost=600+4.5/6+50+fee(1990)+200;
const n=v=>v.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const notes=`Aeterlux SaaS 收費提案｜成本與定價模型
估算日期：2026-09-15（Asia/Taipei）。以下是試營運方案，並非現有產品已上線的價格或付費功能。幣別新臺幣。標價含稅；模型假設用售價／1.05估不含營業稅收入，採保守成本口徑，不計可扣抵進項稅。未扣所得稅，不是完整財務報表。

一、為什麼這樣收費
沿用專案原有的免費追思、標準文字 AI、進階聲音與 3D 三層概念。每位逝者算一份訂閱，家屬共用該塔位的額度，親友來訪不另外收人頭費。免費追思降低初次使用門檻；NT$299 負擔 RAG、語言模型與平台管理；NT$899 支付聲音與動作推理及较高客服需求。一次性分身建置費與永久儲存費各自對應一次性工作，不以新客封存費補貼無上限、終身 AI 算力。
價格屬成本導向的起始假說，尚未經付費意願訪談、轉換率或留存實驗驗證。先以小規模試營運觀察使用，再調整新增合約。

二、方案與計量規則
1. 公益追思：NT$0；一個公開追思頁、親友留言、生平及基本照片；100 MiB 一般素材空間。不含 AI、NFT 鑄造或 Arweave 永久封存。免費不等於平台零成本。
2. 記憶對話：NT$299／月／逝者，按月付款；含免費版功能、AI 文字 300 則／月、1 GiB 一般素材空間、邀請碼與回憶審核。免建置費，資料由使用者自行整理上傳。
3. 聲影陪伴：NT$899／月／逝者，按月付款；含標準版管理功能，AI 文字額度提高至600則／月，5 GiB 一般素材空間，本人聲音與3D頭像互動，AI生成音訊60分鐘／月。首次建置NT$1,990／逝者，含一張正面照建頭像、一段合格錄音登記、一次驗收和一次重試。此費不含永久封存。進階版可規劃3D靈堂體驗，但不承諾專人主持、無限多人影音房或 LiveKit 媒體費。
4. 一則指一次成功生成的AI回覆，重試失敗不扣額度；每則上限300個輸出token、總上下文上限8K token，作為成本模型假設。語音回覆也計入600則文字額度。60分鐘按成功生成的音訊秒數累加，非使用者觀看時長；同份音訊重播不重扣，重新生成算新的使用量。單段最多60秒。每月額度重置、不累積。每塔位同時一個AI會話，伺服器壅塞時排隊。
5. 使用者輸入語音辨識另含60分鐘／月，避免輸入極長錄音形成不受控成本。加購30分鐘包NT$199，同時追加30分鐘音訊生成、30分鐘輸入辨識與最多300則回覆額度；限同一結算月用完。達上限先提示選購，不自動超額扣款。
6. 一般素材空間是平台運作期間的可更新儲存，不是每月可新增相同量的永久儲存。月費取消後AI停用，已付費永久封存的資料仍依儲存協議存在，NFT不因欠月費而被撤回；免費追思頁依平台營運政策提供，不把鏈上保存與平台網站終身可用混為一談。免費版降級可先提供30天匯出窗口，超額一般素材的保存期限須在正式條款明列。

三、本地設備購入成本（資本支出）
本repo部署文件指定RTX5090 32GB；這裡用目前可查到的同級整機價格估重置成本，不宣稱是團隊原始購買發票。
可查通路標价：欣亞 MSI MEG Vision X AI 2NVZ9-016TW，Core Ultra 9-285K／RTX5090 32GB／DDR5 64GB／2TB SSD／1200W電源／Windows 11 Pro，頁面NT$249,800。頁面顯示貨到通知，價格可作參考但不代表現貨。整機已含CPU、RAM、SSD、機殼、散熱與電源，不再重複加計顯卡。
設備預算：整機249,800＋UPS 10,000＋外接備份碟6,000＋網路設備4,000＝NT$269,800。後三項是規劃預算，不是廠商報價。不含辦公室、第二台容錯機、額外冷氣裝機。
直線攤提假設36個月、殘值0：269,800／36＝NT$${n(depreciation)}／月。帳上採此折舊時，不再把同筆購入款全額列每月成本；啟動現金仍需先準備269,800。若设备已经买好，现金增支较低，但更换准备金不应视为0。
來源：https://www.sinya.com.tw/prod/214584
規格交叉參考：https://www.nvidia.com/zh-tw/geforce/graphics-cards/50-series/rtx-5090/

四、電費與每分鐘推理成本
所有功耗為待電表量測的假設，不把1200W電源額定功率當耗電量。模型假設整機待機0.15kW、推理滿載0.90kW，每月730小時，冷卻與供電額外20%，規劃電價NT$5／kWh。台電實際按用戶別、用量和季節分級，5元只是預算單價，不是宣稱適用固定費率。
基礎待機電費＝0.15×730×5×1.2＝NT$${n(idle)}／月。
增量忙碌電費＝(0.90−0.15)×5×1.2＝NT$4.50／GPU忙碌小時。待機已列固定成本，變動成本只加功耗差，避免重複。
若整月满载，電費上限情境＝0.90×730×5×1.2＝NT$3,942。每度7元時，同式為5,518.80，實際依電表及帳單。
本地 SERVER.md 記載 IndexTTS2 RTF約2.7，LAM單照建置約100秒，並提醒模型同時載入時顯存接近滿載。這是專案文件數據，本次未重測。為算容量，語音＋動作合成採3.5 GPU分鐘／1分鐘生成音訊，另加每次LLM文字回覆2秒忙碌時間。2秒是假設，不能由首token100ms直接推成完整回覆耗時。
標準版滿額GPU時間＝300×2／3600＝${n(stdHours)}小時／月；增量電費NT$${n(stdHours*4.5)}。
進階版滿額GPU時間＝600×2／3600＋60×3.5／60＝${n(premiumHours)}小時／月；增量電費NT$${n(premiumHours*4.5)}。
語音辨識预算NT$0.50／輸入分鐘，60分鐘＝30元／進階戶／月。這是包含網路、供應商費率波動的預留，不是OpenAI報價；目前程式可能走外部轉錄API，不能視為自架所以全免費。若改本地轉錄，應移除API預留並補入GPU時數。
電價參考：https://www.taipower.com.tw/media/05klpxyd/1140930_114%E5%B9%B410%E6%9C%88%E9%9B%BB%E5%83%B9%E5%85%AC%E5%91%8A.pdf?mediaDL=true
本地資料：docs/server/SERVER.md 第11、12節；backend/src/cloud-persona.ts 的轉錄流程。

五、Arweave 永久儲存成本與定價
使用repo已存在的ArDrive Turbo連接Arweave作計價基準，未採未實作的Irys driver報價。1 GiB＝1,073,741,824 bytes；1 MiB＝1,048,576 bytes，不與十進位GB混用。
報價擷取：${q.checkedAt}。GET https://payment.ardrive.io/v1/rates 得每GiB WINC=${q.rates.winc}，fiat.usd=${q.rates.fiat.usd}；GET https://payment.ardrive.io/v1/price/bytes/1073741824 得1GiB單一data item WINC=${q.oneGiB.winc}。
依官方SDK公式：USD成本＝bytes報價WINC／每GiB WINC×每GiB USD。代入為US$${usd.toFixed(6)}，依SDK向上取兩位小數約US$${(Math.ceil(usd*100)/100).toFixed(2)}／GiB。這裡是美元，不是美分；/price/usd/金額這另一種端點才以美分輸入，不能混用。
規劃匯率USD/TWD＝32。台銀查詢頁當時可見即期賣出31.765，採32作估算，不宣稱實際扣款匯率。NT$${n(raw)}／GiB原始成本。
每個data item有額外小額處理成本，/rates 也回傳perDataItemFeeWinc=${q.rates.perDataItemFeeWinc}。上面單檔quote已含一項，不能重複加計；為一千個小檔以內的封存包再預留NT$5管理差額。含20%價格／匯率／重試緩衝：ceil[(${n(raw)}＋5)×1.20]＝NT$${archiveBudget}／GiB。實際大量檔案要依加密後每個檔案的簽名封裝大小逐檔查價，而非只看原檔大小。
不將小檔免費補貼當永久商業前提；官方免費層有大小及累計額度限制。更新的照片或新版本都會新增上傳成本，已封存的額度不是可以刪除後回收再用的硬碟空間。
本次單價偏高，因此不沿用舊文件的US$5或US$20範例值；購買時重新查詢、在確認付款前鎖定該筆報價，若成本超過這份假設20%以上就暫停原價新單、更新報價。既有已成功封存資料不因新價格變動補收月租。
來源：
https://docs.ar.io/sdks/turbo-sdk/turbounauthenticatedclient/
https://raw.githubusercontent.com/ardriveapp/turbo-sdk/main/packages/turbo-sdk/src/common/payment.ts
https://docs.ar.io/build/upload/turbo-credits
https://payment.ardrive.io/v1/rates
https://payment.ardrive.io/v1/price/bytes/1073741824
https://rate.bot.com.tw/xrt?Lang=zh-TW

六、一次性收入的成本拆解
A. 永久封存包 NT$4,990／逝者／首1GiB：包括素材封存、驗證、索引清單、NFT建立協助與交付取回說明，不包含聲音與3D建置（另計1,990）。依加密後實際上傳總量計配額。
保守成本＝Arweave預留${archiveBudget}＋人工整理1.5小時×400元=600＋鏈上交易預算150＋校驗交付100＋金流${n(fee(4990))}＋重做／售後預備200＝NT$${n(archiveCost)}。
4990／1.05−${n(archiveCost)}＝NT$${n(4990/1.05-archiveCost)}／單，為上述假設下的貢獻餘額，尚須支撐開發、獲客等費用。網路備份費與持續索引成本另在月費模型，不能說4990全是Arweave成本。
鏈上150元只是假設的測試營運預留，Sepolia測試幣不代表商用免費。正式部署的鏈、gas及交易筆數須另查，不足時在付款前報價。Lit並未接入主流程，商用前需補實作及實際供應商費用；此模型以每月RPC／金鑰服務預留承接，不聲稱平台已能保證只有家屬解密。
B. 追加封存 NT$3,490／GiB，按實際新增量向上到0.1GiB計費，單次最低0.1GiB，版本重傳算新增量。每GiB成本${archiveBudget}＋操作協助100＋校驗50＋金流${n(fee(3490))}＝NT$${n(extraArchiveCost)}，不含稅收入扣此成本餘額NT$${n(3490/1.05-extraArchiveCost)}。多GiB订单合併一次金流會略省手續費，本估計未計折扣。
C. 進階分身建置 NT$1,990：人工素材檢查／調整／驗收1.5小時×400＝600；建置及重試預留10分鐘GPU增量電費0.75；臨時輸出50；金流${n(fee(1990))}；修正預備200，合計NT$${n(setupCost)}。不含稅收入扣此成本餘額NT$${n(1990/1.05-setupCost)}。GPU設備折舊已在月固定成本，不在此重复算。需要人工修復老照片、多人去噪或重做新面容，另外評估；不承諾每種素材都能達同品質，無法驗收時按事前約定重試或退費。
D. 加購30分鐘 NT$199：保守另配300則回覆，GPU時間=(30×3.5／60＋300×2／3600)=1.9167小時，增量電费8.625；輸入辨識30×0.5=15；處理預留10；金流6.97，合計40.595。199／1.05−40.595＝NT$148.93／包，但還會占用可出售容量，不能因電费低便無限出售。

七、每月固定與變動成本
月固定：設備折舊${n(depreciation)}＋待機電费${n(idle)}＋網路1,200＋主站／DB／備份／CDN1,800＋RPC／Lit金鑰服務預留1,000＋維修預備2,000＋免費版營運預算1,500＝NT$${n(fixed)}。
除設備報價與電費公式外，其餘均為預算假設，未取得雲端、RPC、Lit等正式合約報價。免費池假設500戶，每戶平均3元／月，僅支應低流量文字照片追思；非無限影音。免費流量成長時提高此預算或以公益贊助支付。
金流查核：綠界一般賣家國內卡費率2.75%未稅，加5%手續費稅與每筆1元處理費。模型以售價×3%＋1向上預留，299→9.97、899→27.97。小額交易要注意最低5元規則；本模型各單價均高於門檻。正式定期扣款資格或特約年費需另外談合約，沒有藏在此假設裡。
標準戶每月變動成本：GPU增量電費${n(stdHours*4.5)}＋客服／通知／資料處理20＋金流${n(fee(299))}＝NT$${n(stdVariable)}。每戶貢獻＝299／1.05−${n(stdVariable)}＝${n(stdContribution)}。
進階戶每月變動成本：GPU增量電費${n(premiumHours*4.5)}＋輸入辨識30＋客服／資料處理40＋金流${n(fee(899))}＝NT$${n(premiumVariable)}。每戶貢獻＝899／1.05−${n(premiumVariable)}＝${n(premiumContribution)}。
金流來源：https://www.ecpay.com.tw/Business/payment_fees

八、100個付費塔位的損益與容量示例
假設標準60戶、進階40戶，500免費戶，全部用滿額度。月含稅收款＝60×299＋40×899＝53,900。不含稅收入＝51,333.33；變動成本＝60×${n(stdVariable)}＋40×${n(premiumVariable)}＝${n(60*stdVariable+40*premiumVariable)}；固定成本${n(fixed)}；扣除後餘額NT$${n(100*weighted-fixed)}。這不是淨利，尚未扣人事、研发、獲客、辦公室租金、法務與所得稅，也未把一次性收入當固定經常收入。
在60/40組合下，單戶平均贡献=${n(weighted)}；基礎維運損益兩平＝ceil(${n(fixed)}／${n(weighted)})＝${Math.ceil(fixed/weighted)}個付費塔位。這只代表可覆蓋本表成本，不代表公司養得起團隊。
若再加每月人事／開發／行銷預算100,000，單機紙上需${Math.ceil((fixed+100000)/weighted)}戶；但滿額GPU需求會超過下述保守容量，不能把紙上數字直接當可實現獲利。
容量：標準60×${n(stdHours)}＋進階40×${n(premiumHours)}＝${n(60*stdHours+40*premiumHours)} GPU忙碌小時／月。單機規劃730×40%=292可出售小時，其他時間留尖峰、維護、空閒與新分身建置，使用率不是保證併發能力。100戶在月總量上容納得下，但需要限流與排隊驗證尖峰。原架構TTS RTF2.7意味着生成比播放慢，不能宣稱低延遲無限即時對話。
若仍是60/40且全部用滿，一台只規劃約floor[292／(0.6×${n(stdHours)}＋0.4×${n(premiumHours)})]=178戶，建置工作另占容量，因此實務門檻更低。
擴為兩台，每月多計第二台同級設備折舊${n(depreciation)}＋待機${n(idle)}＋維修預備1,000＝${n(extraServer)}。加100,000元人事後損益兩平＝ceil[(${n(fixed)}＋${n(extraServer)}＋100,000)／${n(weighted)}]＝${Math.ceil((fixed+extraServer+100000)/weighted)}付費塔位。兩台保守容量584小時，該戶數約${n(Math.ceil((fixed+extraServer+100000)/weighted)*(.6*stdHours+.4*premiumHours))}小時；仍須實测併發、排程、備援與雲端流量。這個例子說明擴客同時需要擴容。

九、敏感度與正式營運前要補的成本
Arweave漲50%：成本由${n(raw)}增至${n(raw*1.5)}／GiB，會吃掉封存加購利潤，需動態報價，不能鎖死終身新增空間。
僅20付費戶且仍維持500免費戶：20×${n(weighted)}−${n(fixed)}＝NT$${n(20*weighted-fixed)}／月，需要啟動資金。設備269,800加三個月固定營運現金（扣非現金折舊）約NT$${n(capex+3*(fixed-depreciation))}；不含生活薪資、正式安全實作與開發支出。
若GPU語音效率由3.5變成7分钟／輸出分鐘，語音容量约減半，須縮減銷售量或加機，不能只加幾元電費就算解決。
未報價項：模型和FLAME等素材商業授權、正式Lit網路费用、MPC登入、主網gas、大量影片流量、LiveKit多人影音、資安測試、備援主機、支付合約費、客服超量及正式部署工時。這些必須在商用前確認，不因模型開源或設備自有就記為零。月費是試營運提案，正式發布需用上述結果重算。
本頁價格透明列額度，無自動超額收費；以可持續運作支撐免費追思，避免以情緒壓力促銷。
`;
await fs.writeFile(tmp+'/speaker-notes.txt',notes);
await fs.writeFile(tmp+'/cost-model.json',JSON.stringify({usd,raw,archiveBudget,capex,depreciation,idle,fixed,stdHours,premiumHours,stdVariable,premiumVariable,stdContribution,premiumContribution,weighted,extraServer,archiveCost,extraArchiveCost,setupCost},null,2));

const p=Presentation.create({slideSize:{width:1600,height:900}}), s=p.slides.add();
const font='Microsoft JhengHei', bg='#F4F2EB', red='#812D2A', ink='#282B29', muted='#74766F', green='#426147';
s.background.fill=bg;
function text(name,str,x,y,w,h,size=30,color=ink,bold=false,align='left'){
 const shape=s.shapes.add({name,geometry:'textbox',position:{left:x,top:y,width:w,height:h},fill:'none',line:{fill:'none',width:0}});
 shape.text=str;shape.text.style={typeface:font,fontSize:size,color,bold,alignment:align,verticalAlignment:'middle',autoFit:'none',insets:{left:0,right:0,top:0,bottom:0}};return shape;
}
text('brand','AETERLUX',64,30,400,44,34,red,true);
text('proposal','SaaS 收費提案',1130,33,406,38,24,muted,false,'right');
text('title','免費追思，依需求開啟 AI 陪伴',64,93,1472,78,56,red,true);
text('subtitle','月費支付持續互動與維運，分身建置及永久封存採一次性收費。',66,176,1470,48,30,ink);

const xs=[80,582,1084], colors=[muted,green,red];
['公益追思','記憶對話','聲影陪伴'].forEach((name,i)=>text('plan-'+i,name,xs[i],266,436,51,37,colors[i],true,'center'));
['NT$0','NT$299','NT$899'].forEach((price,i)=>text('price-'+i,price,xs[i],327,436,89,67,colors[i],true,'center'));
['免費使用','每月／每位逝者','每月／每位逝者'].forEach((str,i)=>text('billing-'+i,str,xs[i],422,436,36,25,muted,false,'center'));
const vals=[['公開追思頁、親友留言','含免費版追思功能','含標準版管理功能'],['100 MiB 素材空間','AI 文字 300 則／月','AI 文字 600 則／月'],['基本照片與生平','1 GiB 素材空間','本人聲音＋3D 頭像'],['不含 AI 對話','邀請碼、回憶審核','語音 60 分／月、5 GiB 空間']];
const table=s.tables.add({rows:4,columns:3,left:48,top:481,width:1504,height:194,columnWidths:[501,502,501],values:vals});
table.borders.assign({fill:bg,width:0,style:'solid'});
table.cells.block({row:0,column:0,rowCount:4,columnCount:3}).assign({margins:{left:15,right:15,top:6,bottom:6},anchor:'center',textStyle:{typeface:font,fontSize:27,color:ink}});
for(let r=0;r<4;r++){table.rows[r].height=48.5;for(let j=0;j<3;j++){const cell=table.getCell(r,j);cell.fill=j===2?'#F5E5DB':bg;cell.text.style={typeface:font,fontSize:26,color:j===0&&r===3?muted:ink,alignment:'center',bold:r===1&&j>0};}}
['免建置費','免建置費','首次分身建置 NT$1,990'].forEach((str,i)=>text('setup-'+i,str,xs[i]-8,687,452,40,26,colors[i],i===2,'center'));
text('archive','永久封存選購　NT$4,990／首 1 GiB；追加 NT$3,490／GiB',64,758,1472,44,29,red,true);
text('extra','語音加購 NT$199／30 分鐘　　月費取消後，已完成的永久封存仍保留。',64,809,1472,38,26,ink);
text('terms','試營運建議價，均為新臺幣含稅。素材空間為一般儲存；語音按成功生成音訊計量。成本假設與來源詳見備註。',64,861,1472,26,18,muted);
s.speakerNotes.textFrame.setText(notes);
const candidate=tmp+'/candidate.pptx', final=work+'/output/Aeterlux-SaaS-Pricing.pptx';
await (await PresentationFile.exportPptx(p)).save(candidate);
const preview=await p.export({slide:s,format:'png',scale:1});
await fs.writeFile(tmp+'/preview.png',new Uint8Array(await preview.arrayBuffer()));
console.log('draft and preview written');
const result=await finalizePresentation({workspaceDir:work,candidatePath:candidate,finalPath:final,pythonExecutable:runtime+'/python/python.exe',integrityValidatorPath:skill+'/container_tools/inspect_presentation_package_integrity.py',layoutValidatorPath:skill+'/container_tools/inspect_presentation_layout_geometry.py',layoutArgs:['--expected-slide-size-emu','15240000,8572500','--validate-heading-fit','--require-native-table-slide','1'],explicitTotalSlideCount:1,requiredNativeTableOwnerSlides:[1],requiredNativeChartOwnerSlides:[],fontPolicy:{basis:'design',families:[font]},verifyArtifactToolImport:true,receiptPath:tmp+'/validation.json'});
console.log(JSON.stringify({finalPath:result.finalPath,package:result.packageIntegrity.status,layoutFindings:result.presentationLayout.finding_count,notesCharacters:notes.length}));
const fp=await PresentationFile.importPptx(await FileBlob.load(final));
const finalPng=await fp.export({slide:fp.slides.items[0],format:'png',scale:1});
await fs.writeFile(work+'/output/Aeterlux-SaaS-Pricing.png',new Uint8Array(await finalPng.arrayBuffer()));
console.log('final preview written');
