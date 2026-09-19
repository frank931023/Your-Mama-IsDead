import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {PresentationFile,FileBlob} from '@oai/artifact-tool';
const work='C:/Users/kk865/OneDrive/Desktop/your-mama-is-dead/Your-Mama-IsDead/docs/slides';
const tmp=work+'/.build-pricing';
const skill='C:/Users/kk865/.codex/plugins/cache/openai-primary-runtime/presentations/26.905.11957/skills/presentations';
const runtime='C:/Users/kk865/.cache/codex-runtimes/codex-primary-runtime/dependencies';
process.env.RUNTIME_NODE_MODULES=runtime+'/node/node_modules';
const {finalizePresentation}=await import(pathToFileURL(skill+'/container_tools/artifact_tool_utils.mjs').href);
const p=await PresentationFile.importPptx(await FileBlob.load(work+'/output/Aeterlux-SaaS-Pricing-v2.pptx'));
const s=p.resolve('sl/y90nupkv');
s.tables.deleteById(p.resolve('tb/4nilkzmd').id);
const lefts=[64,580,1096],fills=['#E9E8E1','#E5EDDF','#F4E0D4'];
for(let i=0;i<3;i++){
 const capsule=s.shapes.add({name:'capsule-'+i,geometry:'roundRect',position:{left:lefts[i],top:226,width:440,height:430},borderRadius:180,fill:fills[i],line:{fill:'none',width:0}});
 capsule.sendToBack();
}
for(const shape of [...s.shapes.items]){
 const match=/^(plan|price|billing|setup)-(\d)$/.exec(shape.name);
 if(!match)continue;
 const i=Number(match[2]);
 const kind=match[1];
 const words={plan:['公益追思','記憶對話','聲影陪伴'],price:['NT$0','NT$299','NT$899'],billing:['免費使用','每月／每位逝者','每月／每位逝者'],setup:['免建置費','免建置費','首次分身建置 NT$1,990']}[kind][i];
 s.shapes.deleteById(shape.id);
 const replacement=s.shapes.add({name:kind+'-'+i,geometry:'textbox',position:{left:lefts[i]+30,top:{plan:243,price:294,billing:381,setup:591}[kind],width:380,height:{plan:51,price:89,billing:36,setup:40}[kind]},fill:'none',line:{fill:'none',width:0}});
 replacement.text=words;
 replacement.text.style={typeface:'Microsoft JhengHei',fontSize:{plan:37,price:67,billing:25,setup:24}[kind],color:kind==='billing'?'#74766F':['#74766F','#426147','#812D2A'][i],bold:kind==='price'||kind==='plan'||kind==='setup'&&i===2,alignment:'center',verticalAlignment:'middle',autoFit:'none',insets:{left:0,right:0,top:0,bottom:0}};
}
const features=[['公開追思頁、親友留言','100 MiB 素材空間','基本照片與生平','不含 AI 對話'],['含免費版追思功能','AI 文字 300 則／月','1 GiB 素材空間','邀請碼、回憶審核'],['含標準版管理功能','AI 文字 600 則／月','本人聲音＋3D 頭像','語音 60 分／月、5 GiB 空間']];
for(let i=0;i<3;i++)for(let j=0;j<4;j++){
 const text=s.shapes.add({name:`feature-${i}-${j}`,geometry:'textbox',position:{left:lefts[i]+35,top:429+j*37,width:370,height:34},fill:'none',line:{fill:'none',width:0}});
 text.text=features[i][j];
 text.text.style={typeface:'Microsoft JhengHei',fontSize:25,color:i===0&&j===3?'#74766F':'#282B29',bold:i>0&&j===1,alignment:'center',verticalAlignment:'middle',autoFit:'none',insets:{left:0,right:0,top:0,bottom:0}};
}
const candidate=tmp+'/candidate-capsules-final.pptx',final=work+'/output/Aeterlux-SaaS-Pricing-Capsules-v2.pptx';
await (await PresentationFile.exportPptx(p)).save(candidate);
const result=await finalizePresentation({workspaceDir:work,candidatePath:candidate,finalPath:final,pythonExecutable:runtime+'/python/python.exe',integrityValidatorPath:skill+'/container_tools/inspect_presentation_package_integrity.py',layoutValidatorPath:skill+'/container_tools/inspect_presentation_layout_geometry.py',layoutArgs:['--expected-slide-size-emu','15240000,8572500','--validate-heading-fit'],explicitTotalSlideCount:1,requiredNativeTableOwnerSlides:[],requiredNativeChartOwnerSlides:[],fontPolicy:{basis:'design',families:['Microsoft JhengHei']},verifyArtifactToolImport:true,receiptPath:tmp+'/validation-capsules-final.json'});
console.log(JSON.stringify({finalPath:result.finalPath,package:result.packageIntegrity.status,layoutFindings:result.presentationLayout.finding_count}));
const verified=await PresentationFile.importPptx(await FileBlob.load(final));
await fs.writeFile(work+'/output/Aeterlux-SaaS-Pricing-Capsules-v2.png',new Uint8Array(await (await verified.export({slide:verified.slides.items[0],format:'png',scale:1})).arrayBuffer()));
