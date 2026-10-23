// Exercise the two-phone client protocol with independent simulated browsers.
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const source=fs.readFileSync(path.join(__dirname,'..','remote-multiplayer.js'),'utf8');

function fixture(){
  const rooms=new Map(),allEvents=[];
  let nextId=0,failAcknowledgement=false;
  async function fetch(url,opts){
    const name=url.split('/').pop(),a=JSON.parse(opts.body);
    const success=data=>({ok:true,json:async()=>data});
    const failure=message=>({ok:false,status:400,json:async()=>({message})});
    if(name==='blocks_create_match'){
      const id=randomUUID(),hostToken=randomUUID(),code='ABCDEF';
      rooms.set(id,{id,code,hostToken,guestToken:null,status:'waiting',winner:null,events:[]});
      return success([{match_id:id,room_code:code,player_token:hostToken}]);
    }
    if(name==='blocks_join_match'){
      const m=[...rooms.values()].find(m=>m.code===a.p_code&&m.status==='waiting');
      if(!m)return failure('Room already joined');
      m.guestToken=randomUUID();m.status='playing';
      return success([{match_id:m.id,player_token:m.guestToken}]);
    }
    const m=rooms.get(a.p_match);
    if(!m||![m.hostToken,m.guestToken].includes(a.p_token))return failure('Access denied');
    if(name==='blocks_match_poll')
      return success({status:m.status,winner:m.winner,
        events:m.events.filter(e=>e.id>(a.p_after||0))});
    if(name==='blocks_match_send'){
      const sender=a.p_token===m.hostToken?1:2;
      let event=m.events.find(e=>e.key===a.p_key&&e.sender===sender);
      if(!event){
        if(m.status!=='playing')return failure('Match not active');
        event={id:++nextId,key:a.p_key,sender,type:a.p_type,rows:a.p_rows};
        m.events.push(event);allEvents.push(event);
        if(event.type==='lost'){m.status='finished';m.winner=3-sender;}
      }
      if(failAcknowledgement){
        failAcknowledgement=false;
        return failure('Simulated dropped acknowledgement');
      }
      return success(event.id);
    }
    return failure('Unknown RPC');
  }
  function browser(storage=new Map()){
    const node=()=>({
      hidden:false,value:'',textContent:'',disabled:false,onclick:null,
      classList:{toggle(){}},listeners:{},
      addEventListener(event,handler){this.listeners[event]=handler;},
      append(){},prepend(){},close(){},
      querySelector(selector){return nodes.get(selector.replace('#',''))||get(selector.replace('#',''));},
    });
    const nodes=new Map();
    const get=id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id)};
    const handlers=new Map(),intervals=new Map();
    let intervalId=0;
    const window={
      BLOCKS_REMOTE_CAPTURE:()=>({snapshot:{applied:attacks.length},progress:0}),
      BLOCKS_REMOTE_RESET:()=>{attacks.length=0;},
      addEventListener(name,fn){handlers.set(name,[...(handlers.get(name)||[]),fn]);},
      dispatchEvent(ev){for(const fn of handlers.get(ev.type)||[])fn(ev);},
      confirm:()=>true
    };
    const attacks=[],results=[];
    window.addEventListener('blocks:remote-event',e=>{
      if(e.detail.type==='attack')attacks.push(e.detail.rows);
    });
    window.addEventListener('blocks:remote-finished',e=>results.push(e.detail.winner));
    const localStorage={
      getItem:key=>storage.get(key)||null,
      setItem:(key,value)=>storage.set(key,String(value)),
      removeItem:key=>storage.delete(key)
    };
    const document={
      body:{append(){},classList:{toggle(){}},hidden:false},
      createElement:()=>node(),
      getElementById:()=>node(),
      addEventListener(){}
    };
    const location={pathname:'/blocks/dev/',search:'?remote=1',href:'https://example.test/blocks/dev/?remote=1'};
    const context={window,document,location,localStorage,fetch,
      navigator:{onLine:true},URL,URLSearchParams,
      setInterval:(fn)=>{const id=++intervalId;intervals.set(id,fn);return id;},
      clearInterval:id=>intervals.delete(id),
      clearTimeout:()=>{},setTimeout:()=>1,
      crypto:{randomUUID},console,CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail;}}};
    vm.runInNewContext(source,context,{filename:'remote-multiplayer.js'});
    return {
      window,get,attacks,results,storage,
      async tick(){for(const fn of [...intervals.values()])await fn();}
    };
  }
  return {browser,rooms,allEvents,setDropAck:()=>{failAcknowledgement=true}};
}
async function settle(){for(let i=0;i<30;i++)await Promise.resolve();}
async function matched(f){
  const host=f.browser(),guest=f.browser();
  host.get('remote-create').onclick();await settle();
  assert.match(host.get('remote-code').textContent,/^[A-Z]{6}$/);
  guest.get('remote-input').value='ABCDEF';
  guest.get('remote-join').onclick();await settle();
  await host.tick();await settle();
  assert.equal(host.window.BLOCKS_REMOTE.ready,true);
  assert.equal(guest.window.BLOCKS_REMOTE.ready,true);
  return {host,guest};
}

test('two phones join a room and receive attacks once, without shared boards',async()=>{
  const f=fixture(),{host,guest}=await matched(f);
  host.window.BLOCKS_REMOTE.sendAttack(2);
  await settle();await guest.tick();await settle();
  assert.deepEqual(guest.attacks,[2]);
  assert.deepEqual(host.attacks,[]);
  await guest.tick();await settle();
  assert.deepEqual(guest.attacks,[2]);
  assert.equal(f.allEvents.length,1);
  const saved=JSON.parse(guest.storage.get('blocks:remote-match:/blocks/dev/'));
  assert.equal(saved.snapshot.applied,1);
  assert.equal(saved.cursor,f.allEvents[0].id);
});

test('reloading restores the cursor and snapshot without replaying junk',async()=>{
  const f=fixture(),{host,guest}=await matched(f);
  host.window.BLOCKS_REMOTE.sendAttack(2);
  await settle();await guest.tick();await settle();
  const replacement=f.browser(guest.storage);
  replacement.get('remote-resume').onclick();await settle();
  await replacement.tick();await settle();
  assert.deepEqual(replacement.attacks,[]);
  host.window.BLOCKS_REMOTE.sendAttack(1);
  await settle();await replacement.tick();await settle();
  assert.deepEqual(replacement.attacks,[1]);
});

test('a dropped response retries the same event key without duplicate junk',async()=>{
  const f=fixture(),{host,guest}=await matched(f);
  f.setDropAck();
  host.window.BLOCKS_REMOTE.sendAttack(2);await settle();
  assert.equal(f.allEvents.length,1);
  await host.tick();await settle();await guest.tick();await settle();
  assert.equal(f.allEvents.length,1);
  assert.deepEqual(guest.attacks,[2]);
  const saved=JSON.parse(host.storage.get('blocks:remote-match:/blocks/dev/'));
  assert.deepEqual(saved.outbox,[]);
});

test('forfeiting ends the match with the opponent as winner',async()=>{
  const f=fixture(),{host,guest}=await matched(f);
  guest.window.BLOCKS_REMOTE.reportLoss();await settle();
  await host.tick();await guest.tick();await settle();
  assert.deepEqual(host.results,[1]);
  assert.deepEqual(guest.results,[1]);
  assert.equal(host.get('remote-title').textContent,'YOU WIN');
  assert.equal(guest.get('remote-title').textContent,'YOU LOSE');
});
