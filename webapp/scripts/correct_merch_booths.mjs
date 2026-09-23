#!/usr/bin/env node
// Scoped one-time correction authorized by the map owner. Dry-run by default.
// node --env-file=.env.local scripts/correct_merch_booths.mjs BACKUP_DIR [--apply]
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { initializeApp, deleteApp } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";
import { getFirestore, doc, getDoc, runTransaction, serverTimestamp } from "firebase/firestore";

const mapId = "xDUYA9nxn7ThMmYcJXhZ";
const operationId = "merch-M3-M13-M14-2026-09-23";
const backupDir = resolve(process.argv[2]);
const apply = process.argv.includes("--apply");
const sha = (s) => createHash("sha256").update(s).digest("hex");
const stable = (v) => v === null || typeof v !== "object" ? JSON.stringify(v)
  : Array.isArray(v) ? `[${v.map(stable).join(",")}]`
    : `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}`;
const manifest = JSON.parse(await readFile(resolve(backupDir, "manifest.json"), "utf8"));
for (const entry of manifest.maps) {
  assert.equal(sha(await readFile(resolve(backupDir, entry.filename))), entry.sha256, "Backup checksum mismatch");
}
const entry = manifest.maps.find((m) => m.id === mapId);
assert.ok(entry, "Target map missing from backup");
const backup = JSON.parse(await readFile(resolve(backupDir, entry.filename), "utf8"));
assert.equal(backup.document.title, "All Levels – Working Plans");
const original = backup.render.main;
const data = JSON.parse(original.boothsJson);
const old = Object.fromEntries(["M2", "M5", "M13", "M14"].map((n) => {
  const matches = data.booths.filter((b) => b.number === n);
  assert.equal(matches.length, 1, `Expected exactly one ${n}`);
  return [n, matches[0]];
}));
for (const render of Object.values(backup.render)) {
  assert.ok(!JSON.parse(render.boothsJson).booths.some((b) => b.number === "M3"), "M3 already exists");
}
const meta = backup.meta.booths;
assert.ok(!meta.assignments.M3, "M3 already has an assignment");
for (const [number, split] of Object.entries(meta.splits || {})) {
  assert.ok(!["M2", "M5", "M3", "M13", "M14"].includes(number));
  assert.ok(!split.parts.some((p) => ["M2", "M5", "M3", "M13", "M14"].includes(p.number)));
}
assert.deepEqual(old.M5.polygon, [[33784.9,29192.9],[24784.9,29192.9],[24784.9,32192.9],[33784.9,32192.9]]);
assert.deepEqual(old.M2.polygon, [[33784.9,29192.9],[36784.9,29192.9],[36784.9,32192.9],[33784.9,32192.9]]);
assert.deepEqual(old.M13.polygon, [[37484.2,24172.2],[33484.2,24172.2],[33484.2,21172.2],[37484.2,21172.2]]);
assert.deepEqual(old.M14.polygon, [[41484.2,24172.2],[37484.2,24172.2],[37484.2,21172.2],[41484.2,21172.2]]);
const { exhibitor: name2, ...assignment2 } = meta.assignments.M2;
const { exhibitor: name5, ...assignment5 } = meta.assignments.M5;
assert.equal(name2, "Just Country - M3");
assert.equal(name5, "Just Country Now M3");
assert.deepEqual(assignment2, assignment5, "Merged booths have conflicting assignment data");

const m3 = { ...old.M5, number: "M3", width_m: 12, depth_m: 3, area_m2: 36,
  centroid: [30784.9,30692.9],
  polygon: [[36784.9,29192.9],[24784.9,29192.9],[24784.9,32192.9],[36784.9,32192.9]] };
function resize(booth, width) {
  const polygon = booth.polygon.map(([x,y]) => [x === 37484.2 ? 38484.2 : x, y]);
  const resized = { ...booth, width_m: width, depth_m: 3, area_m2: width * 3,
    centroid: [booth.centroid[0] + 500, booth.centroid[1]], polygon };
  if (resized.absorbed) resized.absorbed = resized.absorbed.map((part) => ({ ...part,
    area_m2: width * 3,
    polygon: part.polygon.map(([x,y]) => [x === 37484.2 ? 38484.2 : x,y]),
  }));
  return resized;
}
const updated = { M3: m3, M13: resize(old.M13, 5), M14: resize(old.M14, 3) };
const newData = { ...data, count: data.count - 1, named: data.named - 1,
  booths: data.booths.filter((b) => b.number !== "M2").map((b) =>
    b.number === "M5" ? m3 : updated[b.number] || b) };
assert.equal(newData.booths.length, data.booths.length - 1);
for (const b of Object.values(updated)) {
  const xs=b.polygon.map(p=>p[0]), ys=b.polygon.map(p=>p[1]);
  assert.ok(Math.abs((Math.max(...xs)-Math.min(...xs))/1000-b.width_m)<1e-8);
  assert.ok(Math.abs((Math.max(...ys)-Math.min(...ys))/1000-b.depth_m)<1e-8);
}

// The CAD has duplicate strokes for shared walls; remove both copies of the
// M2/M5 divider and move every stroke endpoint on the M13/M14 divider.
let removed = 0, shifted = 0, labelEdits = 0;
const svg = original.svg.split("\n").flatMap((line) => {
  if (/^<line /.test(line)) {
    const a = Object.fromEntries([...line.matchAll(/(x1|x2|y1|y2)="([^"]+)"/g)].map((m)=>[m[1],Number(m[2])]));
    if (a.x1===33784.9 && a.x2===33784.9 && Math.min(a.y1,a.y2)===29192.9 && Math.max(a.y1,a.y2)===32192.9) {
      removed++; return [];
    }
    if ([21172.2,24172.2].includes(a.y1) && [21172.2,24172.2].includes(a.y2)) {
      const next = line.replace(/(x[12])="37484\.2"/g, '$1="38484.2"');
      if(next!==line)shifted++;
      line=next;
    }
  }
  if (line.startsWith("<text ")) {
    if (/x="35284\.9" y="(?:30239\.3|31398\.5)"/.test(line)) { labelEdits++; return []; }
    if (/x="29284\.9" y="(?:30239\.3|31398\.5)"/.test(line)) {
      labelEdits++; line=line.replace('x="29284.9"','x="30784.9"').replace('>M5<','>M3<').replace('>9 × 3<','>12 × 3<');
    }
    for (const [from,to,width] of [[35484.2,35984.2,5],[39484.2,39984.2,3]]) {
      if (line.includes(`x="${from}"`) && /y="(?:22218\.6|23377\.8)"/.test(line)) {
        labelEdits++; line=line.replace(`x="${from}"`,`x="${to}"`).replace('>4 × 3<',`>${width} × 3<`);
      }
    }
  }
  return [line];
}).join("\n");
assert.equal(removed,2); assert.equal(shifted,9); assert.equal(labelEdits,8);
assert.ok(!/>M[25]</.test(svg));
const newRender = { ...original, svg, boothsJson: JSON.stringify(newData) };
let thumbChanges=0;
const points = (polygon) => polygon.map((p)=>p.map(Math.round).join(",")).join(" ");
const thumb = backup.levels.main.thumbSvg.replace(/<polygon points="([^"]+)"\/>/g,(tag, pts)=>{
  for(const n of ["M2","M5","M13","M14"])if(pts===points(old[n].polygon)){
    thumbChanges++;
    return n==="M2" ? "" : `<polygon points="${points((n==="M5" ? m3 : updated[n]).polygon)}"/>`;
  }
  return tag;
});
assert.equal(thumbChanges,4);
assert.equal(backup.document.thumbSvg,backup.levels.main.thumbSvg);
const assignments={...meta.assignments,M3:{...assignment5,exhibitor:"Just Country"}};
delete assignments.M2; delete assignments.M5;
const plan={mapId,levelId:"main",backup:entry.filename,backupSha256:entry.sha256,
  booths:Object.values(updated),assignments:{M3:assignments.M3,M13:assignments.M13,M14:assignments.M14},
  removedBooths:["M2","M5"],svgEdits:{removed,shifted,labelEdits,thumbChanges}};
console.log(JSON.stringify({mode:apply?"apply":"preview",...plan},null,2));
if (!apply) {
  await writeFile(resolve(backupDir,"merch-correction-plan.json"),JSON.stringify(plan,null,2),{flag:"wx"});
  await writeFile(resolve(backupDir,"merch-correction-preview.svg"),svg.replace('viewBox="0 0 185199.4 122824.7"','viewBox="12000 19500 32000 15000"'),{flag:"wx"});
  process.exit(0);
}

const app=initializeApp({apiKey:process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain:process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,projectId:process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId:process.env.NEXT_PUBLIC_FIREBASE_APP_ID});
assert.equal(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,manifest.projectId);
try {
  const {user}=await signInAnonymously(getAuth(app));
  const db=getFirestore(app);
  const mapRef=doc(db,"maps",mapId), renderRef=doc(db,"maps",mapId,"render","main"),
    levelRef=doc(db,"maps",mapId,"levels","main"), metaRef=doc(db,"maps",mapId,"meta","booths"),
    auditRef=doc(db,"activity",operationId);
  await runTransaction(db,async(tx)=>{
    const [m,r,l,b,a]=await Promise.all([mapRef,renderRef,levelRef,metaRef,auditRef].map(ref=>tx.get(ref)));
    assert.ok(!a.exists(),"Correction has already been applied");
    assert.ok(stable(r.data())===stable(original),"Render changed since backup; take a new backup");
    assert.ok(stable(b.data())===stable(meta),"Assignments changed since backup; take a new backup");
    for(const [current,saved] of [[m.data(),backup.document],[l.data(),backup.levels.main]]){
      assert.equal(current.thumbSvg,saved.thumbSvg); assert.equal(current.boothCount,saved.boothCount);
    }
    tx.update(renderRef,{svg:newRender.svg,boothsJson:newRender.boothsJson});
    tx.update(metaRef,{assignments});
    tx.update(levelRef,{thumbSvg:thumb,boothCount:newData.count});
    tx.update(mapRef,{thumbSvg:thumb,boothCount:newData.count,updatedAt:serverTimestamp()});
    tx.set(auditRef,{schemaVersion:1,eventType:"mutation",action:"Correct merchandise booth layout",mapId,
      authUid:user.uid,actor:{uid:user.uid,name:"Codex — authorized map correction",isGuest:true},
      path:`/map/${mapId}`,clientAt:Date.now(),createdAt:serverTimestamp(),
      metadata:{operationId,levelId:"main",mergedFrom:"M2,M5",mergedInto:"M3",dimensions:"M3=12x3; M13=5x3; M14=3x3",backupSha256:entry.sha256}});
  });
  const [r,b,l,m,a]=await Promise.all([renderRef,metaRef,levelRef,mapRef,auditRef].map(ref=>getDoc(ref)));
  assert.ok(stable(r.data())===stable(newRender),"Post-write render verification failed");
  assert.ok(stable(b.data())===stable({...meta,assignments}),"Post-write assignment verification failed");
  assert.equal(l.data().thumbSvg,thumb);assert.equal(l.data().boothCount,newData.count);
  assert.equal(m.data().thumbSvg,thumb);assert.equal(m.data().boothCount,newData.count);
  assert.ok(a.exists());
  const receipt={operationId,verifiedAt:new Date().toISOString(),...plan,boothCount:newData.count,
    renderSha256:sha(stable(r.data())),metaSha256:sha(stable(b.data()))};
  await writeFile(resolve(backupDir,"merch-correction-receipt.json"),JSON.stringify(receipt,null,2),{flag:"wx"});
  console.log("APPLIED AND VERIFIED: geometry, SVG, assignments, thumbnails, counts, and audit event.");
} finally {await deleteApp(app);}
