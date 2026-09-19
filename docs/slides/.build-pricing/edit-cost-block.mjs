import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {PresentationFile,FileBlob} from '@oai/artifact-tool';
const work='C:/Users/kk865/OneDrive/Desktop/your-mama-is-dead/Your-Mama-IsDead/docs/slides';
const tmp=work+'/.build-pricing';
const skill='C:/Users/kk865/.codex/plugins/cache/openai-primary-runtime/presentations/26.905.11957/skills/presentations';
const runtime='C:/Users/kk865/.cache/codex-runtimes/codex-primary-runtime/dependencies';
process.env.RUNTIME_NODE_MODULES=runtime+'/node/node_modules';
const {finalizePresentation}=await import(pathToFileURL(skill+'/container_tools/artifact_tool_utils.mjs').href);
const p=await PresentationFile.importPptx(await FileBlob.load(work+'/output/Aeterlux-SaaS-Pricing.pptx'));
const s=p.resolve('sl/y90nupkv');
await fs.writeFile(tmp+'/cost-block-before.layout.json',await (await s.export({format:'layout'})).text());
for(const shape of s.shapes.items){
 if(shape.name.startsWith('plan-'))shape.position.top=228;
 if(shape.name.startsWith('price-'))shape.position.top=282;
 if(shape.name.startsWith('billing-'))shape.position.top=369;
 if(shape.name.startsWith('setup-'))shape.position.top=624;
 if(shape.name==='archive')shape.position.top=674;
 if(shape.name==='extra')shape.position.top=720;
}
p.resolve('tb/gjilgzmh').position.top=420;
function add(name,str,y,h,size,color,bold=false){
 const shape=s.shapes.add({name,geometry:'textbox',position:{left:64,top:y,width:1472,height:h},fill:'none',line:{fill:'none',width:0}});
 shape.text=str;
 shape.text.style={typeface:'Microsoft JhengHei',fontSize:size,color,bold,verticalAlignment:'middle',autoFit:'none',insets:{left:0,right:0,top:0,bottom:0}};
}
add('cost-heading','＊成本費用（估算）',770,29,24,'#812D2A',true);
add('cost-local','本地建置約 NT$27 萬（RTX 5090 整機、UPS 與備援），36 個月攤提約 NT$7,494／月。',802,28,23,'#426147');
add('cost-arweave','Arweave 約 NT$1,940／GiB，含緩衝預算約 NT$2,335／GiB（一次性，2026/09/15 查價）。',831,28,23,'#426147');
await fs.writeFile(tmp+'/cost-block-after.layout.json',await (await s.export({format:'layout'})).text());
const candidate=tmp+'/candidate-cost-block.pptx',final=work+'/output/Aeterlux-SaaS-Pricing-v2.pptx';
await (await PresentationFile.exportPptx(p)).save(candidate);
const result=await finalizePresentation({workspaceDir:work,candidatePath:candidate,finalPath:final,pythonExecutable:runtime+'/python/python.exe',integrityValidatorPath:skill+'/container_tools/inspect_presentation_package_integrity.py',layoutValidatorPath:skill+'/container_tools/inspect_presentation_layout_geometry.py',layoutArgs:['--expected-slide-size-emu','15240000,8572500','--validate-heading-fit','--require-native-table-slide','1'],explicitTotalSlideCount:1,requiredNativeTableOwnerSlides:[1],requiredNativeChartOwnerSlides:[],fontPolicy:{basis:'design',families:['Microsoft JhengHei']},verifyArtifactToolImport:true,receiptPath:tmp+'/validation-cost-block.json'});
console.log(JSON.stringify({finalPath:result.finalPath,package:result.packageIntegrity.status,layoutFindings:result.presentationLayout.finding_count}));
const verified=await PresentationFile.importPptx(await FileBlob.load(final));
await fs.writeFile(work+'/output/Aeterlux-SaaS-Pricing-v2.png',new Uint8Array(await (await verified.export({slide:verified.slides.items[0],format:'png',scale:1})).arrayBuffer()));
