/** Targeted synthetic audit; run after performance-probe, with other audit browsers closed.
 * node --import tsx docs/research/interaction-probe.mjs
 * Original product code and user files are unchanged. No external network is needed.
 */
import { chromium } from '@playwright/test';
import { createStaticServer } from '../../src/static-server.ts';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const server=createStaticServer({root:fileURLToPath(new URL('../../web-dist/',import.meta.url))});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}/`;
const browser=await chromium.launch({channel:'chrome'});
const output={observedAtUtc:new Date().toISOString(),browser:browser.version(),cpuRate:4,limitations:['Synthetic dense tiles and repeated imports; not typical user documents.','CDP metrics are page-target JavaScript/DOM, not total browser/worker/GPU memory.','Frame delays include headless scheduling and automation; no field INP claim.','Selection taskMsIncludingFinalGc includes the final diagnostic GC command; do not interpret it as gesture-only CPU cost.'],selection:[],retention:[]};
const rows=(n,dense=false)=>`<!doctype html><style>body{margin:24px;font:12px Arial}#tiles{${dense?'display:grid;grid-template-columns:repeat(25,16px);gap:2px;width:max-content;':''}}p{margin:0;height:${dense?16:24}px;${dense?'width:16px;font-size:8px;overflow:hidden;':''}}</style><section id="tiles">`+Array.from({length:n},(_,i)=>`<p id="row-${i}">${dense?i:'Planning row '+i}</p>`).join('')+'</section>';
async function opened(context){const page=await context.newPage();await page.goto(base);await page.waitForFunction(()=>document.querySelector('#file-empty').textContent.includes('HTML 가져오기'));const cdp=await context.newCDPSession(page);await cdp.send('Performance.enable');await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});return {page,cdp};}
async function importFile(page,source,name){await page.locator('#file-input').setInputFiles({name,mimeType:'text/html',buffer:Buffer.from(source)});await page.waitForFunction(name=>document.querySelector('#filename').textContent===name&&document.querySelector('#canvas').getAttribute('aria-busy')==='false',name);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));}
async function metrics(cdp){await cdp.send('HeapProfiler.collectGarbage');return Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(x=>[x.name,x.value]));}
try{
 for(const n of [100,1000])for(let rep=1;rep<=3;rep++){
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  try{const {page,cdp}=await opened(context);await importFile(page,rows(n,true),`dense-${n}.html`);
   const before=await metrics(cdp);const c=await page.locator('#canvas').boundingBox();const box=await page.frameLocator('#preview').locator('#tiles').boundingBox();
   await page.evaluate(()=>{window.__selectionStart=performance.now();window.__gaps=[];let last=performance.now();window.__recordFrames=true;const tick=()=>{const now=performance.now();window.__gaps.push(now-last);last=now;if(window.__recordFrames)requestAnimationFrame(tick);};requestAnimationFrame(tick);});
   await page.mouse.move(c.x+5,c.y+5);await page.mouse.down();await page.mouse.move(box.x+box.width+2,box.y+box.height+2,{steps:10});await page.mouse.up();
   await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   const selection=await page.evaluate(()=>{window.__recordFrames=false;return {selected:document.querySelector('#selection-count').textContent,outlines:document.querySelector('#multi-boxes').children.length,gestureMs:performance.now()-window.__selectionStart,maxFrameGapMs:Math.max(...window.__gaps),gaps:window.__gaps};});
   const after=await metrics(cdp);output.selection.push({n,rep,...selection,taskMsIncludingFinalGc:(after.TaskDuration-before.TaskDuration)*1000,layoutMs:(after.LayoutDuration-before.LayoutDuration)*1000,heapAfterGc:after.JSHeapUsedSize});
  }finally{await context.close();}
 }
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 try{const {page,cdp}=await opened(context);output.retention.push({iteration:0,...await metrics(cdp)});
  for(let i=1;i<=30;i++){await importFile(page,rows(2000),`document-${i}.html`);if([1,5,10,20,30].includes(i))output.retention.push({iteration:i,retainedFiles:await page.locator('#file-count').textContent(),...await metrics(cdp)});}
 }finally{await context.close();}
}catch(error){output.error=String(error);process.exitCode=1;}
finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));await writeFile(new URL('./interaction-results.json',import.meta.url),JSON.stringify(output,null,2)+'\n');}
console.log(JSON.stringify({selection:output.selection.map(({n,rep,selected,outlines,maxFrameGapMs,taskMsIncludingFinalGc})=>({n,rep,selected,outlines,maxFrameGapMs,taskMsIncludingFinalGc})),retention:output.retention.map(({iteration,retainedFiles,JSHeapUsedSize,Nodes})=>({iteration,retainedFiles,JSHeapUsedSize,Nodes})),error:output.error},null,2));
