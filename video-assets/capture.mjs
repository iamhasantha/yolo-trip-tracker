import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve('video-assets');
const base='http://127.0.0.1:4100';
const pages=await (await fetch('http://127.0.0.1:9224/json')).json();
const ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
await new Promise(r=>ws.onopen=r);
let id=0, recording=null;
const pending=new Map();
ws.onmessage=({data})=>{const m=JSON.parse(data); if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p?.reject(Error(m.error.message)):p?.resolve(m.result);} else if(m.method==='Page.screencastFrame'){cmd('Page.screencastFrameAck',{sessionId:m.params.sessionId});if(recording){const file=`frame-${String(recording.frames.length).padStart(5,'0')}.jpg`;fs.writeFileSync(path.join(recording.dir,file),Buffer.from(m.params.data,'base64'));recording.frames.push({file,time:performance.now()});}}};
function cmd(method,params={}){return new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});}
async function ev(expression){const r=await cmd('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(expr){for(let i=0;i<100;i++){if(await ev(expr))return;await wait(100);}throw Error('Timed out: '+expr);}
async function nav(route){await cmd('Page.navigate',{url:base+route});await until('document.readyState === "complete" && !!document.querySelector("#app h2, #app h1")');await ev('document.fonts.ready');await wait(700);}
async function click(selector){await ev(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',behavior:'smooth'})`);await wait(500);const p=await ev(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);await cmd('Input.dispatchMouseEvent',{type:'mouseMoved',...p});await wait(200);await cmd('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...p});await cmd('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...p});await wait(450);}
async function type(selector,value){await click(selector);await ev(`document.querySelector(${JSON.stringify(selector)}).value='';document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new Event('input',{bubbles:true}))`);for(const text of String(value)){await cmd('Input.insertText',{text});await wait(55);}}
async function select(selector,value){await ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(String(value))};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);await wait(400);}
async function tab(name){await ev(`[...document.querySelectorAll('.tabs .tab')].find(e=>e.textContent.includes(${JSON.stringify(name)})).click()`);await wait(650);await ev(`document.querySelector('.tabs').scrollIntoView({block:'start',behavior:'smooth'})`);await wait(650);}
async function shot(name){const s=await cmd('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(root,'stills',name+'.png'),Buffer.from(s.data,'base64'));}
const manifest=[];
async function clip(name,fn){console.log('Recording '+name);const dir=path.join(root,'work',name);fs.mkdirSync(dir,{recursive:true});recording={dir,frames:[],start:performance.now()};await cmd('Page.startScreencast',{format:'jpeg',quality:95,maxWidth:1920,maxHeight:1080,everyNthFrame:1});await wait(1000);await fn();await wait(1700);await shot(name);await cmd('Page.stopScreencast');const r=recording;recording=null;const end=performance.now();const lines=['ffconcat version 1.0'];r.frames.forEach((f,i)=>{lines.push(`file '${f.file}'`,`duration ${((r.frames[i+1]?.time??end)-f.time)/1000}`);});lines.push(`file '${r.frames.at(-1).file}'`);fs.writeFileSync(path.join(dir,'frames.ffconcat'),lines.join('\n'));manifest.push({name,duration:(end-r.frames[0].time)/1000,frames:r.frames.length});fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify(manifest,null,2));console.log('Saved '+name);}
async function api(route,data,token,method='POST'){const r=await fetch(base+'/api'+route,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(data)});if(!r.ok)throw Error(await r.text());return r.json();}
await cmd('Page.enable');await cmd('Runtime.enable');
await cmd('Emulation.setDeviceMetricsOverride',{width:1440,height:810,deviceScaleFactor:4/3,mobile:false});
await nav('/');
await clip('01-landing',async()=>{await wait(2300);});
await nav('/create');
await clip('02-create-trip',async()=>{await type('#name','Ella Weekend');await type('#creator','Alex');await type('#creator-pin','2468');await type('#amount','10000');await click('form button[type=submit]');await until('!!document.querySelector(".stamp-code")');await wait(900);});
const code=await ev('location.pathname.split("/").pop()');
const token=await ev(`localStorage.getItem('yolo:${code}:token')`);
const alexId=Number(await ev(`localStorage.getItem('yolo:${code}:memberId')`));
await clip('03-share-code',async()=>{await click('.stamp-code');await wait(1200);});
await nav('/join');await click('.access-mode button:first-child');
await clip('04-join-the-squad',async()=>{await type('#code',code);await type('#name','Maya');await type('#member-pin','1357');await click('form button[type=submit]');await until('!!document.querySelector(".stamp-code")');});
const mayaToken=await ev(`localStorage.getItem('yolo:${code}:token')`);
const mayaId=Number(await ev(`localStorage.getItem('yolo:${code}:memberId')`));
const kai=await api(`/trips/${code}/members`,{name:'Kai',pin:'3456'});
const zara=await api(`/trips/${code}/members`,{name:'Zara',pin:'4567'});
await ev(`localStorage.setItem('yolo:${code}:token',${JSON.stringify(token)});localStorage.setItem('yolo:${code}:name','Alex');localStorage.setItem('yolo:${code}:memberId','${alexId}')`);
for(const memberId of [alexId,mayaId,kai.id])await api(`/trips/${code}/contributions`,{memberId,amount:10000,note:'Trip fund'},token);
for(const [description,amount,category] of [['Cabin with a view',12000,'Stay'],['Fuel for the road',6000,'Transport'],['Breakfast with the crew',3600,'Food'],['Nine Arch Bridge tuk-tuk',2400,'Activities']])await api(`/trips/${code}/expenses`,{description,amount,category},token);
await api(`/trips/${code}/notes`,{content:'Meet at 6 AM. Yes, AM. Bring a hoodie.',priority:false},mayaToken);
await api(`/trips/${code}/notes`,{content:'Playlist sorted. Main-character window seats are first come, first served.',priority:false},kai.token);
await api(`/trips/${code}/messages`,{text:'Group chat trip is finally happening.'},mayaToken);
await api(`/trips/${code}/messages`,{text:'I call aux. No negotiations.'},kai.token);
await nav('/trip/'+code);
await tab('Contributions');
await clip('05-record-contribution',async()=>{await select('form select',zara.id);await type('form input[type=number]','10000');await type('form input[placeholder]','Paid. Screenshot era over.');await click('form button[type=submit]');await wait(1000);});
await tab('Breakdown');await ev('document.querySelector(".stat-grid").scrollIntoView({block:"start",behavior:"smooth"})');await wait(800);
await clip('06-budget-overview',async()=>{await wait(2500);});
await tab('Expenses');
await clip('07-log-snack-run',async()=>{await type('form input[placeholder]','Emotionally necessary snacks');await type('form input[type=number]','1800');await select('form select','Food');await click('form button[type=submit]');await wait(800);await ev('document.querySelector("table").scrollIntoView({block:"center",behavior:"smooth"})');await wait(1300);});
await tab('Breakdown');await ev('window.scrollTo({top:document.body.scrollHeight,behavior:"smooth"})');await wait(1000);
await clip('08-spending-breakdown',async()=>{await wait(2700);});
await tab('Chat');await ev('document.querySelector(".trip-chat").scrollIntoView({block:"center",behavior:"smooth"})');await wait(800);
await clip('09-trip-chat',async()=>{await type('#chat-text','One more stop? The budget says yes.');await click('.chat-compose button');await wait(1500);});
await tab('Notes');
await clip('10-sticky-notes',async()=>{await type('#note-content','Sunrise hike. Coffee first. Obviously.');await click('.notes-composer button[type=submit]');await ev('document.querySelector(".notes-grid").scrollIntoView({block:"center",behavior:"smooth"})');await wait(1800);});
await tab('Breakdown');await ev('document.querySelector(".stat-grid").scrollIntoView({block:"center",behavior:"smooth"})');await wait(800);
await clip('11-balance-in-pot',async()=>{await wait(2300);});
await api(`/trips/${code}/completion/vote`,{memberId:mayaId,vote:true},mayaToken,'PUT');
await nav('/trip/'+code);
await clip('12-complete-trip',async()=>{await click('.completion-actions button');await until('document.body.textContent.includes("Your final report is ready")');await wait(1700);});
const pdf=await fetch(base+`/api/trips/${code}/report.pdf`);fs.writeFileSync(path.join(root,'Ella-Weekend-report.pdf'),Buffer.from(await pdf.arrayBuffer()));
fs.writeFileSync(path.join(root,'demo.json'),JSON.stringify({url:base+'/trip/'+code,code,name:'Ella Weekend',demoMembers:['Alex','Maya','Kai','Zara'],alexPin:'2468'},null,2));
console.log('CAPTURE COMPLETE '+code);ws.close();
