// Read-only comparison of complete before/after Firestore exports.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { prepareStandAdjustment, MAP_ID, LEVEL_ID, stable } from './adjust_october_stands.mjs';
const [beforeDir,afterDir]=process.argv.slice(2).map(p=>resolve(p));
assert.ok(beforeDir&&afterDir,'Supply before and after backup directories');
async function load(dir){
 const manifest=JSON.parse(await readFile(resolve(dir,'manifest.json'),'utf8'));
 const maps={};
 for(const e of manifest.maps){const bytes=await readFile(resolve(dir,e.filename));assert.equal(createHash('sha256').update(bytes).digest('hex'),e.sha256);maps[e.id]=JSON.parse(bytes);}
 return maps;
}
const before=await load(beforeDir),after=await load(afterDir);
assert.deepEqual(Object.keys(before).sort(),Object.keys(after).sort(),'Map set changed');
for(const[id,old]of Object.entries(before)){
 const expected=structuredClone(old),actual=structuredClone(after[id]);
 if(id===MAP_ID){
  const planned=prepareStandAdjustment(old);
  expected.render[LEVEL_ID]=planned.render;expected.levels[LEVEL_ID]=planned.level;expected.meta.booths=planned.meta;
  // Intentional update timestamp; viewing/searching affects only transient UI state.
  delete expected.document.updatedAt;delete actual.document.updatedAt;
  delete expected.meta.search;delete actual.meta.search;
 }
 for(const key of ['document','levels','render','meta'])assert.ok(stable(expected[key])===stable(actual[key]),`Unexpected difference: ${id}/${key}`);
}
const result={verifiedAt:new Date().toISOString(),beforeDir,afterDir,mapsVerified:Object.keys(before).length,
 otherMapsUnchanged:true,allOtherLevelsUnchanged:true,allRetainedAssignmentsUnchanged:true,statusDefinitionsAndSplitsUnchanged:true,
 expectedChanges:['Merge 144+161 into 144 at 225 m²','Stand 30 = 40 m²','Stand 31 = 60 m²','Exhibition Halls thumbnail and booth count','Map update timestamp'],
 excludedTransientFields:['presence','working map shared search state','export timestamp']};
await writeFile(resolve(afterDir,'cross-map-verification.json'),JSON.stringify(result,null,2),{flag:'wx'});
console.log(JSON.stringify(result,null,2));
