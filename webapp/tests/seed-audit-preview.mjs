// Deliberately synthetic, local-only browser fixture; never imports .env.local.
import {initializeApp,deleteApp} from 'firebase/app';
import {getAuth,connectAuthEmulator,signInAnonymously} from 'firebase/auth';
import {getFirestore,connectFirestoreEmulator,doc,setDoc,terminate} from 'firebase/firestore';
const app=initializeApp({projectId:'demo-truckshow',apiKey:'demo-only'}),auth=getAuth(app),db=getFirestore(app);
connectAuthEmulator(auth,'http://127.0.0.1:9098',{disableWarnings:true});connectFirestoreEmulator(db,'127.0.0.1',8088);
try{
 const{user}=await signInAnonymously(auth);
 await setDoc(doc(db,'maps','audit-preview'),{title:'LOCAL TEST ONLY — Audit',ownerId:user.uid,ownerName:'Local test',status:'ready',boothCount:1,svgUrl:null,updatedAt:new Date()});
 await setDoc(doc(db,'maps','audit-preview','levels','main'),{name:'Test floor',order:0,status:'ready',boothCount:1});
 const booth={number:'TEST1',kind:'space_only',width_m:10,depth_m:5,area_m2:50,centroid:[10000,10000],polygon:[[5000,7500],[15000,7500],[15000,12500],[5000,12500]]};
 await setDoc(doc(db,'maps','audit-preview','render','main'),{viewBox:[20000,20000],svg:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20000 20000"><rect x="5000" y="7500" width="10000" height="5000" fill="none" stroke="black"/></svg>',boothsJson:JSON.stringify({count:1,named:1,booths:[booth]})});
 await setDoc(doc(db,'maps','audit-preview','meta','booths'),{statusTypes:[{id:'s',name:'Status',statuses:[{id:'sent',name:'Offer Sent',color:'#ed0713'},{id:'approved',name:'Plan Approved',color:'#1e8e3e'}]}],activeStatusTypeId:'s',activeStatusTypeIds:['s'],assignments:{TEST1:{exhibitor:'Original exhibitor',statusIdsByType:{s:'sent'}}},splits:{}});
 console.log('Seeded synthetic audit-preview map in demo-truckshow emulators only.');
}finally{await terminate(db);await deleteApp(app);}
