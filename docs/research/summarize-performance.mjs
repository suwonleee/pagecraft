/** Regenerate the compact audit summary from recorded measurements. No browser is launched. */
import { readFile, writeFile } from 'node:fs/promises';
const raw=JSON.parse(await readFile(new URL('./performance-results.json',import.meta.url),'utf8'));
const round=n=>Math.round(n*100)/100;
const median=values=>{const s=[...values].sort((a,b)=>a-b);const i=Math.floor(s.length/2);return s.length%2?s[i]:(s[i-1]+s[i])/2;};
const summary={observedAtUtc:raw.observedAtUtc,commit:raw.commit,browser:raw.browser,machine:raw.machine,runs:raw.runs.length,errors:raw.errors,conditions:[]};
for(const cpuRate of [1,4])for(const fixture of ['sample','rows-2000','rows-10000']){
 const rows=raw.runs.filter(r=>r.cpuRate===cpuRate&&r.fixture===fixture);
 if(!rows.length||rows.some(r=>r.error))throw new Error(`Missing or failed condition: ${fixture}/${cpuRate}`);
 const record={cpuRate,fixture,sourceBytes:rows[0].sourceBytes,editableNodes:rows[0].editableNodes,samples:rows.length};
 for(const key of ['openMs','selectMs','textEditMs','undoMs','blankPointerDownSyncMs','downloadEventMs']){const vals=rows.map(r=>r[key]);record[key]={median:round(median(vals)),min:round(Math.min(...vals)),max:round(Math.max(...vals))};}
 record.startupReadyMs=round(median(rows.map(r=>r.startup.readyMs)));
 record.parentHeapAfterGcMiB=round(median(rows.map(r=>r.openAfterGc.JSHeapUsedSize))/1024**2);
 record.maxParentLongTaskMs=Math.max(0,...rows.flatMap(r=>r.longTasks.map(e=>e.duration)));
 record.medianIdleMainTaskMsOver1500ms=round(median(rows.map(r=>r.idle.taskMs)));
 record.maxPanFrameGapMs=round(Math.max(...rows.map(r=>r.pan.maxFrameGapMs)));
 record.layerDomRows=[...new Set(rows.map(r=>r.dom.layers))].sort((a,b)=>a-b);
 summary.conditions.push(record);
}
summary.assets={rawBytes:raw.assets.reduce((n,a)=>n+a.bytes,0),gzipBytes:raw.assets.reduce((n,a)=>n+a.gzipBytes,0),initialRequestsInFirstRun:raw.runs[0].initialRequests.length};
await writeFile(new URL('./performance-summary.json',import.meta.url),JSON.stringify(summary,null,2)+'\n');
console.log(`Summarized ${raw.runs.length} recorded runs.`);
