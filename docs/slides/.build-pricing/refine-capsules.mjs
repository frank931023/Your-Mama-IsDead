import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {PresentationFile,FileBlob} from '@oai/artifact-tool';
const work='C:/Users/kk865/OneDrive/Desktop/your-mama-is-dead/Your-Mama-IsDead/docs/slides';
const tmp=work+'/.build-pricing';
const skill='C:/Users/kk865/.codex/plugins/cache/openai-primary-runtime/presentations/26.905.11957/skills/presentations';
const runtime='C:/Users/kk865/.cache/codex-runtimes/codex-primary-runtime/dependencies';
process.env.RUNTIME_NODE_MODULES=runtime+'/node/node_modules';
const {finalizePresentation}=await import(pathToFileURL(skill+'/container_tools/artifact_tool_utils.mjs').href);
const p=await PresentationFile.importPptx(await FileBlob.load(work+'/output/Aeterlux-SaaS-Pricing-Capsules-v2.pptx'));
console.log((await p.inspect({kind:'slide',maxChars:1000})).ndjson);
const s=p.resolve('sl/y90nupkv');
await fs.writeFile(tmp+'/refine-before.layout.json',await (await s.export({format:'layout'})).text());
const lefts=[64,580,1096],colors=['#656C63','#426147','#812D2A'];
for(const shape of [...s.shapes.items]){
 if(/^(plan|price|billing|setup|feature)-/.test(shape.name))s.shapes.deleteById(shape.id);
 if(shape.name.startsWith('capsule-')){
  shape.borderRadius=72;
  shape.position.top=234;shape.position.height=430;
 }
}
function text(name,str,x,y,w,h,size,color,bold=false,align='left'){
 const a=s.shapes.add({name,geometry:'textbox',position:{left:x,top:y,width:w,height:h},fill:'none',line:{fill:'none',width:0}});
 a.text=str;a.text.style={typeface:'Microsoft JhengHei',fontSize:size,color,bold,alignment:align,verticalAlignment:'middle',autoFit:'none',insets:{left:0,right:0,top:0,bottom:0}};
}
const lists=[
 ['公開追思頁、親友留言','基本照片與生平','100 MiB 素材空間','不含 AI 對話'],
 ['含公益追思功能','AI 文字 300 則／月','1 GiB 素材空間','邀請碼、回憶審核'],
 ['含記憶對話管理功能','AI 文字 600 則／月','本人聲音＋3D 頭像','語音 60 分／月、5 GiB 空間']
];
for(let i=0;i<3;i++){
 const x=lefts[i],color=colors[i];
 text('plan-'+i,['公益追思','記憶對話','聲影陪伴'][i],x+38,258,364,45,34,color,true);
 text('currency-'+i,'NT$',x+38,319,54,39,26,color,true);
 text('price-'+i,['0','299','899'][i],x+100,305,236,70,62,color,true);
 text('billing-'+i,['免費使用','每月／每位逝者','每月／每位逝者'][i],x+38,375,364,29,22,'#74766F');
 s.shapes.add({name:'divider-'+i,geometry:'line',position:{left:x+38,top:419,width:364,height:0},fill:'none',line:{fill:i===2?'#D5B8A7':i===1?'#BCCCB7':'#C8CBC1',width:1}});
 for(let j=0;j<4;j++){
  const excluded=i===0&&j===3;
  text(`check-${i}-${j}`,excluded?'−':'✓',x+38,435+j*38,23,31,22,excluded?'#92958D':color,true);
  text(`feature-${i}-${j}`,lists[i][j],x+71,435+j*38,337,31,23,excluded?'#92958D':'#282B29',i>0&&j===1);
 }
 s.shapes.add({name:'footer-divider-'+i,geometry:'line',position:{left:x+38,top:595,width:364,height:0},fill:'none',line:{fill:i===2?'#D5B8A7':i===1?'#BCCCB7':'#C8CBC1',width:1}});
 text('setup-label-'+i,'首次建置',x+38,610,112,31,21,'#74766F');
 text('setup-'+i,i===2?'NT$1,990':'免費',x+154,608,248,34,25,color,true,'right');
}
const candidate=tmp+'/candidate-refined.pptx',final=work+'/output/Aeterlux-SaaS-Pricing-Refined.pptx';
await (await PresentationFile.exportPptx(p)).save(candidate);
const result=await finalizePresentation({workspaceDir:work,candidatePath:candidate,finalPath:final,pythonExecutable:runtime+'/python/python.exe',integrityValidatorPath:skill+'/container_tools/inspect_presentation_package_integrity.py',layoutValidatorPath:skill+'/container_tools/inspect_presentation_layout_geometry.py',layoutArgs:['--expected-slide-size-emu','15240000,8572500','--validate-heading-fit'],explicitTotalSlideCount:1,requiredNativeTableOwnerSlides:[],requiredNativeChartOwnerSlides:[],fontPolicy:{basis:'design',families:['Microsoft JhengHei']},verifyArtifactToolImport:true,receiptPath:tmp+'/validation-refined.json'});
console.log(JSON.stringify({finalPath:result.finalPath,package:result.packageIntegrity.status,layoutFindings:result.presentationLayout.finding_count}));
const verified=await PresentationFile.importPptx(await FileBlob.load(final));
await fs.writeFile(work+'/output/Aeterlux-SaaS-Pricing-Refined.png',new Uint8Array(await (await verified.export({slide:verified.slides.items[0],format:'png',scale:1})).arrayBuffer()));
