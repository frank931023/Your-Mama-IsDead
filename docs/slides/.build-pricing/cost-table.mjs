import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {PresentationFile,FileBlob} from '@oai/artifact-tool';
const work='C:/Users/kk865/OneDrive/Desktop/your-mama-is-dead/Your-Mama-IsDead/docs/slides';
const tmp=work+'/.build-pricing';
const skill='C:/Users/kk865/.codex/plugins/cache/openai-primary-runtime/presentations/26.905.11957/skills/presentations';
const runtime='C:/Users/kk865/.cache/codex-runtimes/codex-primary-runtime/dependencies';
process.env.RUNTIME_NODE_MODULES=runtime+'/node/node_modules';
const {finalizePresentation}=await import(pathToFileURL(skill+'/container_tools/artifact_tool_utils.mjs').href);
const source=work+'/output/Aeterlux-Billing-Model-Sources.pptx';
const p=await PresentationFile.importPptx(await FileBlob.load(source));
console.log((await p.inspect({kind:'slide',maxChars:1000})).ndjson);
const s=p.resolve('sl/y90nupkv');
for(const a of [...s.shapes.items]) if(/^cost-(name|detail|range|basis|source)-/.test(a.name))s.shapes.deleteById(a.id);
const heading=s.shapes.items.find(a=>a.name==='cost-heading');
heading.position.top=609;heading.position.height=40;
const vals=[
 ['成本項目','概估區間（NT$）','支出方式','涵蓋內容／估算口徑','核對來源'],
 ['本地設備','25–30 萬／套','一次投入','GPU 電腦、UPS 與備份，逐月攤提','[1] 欣亞整機＋周邊預算'],
 ['Arweave 封存','1,800–2,600／GiB','一次性','按新增封存量，依即時報價','[2] Turbo 報價 API'],
 ['電費與散熱','1,500–6,000／月','每月支出','單台電腦，依負載與電價估算','[3] 台電制度＋功耗假設'],
 ['平台維運','5,000–10,000／月','每月支出','網路、資料庫、備份等，不含人事','[4] 內部預算拆解']
];
const table=s.tables.add({rows:5,columns:5,left:64,top:657,width:1472,height:205,columnWidths:[190,280,160,490,352],values:vals});
table.borders.assign({fill:'#D7DACE',width:1,style:'solid'});
table.cells.block({row:0,column:0,rowCount:5,columnCount:5}).assign({margins:{left:14,right:12,top:5,bottom:5},anchor:'center',textStyle:{typeface:'Microsoft JhengHei',fontSize:22,color:'#282B29'}});
for(let r=0;r<5;r++){
 table.rows[r].height=41;
 for(let c=0;c<5;c++){
  const cell=table.getCell(r,c);cell.fill=r===0?'#426147':r%2===1?'#EAF0E5':'#F4F2EB';
  cell.text.style={typeface:'Microsoft JhengHei',fontSize:c===3||c===4?21:22,color:r===0?'#FFFFFF':c===4?'#426B79':c===0||c===1?'#426147':'#282B29',bold:r===0||c===0||c===1,alignment:c===2?'center':'left'};
 }
}
const unlinked=tmp+'/candidate-cost-table-unlinked.pptx',candidate=tmp+'/candidate-cost-table.pptx';
const final=work+'/output/Aeterlux-Billing-Model-Cost-Table.pptx';
await(await PresentationFile.exportPptx(p)).save(unlinked);
execFileSync(runtime+'/python/python.exe',[tmp+'/cost-table-links.py',source,unlinked,candidate]);
const result=await finalizePresentation({workspaceDir:work,candidatePath:candidate,finalPath:final,pythonExecutable:runtime+'/python/python.exe',integrityValidatorPath:skill+'/container_tools/inspect_presentation_package_integrity.py',layoutValidatorPath:skill+'/container_tools/inspect_presentation_layout_geometry.py',layoutArgs:['--expected-slide-size-emu','15240000,8572500','--validate-heading-fit','--require-native-table-slide','1'],explicitTotalSlideCount:1,requiredNativeTableOwnerSlides:[1],requiredNativeChartOwnerSlides:[],fontPolicy:{basis:'design',families:['Microsoft JhengHei']},verifyArtifactToolImport:true,receiptPath:tmp+'/validation-cost-table.json'});
const v=await PresentationFile.importPptx(await FileBlob.load(final));
await fs.writeFile(work+'/output/Aeterlux-Billing-Model-Cost-Table.png',new Uint8Array(await(await v.export({slide:v.slides.items[0],format:'png',scale:1})).arrayBuffer()));
console.log(JSON.stringify({path:result.finalPath,layout:result.presentationLayout.finding_count}));
