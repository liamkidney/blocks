// Two independent simulated phones exercise the real two-phone browser client.
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const source=fs.readFileSync(path.join(__dirname,'..','remote-multiplayer.js'),'utf8');

function fixture(){
  const rooms=new Map(),allEvents=[];
  let nextId=0,failAcknowledgement=false,joins=0,rematches=0;
  async function fetch(url,opts){
    const name=url.split('/').pop(),a=JSON.parse(opts.body);
    const success=data=>({ok:true,json:async()=>data});
    const failure=message=>({ok:false,status:400,json:async()=>({message})});
    if(name==='blocks_create_match'){
      const id=randomUUID(),hostToken=randomUUID(),code='ABCDEF';
      rooms.set(id,{id,code,hostToken,guestToken:null,status:'waiting',winner:null,
        round:1,host_ready:false,guest_ready:false,events:[]});
      return success([{match_id:id,room_code:code,player_token:hostToken}]);
    }
    if(name==='blocks_join_match'){
      joins++;
      const m=[...rooms.values()].find(m=>m.code===a.p_code&&m.status==='waiting');
      if(!m)return failure('Room already joined');
      m.guestToken=randomUUID();m.status='playing';
      return success([{match_id:m.id,player_token:m.guestToken}]);
    }
    const m=rooms.get(a.p_match);
    if(!m||![m.hostToken,m.guestToken].includes(a.p_token))return failure('Access denied');
    if(name==='blocks_match_poll')return success({
      status:m.status,winner:m.winner,round:m.round,
      host_ready:m.host_ready,guest_ready:m.guest_ready,
      events:m.events.filter(e=>e.round===m.round&&e.id>(a.p_after||0))
    });
    if(name==='blocks_match_send'){
      const sender=a.p_token===m.hostToken?1:2;
      let event=m.events.find(e=>e.key===a.p_key&&e.sender===sender);
      if(!event){
        if(m.status!=='playing'||m.round!==a.p_round)
          return failure('Match round not active');
        event={id:++nextId,key:a.p_key,sender,type:a.p_type,rows:a.p_rows,round:m.round};
        m.events.push(event);allEvents.push(event);
        if(event.type==='lost'){
          m.status='finished';m.winner=3-sender;
          m.host_ready=false;m.guest_ready=false;
        }
      }
      if(failAcknowledgement){
        failAcknowledgement=false;
        return failure('Simulated dropped acknowledgement');
      }
      return success(event.id);
    }
    if(name==='blocks_match_rematch'){
      rematches++;
      if(m.round>a.p_round)return success({status:m.status,round:m.round});
      if(m.status!=='finished'||m.round!==a.p_round)return failure('No rematch');
      if(a.p_token===m.hostToken)m.host_ready=true;
      else m.guest_ready=true;
      if(m.host_ready&&m.guest_ready){
        m.round++;m.status='playing';m.winner=null;
        m.host_ready=false;m.guest_ready=false;
      }
      return success({status:m.status,round:m.round,
        host_ready:m.host_ready,guest_ready:m.guest_ready});
    }
    return failure('Unknown RPC');
  }

  function browser(storage=new Map()){
    const nodes=new Map(),bodyElements=[];
    const get=id=>{
      if(!nodes.has(id))nodes.set(id,node(id));
      return nodes.get(id);
    };
    function node(id=''){
      const classes=new Set();
      return {
        id,hidden:false,value:'',textContent:'',disabled:false,onclick:null,attrs:{},
        classList:{
          toggle(name,on){if(on)classes.add(name);else classes.delete(name)},
          add(name){classes.add(name)},remove(name){classes.delete(name)},
          contains(name){return classes.has(name)}
        },
        listeners:{},
        setAttribute(key,value){this.attrs[key]=String(value)},
        addEventListener(event,handler){this.listeners[event]=handler},
        append(){},prepend(){},close(){},focus(){this.focused=true},
        querySelector(selector){return get(selector.replace('#',''));}
      };
    }
    const handlers=new Map(),intervals=new Map();
    let intervalId=0,resetCount=0;
    const attacks=[],results=[],rounds=[];
    const window={
      BLOCKS_REMOTE_CAPTURE:()=>({snapshot:{applied:attacks.length},progress:0}),
      BLOCKS_REMOTE_RESET:()=>{resetCount++;attacks.length=0;},
      addEventListener(name,fn){handlers.set(name,[...(handlers.get(name)||[]),fn])},
      dispatchEvent(ev){for(const fn of handlers.get(ev.type)||[])fn(ev)},
      confirm:()=>true
    };
    window.addEventListener('blocks:remote-event',e=>{
      if(e.detail.type==='attack')attacks.push(e.detail.rows);
    });
    window.addEventListener('blocks:remote-finished',e=>results.push(e.detail.winner));
    window.addEventListener('blocks:remote-new-round',e=>{
      rounds.push(e.detail.round);
      window.BLOCKS_REMOTE_RESET(); // app.js resets the local board on this event.
    });
    const localStorage={
      getItem:key=>storage.get(key)||null,
      setItem:(key,value)=>storage.set(key,String(value)),
      removeItem:key=>storage.delete(key)
    };
    const document={
      body:{append(el){bodyElements.push(el)},classList:{toggle(){}}},
      createElement:()=>node(),
      getElementById:()=>node(),
      addEventListener(){}
    };
    const location={pathname:'/blocks/dev/',search:'?remote=1',
      href:'https://example.test/blocks/dev/?remote=1'};
    const context={window,document,location,localStorage,fetch,
      navigator:{onLine:true,clipboard:{writeText:async()=>{}}},
      URL,URLSearchParams,WebSocket:undefined,
      setInterval:(fn)=>{const id=++intervalId;intervals.set(id,fn);return id},
      clearInterval:id=>intervals.delete(id),
      clearTimeout:()=>{},setTimeout:()=>1,
      crypto:{randomUUID},console,CustomEvent:class{
        constructor(type,options){this.type=type;this.detail=options?.detail}
      }
    };
    vm.runInNewContext(source,context,{filename:'remote-multiplayer.js'});
    return {
      window,get,attacks,results,rounds,storage,bodyElements,
      get resetCount(){return resetCount},
      async tick(){
        for(const fn of [...intervals.values()])await fn();
      },
      popup(id){return bodyElements.find(el=>el.id===id)}
    };
  }
  return {
    browser,rooms,allEvents,setDropAck:()=>{failAcknowledgement=true},
    get joins(){return joins},get rematches(){return rematches}
  };
}
async function settle(){for(let i=0;i<60;i++)await Promise.resolve();}
async function matched(f){
  const host=f.browser(),guest=f.browser();
  assert.equal(host.get('remote-entry').hidden,true);
  assert.equal(host.get('remote-code-panel').hidden,true);
  assert.equal(host.get('remote-actions').hidden,false);
  host.get('remote-create').onclick();
  assert.equal(host.get('remote-create').classList.contains('is-loading'),true);
  assert.equal(host.get('remote-create').attrs['aria-busy'],'true');
  await settle();
  assert.equal(host.get('remote-create').classList.contains('is-loading'),false);
  assert.match(host.get('remote-code').textContent,/^[A-Z]{6}$/);
  guest.get('remote-join').onclick();
  assert.equal(guest.get('remote-entry').hidden,false);
  assert.equal(guest.get('remote-slots').textContent,'— — — — — —');
  guest.get('remote-input').value='abcde';
  guest.get('remote-input').listeners.input();
  assert.equal(f.joins,0,'Do not attempt a join before six letters');
  assert.equal(guest.get('remote-slots').textContent,'A B C D E —');
  guest.get('remote-input').value='abcdef';
  guest.get('remote-input').listeners.input(); // Auto-submits without Enter.
  await settle();
  await host.tick();await settle();
  assert.equal(f.joins,1);
  assert.equal(host.window.BLOCKS_REMOTE.ready,true);
  assert.equal(guest.window.BLOCKS_REMOTE.ready,true);
  return {host,guest};
}

test('two-button lobby creates rooms with a spinner and joins after six letters',async()=>{
  const f=fixture(),{host,guest}=await matched(f);
  assert.equal(host.get('remote-lobby')?.hidden,false); // Fake DOM nodes only.
  assert.equal(guest.window.BLOCKS_REMOTE.player,2);
  assert.equal(host.window.BLOCKS_REMOTE.player,1);
  assert.equal(f.rooms.size,1);
});

test('attack is delivered once to the other phone with separate board state',async()=>{
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

test('reconnecting retains the saved cursor and does not repeat attacks',async()=>{
  const f=fixture(),{host,guest}=await matched(f);
  host.window.BLOCKS_REMOTE.sendAttack(2);
  await settle();await guest.tick();await settle();
  const replacement=f.browser(guest.storage); // Auto-resumes an existing match.
  await settle();await replacement.tick();await settle();
  assert.deepEqual(replacement.attacks,[]);
  host.window.BLOCKS_REMOTE.sendAttack(1);
  await settle();await replacement.tick();await settle();
  assert.deepEqual(replacement.attacks,[1]);
});

test('a dropped acknowledgement retries an attack key without duplicate junk',async()=>{
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

test('completed match keeps the game displayed behind an independent result panel',async()=>{
  const f=fixture(),{host,guest}=await matched(f);
  guest.window.BLOCKS_REMOTE.reportLoss();await settle();
  await host.tick();await guest.tick();await settle();
  assert.deepEqual(host.results,[1]);
  assert.deepEqual(guest.results,[1]);
  assert.equal(host.get('remote-result-title').textContent,'YOU WIN');
  assert.equal(guest.get('remote-result-title').textContent,'YOU LOSE');
  assert.equal(host.get('remote-result-detail').textContent,'PLAYER 1 WON · PLAYER 2 LOST');
  assert.equal(host.popup('remote-result').hidden,false);
  assert.equal(host.popup('remote-lobby').hidden,true);
});

test('rematch waits for both players and starts new round without a new code',async()=>{
  const f=fixture(),{host,guest}=await matched(f);
  const id=host.window.BLOCKS_REMOTE.round;
  host.window.BLOCKS_REMOTE.sendAttack(2);await settle();await guest.tick();await settle();
  guest.window.BLOCKS_REMOTE.reportLoss();await settle();
  await host.tick();await guest.tick();await settle();
  host.get('remote-restart').onclick();await settle();
  await host.tick();await guest.tick();await settle();
  assert.equal(host.get('remote-restart').disabled,true);
  assert.match(host.get('remote-rematch-status').textContent,/Waiting for the other player/);
  assert.equal(f.rooms.size,1);
  assert.equal(f.rooms.values().next().value.round,id);
  assert.equal(guest.get('remote-restart').disabled,false);
  guest.get('remote-restart').onclick();await settle();
  await host.tick();await guest.tick();await settle();
  assert.equal(host.window.BLOCKS_REMOTE.round,id+1);
  assert.equal(guest.window.BLOCKS_REMOTE.round,id+1);
  assert.deepEqual(host.rounds,[id+1]);
  assert.deepEqual(guest.rounds,[id+1]);
  assert.equal(host.popup('remote-result').hidden,true);
  assert.equal(guest.popup('remote-result').hidden,true);
  assert.equal(host.window.BLOCKS_REMOTE.ready,true);
  assert.equal(guest.window.BLOCKS_REMOTE.ready,true);
  assert.deepEqual(guest.attacks,[],'Old junk not carried into a rematch');
  assert.equal(f.rooms.size,1,'Room and players are retained');
  assert.equal(f.rematches,2);
});

test('finished match restores its winner when reopened on the same phone',async()=>{
  const f=fixture(),{host,guest}=await matched(f);
  guest.window.BLOCKS_REMOTE.reportLoss();await settle();
  await host.tick();await guest.tick();await settle();
  const restored=f.browser(host.storage);await settle();
  assert.equal(restored.get('remote-result-title').textContent,'YOU WIN');
  assert.equal(restored.popup('remote-result').hidden,false);
});
