#!/usr/bin/env node
// Scoped, backup-checked production repair. Preview by default; never run implicitly.
// node --env-file=.env.local scripts/adjust_october_stands.mjs BACKUP_DIR [--apply]
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getFirestore, doc, runTransaction, getDocFromServer, serverTimestamp, terminate } from 'firebase/firestore';
import { polygonIntersectionArea } from '../src/lib/remap.ts';

export const MAP_ID='xDUYA9nxn7ThMmYcJXhZ', LEVEL_ID='ztgu6h0r';
const operationId='merge144-161-swap30-31-2026-10-17';
const sha=value=>createHash('sha256').update(value).digest('hex');
export const stable=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?`[${value.map(stable).join(',')}]`:`{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
const same=(a,b)=>stable(a)===stable(b);
const area=poly=>Math.abs(poly.reduce((s,p,i)=>{const q=poly[(i+1)%poly.length];return s+p[0]*q[1]-q[0]*p[1];},0))/2/1e6;

export function prepareStandAdjustment(backup) {
 assert.equal(backup.id,MAP_ID);assert.equal(backup.document.title,'All Levels – Working Plans');
 const original=backup.render[LEVEL_ID],meta=backup.meta.booths,data=JSON.parse(original.boothsJson);
 const numbers=['144','161','30','31'];
 const old=Object.fromEntries(numbers.map(n=>{
  const all=Object.values(backup.render).flatMap(r=>JSON.parse(r.boothsJson).booths).filter(b=>b.number===n);
  assert.equal(all.length,1,`Expected one stand ${n}`);
  assert.ok(data.booths.some(b=>b.number===n));return[n,all[0]];
 }));
 for(const[n,s]of Object.entries(meta.splits||{}))assert.ok(!numbers.includes(n)&&!s.parts.some(p=>numbers.includes(p.number)),'Target is already split');
 assert.deepEqual(old['144'].polygon,[[242457.8,43457.8],[257457.8,43457.8],[257457.8,35957.8],[242457.8,35957.8]]);
 assert.deepEqual(old['161'].polygon,[[242457.8,28457.8],[257457.8,28457.8],[257457.8,35957.8],[242457.8,35957.8]]);
 assert.deepEqual(old['30'].polygon,[[66598.1,93407.8],[54598.1,93407.8],[54598.1,88407.8],[66598.1,88407.8]]);
 assert.deepEqual(old['31'].polygon,[[54598.1,93407.8],[46598.1,93407.8],[46598.1,88407.8],[54598.1,88407.8]]);
 assert.ok(same(meta.assignments['144'],meta.assignments['161']),'144 and 161 have conflicting assignment data; ask user');
 assert.equal(meta.assignments['144'].exhibitor,'Foton');
 const merged={...old['144'],width_m:15,depth_m:15,area_m2:225,centroid:[249957.8,35957.8],
  polygon:[[242457.8,43457.8],[257457.8,43457.8],[257457.8,28457.8],[242457.8,28457.8]],
  absorbed:[...(old['144'].absorbed||[]),...(old['161'].absorbed||[])]};
 const resized=n=>({...old[n],width_m:n==='30'?8:12,area_m2:n==='30'?40:60,
  centroid:[old[n].centroid[0]+2000,old[n].centroid[1]],
  polygon:old[n].polygon.map(([x,y])=>[x===54598.1?58598.1:x,y])});
 const changed={'144':merged,'30':resized('30'),'31':resized('31')};
 const booths=data.booths.filter(b=>b.number!=='161').map(b=>changed[b.number]||b);
 assert.equal(booths.length,data.booths.length-1);
 for(const b of Object.values(changed))assert.ok(Math.abs(area(b.polygon)-b.area_m2)<1e-6);
 assert.ok(Math.abs(Object.values(old).reduce((s,b)=>s+area(b.polygon),0)-Object.values(changed).reduce((s,b)=>s+area(b.polygon),0))<1e-6,'Total area changed');
 assert.equal(polygonIntersectionArea(changed['30'].polygon,changed['31'].polygon),0);
 for(const b of data.booths.filter(b=>!numbers.includes(b.number)&&b.polygon?.length)){
  assert.ok(same(booths.find(next=>next===b),b),'Unrelated booth changed');
  const before=Object.values(old).reduce((s,o)=>s+polygonIntersectionArea(o.polygon,b.polygon),0);
  const after=Object.values(changed).reduce((s,o)=>s+polygonIntersectionArea(o.polygon,b.polygon),0);
  assert.ok(Math.abs(before-after)<0.1,`Neighbour overlap changed: ${b.number}`);
 }
 let removedDividers=0,movedLines=0,labelEdits=0;
 const svg=original.svg.split('\n').flatMap(line=>{
  if(line.startsWith('<line ')){
   const a=Object.fromEntries([...line.matchAll(/(x1|x2|y1|y2)="([^"]+)"/g)].map(m=>[m[1],Number(m[2])]));
   if(a.y1===35957.8&&a.y2===35957.8&&Math.min(a.x1,a.x2)===242457.8&&Math.max(a.x1,a.x2)===257457.8){removedDividers++;return[];}
   if([88407.8,93407.8].includes(a.y1)&&[88407.8,93407.8].includes(a.y2)){
    const moved=line.replace(/(x[12])="54598\.1"/g,'$1="58598.1"');if(moved!==line)movedLines++;line=moved;
   }
  }
  if(line.startsWith('<text ')){
   if(/x="249957\.8" y="(?:31415\.8|33439\.8)"/.test(line)){labelEdits++;return[];}
   if(/x="249957\.8" y="38915\.8"/.test(line)){labelEdits++;line=line.replace('38915.8','35165.8');}
   if(/x="249957\.8" y="40939\.8"/.test(line)){labelEdits++;line=line.replace('40939.8','37189.8').replace('>15 × 7.5<','>15 × 15<');}
   for(const[from,to,oldWidth,newWidth]of[[60598.1,62598.1,12,8],[50598.1,52598.1,8,12]]){
    if(line.includes(`x="${from}"`)&&/y="(?:90151\.8|92083\.8)"/.test(line)){
     labelEdits++;line=line.replace(`x="${from}"`,`x="${to}"`).replace(`>${oldWidth} × 5<`,`>${newWidth} × 5<`);
    }
   }
  }
  return[line];
 }).join('\n');
 assert.equal(removedDividers,4);assert.equal(movedLines,6);assert.equal(labelEdits,8);
 assert.ok(!/>161</.test(svg));
 let thumbEdits=0;
 const points=poly=>poly.map(p=>p.map(Math.round).join(',')).join(' ');
 const thumb=backup.levels[LEVEL_ID].thumbSvg.replace(/<polygon points="([^"]+)"\/>/g,(tag,p)=>{
  const n=numbers.find(n=>points(old[n].polygon)===p);if(!n)return tag;thumbEdits++;
  return n==='161'?'':`<polygon points="${points(changed[n].polygon)}"/>`;
 });
 assert.equal(thumbEdits,4);
 const assignments={...meta.assignments};delete assignments['161'];
 const nextMeta={...meta,assignments};
 for(const[n,a]of Object.entries(assignments))assert.ok(same(a,meta.assignments[n]),`Assignment changed for ${n}`);
 const nextData={...data,booths,count:data.count-1,named:data.named-1};
 const render={...original,svg,boothsJson:JSON.stringify(nextData)};
 const level={...backup.levels[LEVEL_ID],thumbSvg:thumb,boothCount:nextData.count};
 const report={mapId:MAP_ID,levelId:LEVEL_ID,before:Object.values(old),after:Object.values(changed),
  removedStand:'161',retainedStand:'144',totalTargetAreaM2:325,removedDividers,movedLines,labelEdits,thumbEdits,
  unchangedOtherBooths:data.booths.length-4,unchangedAssignments:Object.keys(assignments).length};
 return{render,level,meta:nextMeta,report};
}

async function main(){
 assert.ok(process.argv[2],'Supply verified backup directory');
 assert.ok(process.argv.slice(3).every(a=>a==='--apply'),'Unknown argument');
 const dir=resolve(process.argv[2]),apply=process.argv.includes('--apply');
 const manifest=JSON.parse(await readFile(resolve(dir,'manifest.json'),'utf8'));
 assert.equal(manifest.projectId,'truckshow-platform');
 for(const e of manifest.maps)assert.equal(sha(await readFile(resolve(dir,e.filename))),e.sha256,'Backup checksum failed');
 const entry=manifest.maps.find(m=>m.id===MAP_ID);assert.ok(entry);
 const backup=JSON.parse(await readFile(resolve(dir,entry.filename),'utf8'));
 const next=prepareStandAdjustment(backup);
 console.log(JSON.stringify({mode:apply?'apply':'preview',...next.report},null,2));
 if(!apply){await writeFile(resolve(dir,'october-stand-preview.json'),JSON.stringify(next,null,2),{flag:'wx'});return;}
 assert.equal(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,manifest.projectId);
 const app=initializeApp({apiKey:process.env.NEXT_PUBLIC_FIREBASE_API_KEY,projectId:manifest.projectId,authDomain:process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN});
 const db=getFirestore(app);
 try{
  const{user}=await signInAnonymously(getAuth(app));
  const mapRef=doc(db,'maps',MAP_ID),renderRef=doc(db,'maps',MAP_ID,'render',LEVEL_ID),levelRef=doc(db,'maps',MAP_ID,'levels',LEVEL_ID),metaRef=doc(db,'maps',MAP_ID,'meta','booths'),auditRef=doc(db,'activity',operationId);
  await runTransaction(db,async tx=>{
   const[m,r,l,b,a]=await Promise.all([mapRef,renderRef,levelRef,metaRef,auditRef].map(ref=>tx.get(ref)));
   assert.ok(!a.exists(),'Already applied; do not rerun');assert.equal(m.data()?.title,backup.document.title);
   assert.ok(same(r.data(),backup.render[LEVEL_ID]),'Render changed since backup; refresh backup');
   // Level has timestamps in backup serialization; guard every field being overwritten.
   assert.equal(l.data().thumbSvg,backup.levels[LEVEL_ID].thumbSvg);assert.equal(l.data().boothCount,backup.levels[LEVEL_ID].boothCount);
   assert.ok(same(b.data(),backup.meta.booths),'Assignments changed since backup; refresh backup');
   tx.update(renderRef,{svg:next.render.svg,boothsJson:next.render.boothsJson});
   tx.update(levelRef,{thumbSvg:next.level.thumbSvg,boothCount:next.level.boothCount});
   tx.update(metaRef,{assignments:next.meta.assignments});
   tx.update(mapRef,{updatedAt:serverTimestamp()});
   tx.set(auditRef,{schemaVersion:2,authUid:user.uid,actor:{uid:user.uid,name:'Codex — authorized stand adjustment',isGuest:true},
    eventType:'mutation',action:'Merge 144/161 and resize 30/31',mapId:MAP_ID,path:`/map/${MAP_ID}`,clientAt:Date.now(),createdAt:serverTimestamp(),
    metadata:{backupSha256:entry.sha256,operationId,before:JSON.stringify(next.report.before),after:JSON.stringify(next.report.after),preservedAssignment:JSON.stringify(next.meta.assignments['144'])}});
  });
  const[r,b,l,a]=await Promise.all([renderRef,metaRef,levelRef,auditRef].map(ref=>getDocFromServer(ref)));
  assert.ok(same(r.data(),next.render),'Post-write render mismatch');assert.ok(same(b.data(),next.meta),'Post-write metadata mismatch');
  assert.equal(l.data().thumbSvg,next.level.thumbSvg);assert.equal(l.data().boothCount,next.level.boothCount);assert.ok(a.exists());
  await writeFile(resolve(dir,'october-stand-receipt.json'),JSON.stringify({verifiedAt:new Date().toISOString(),backupSha256:entry.sha256,...next.report},null,2),{flag:'wx'});
  console.log('APPLIED AND VERIFIED. Only requested stand geometry, labels, thumbnail and redundant 161 assignment changed.');
 }finally{await terminate(db);await deleteApp(app);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main();
