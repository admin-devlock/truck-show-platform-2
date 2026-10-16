import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareStandAdjustment,MAP_ID,LEVEL_ID} from '../scripts/adjust_october_stands.mjs';
function fixture(){
 const poly={
  '144':[[242457.8,43457.8],[257457.8,43457.8],[257457.8,35957.8],[242457.8,35957.8]],
  '161':[[242457.8,28457.8],[257457.8,28457.8],[257457.8,35957.8],[242457.8,35957.8]],
  '30':[[66598.1,93407.8],[54598.1,93407.8],[54598.1,88407.8],[66598.1,88407.8]],
  '31':[[54598.1,93407.8],[46598.1,93407.8],[46598.1,88407.8],[54598.1,88407.8]],
  '143':[[227457.8,28457.8],[242457.8,28457.8],[242457.8,43457.8],[227457.8,43457.8]],
 };
 const booths=Object.entries(poly).map(([number,polygon])=>({number,kind:'space_only',polygon,
  centroid:[polygon.reduce((s,p)=>s+p[0],0)/4,polygon.reduce((s,p)=>s+p[1],0)/4],
  width_m:number==='30'?12:number==='31'?8:15,depth_m:['30','31'].includes(number)?5:7.5,
  area_m2:number==='30'?60:number==='31'?40:112.5}));
 const lines=booths.flatMap(b=>b.polygon.map((p,i)=>{const q=b.polygon[(i+1)%4];return`<line x1="${p[0]}" y1="${p[1]}" x2="${q[0]}" y2="${q[1]}"/>`;}));
 lines.push('<line x1="242457.8" y1="35957.8" x2="257457.8" y2="35957.8"/>','<line x1="257457.8" y1="35957.8" x2="242457.8" y2="35957.8"/>');
 for(const[x,y,text]of[[249957.8,31415.8,'161'],[249957.8,33439.8,'15 × 7.5'],[249957.8,38915.8,'144'],[249957.8,40939.8,'15 × 7.5'],[60598.1,90151.8,'30'],[60598.1,92083.8,'12 × 5'],[50598.1,90151.8,'31'],[50598.1,92083.8,'8 × 5']])lines.push(`<text x="${x}" y="${y}">${text}</text>`);
 const thumbSvg=booths.map(b=>`<polygon points="${b.polygon.map(p=>p.map(Math.round).join(',')).join(' ')}"/>`).join('\n');
 return{id:MAP_ID,document:{title:'All Levels – Working Plans',thumbSvg:'main untouched'},
  render:{[LEVEL_ID]:{svg:lines.join('\n'),boothsJson:JSON.stringify({booths,count:5,named:5})},main:{svg:'other level',boothsJson:'{"booths":[]}'}},
  levels:{[LEVEL_ID]:{thumbSvg,boothCount:5}},meta:{booths:{statusTypes:[{id:'s',name:'Status',statuses:[{id:'a',name:'Contract Received',color:'#e9931c'}]}],splits:{},
   assignments:{'144':{exhibitor:'Foton',statusIdsByType:{s:'a'}},'161':{exhibitor:'Foton',statusIdsByType:{s:'a'}},'30':{exhibitor:'40sqm'},'31':{exhibitor:'Genesis - 60sqm'},'143':{exhibitor:'Neighbour'}}}}};
}
test('merge and size swap keep source immutable, other geometry and every retained assignment unchanged',()=>{
 const source=fixture(),before=structuredClone(source),next=prepareStandAdjustment(source);
 assert.deepEqual(source,before);
 const booths=JSON.parse(next.render.boothsJson).booths;
 assert.equal(booths.find(b=>b.number==='144').area_m2,225);
 assert.equal(booths.find(b=>b.number==='30').area_m2,40);
 assert.equal(booths.find(b=>b.number==='31').area_m2,60);
 assert.ok(!booths.some(b=>b.number==='161'));
 assert.deepEqual(booths.find(b=>b.number==='143'),JSON.parse(source.render[LEVEL_ID].boothsJson).booths.find(b=>b.number==='143'));
 const expected=structuredClone(source.meta.booths);delete expected.assignments['161'];assert.deepEqual(next.meta,expected);
 assert.equal(next.level.boothCount,4);assert.equal(JSON.parse(next.render.boothsJson).named,4);
 assert.ok(!next.render.svg.includes('>161<'));assert.ok(next.render.svg.includes('>15 × 15<'));
});
test('refuses to merge conflicting exhibitors or statuses',()=>{
 const source=fixture();source.meta.booths.assignments['161'].exhibitor='Different company';
 assert.throws(()=>prepareStandAdjustment(source),/conflicting/);
 source.meta.booths.assignments['161'].exhibitor='Foton';source.meta.booths.assignments['161'].statusIdsByType.s='other';
 assert.throws(()=>prepareStandAdjustment(source),/conflicting/);
});
test('refuses unexpected geometry and existing target splits',()=>{
 const source=fixture();source.meta.booths.splits['30']={parts:[]};
 assert.throws(()=>prepareStandAdjustment(source),/already split/);
 delete source.meta.booths.splits['30'];const data=JSON.parse(source.render[LEVEL_ID].boothsJson);data.booths.find(b=>b.number==='31').polygon[0][0]+=1;
 source.render[LEVEL_ID].boothsJson=JSON.stringify(data);assert.throws(()=>prepareStandAdjustment(source));
});
