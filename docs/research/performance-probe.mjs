/** Local synthetic audit. Run: node --import tsx docs/research/performance-probe.mjs
 * Uses a fresh isolated Chrome context and a temporary loopback server per run.
 * Does not change application code, user files, or the user's browser profile.
 * Wall times and parent-target metrics are lab observations, not field INP/RSS.
 */
import { chromium } from '@playwright/test';
import { createStaticServer } from '../../src/static-server.ts';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const idleFollowup = process.argv.includes('--idle-followup');
const root = new URL('../../', import.meta.url);
const path = fileURLToPath(root);
const assets = [];
for (const name of (await readdir(new URL('web-dist/', root))).sort()) {
 const body = await readFile(new URL('web-dist/' + name, root));
 assets.push({name,bytes:body.length,gzipBytes:gzipSync(body).length,sha256:createHash('sha256').update(body).digest('hex')});
}
const sample = await readFile(new URL('fixtures/welcome.html', root),'utf8');
const rows = n => '<!doctype html><html><head><meta charset="utf-8"><style>body{margin:24px;font:16px Arial}p{height:28px;margin:0}</style></head><body><main>' + Array.from({length:n},(_,i)=>`<p id="row-${i}">Planning row ${i}</p>`).join('') + '</main></body></html>';
const fixtures = [{id:'sample',source:sample,target:'#hero-title',nodes:33}, {id:'rows-2000',source:rows(2000),target:'#row-0',nodes:2001}, {id:'rows-10000',source:rows(10000),target:'#row-0',nodes:10001}];
const result = {
 observedAtUtc:new Date().toISOString(),commit:execFileSync('git',['rev-parse','HEAD'],{cwd:path,encoding:'utf8'}).trim(),
 machine:{platform:os.platform(),release:os.release(),architecture:os.arch(),cpu:os.cpus()[0]?.model,logicalCpus:os.cpus().length,memoryBytes:os.totalmem()},
 assets,
 methodology:{repetitions:idleFollowup?1:3,cpuRates:idleFollowup?[1]:[1,4],viewport:{width:1440,height:1000},serviceWorkers:'allowed; await shell caching before document import',network:'loopback, uncompressed HTTP; no network throttling',
 timings:'Navigation start to usable empty UI; file input change to completed metadata/UI plus two animation frames; programmatic UI changes to two animation frames. These are lab task proxies, not field INP or human task completion.',
 memory:'Chrome Performance.getMetrics for page target before and after explicit GC; excludes separately measured worker, GPU/native image buffers and whole browser RSS. GC diagnostics are not normal user behavior.',
 limits:['One Apple Silicon machine; 4x CPU slowdown is not an actual low-end device.','Headless Chrome and synthetic static documents; no mobile/touch or real project representativeness implied.','Long tasks collected in parent window only; iframe/worker work can be omitted.','Runs are sequential with no other audit browser agents active; ordinary machine background work is uncontrolled.','Compressed sizes are calculated artifacts, not bytes sent by the current uncompressed static server.']},
 runs:[],errors:[]
};
const browser = await chromium.launch({channel:'chrome',headless:true});
result.browser=browser.version();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function metrics(cdp,gc=false){if(gc)await cdp.send('HeapProfiler.collectGarbage');return Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));}
async function twoFrames(page){await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));}
async function importSource(page,fixture,name){
 await page.evaluate(({source,name})=>{
  const input=document.querySelector('#file-input');const data=new DataTransfer();data.items.add(new File([source],name,{type:'text/html'}));input.files=data.files;
  window.__audit.importStarted=performance.now();input.dispatchEvent(new Event('change',{bubbles:true}));
 },{source:fixture.source,name});
 await page.waitForFunction(({name,nodes})=>document.querySelector('#filename').textContent===name && document.querySelector('#node-count').textContent===String(nodes) && document.querySelector('#canvas').getAttribute('aria-busy')==='false',{name,nodes:fixture.nodes},{timeout:30000});
 await twoFrames(page);
 return page.evaluate(()=>performance.now()-window.__audit.importStarted);
}
async function dispatchPaint(page,selector,type,value){return page.evaluate(async({selector,type,value})=>{
 const el=document.querySelector(selector);const start=performance.now();
 if(type==='click')el.click();else {el.value=value;el.dispatchEvent(new Event(type,{bubbles:true}));}
 await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return performance.now()-start;
},{selector,type,value});}
try{
 for(const cpuRate of (idleFollowup ? [1] : [1,4]))for(let repetition=1;repetition<=(idleFollowup ? 1 : 3);repetition++)for(const fixture of fixtures.filter(f=>!idleFollowup || f.id==='rows-10000')){
  const server=createStaticServer({root:fileURLToPath(new URL('web-dist/',root))});
  const requests=[];server.on('request',(req,res)=>{res.on('finish',()=>requests.push({url:req.url,status:res.statusCode,encoding:res.getHeader('content-encoding')||null}));});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const url=`http://127.0.0.1:${server.address().port}/`;
  const context=await browser.newContext({viewport:result.methodology.viewport,acceptDownloads:true});const page=await context.newPage();page.setDefaultTimeout(30000);
  const cdp=await context.newCDPSession(page);await cdp.send('Performance.enable');await cdp.send('Emulation.setCPUThrottlingRate',{rate:cpuRate});
  let workers=0;page.on('worker',()=>workers++);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
   window.__audit={longTasks:[],events:[]};
   new PerformanceObserver(list=>{for(const e of list.getEntries())window.__audit.longTasks.push({start:e.startTime,duration:e.duration});}).observe({type:'longtask',buffered:true});
  });
  const record={fixture:fixture.id,sourceBytes:Buffer.byteLength(fixture.source),editableNodes:fixture.nodes,cpuRate,repetition};
  try{
   await page.goto(url,{waitUntil:'load'});await page.waitForFunction(()=>document.querySelector('#file-empty').textContent.includes('HTML 가져오기'));await twoFrames(page);
   record.startup=await page.evaluate(()=>({readyMs:performance.now(),navigation:performance.getEntriesByType('navigation')[0].toJSON(),paint:performance.getEntriesByType('paint').map(e=>({name:e.name,start:e.startTime}))}));
   await page.evaluate(async()=>{await navigator.serviceWorker.ready;});
   record.initialRequests=[...requests];record.workersBeforeOpen=workers;
   record.emptyMetrics=await metrics(cdp,true);
   record.openMs=await importSource(page,fixture,`${fixture.id}.html`);
   record.openMetrics=await metrics(cdp);record.openAfterGc=await metrics(cdp,true);
   record.dom=await page.evaluate(()=>({layers:document.querySelectorAll('#layers .layer').length,parentElements:document.querySelectorAll('*').length,previewElements:document.querySelector('#preview').contentDocument.querySelectorAll('*').length,iframes:document.querySelectorAll('iframe').length}));
   const idleBefore=await metrics(cdp);const requestsBefore=requests.length;await sleep(1500);const idleAfter=await metrics(cdp);
   record.idle={windowMs:1500,taskMs:(idleAfter.TaskDuration-idleBefore.TaskDuration)*1000,scriptMs:(idleAfter.ScriptDuration-idleBefore.ScriptDuration)*1000,layoutMs:(idleAfter.LayoutDuration-idleBefore.LayoutDuration)*1000,newRequests:requests.length-requestsBefore,requestDetails:requests.slice(requestsBefore)};
   record.selectMs=await page.evaluate(async selector=>{const start=performance.now();document.querySelector('#preview').contentDocument.querySelector(selector).click();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return performance.now()-start;},fixture.target);
   record.textEditMs=await dispatchPaint(page,'#text-value','input','Edited audit headline');
   record.undoMs=await dispatchPaint(page,'#undo','click');
   // Measure a true pointer click in the empty outer canvas, with browser event timestamps.
   await page.evaluate(()=>{
    const c=document.querySelector('#canvas');
    document.addEventListener('pointerdown',e=>{if(e.target===c)window.__audit.pointerStart=performance.now();},{capture:true,once:true});
    c.addEventListener('pointerdown',()=>{window.__audit.pointerSyncMs=performance.now()-window.__audit.pointerStart;},{once:true});
   });
   const canvas=await page.locator('#canvas').boundingBox();await page.mouse.click(canvas.x+5,canvas.y+5);await twoFrames(page);
   record.blankPointerDownSyncMs=await page.evaluate(()=>window.__audit.pointerSyncMs);
   // Sixty frames of wheel input at one dispatch per animation frame; captures scheduling gaps.
   record.pan=await page.evaluate(async()=>{
    const c=document.querySelector('#canvas'),gaps=[];let last=performance.now();const start=last;
    for(let i=0;i<60;i++){await new Promise(requestAnimationFrame);const now=performance.now();gaps.push(now-last);last=now;c.dispatchEvent(new WheelEvent('wheel',{deltaY:i<30?2:-2,bubbles:true,cancelable:true}));}
    gaps.sort((a,b)=>a-b);return {frames:gaps.length,elapsedMs:performance.now()-start,p95FrameGapMs:gaps[Math.ceil(gaps.length*.95)-1],maxFrameGapMs:gaps.at(-1)};
   });
   await page.evaluate(selector=>document.querySelector('#preview').contentDocument.querySelector(selector).click(),fixture.target);
   await dispatchPaint(page,'#text-value','input','Downloaded audit headline');
   const downloadPromise=page.waitForEvent('download');
   await page.evaluate(()=>{window.__audit.downloadStarted=performance.now();document.querySelector('#save').click();});
   const download=await downloadPromise;record.downloadEventMs=await page.evaluate(()=>performance.now()-window.__audit.downloadStarted);
   const stream=await download.createReadStream();let source='';for await(const chunk of stream)source+=chunk;
   record.downloadContainsEdit=source.includes('Downloaded audit headline');
   record.finalMetrics=await metrics(cdp,true);record.workersAfterEditing=workers;
   record.longTasks=await page.evaluate(()=>window.__audit.longTasks);record.pageErrors=errors;
  }catch(error){record.error=String(error);result.errors.push({fixture:fixture.id,cpuRate,repetition,error:String(error)});}
  finally{await context.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
  result.runs.push(record);console.log(JSON.stringify({fixture:fixture.id,cpuRate,repetition,openMs:record.openMs,error:record.error}));
 }
}finally{await browser.close();result.completedAtUtc=new Date().toISOString();await writeFile(new URL(idleFollowup ? './performance-idle-followup.json' : './performance-results.json',import.meta.url),JSON.stringify(result,null,2)+'\n');}
if(result.errors.length)process.exitCode=1;
if(!idleFollowup && !result.errors.length) await import('./summarize-performance.mjs');
