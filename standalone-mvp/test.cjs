const fs=require('node:fs');
const assert=require('node:assert/strict');
const {JSDOM,VirtualConsole}=require('jsdom');
const html=fs.readFileSync(require('node:path').join(__dirname,'index.html'),'utf8');
const KEY='local-workbench-v1';
let count=0;
function open(saved){
 const exports=[],errors=[];
 const virtualConsole=new VirtualConsole();virtualConsole.on('jsdomError',e=>errors.push(e.message));
 const dom=new JSDOM(html,{url:'http://localhost:8765',runScripts:'dangerously',virtualConsole,beforeParse(w){w.confirm=()=>true;w.Blob=Blob;w.URL.createObjectURL=blob=>{exports.push(blob);return 'blob:test';};w.URL.revokeObjectURL=()=>{};w.HTMLAnchorElement.prototype.click=function(){};if(saved!==undefined)w.localStorage.setItem(KEY,saved);}});
 const $=id=>dom.window.document.getElementById(id);
 return {dom,$,exports,errors,close:()=>dom.window.close(),saved:()=>dom.window.localStorage.getItem(KEY),data:()=>JSON.parse(dom.window.localStorage.getItem(KEY))};
}
function input(app,id,value){app.$(id).value=value;app.$(id).dispatchEvent(new app.dom.window.Event('input',{bubbles:true}));}
function submit(app,id){app.$(id).dispatchEvent(new app.dom.window.Event('submit',{bubbles:true,cancelable:true}));}
function create(app,title='Cooling review'){input(app,'new-title',title);input(app,'new-objective','Explain the thermal results');input(app,'new-criteria','Numbers checked\nClear limitations');submit(app,'create-form');}
async function restore(app,obj){const file={size:JSON.stringify(obj).length,text:async()=>JSON.stringify(obj)};Object.defineProperty(app.$('restore-file'),'files',{configurable:true,value:[file]});await app.$('restore-file').onchange({target:app.$('restore-file')});}
(async()=>{
 const a=open();assert.equal(a.data(),null);create(a);assert.equal(a.data().tasks.length,1);
 input(a,'draft','Accepted result A');assert(a.$('accept-latest').disabled);a.$('save-revision').click();assert(!a.$('accept-latest').disabled);a.$('accept-latest').click();
 const approved=a.data().tasks[0].accepted;assert(approved);
 input(a,'draft','Scratch result B');assert(a.$('accept-latest').disabled);
 a.$('export-accepted').click();const exported=JSON.parse(await a.exports.at(-1).text());assert.equal(exported.revision.body,'Accepted result A');assert.equal(exported.revision.id,approved);assert(!JSON.stringify(exported).includes('Scratch'));assert(!('revisions' in exported));assert(!('draft' in exported));count++;
 a.$('task-stage').value='moving';a.$('task-review').checked=true;submit(a,'task-form');assert.equal(a.data().tasks[0].stage,'moving');assert.equal(a.data().tasks[0].needsReview,true);assert(a.$('tasks').textContent.includes('Needs review'));count++;
 a.$('save-revision').click();assert.equal(a.data().tasks[0].revisions.length,2);assert.equal(a.data().tasks[0].accepted,approved);a.$('export-accepted').click();assert.equal(JSON.parse(await a.exports.at(-1).text()).revision.body,'Accepted result A');count++;
 input(a,'task-objective','Unsaved changed objective');assert(a.$('accept-latest').disabled);assert(a.$('save-revision').disabled);a.$('accept-latest').onclick();assert.equal(a.data().tasks[0].accepted,approved);assert(a.$('error').textContent.includes('task brief'));input(a,'task-objective','Explain the thermal results');count++;
 const saved=a.saved();a.$('backup').click();const backup=JSON.parse(await a.exports.at(-1).text());assert.equal(backup.tasks[0].draft,'Scratch result B');
 const b=open(saved);assert.equal(b.$('draft').value,'Scratch result B');b.$('export-accepted').click();assert.equal(JSON.parse(await b.exports.at(-1).text()).revision.body,'Accepted result A');assert.equal(b.data().tasks[0].accepted,approved);count++;
 const c=open();await restore(c,backup);assert.equal(c.data().tasks[0].draft,'Scratch result B');assert.equal(c.data().tasks[0].accepted,approved);count++;
 const prior=c.saved();await restore(c,{version:99,tasks:[]});assert.equal(c.saved(),prior);assert(c.$('error').textContent.includes('rejected'));await restore(c,{...backup,tasks:[...backup.tasks,...backup.tasks]});assert.equal(c.saved(),prior);await restore(c,{...backup,tasks:[{...backup.tasks[0],accepted:'missing'}]});assert.equal(c.saved(),prior);count++;
 const malicious=JSON.parse(JSON.stringify(backup));malicious.tasks[0].title='<img src=x onerror="window.hacked=true">';malicious.tasks[0].draft='<script>window.hacked=true</script>';await restore(c,malicious);assert.equal(c.dom.window.hacked,undefined);assert.equal(c.dom.window.document.querySelectorAll('img').length,0);assert(c.$('tasks').textContent.includes('<img'));count++;
 const d=open('{bad-json');assert(d.$('error').textContent.includes('not been overwritten'));create(d);assert.equal(d.saved(),'{bad-json');await restore(d,backup);assert.equal(d.data().tasks.length,1);count++;
 const oldSet=a.dom.window.Storage.prototype.setItem;a.dom.window.Storage.prototype.setItem=function(){throw Error('Quota exceeded');};input(a,'draft','Unsaved in-memory result C');assert(a.$('error').textContent.includes('Current edits remain in memory'));a.$('backup').click();assert.equal(JSON.parse(await a.exports.at(-1).text()).tasks[0].draft,'Unsaved in-memory result C');a.dom.window.Storage.prototype.setItem=oldSet;count++;
 for(const app of [a,b,c,d]){assert.deepEqual(app.errors,[]);app.close();}
 console.log('PASS: '+count+' workflow checks: create/save/accept, exact accepted export, independent review/stage, immutable revisions, reload, backup/restore, invalid/malicious backup rejection, corrupted-store protection, quota recovery.');
})().catch(e=>{console.error(e);process.exitCode=1;});
