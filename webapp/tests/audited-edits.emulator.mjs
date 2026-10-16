// Only runs against local Firebase emulators; never accepts production config.
import assert from 'node:assert/strict';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInAnonymously } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, doc, setDoc, getDocFromServer, getDocs, collection, terminate } from 'firebase/firestore';
import { commitAuditedBoothEdit } from '../src/lib/audited-booth-store.mjs';
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8088', 'Refusing non-emulator execution');
const app=initializeApp({projectId:'demo-truckshow',apiKey:'demo-only'});
const auth=getAuth(app);connectAuthEmulator(auth,'http://127.0.0.1:9098',{disableWarnings:true});
const db=getFirestore(app);connectFirestoreEmulator(db,'127.0.0.1',8088);
try {
 const {user}=await signInAnonymously(auth);
 const ctx={schemaVersion:2,authUid:user.uid,actor:{uid:user.uid,name:'Emulator test',isGuest:true},clientAt:Date.now()};
 const ref=doc(db,'maps','test-only','meta','booths');
 const initial={statusTypes:[{id:'s',name:'Status',statuses:[{id:'a',name:'Offer',color:'#ed0713'},{id:'b',name:'Approved',color:'#1e8e3e'}]}],
   assignments:{'144':{exhibitor:'Foton',labelMode:'dims',statusIdsByType:{s:'a',other:'untouched'}},'161':{exhibitor:'Keep me'}},splits:{unrelated:{parts:[]}}};
 await setDoc(ref,initial);
 const edit={kind:'status',boothNumber:'144',statusTypeId:'s',statusId:'b'};
 // Real security-rule failure: neither the booth change nor the audit record may commit.
 await assert.rejects(commitAuditedBoothEdit(db,'test-only',edit,{...ctx,authUid:'wrong-user'}));
 assert.deepEqual((await getDocFromServer(ref)).data(),initial);
 assert.equal((await getDocs(collection(db,'activity'))).size,0);
 await Promise.all([
   commitAuditedBoothEdit(db,'test-only',edit,ctx),
   commitAuditedBoothEdit(db,'test-only',{kind:'exhibitor',boothNumber:'144',exhibitor:'Foton Australia'},ctx),
 ]);
 const saved=(await getDocFromServer(ref)).data();
 assert.equal(saved.assignments['144'].exhibitor,'Foton Australia');
 assert.deepEqual(saved.assignments['144'].statusIdsByType,{s:'b',other:'untouched'});
 assert.equal(saved.assignments['144'].labelMode,'dims');
 assert.deepEqual(saved.assignments['161'],initial.assignments['161']);
 assert.deepEqual(saved.splits,initial.splits);
 let events=(await getDocs(collection(db,'activity'))).docs.map(d=>d.data());
 assert.equal(events.length,2);
 const status=events.find(e=>e.action==='Set booth status').metadata;
 assert.equal(status.previousStatusId,'a');assert.equal(status.statusId,'b');
 const name=events.find(e=>e.action==='Change booth exhibitor').metadata;
 assert.equal(name.previousExhibitor,'Foton');assert.equal(name.exhibitor,'Foton Australia');
 await commitAuditedBoothEdit(db,'test-only',edit,ctx);
 assert.equal((await getDocs(collection(db,'activity'))).size,2,'No-op must not log twice');
 await commitAuditedBoothEdit(db,'test-only',{...edit,statusId:null},ctx);
 assert.equal((await getDocFromServer(ref)).data().assignments['144'].statusIdsByType.s,null);
 assert.equal((await getDocs(collection(db,'activity'))).size,3);
 console.log('PASS: emulator rules, atomic failure rollback, concurrent edits, exact before/after, no-op suppression, explicit clears. No production writes.');
} finally {await terminate(db);await deleteApp(app);}
