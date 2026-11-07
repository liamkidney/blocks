const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

const root=path.join(__dirname,"..");
const source=fs.readFileSync(path.join(root,"install-gate.js"),"utf8");

function boot({ios=false,android=false,appMode=false,appleStandalone=false}={}){
  const rootClasses=new Set();
  const windowEvents={},documentEvents={};
  const button={hidden:true,events:{},addEventListener(name,fn){this.events[name]=fn}};
  const instructions={hidden:false,innerHTML:""};
  const status={textContent:""};
  const gate={
    id:"",innerHTML:"",removed:false,
    querySelector(selector){
      return {
        "#blocks-install-button":button,
        "#blocks-install-instructions":instructions,
        "#blocks-install-status":status
      }[selector];
    },
    remove(){this.removed=true}
  };
  const document={
    readyState:"loading",
    documentElement:{classList:{
      add:name=>rootClasses.add(name),
      remove:name=>rootClasses.delete(name)
    }},
    body:{appendChild(){document.mounted=gate}},
    createElement:()=>gate,
    getElementById:id=>id==="blocks-install-gate"?document.mounted:null,
    addEventListener:(name,fn)=>{documentEvents[name]=fn}
  };
  const window={
    addEventListener:(name,fn)=>{windowEvents[name]=fn},
    matchMedia:query=>({
      matches:appMode&&query==="(display-mode: standalone)",
      addEventListener:()=>{}
    })
  };
  const navigator={
    userAgent:ios?"Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X)":
      android?"Mozilla/5.0 (Linux; Android 16)":"Mozilla/5.0 (X11; Linux x86_64)",
    standalone:appleStandalone
  };
  vm.runInNewContext(source,{document,window,navigator,console},{filename:"install-gate.js"});
  if(documentEvents.DOMContentLoaded)documentEvents.DOMContentLoaded();
  return {rootClasses,windowEvents,documentEvents,document,gate,button,instructions,status};
}

test("standalone and iOS home-screen launches bypass installation gate",()=>{
  for(const options of [{appMode:true},{appleStandalone:true}]){
    const result=boot(options);
    assert.equal(result.rootClasses.size,0);
    assert.equal(result.document.mounted,undefined);
  }
});

test("browser launches are locked and show manual iOS install instructions",()=>{
  const result=boot({ios:true});
  assert.ok(result.rootClasses.has("blocks-install-required"));
  assert.equal(result.document.mounted,result.gate);
  assert.equal(result.button.hidden,true);
  assert.match(result.gate.innerHTML,/Install Blocks to play/);
  assert.match(result.instructions.innerHTML,/Safari/);
  assert.match(result.instructions.innerHTML,/Add to Home Screen/);
  assert.match(result.instructions.innerHTML,/Open as Web App/);
});

test("Android gets manual instructions when its install event is unavailable",()=>{
  const result=boot({android:true});
  assert.match(result.instructions.innerHTML,/Chrome/);
  assert.match(result.instructions.innerHTML,/Install app/);
  assert.equal(result.button.hidden,true);
});

test("Chromium prompt requires a click and accepting does not unlock browser play",async()=>{
  const result=boot({android:true});
  let prevented=0,prompted=0;
  result.windowEvents.beforeinstallprompt({
    preventDefault(){prevented++},
    prompt:async()=>{prompted++;return {outcome:"accepted"}}
  });
  assert.equal(prevented,1);
  assert.equal(prompted,0);
  assert.equal(result.button.hidden,false);
  assert.equal(result.instructions.hidden,true);
  await result.button.events.click();
  assert.equal(prompted,1);
  assert.equal(result.button.hidden,true);
  assert.ok(result.rootClasses.has("blocks-install-required"));
  assert.match(result.instructions.innerHTML,/Open/);
});

test("appinstalled shows launch instructions but never silently enables browser gameplay",()=>{
  const result=boot();
  result.windowEvents.appinstalled();
  assert.ok(result.rootClasses.has("blocks-install-required"));
  assert.match(result.status.textContent,/Open the app/);
  assert.match(result.instructions.innerHTML,/app icon/);
});

test("all game screens are hidden and the gate is precached and built in both channels",()=>{
  const css=fs.readFileSync(path.join(root,"install-gate.css"),"utf8");
  const sw=fs.readFileSync(path.join(root,"sw.js"),"utf8");
  const build=fs.readFileSync(path.join(root,"scripts/build-pages.mjs"),"utf8");
  const index=fs.readFileSync(path.join(root,"index.html"),"utf8");
  assert.match(css,/body > :not\(#blocks-install-gate\):not\(script\)/);
  for(const name of ["install-gate.js","install-gate.css"]){
    assert.ok(sw.includes('"'+name+'"'),"uncached "+name);
    assert.ok(build.includes('"'+name+'"'),"missing build asset "+name);
    assert.ok(index.includes(name),"not loaded by page: "+name);
  }
});
