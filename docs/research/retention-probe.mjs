// Run after npm run build:web: node --import tsx docs/research/retention-probe.mjs
// Synthetic page-target diagnostics; does not measure total browser memory.
import { chromium } from '@playwright/test';
import { createStaticServer } from '../../src/static-server.ts';
import { mkdtemp, writeFile, rm, cp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const root=await mkdtemp(join(tmpdir(),'pagecraft-browser-retention-'));
await cp(new URL('../../web-dist/', import.meta.url),root,{recursive:true});
const source='<!doctype html><html><head><meta charset="utf-8"><style>body{margin:24px;font:16px Arial}p{margin:0;height:28px}</style></head><body><main>'+Array.from({length:2000},(_,i)=>`<p id="row-${i}">Planning row ${i}</p>`).join('')+'</main></body></html>';
const server=createStaticServer({root});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000}});const page=await context.newPage();
const cdp=await context.newCDPSession(page);await cdp.send('Performance.enable');
const metrics=async(gc=false)=>{if(gc)await cdp.send('HeapProfiler.collectGarbage');return Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));};
const result={observedAt:new Date().toISOString(),browser:browser.version(),sourceBytes:Buffer.byteLength(source),editableNodes:2001,errors:[],retention:[],limits:['Synthetic repeated usage in isolated headless Chrome on Apple M4 Pro; not an hours-long field study.','Forced GC diagnostics only; page-target heap excludes worker, GPU/native and total browser RSS.','Uses the current web-dist build; rerun npm run build:web after source changes.']};
let workers=0,requests=0;page.on('worker',()=>workers++);page.on('request',()=>requests++);page.on('pageerror',e=>result.errors.push(e.message));
try{
 await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.locator('#welcome-report').waitFor();await page.evaluate(()=>navigator.serviceWorker.ready);result.workersBeforeOpen=workers;
 for(let i=0;i<30;i++){
  await page.locator('#file-input').setInputFiles({name:`cycle-${i}.html`,mimeType:'text/html',buffer:Buffer.from(source)});
  await page.waitForFunction(name=>document.querySelector('#filename').textContent===name&&document.querySelector('#canvas').getAttribute('aria-busy')==='false',`cycle-${i}.html`);
  await page.locator('#preview').evaluate(frame=>frame.contentDocument.querySelector('#row-0').click());await page.locator('#text-value').fill(`Edit cycle ${i}`);await page.locator('#undo').click();
  if((i+1)%10===0)result.retention.push({cycles:i+1,files:await page.locator('#files button').count(),workers,...await metrics(true)});
 }
 result.dom=await page.evaluate(()=>({layers:document.querySelectorAll('#layers .layer').length,iframes:document.querySelectorAll('iframe').length}));
 const before=await metrics(),requestsBefore=requests;await page.waitForTimeout(3000);const after=await metrics();result.idle={windowMs:3000,taskMs:(after.TaskDuration-before.TaskDuration)*1000,scriptMs:(after.ScriptDuration-before.ScriptDuration)*1000,newRequests:requests-requestsBefore};
 result.workersAfter=workers;
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});await writeFile(new URL('final-polish/retention.json', import.meta.url),JSON.stringify(result,null,2)+'\n');}
console.log(JSON.stringify({workersBeforeOpen:result.workersBeforeOpen,workersAfter:result.workersAfter,retention:result.retention.map(x=>({cycles:x.cycles,files:x.files,workers:x.workers,heapMiB:x.JSHeapUsedSize/1048576,listeners:x.JSEventListeners,documents:x.Documents,detached:x.DetachedScriptStates})),idle:result.idle,dom:result.dom,errors:result.errors},null,2));
