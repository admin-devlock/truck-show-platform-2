import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareBoothEdit, applyAuditedBoothEdit, boothSaveErrorMessage } from '../src/lib/booth-edit.ts';
import { getAuditSession, AUDIT_IDLE_MS } from '../src/lib/audit-session.ts';
const type = {id:'status',name:'Status',statuses:[{id:'offer',name:'Offer Sent',color:'#ed0713'},{id:'approved',name:'Plan Approved',color:'#1e8e3e'}]};
const source = () => ({statusTypes:[type],assignments:{'144':{exhibitor:'Foton',statusIdsByType:{status:'offer'},labelMode:'area'},'161':{exhibitor:'Other'}}});
const statusEdit = {kind:'status',boothNumber:'144',statusTypeId:'status',statusId:'approved'};

test('save errors explain what happened without exposing low-level rule details',()=>{
 assert.equal(boothSaveErrorMessage({code:'permission-denied',message:'internal rules'}),'This change wasn’t saved. Check your access and try again.');
 assert.match(boothSaveErrorMessage({code:'unavailable'}),/connection/);
 assert.match(boothSaveErrorMessage(new Error('Refresh the map.')),/Refresh the map/);
});

test('status events preserve previous and next IDs, names and exact colours',()=>{
 const meta=source(), saved=structuredClone(meta), result=prepareBoothEdit(meta,statusEdit);
 assert.deepEqual(meta,saved);
 assert.deepEqual(result.patch,{statusIdsByType:{status:'approved'}});
 assert.deepEqual(result.metadata,{boothNumber:'144',statusTypeId:'status',statusTypeName:'Status',previousStatusId:'offer',previousStatusName:'Offer Sent',previousStatusColor:'#ed0713',statusId:'approved',statusName:'Plan Approved',statusColor:'#1e8e3e'});
});
test('exhibitor events include both values, and trim without erasing other fields',()=>{
 const result=prepareBoothEdit(source(),{kind:'exhibitor',boothNumber:'144',exhibitor:' Foton Australia '});
 assert.deepEqual(result.patch,{exhibitor:'Foton Australia'});
 assert.equal(result.metadata.previousExhibitor,'Foton');assert.equal(result.metadata.exhibitor,'Foton Australia');
 assert.equal(prepareBoothEdit(source(),{kind:'exhibitor',boothNumber:'144',exhibitor:' Foton '}),null);
});
test('clears and legacy values resolve correctly without reviving explicit nulls',()=>{
 const meta=source();meta.assignments['144']={statusId:'offer'};
 assert.equal(prepareBoothEdit(meta,statusEdit).metadata.previousStatusId,'offer');
 meta.assignments['144'].statusIdsByType={status:null};
 assert.equal(prepareBoothEdit(meta,statusEdit).metadata.previousStatusId,null);
 assert.equal(prepareBoothEdit(meta,{...statusEdit,statusId:null}),null);
 const clear=prepareBoothEdit(source(),{...statusEdit,statusId:null});
 assert.equal(clear.action,'Clear booth status');assert.equal(clear.metadata.statusId,null);
});
test('removed status definitions fail closed and same-value saves do not add events',()=>{
 assert.throws(()=>prepareBoothEdit(source(),{...statusEdit,statusId:'removed'}),/no longer exists/);
 assert.throws(()=>prepareBoothEdit(source(),{...statusEdit,statusTypeId:'removed'}),/category has changed/);
 assert.equal(prepareBoothEdit(source(),{...statusEdit,statusId:'offer'}),null);
});

// Simulate atomic commit: a failed stage never publishes either staged write.
function transaction(db, edit, failAudit=false) {
 const staged=structuredClone(db);
 return applyAuditedBoothEdit({read:async()=>staged.meta,
  writeBooth:(number,patch)=>{const old=staged.meta.assignments[number];staged.meta.assignments[number]={...old,...patch,
    ...(patch.statusIdsByType?{statusIdsByType:{...old.statusIdsByType,...patch.statusIdsByType}}:{})};},
  writeAudit:(action,metadata)=>{if(failAudit)throw Error('permission-denied');staged.events.push({action,metadata});}
 },edit).then(changed=>{Object.assign(db,staged);return changed;});
}
test('an audit failure leaves the original booth and audit list untouched',async()=>{
 const db={meta:source(),events:[]}, before=structuredClone(db);
 await assert.rejects(transaction(db,statusEdit,true),/permission-denied/);
 assert.deepEqual(db,before);
});
test('retry recomputes previous values and does not duplicate a committed no-op',async()=>{
 const db={meta:source(),events:[]};
 await transaction(db,statusEdit);
 await transaction(db,statusEdit);
 assert.equal(db.events.length,1);
 await transaction(db,{...statusEdit,statusId:'offer'});
 assert.equal(db.events[1].metadata.previousStatusId,'approved');
 assert.equal(db.meta.assignments['144'].exhibitor,'Foton');
 assert.deepEqual(db.meta.assignments['161'],{exhibitor:'Other'});
});
test('session IDs rotate after inactivity or identity change, not every event',()=>{
 const data=new Map(),storage={getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)};
 let id=0;const uuid=()=>`session-${++id}`;
 assert.equal(getAuditSession(storage,'a',0,uuid),'session-1');
 assert.equal(getAuditSession(storage,'a',1000,uuid),'session-1');
 assert.equal(getAuditSession(storage,'a',AUDIT_IDLE_MS+1000,uuid),'session-2');
 assert.equal(getAuditSession(storage,'b',AUDIT_IDLE_MS+1001,uuid),'session-3');
 assert.equal(getAuditSession({getItem:()=>{throw Error('blocked')},setItem:()=>{}},'b',1,uuid),'session-4');
});
