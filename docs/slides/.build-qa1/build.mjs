import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {Presentation, PresentationFile, FileBlob} from '@oai/artifact-tool';

const root = 'C:/Users/kk865/OneDrive/Desktop/your-mama-is-dead/Your-Mama-IsDead';
const work = root + '/docs/slides';
const tmp = work + '/.build-qa1';
const skill = 'C:/Users/kk865/.codex/plugins/cache/openai-primary-runtime/presentations/26.905.11957/skills/presentations';
const runtime = 'C:/Users/kk865/.cache/codex-runtimes/codex-primary-runtime/dependencies';
process.env.RUNTIME_NODE_MODULES = runtime + '/node/node_modules';
const {finalizePresentation} = await import(pathToFileURL(skill + '/container_tools/artifact_tool_utils.mjs').href);
const font = 'Microsoft JhengHei';
const c = {bg:'#F4F2EB', red:'#812D2A', ink:'#282B29', muted:'#676B63', sage:'#E2EBDD', green:'#426147', peach:'#F7E5D8', line:'#D4D2C8'};
const p = Presentation.create({slideSize:{width:1600,height:900}});
const s = p.slides.add();
s.background.fill = c.bg;
function text(name, str, x,y,w,h,size=30,color=c.ink,bold=false,align='left'){
 const o=s.shapes.add({name,geometry:'textbox',position:{left:x,top:y,width:w,height:h},fill:'none',line:{fill:'none',width:0}});
 o.text=str;
 o.text.style={typeface:font,fontSize:size,color,bold,alignment:align,verticalAlignment:'middle',autoFit:'none',insets:{left:0,right:0,top:0,bottom:0}};
 return o;
}
function node(name,x,y,w,h,fill,stroke){return s.shapes.add({name,geometry:'rect',position:{left:x,top:y,width:w,height:h},fill,line:{fill:stroke,width:1.5}});}
function connect(a,b,color){return s.shapes.connect(a,b,{kind:'elbow',fromSide:'right',toSide:'left',line:{fill:color,width:3},tail:{type:'triangle',width:'med',length:'med'}});}

text('brand','AETERLUX',64,36,380,44,34,c.red,true);
text('page','QA 01　架構設計',1180,40,356,34,22,c.muted,false,'right');
text('title','NFT 只存地址：資料怎麼被找到',64,100,1472,75,56,c.red,true);
text('summary','鏈上記錄持有權與檔案地址，公開介紹與加密素材各走一條路。',66,183,1470,52,31,c.ink);

text('diagram-title','一顆 NFT，兩條資料路徑',64,269,710,46,34,c.red,true);
const nft=node('NFT',64,413,215,158,c.bg,c.red);
text('nft-name','塔位 NFT',84,435,175,44,35,c.red,true,'center');
text('nft-id','tokenId 42',82,487,179,40,27,c.ink,false,'center');
const pub=node('public-metadata',430,332,320,140,c.sage,c.sage);
const priv=node('encrypted-manifest',430,526,320,140,c.peach,c.peach);
connect(nft,pub,c.green);
connect(nft,priv,c.red);
text('token-uri','tokenURI',289,350,140,36,25,c.green,true);
text('artifact-uri','artifactURI',283,550,145,36,24,c.red,true);
text('public-title','公開 metadata',450,344,280,46,31,c.green,true);
text('public-content','介紹與大頭照的位置',450,394,280,34,26,c.ink);
text('public-access','任何人可讀',450,432,280,30,23,c.green);
text('private-title','私密素材索引',450,541,280,43,31,c.red,true);
text('private-content','列出各個密文的位置',450,590,280,33,26,c.ink);
text('private-access','持有 NFT 才能解密素材',450,630,288,30,23,c.red);
text('chain-details','另記錄擁有者\n與家族關係',64,600,212,74,23,c.muted);
text('table-title','公開與加密資料分類',828,269,708,46,34,c.red,true);

const values=[['類別','內容','保存方式'],['公開介紹','姓名、生卒、籍貫\n簡介與公開大頭照','明文\ntokenURI'],['私密素材','相簿、影片、錄音\n日記與對話紀錄','加密\nartifactURI'],['分身產物','3D 頭像\n聲音參考','加密\nartifactURI'],['互動資料','公祭留言、邀請碼\n可見度設定','一般資料庫\n依需求保護']];
const table=s.tables.add({rows:5,columns:3,left:828,top:332,width:708,height:334,columnWidths:[134,350,224],values});
table.borders.assign({fill:c.line,width:1,style:'solid'});
table.cells.block({row:0,column:0,rowCount:5,columnCount:3}).assign({textStyle:{typeface:font,fontSize:24,color:c.ink},margins:{left:15,right:10,top:8,bottom:8},anchor:'center'});
for(let r=0;r<5;r++){
 table.rows[r].height = r===0?46:72;
 for(let col=0;col<3;col++){
  const cell=table.getCell(r,col);
  cell.fill=r===0?c.red:r===1?'#EDF1E8':r<4?'#F9EEE5':c.bg;
  cell.text.style={typeface:font,fontSize:r===0?24:23,color:r===0?'#FFFFFF':c.ink,bold:r===0||col===0};
 }
}

text('lookup-title','找一張大頭照',64,719,257,43,30,c.red,true);
const steps=[['tokenId 42',346,177],['tokenURI',580,170],['metadata.json',807,238],['image 欄位',1102,196],['大頭照',1355,176]];
const boxes=steps.map(([str,x,w],i)=>text('lookup-'+i,str,x,720,w,42,27,c.ink,i===0));
for(let i=0;i<boxes.length-1;i++)s.shapes.connect(boxes[i],boxes[i+1],{kind:'straight',fromSide:'right',toSide:'left',line:{fill:c.muted,width:2},tail:{type:'triangle'}});
text('reason','大檔案放 Arweave，鏈上保存地址，降低鏈上儲存成本。',64,790,1470,43,30,c.ink,true);
text('source','來源：architecture-qa-4pages.md 第 1 頁；ERC-721、ERC-6150',64,853,1470,25,18,c.muted);

const md=await fs.readFile(root+'/docs/architecture-qa-4pages.md','utf8');
const section=md.slice(md.indexOf('# 第 1 頁'),md.indexOf('# 第 2 頁'));
s.speakerNotes.textFrame.setText(`主題：NFT 只存地址，資料怎麼被找到\n\n講解順序：先說明 NFT 的 tokenId 是識別編號，兩個 URI 指向鏈外資料。公開 metadata 列介紹和照片位置，私密素材索引列加密檔案的位置。接著指向分類表，最後走一次大頭照讀取流程。\n\n本頁依來源呈現目標架構。NFT 同時記錄擁有者與家族關係，不能把「只存地址」理解為整份合約只有兩個欄位。鏈上紀錄可追溯指標與持有權，本身不驗證上傳生平的真實性。\n\n評審追問：\n照片存在 NFT 裡嗎？檔案在鏈外儲存，NFT 記錄地址。\n為什麼不全部加密？家屬同意公開的介紹用於公開追思，私密素材另行加密。\n家族關係怎麼表示？以 parentOf、childrenOf 記錄 NFT 間的父子關係。\n地址相同但檔案被替換？依來源的 Arweave 設計，新內容對應新 ID。\n\n來源：\nhttps://eips.ethereum.org/EIPS/eip-721\nhttps://eips.ethereum.org/EIPS/eip-6150\n\n原始 Markdown（含完整細節、分類、評審追問與引用）：\n${section}`);
const candidate=tmp+'/candidate-v2.pptx';
await (await PresentationFile.exportPptx(p)).save(candidate);
console.log('draft exported');
const img=await p.export({slide:s,format:'png',scale:1});
await fs.writeFile(tmp+'/preview.png',new Uint8Array(await img.arrayBuffer()));
console.log('preview exported');
const final=work+'/output/Aeterlux-QA01-NFT-v2.pptx';
const result=await finalizePresentation({workspaceDir:work,candidatePath:candidate,finalPath:final,pythonExecutable:runtime+'/python/python.exe',integrityValidatorPath:skill+'/container_tools/inspect_presentation_package_integrity.py',layoutValidatorPath:skill+'/container_tools/inspect_presentation_layout_geometry.py',layoutArgs:['--expected-slide-size-emu','15240000,8572500','--validate-bullet-geometry','--validate-heading-fit','--require-native-table-slide','1'],explicitTotalSlideCount:1,requiredNativeTableOwnerSlides:[1],requiredNativeChartOwnerSlides:[],fontPolicy:{basis:'design',families:[font]},verifyArtifactToolImport:true,receiptPath:tmp+'/validation-v2.json'});
console.log(JSON.stringify(result));
const finalPres=await PresentationFile.importPptx(await FileBlob.load(final));
const finalImg=await finalPres.export({slide:finalPres.slides.items[0],format:'png',scale:1});
await fs.writeFile(work+'/output/Aeterlux-QA01-NFT-v2.png',new Uint8Array(await finalImg.arrayBuffer()));
console.log('final preview exported');

