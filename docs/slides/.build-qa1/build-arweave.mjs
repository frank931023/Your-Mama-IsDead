import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {Presentation,PresentationFile,FileBlob} from '@oai/artifact-tool';
const root='C:/Users/kk865/OneDrive/Desktop/your-mama-is-dead/Your-Mama-IsDead';
const work=root+'/docs/slides',tmp=work+'/.build-qa1';
const skill='C:/Users/kk865/.codex/plugins/cache/openai-primary-runtime/presentations/26.905.11957/skills/presentations';
const runtime='C:/Users/kk865/.cache/codex-runtimes/codex-primary-runtime/dependencies';
process.env.RUNTIME_NODE_MODULES=runtime+'/node/node_modules';
const {finalizePresentation}=await import(pathToFileURL(skill+'/container_tools/artifact_tool_utils.mjs').href);
const p=Presentation.create({slideSize:{width:1600,height:900}}),s=p.slides.add();
const c={bg:'#F4F2EB',red:'#812D2A',ink:'#282B29',muted:'#676B63',green:'#426147',sage:'#E2EBDD',peach:'#F7E5D8',line:'#D4D2C8'},font='Microsoft JhengHei';
s.background.fill=c.bg;
function text(name,str,x,y,w,h,size=28,color=c.ink,bold=false){
 const a=s.shapes.add({name,geometry:'textbox',position:{left:x,top:y,width:w,height:h},fill:'none',line:{fill:'none',width:0}});
 a.text=str;a.text.style={typeface:font,fontSize:size,color,bold,verticalAlignment:'middle',autoFit:'none',insets:{left:0,right:0,top:0,bottom:0}};return a;
}
function box(name,x,y,w,h,fill,line='none') {return s.shapes.add({name,geometry:'rect',position:{left:x,top:y,width:w,height:h},fill,line:{fill:line,width:line==='none'?0:1.5}});}
function arrow(a,b,color){s.shapes.connect(a,b,{kind:'straight',fromSide:'right',toSide:'left',line:{fill:color,width:3},tail:{type:'triangle',width:'med',length:'med'}});}
text('brand','AETERLUX',64,36,400,44,34,c.red,true);
text('page','QA 01　Arweave 正式版設計',1130,42,420,34,22,c.muted);
text('title','合約怎麼連到公開與私密資料？',64,101,1472,77,56,c.red,true);
text('summary','兩個 URI 指向 Arweave：公開介紹存明文，私密素材先加密再封存。',66,188,1470,47,30);
text('chain-heading','鏈上：DigitalTablet.sol',64,276,620,45,34,c.red,true);
text('storage-heading','Arweave：檔案本體與索引',754,276,782,45,34,c.red,true);
box('contract',64,335,516,351,c.bg,c.line);
text('token','塔位 NFT　tokenId 42',90,348,460,38,30,c.ink,true);
const pubPort=box('public-pointer',90,395,460,90,c.sage);
const privatePort=box('private-pointer',90,550,460,90,c.peach);
const pub=box('public-files',754,370,782,140,c.sage);
const priv=box('private-files',754,520,782,150,c.peach);
arrow(pubPort,pub,c.green);arrow(privatePort,priv,c.red);
text('pub-getter','tokenURI(42)',108,401,422,36,29,c.green,true);
text('pub-uri','ar://<metadata-TXID>',108,444,422,29,25,c.ink);
text('priv-getter','artifactURI(42)',108,555,422,36,29,c.red,true);
text('priv-uri','ar://<manifest-TXID>',108,598,422,29,25,c.ink);
text('public-route-label','公開路徑',603,392,138,29,23,c.green,true);
text('private-route-label','私密路徑',603,547,138,29,23,c.red,true);
text('owner-foot','另記錄 ownerOf 與 parentOf／childrenOf',90,650,470,25,20,c.muted);
text('public-title','公開 metadata.json',780,381,720,39,31,c.green,true);
text('public-content','姓名、生卒、籍貫、簡介與公開大頭照連結',780,427,720,33,27);
text('public-read','任何人可讀，image 欄位再指向 Arweave 上的照片',780,469,720,28,24,c.green);
text('private-title','manifest.json 索引與加密素材',780,532,720,39,31,c.red,true);
text('private-content','索引列密文 TXID 與解密條件，不放私密原文或金鑰',780,578,720,32,25);
text('private-types','相簿、錄音、對話紀錄、3D 頭像皆先加密再上傳',780,621,720,31,25,c.red);
text('edit-label','誰能更新地址？',64,721,300,36,29,c.red,true);
text('edit-rule','NFT 持有者或 MINTER_ROLE',64,764,660,36,28,c.ink,true);
text('edit-functions','setTokenURI()／setArtifactURI() 分開更新',64,805,660,30,24,c.muted);
text('privacy-label','地址公開，內容怎麼保密？',754,721,782,36,29,c.red,true);
text('privacy-rule','規劃由 Lit 驗證 ownerOf(42)＝請求者後解密',754,764,782,36,27,c.ink,true);
text('privacy-detail','合約只存地址與權限，private 宣告本身不會加密資料',754,805,782,30,23,c.muted);
text('status','依現有合約與 QA 規劃製作。雙 URI 與更新權限已實作，Lit 解密流程待整合。來源與講稿詳見備註。',64,858,1472,26,19,c.muted);
const notes=`QA 01：Arweave 版本，DigitalTablet 合約如何連到公開與私密資料

【30 秒講稿】
每位逝者對應一顆塔位 NFT。合約記錄持有者、家族關係，以及兩條互相獨立的地址。tokenURI 指向 Arweave 上的公開 metadata，包含家屬同意公開的姓名、生卒、簡介和大頭照連結；artifactURI 指向索引清單，記錄加密素材的位置及解密條件。照片、聲音、對話和分身檔案不塞進 EVM 合約，私密檔案在上傳前就要加密。兩個地址任何人都看得到，保密的是密文內容。正式版規劃用 Lit 檢查目前 NFT 持有者，通過後才協助解密。

【本頁依據與實作邊界】
這是 Arweave 正式版目標架構，沿用現有 DigitalTablet.sol 的真實介面，不是宣稱目前所有上傳已走 Arweave 或 Lit 已上線。現有合約只接受 URI 字串，不檢查 URI 是否為 ar://、不驗證檔案已上傳成功、不檢查內容是否加密，也不驗證生平真實性。原始合約註解將 artifactURI 定義為 AI 產物 manifest；此頁依 architecture-qa.md Q5 與 frank_docs 的目標設計，讓 manifest 同時索引私密原始素材與分身產物，需在應用層落實格式及流程。

【1. 合約究竟存什麼】
contracts/src/DigitalTablet.sol:31–35：
mapping(uint256 => string) private _tokenURIs;
mapping(uint256 => string) private _artifactURI;
兩個 mapping 用 tokenId 對應 URI 字串。tokenURI(42) 及 artifactURI(42) 是查詢函式，不是直接存檔的欄位。示意 ar://<metadata-TXID>、ar://<manifest-TXID> 為佔位符，非實際交易。
合約另以 ERC-721 ownerOf 表示持有者，以 parentOf、childrenOf 表示家族關係；不能把「只存地址」講成整份合約只有兩個欄位。

【2. 如何写入及更新】
mintRoot(address to, string tokenURI_)：只有 MINTER_ROLE 可鑄造根塔位，鑄造時設定 tokenURI。
safeMintWithParent(address to, uint256 parentId, string tokenURI_)：父 NFT 持有者或 MINTER_ROLE 可鑄造子塔位，並記錄父子關係。
artifactURI 初始為空字串，封存或建置流程準備好 manifest 後，再呼叫 setArtifactURI(tokenId, uri)。
setArtifactURI()（106–113 行）與 setTokenURI()（117–124 行）都先確認 token 存在，再檢查 msg.sender 等於 token 擁有者，或具有 MINTER_ROLE。兩者可分開更新，各自發出 ArtifactURIUpdated／TokenURIUpdated 事件。
不能說「只有家屬才能改地址」：MINTER_ROLE 也能修改。部署者在建構時取得 DEFAULT_ADMIN_ROLE 與 MINTER_ROLE；角色持有者需按實際部署確認。修改 URI 的權限與 Lit 解密權是不同機制，MINTER_ROLE 本身不等於有解密權。

【3. 公開路徑】
先將同意公開的照片上傳 Arweave，得到圖片 TXID；組成 metadata JSON，其 image 欄位指向該圖片；上傳 metadata 得到另一個 TXID，最後將 ar://<metadata-TXID> 寫入 tokenURI。
閱讀者查 tokenURI，透過 gateway 取得 JSON，再讀 image 取得照片。metadata 只放家屬同意公開的介紹，不可因欄位叫 metadata 就放入私密原文。

【4. 私密路徑】
本頁採 architecture-qa.md Q5 的非敏感 manifest 設計。原始素材及分身產物先在授權端加密，上傳 Arweave 後，各自取得密文 TXID。manifest 只列密文位置、必要格式資訊和解密條件，再上傳 Arweave，將 manifest 的 URI 寫入 artifactURI。manifest 本身可公開讀取，但不得含私密原文、可識別敏感檔名或明文解密金鑰。若未來索引需要敏感資訊，應加密索引，另外設計可取得的解密引導資訊。
公開、私密兩條路都可取得地址及儲存的位元組。私密路徑拿到的是密文，解密能力必須由密碼學和金鑰服務控制。
正式版規劃以 Lit 的存取條件驗證已簽名的請求者是否等於 ownerOf(tokenId)。此檢查不是 DigitalTablet 的 getter 內建功能。本次未主張 Lit 節點會交出網路主金鑰，也未主張合約直接加解密。

【5. 評審可能追問】
Q：Solidity 已經寫 private，不就保密了？
A：private 只是 Solidity 的程式存取範圍，鏈上儲存仍可被觀察。合約的兩個 getter 也都不限制讀取身分，所以私密素材要在上傳前加密。
Q：MINTER_ROLE 能改指標，平台就能解密嗎？
A：修改 URI 和解密是兩件事。現有合約給 minter 修改指標的權限；若 Lit 條件只授予 NFT 持有者，minter 身分本身不授予解密能力。這不能推論平台後端處理明文時也完全無法接觸內容，需以實際資料處理流程界定。
Q：資料更新怎麼辦？
A：新版本重新封存取得新 TXID，由有權者更新對應 URI。合約指標可改，已上傳的舊內容不因改指標消失。
Q：轉讓 NFT 後舊持有人還能看嗎？
A：若解密条件綁定當前 ownerOf，新持有人可獲得後續授權；但無法收回舊持有人先前已下載的明文或解密材料，不應承諾轉讓即可抹除既有副本。
Q：目前是否已完整上 Arweave？
A：backend/src/lib/arweave.ts 已有 ArDrive Turbo 上傳程式，uploads.ts 支援 IPFS 與 Arweave 雙寫，stories.ts 支援 Arweave 封存；目前 IPFS 仍是主要服務層，Turbo 未設定時停用，失敗不阻擋流程。storage/src/providers/irys.ts 仍是 stub。實作過程可採 Turbo，但這不等於原規劃的 Irys + Lit 全流程已完成。

【來源】
contracts/src/DigitalTablet.sol：16–35、59–124、149–157 行。
docs/contracts.md：Roles、Functions、Storage Layout。
docs/architecture-qa-4pages.md：第 1 頁。
docs/architecture-qa.md：Q2–Q5，特別是 Q5 非敏感 manifest 與 ownerOf 解密條件示意。
docs/frank_docs/02_系統架構.md：第 197–228 行，Arweave 正式儲存流程。
backend/src/lib/arweave.ts；backend/src/routes/uploads.ts:223；backend/src/routes/stories.ts:183；storage/src/providers/irys.ts。
Solidity 官方文件 Visibility and Getters：https://docs.soliditylang.org/en/latest/contracts.html#visibility-and-getters（2026-09-15 查閱），private/internal 不使鏈上資料保密。
`;
s.speakerNotes.textFrame.setText(notes);
await fs.writeFile(tmp+'/arweave-speaker-notes.txt',notes);
const candidate=tmp+'/candidate-arweave.pptx',final=work+'/output/Aeterlux-QA01-Arweave-Contract.pptx';
await (await PresentationFile.exportPptx(p)).save(candidate);
const result=await finalizePresentation({workspaceDir:work,candidatePath:candidate,finalPath:final,pythonExecutable:runtime+'/python/python.exe',integrityValidatorPath:skill+'/container_tools/inspect_presentation_package_integrity.py',layoutValidatorPath:skill+'/container_tools/inspect_presentation_layout_geometry.py',layoutArgs:['--expected-slide-size-emu','15240000,8572500','--validate-heading-fit'],explicitTotalSlideCount:1,requiredNativeTableOwnerSlides:[],requiredNativeChartOwnerSlides:[],fontPolicy:{basis:'design',families:[font]},verifyArtifactToolImport:true,receiptPath:tmp+'/validation-arweave.json'});
console.log(JSON.stringify({finalPath:result.finalPath,package:result.packageIntegrity.status,layoutFindings:result.presentationLayout.finding_count}));
const verified=await PresentationFile.importPptx(await FileBlob.load(final));
await fs.writeFile(work+'/output/Aeterlux-QA01-Arweave-Contract.png',new Uint8Array(await (await verified.export({slide:verified.slides.items[0],format:'png',scale:1})).arrayBuffer()));
