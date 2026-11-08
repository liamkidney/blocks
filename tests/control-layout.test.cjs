const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const root=path.join(__dirname,"..");
const source=fs.readFileSync(path.join(root,"control-layout.js"),"utf8");
const key="blocks:control-order:v1:/blocks/dev/";
const commands=["left","right","down","rotate_cw"];

function makePad(commandsList=commands){
  const children=commandsList.map(command=>({
    dataset:{command},attrs:{"aria-label":command==="rotate_cw"?"Rotate clockwise":
      command==="down"?"Drop":"Move "+command},
    style:{props:{},setProperty(name,value){this.props[name]=String(value)}},
    getAttribute(name){return this.attrs[name]},
    setAttribute(name,value){this.attrs[name]=value},
    cloneNode(){
      const clone=makePad([command]).children[0];
      clone.attrs={...this.attrs};
      return clone;
    }
  }));
  return {
    children,
    classList:{add(name){this.mode=name}},
    querySelectorAll(selector){
      return selector===".control"||selector==="button.control"?this.children:[];
    },
    appendChild(button){this.children=this.children.filter(v=>v!==button);this.children.push(button)}
  };
}
function boot(storage,pad=makePad()){
  const doc={
    querySelectorAll:()=>pad.children,
    createElement:()=>makePad([])
  };
  const window={};
  const localStorage={getItem:k=>storage.get(k)??null,
    setItem:(k,v)=>storage.set(k,String(v))};
  vm.runInNewContext(source,{window,document:doc,location:{pathname:"/blocks/dev/"},
    localStorage,console},{filename:"control-layout.js"});
  return {api:window.BLOCKS_CONTROL_LAYOUT,pad,storage};
}
function visual(pad){
  return pad.children.slice().sort((a,b)=>
    Number(a.style.props["--portrait-control-order"])-
    Number(b.style.props["--portrait-control-order"])).map(x=>x.dataset.command);
}

test("legacy preference loads once and returns defensive copies",()=>{
  const stored=new Map([[key,'["right","left","rotate_cw","down"]']]);
  const {api,pad}=boot(stored);
  api.apply();
  assert.deepEqual(visual(pad),["right","left","rotate_cw","down"]);
  const order=api.getOrder();
  order.reverse();
  assert.deepEqual(Array.from(api.getOrder()),["right","left","rotate_cw","down"]);
});
test("validation ignores malformed and duplicate stored values",()=>{
  for(const invalid of ["oops",'["left","left","right","down"]','["left","right"]']){
    const {api,pad}=boot(new Map([[key,invalid]]));
    api.apply();
    assert.deepEqual(visual(pad),commands);
    assert.equal(api.save(["left","left","right","down"]),false);
  }
});
test("all control pads share save/reset and retain order on a new page load",()=>{
  const stored=new Map();
  const first=boot(stored);
  assert.equal(first.api.save(["down","rotate_cw","right","left"]),true);
  assert.equal(stored.get(key),'["down","rotate_cw","right","left"]');
  const remote=boot(stored);
  remote.api.apply();
  assert.deepEqual(visual(remote.pad),["down","rotate_cw","right","left"]);
  remote.api.reset();
  assert.deepEqual(visual(remote.pad),commands);
  const next=boot(stored);
  next.api.apply();
  assert.deepEqual(visual(next.pad),commands); // Storage persists defaults.
});
test("second-player pad clones canonical control buttons rather than markup",()=>{
  const stored=new Map([[key,'["right","down","rotate_cw","left"]']]);
  const {api,pad}=boot(stored);
  const second=api.createPad(pad,1);
  assert.equal(second.children.length,4);
  assert.deepEqual(second.children.map(x=>x.dataset.command),commands);
  for(let i=0;i<4;i++){
    assert.notEqual(second.children[i],pad.children[i]);
    assert.equal(second.children[i].dataset.player,"1");
    assert.match(second.children[i].getAttribute("aria-label"),/^Player 2 /);
  }
  api.prepareDiamondPad(pad);
  api.prepareDiamondPad(second);
  assert.deepEqual(visual(second),["right","down","rotate_cw","left"]);
  for(const group of [pad,second]){
    const cols=group.children.map(x=>x.style.props["--diamond-control-column"]);
    assert.deepEqual(cols,["1 / 3","1","2","1 / 3"]);
    assert.equal(group.classList.mode,"diamond-pad");
  }
});
test("build, offline worker and both page channels include the single module",()=>{
  for(const name of ["index.html","sw.js","scripts/build-pages.mjs",
    ".github/workflows/check-dev.yml",".github/workflows/pages.yml"]){
    assert.match(fs.readFileSync(path.join(root,name),"utf8"),/control-layout\.js/,name);
  }
  const multiplayer=fs.readFileSync(path.join(root,"multiplayer.js"),"utf8");
  assert.match(multiplayer,/BLOCKS_CONTROL_LAYOUT\.createPad/);
  assert.match(multiplayer,/BLOCKS_CONTROL_LAYOUT\.prepareDiamondPad/);
  assert.doesNotMatch(multiplayer,/controls2\.innerHTML\s*=/);
  const app=fs.readFileSync(path.join(root,"app.js"),"utf8");
  assert.match(app,/controlLayout\.save\(state\.order\)/);
  assert.doesNotMatch(app,/SOLO_CONTROL_ORDER_KEY|BLOCKS_APPLY_CONTROL_ORDER/);
});
