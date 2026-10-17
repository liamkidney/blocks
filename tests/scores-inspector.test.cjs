const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

function runInspector(){
  const html=fs.readFileSync(path.join(__dirname,"..","scores-test.html"),"utf8");
  const script=html.match(/<script>([\\s\\S]*?)<\\/script>/)?.[1];
  assert.ok(script,"inspector should contain executable JavaScript");
  class Element{
    constructor(){this.children=[];this.textContent="";this.value="";this.listeners={};this.classList={add(){}};}
    appendChild(node){this.children.push(node);}
    replaceChildren(){this.children=[];}
    addEventListener(name,handler){this.listeners[name]=handler;}
  }
  const elements=new Map();
  const $=id=>{
    if(!elements.has(id))elements.set(id,new Element());
    return elements.get(id);
  };
  const requests=[];
  const playerId="11111111-1111-4111-8111-111111111111";
  const ctx=vm.createContext({
    document:{getElementById:$,createElement:()=>new Element()},
    URLSearchParams,
    fetch:async url=>{
      requests.push(url);
      const parsed=new URL(url);
      const selected=parsed.searchParams.get("select");
      assert.ok(selected&&selected!=="*","never fetch all columns");
      assert.doesNotMatch(selected,/delete_key_hash/,"the ownership hash is private");
      if(parsed.pathname.endsWith("/sessions"))
        return {ok:true,json:async()=>[{
          session_id:"33333333-3333-4333-8333-333333333333",
          player_id:playerId,score:125,lines:2,pieces_mode:"ALL",
          ghost_mode:false,status:"active",difficulty:1,
          started_at:"2026-10-17T10:00:00Z",updated_at:"2026-10-17T10:10:00Z"
        }]};
      if(parsed.pathname.endsWith("/players"))
        return {ok:true,json:async()=>[{
          player_id:playerId,display_name:"Test Player",
          created_at:"2026-10-17T10:00:00Z",
          updated_at:"2026-10-17T10:10:00Z"
        }]};
      throw Error("Unexpected endpoint");
    }
  });
  vm.runInContext(script,ctx,{filename:"scores-test.html"});
  return {requests,get:$,context:ctx};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));

test("raw inspector reads permitted columns rather than SELECT *",async()=>{
  const view=runInspector();
  await flush();
  const sessions=view.requests.find(url=>url.includes("/sessions?"));
  const players=view.requests.find(url=>url.includes("/players?"));
  assert.ok(sessions);
  assert.ok(players);
  assert.match(decodeURIComponent(sessions),/select=session_id,player_id,score,lines/);
  assert.match(decodeURIComponent(players),/select=player_id,display_name,created_at,updated_at/);
  assert.equal(view.get("rows").children.length,1);
  assert.equal(view.get("status").textContent,"1 shown / 1 loaded");
  const headings=view.get("head").children.map(item=>item.textContent);
  assert.ok(headings.includes("difficulty"));
  assert.ok(headings.includes("started_at"));
  assert.ok(!headings.includes("delete_key_hash"));
  assert.ok(!headings.includes("player_id"));
});

test("raw inspector preserves status filtering and refresh",async()=>{
  const view=runInspector();
  await flush();
  view.get("filter").value="completed";
  view.get("filter").listeners.change();
  assert.equal(view.get("rows").children.length,0);
  assert.equal(view.get("status").textContent,"0 shown / 1 loaded");
  view.get("filter").value="active";
  view.get("filter").listeners.change();
  assert.equal(view.get("rows").children.length,1);
  view.get("refresh").listeners.click();
  await flush();
  assert.equal(view.get("rows").children.length,1);
  assert.equal(view.requests.filter(url=>url.includes("/sessions?")).length,2);
});
