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
  let nextId=0,failAcknowledgement=false,dropJoinAck=false,joins=0,starts=0,rematches=0;
  async function fetch(url,opts){
    const name=url.split('/').pop(),a=JSON.parse(opts.body);
    const success=data=>({ok:true,json:async()=>data});
    const failure=message=>({ok:false,status:400,json:async()=>({message})});
    if(name==='blocks_create_match'||name==='blocks_create_match_config'||
       name==='blocks_create_match_short'){
      const id=randomUUID(),hostToken=randomUUID();
      const code=name==='blocks_create_match_short'?'BRT':'ABCDEF';
      const code_expires_at=new Date(Date.now()+180000).toISOString();
      rooms.set(id,{id,code,hostToken,guestToken:null,status:'waiting',winner:null,
        round:1,host_ready:false,guest_ready:false,host_wins:0,guest_wins:0,
        difficulty:a.p_difficulty??1,piece_set:a.p_piece_set??'ALL',
        presence_enabled:name==='blocks_create_match_config'||name==='blocks_create_match_short',
        code_expires_at,
        host_online:true,guest_online:true,events:[]});
      if(name==='blocks_create_match_short')
        // PostgREST serialises RETURNS TABLE (SETOF records) as an array.
        return success([{match_id:id,room_code:code,player_token:hostToken,code_expires_at}]);
      return success([{match_id:id,room_code:code,player_token:hostToken}]);
    }
    if(name==='blocks_join_match'||name==='blocks_join_match_v2'||
       name==='blocks_join_match_short'){
      joins++;
      const m=[...rooms.values()].find(m=>m.code===a.p_code&&
        (m.status==='waiting'||m.guestToken===a.p_join_token&&
         ['ready','playing','finished'].includes(m.status)));
      if(!m||m.status==='waiting'&&Date.parse(m.code_expires_at)<=Date.now())
        return name==='blocks_join_match_short'?
          success({error:'Room not found or code expired.'}):
          failure('Room already joined');
      if(m.status==='waiting'){m.guestToken=a.p_join_token||randomUUID();m.status='ready';}
      if(dropJoinAck){dropJoinAck=false;return failure('Connection dropped after join');}
      if(name==='blocks_join_match_short')
        return success({match_id:m.id,player_token:m.guestToken});
      return success([{match_id:m.id,player_token:m.guestToken}]);
    }
    const m=rooms.get(a.p_match);
    if(!m||![m.hostToken,m.guestToken].includes(a.p_token))return failure('Access denied');
    if(name==='blocks_expire_short_invite'){
      if(m.status!=='waiting')return success({status:m.status});
      if(Date.now()<Date.parse(m.code_expires_at))
        return success({status:'waiting',expires_at:m.code_expires_at});
      m.status='cancelled';
      return success({status:'expired'});
    }
    if(name==='blocks_match_heartbeat'){
      if(a.p_round!==m.round)return failure('Match round has changed');
      if(a.p_token===m.hostToken)m.host_online=true;
      else m.guest_online=true;
      return success({status:m.status,round:m.round});
    }
    if(name==='blocks_match_poll')return success({
      status:m.status,winner:m.winner,round:m.round,
      host_ready:m.host_ready,guest_ready:m.guest_ready,
      host_wins:m.host_wins,guest_wins:m.guest_wins,
      difficulty:m.difficulty,piece_set:m.piece_set,
      presence_enabled:m.presence_enabled,host_online:m.host_online,guest_online:m.guest_online,
      events:m.events.filter(e=>e.round===m.round&&e.id>(a.p_after||0))
    });
    if(name==='blocks_match_start'){
      starts++;
      if(a.p_round!==m.round)return failure('Match round has changed');
      if(m.status==='playing')return success({
        status:m.status,round:m.round,host_ready:m.host_ready,guest_ready:m.guest_ready,
        host_wins:m.host_wins,guest_wins:m.guest_wins
      });
      if(m.status!=='ready')return failure('Match not ready to start');
      if(a.p_token===m.hostToken)m.host_ready=true;
      else m.guest_ready=true;
      if(m.host_ready&&m.guest_ready){
        m.status='playing';m.host_ready=false;m.guest_ready=false;
      }
      return success({
        status:m.status,round:m.round,host_ready:m.host_ready,guest_ready:m.guest_ready,
        host_wins:m.host_wins,guest_wins:m.guest_wins
      });
    }
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
          if(m.winner===1)m.host_wins++;
          else m.guest_wins++;
          m.host_ready=false;m.guest_ready=false;
        }
      }
      if(failAcknowledgement){
        failAcknowledgement=false;
        return failure('Simulated dropped acknowledgement');
      }
      return success(event.id);
    }
    if(name==='blocks_match_exit'){
      if(m.status!=='cancelled'&&a.p_round!==m.round)return failure('Stale match round');
      if(!['waiting','ready','finished','playing','cancelled'].includes(m.status))
        return failure('Match cannot be exited');
      m.status='cancelled';m.host_ready=false;m.guest_ready=false;
      return success({status:'cancelled',round:m.round});
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

  function browser(storage=new Map(),config={difficulty:1,piece_set:'ALL'}){
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
        style:(()=>{
          const styles=new Map();
          return {
            setProperty:(name,value)=>styles.set(name,String(value)),
            removeProperty:name=>styles.delete(name),
            getPropertyValue:name=>styles.get(name)||''
          };
        })(),
        setAttribute(key,value){this.attrs[key]=String(value)},
        addEventListener(event,handler){this.listeners[event]=handler},
        append(){},prepend(){},close(){},
        focus(){document.activeElement=this;this.focused=true;this.listeners.focus?.()},
        blur(){if(document.activeElement===this)document.activeElement=null;
          this.focused=false;this.listeners.blur?.()},
        querySelector(selector){return get(selector.replace('#',''));}
      };
    }
    const handlers=new Map(),intervals=new Map(),viewportHandlers=new Map();
    let intervalId=0,resetCount=0;
    const visualViewport={
      height:400,width:390,offsetTop:0,offsetLeft:0,
      addEventListener(name,handler){viewportHandlers.set(name,handler)},
      resizeTo(height,top=0){
        this.height=height;this.offsetTop=top;
        viewportHandlers.get('resize')?.();
      }
    };
    const attacks=[],results=[],rounds=[],holds=[],unholds=[],configs=[];
    const window={
      BLOCKS_REMOTE_LOCAL_CONFIG:config,
      visualViewport,innerHeight:800,innerWidth:390,
      BLOCKS_REMOTE_CAPTURE:()=>({snapshot:{applied:attacks.length},progress:0}),
      BLOCKS_REMOTE_RESET:()=>{resetCount++;attacks.length=0;},
      addEventListener(name,fn){handlers.set(name,[...(handlers.get(name)||[]),fn])},
      dispatchEvent(ev){for(const fn of handlers.get(ev.type)||[])fn(ev)},
      confirm:()=>true
    };
    window.addEventListener('blocks:remote-config',e=>configs.push(e.detail));
    window.addEventListener('blocks:remote-hold',()=>holds.push('hold'));
    window.addEventListener('blocks:remote-unhold',()=>unholds.push('unhold'));
    window.addEventListener('blocks:remote-event',e=>{
      if(e.detail.type==='attack')attacks.push(e.detail.rows);
    });
    window.addEventListener('blocks:remote-finished',e=>results.push(e.detail.winner));
    window.addEventListener('blocks:remote-new-round',e=>{
      rounds.push(e.detail.round);
      window.BLOCKS_REMOTE_RESET(); // app.js resets the local board on this event.
    });
    const session=new Map();
    const sessionStorage={
      getItem:key=>session.get(key)||null,
      setItem:(key,value)=>session.set(key,String(value)),
      removeItem:key=>session.delete(key)
    };
    const localStorage={
      getItem:key=>storage.get(key)||null,
      setItem:(key,value)=>storage.set(key,String(value)),
      removeItem:key=>storage.delete(key)
    };
    const document={
      visibilityState:'visible',activeElement:null,
      body:{append(el){bodyElements.push(el)},classList:{toggle(){}}},
      createElement:()=>node(),
      getElementById:()=>node(),
      addEventListener(){}
    };
    const location={pathname:'/blocks/dev/',search:'?remote=1',
      href:'https://example.test/blocks/dev/?remote=1'};
    const context={window,document,location,localStorage,sessionStorage,fetch,
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
      window,get,attacks,results,rounds,holds,unholds,configs,storage,session,location,bodyElements,
      get resetCount(){return resetCount},
      async tick(){
        for(const fn of [...intervals.values()])await fn();
      },
      popup(id){return bodyElements.find(el=>el.id===id)}
    };
  }
  return {
    browser,rooms,allEvents,setDropAck:()=>{failAcknowledgement=true},
    setDropJoinAck:()=>{dropJoinAck=true},
    get joins(){return joins},get starts(){return starts},get rematches(){return rematches},
    expireCode(){for(const m of rooms.values())m.code_expires_at=new Date(Date.now()-30000).toISOString()}
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
  assert.match(host.get('remote-code').textContent,/^[BCDFGHJKLMNPQRSTVWXYZ]{3}$/);
  guest.get('remote-join').onclick();
  assert.equal(guest.get('remote-entry').hidden,false);
  assert.equal(guest.get('remote-slots').textContent,'— — —');
  guest.get('remote-input').value='br';
  guest.get('remote-input').listeners.input();
  assert.equal(f.joins,0,'Do not attempt a join before three consonants');
  assert.equal(guest.get('remote-slots').textContent,'B R —');
  guest.get('remote-input').value='brt';
  guest.get('remote-input').listeners.input(); // Auto-submits without Enter.
  await settle();
  await host.tick();await settle();
  assert.equal(f.joins,1);
  assert.equal(f.starts,0,'Entering the room code must not start the game');
  assert.equal(f.rooms.values().next().value.status,'ready');
  for(const phone of [host,guest]){
    assert.equal(phone.window.BLOCKS_REMOTE.ready,false);
    assert.equal(phone.popup('remote-result').hidden,false);
    assert.equal(phone.get('remote-result-title').textContent,'READY TO START');
    assert.equal(phone.get('remote-score-you').textContent,'0');
    assert.equal(phone.get('remote-score-opponent').textContent,'0');
    assert.equal(phone.get('remote-restart').textContent,'START GAME');
  }
  host.get('remote-restart').onclick();
  await settle();await host.tick();await guest.tick();await settle();
  assert.equal(f.rooms.values().next().value.status,'ready');
  assert.equal(host.window.BLOCKS_REMOTE.ready,false,'First Start only marks readiness');
  assert.equal(host.get('remote-restart').disabled,true);
  assert.match(host.get('remote-rematch-status').textContent,/Waiting for the other player/);
  assert.equal(guest.get('remote-restart').textContent,'START GAME');
  assert.match(guest.get('remote-rematch-status').textContent,/Opponent is ready/);
  guest.get('remote-restart').onclick();
  await settle();await host.tick();await guest.tick();await settle();
  assert.equal(f.starts,2);
  assert.equal(f.rooms.values().next().value.status,'playing');
  assert.equal(host.window.BLOCKS_REMOTE.ready,true);
  assert.equal(guest.window.BLOCKS_REMOTE.ready,true);
  return {host,guest};
}

test('two-button lobby creates rooms with a spinner and joins after three consonants',async()=>{
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


test('close X exits a finished match and returns to create/join menu',async()=>{
  const f=fixture(),{host,guest}=await matched(f);
  guest.window.BLOCKS_REMOTE.reportLoss();await settle();
  await host.tick();await guest.tick();await settle();
  assert.equal(host.popup('remote-result').hidden,false);
  assert.equal(host.get('remote-result-exit').attrs['aria-label'],undefined);
  host.get('remote-result-exit').onclick();await settle();
  assert.equal(host.popup('remote-result').hidden,true);
  assert.equal(host.popup('remote-lobby').hidden,false);
  assert.equal(host.get('remote-actions').hidden,false);
  assert.equal(host.window.BLOCKS_REMOTE.active,false);
  assert.equal(host.storage.has('blocks:remote-match:/blocks/dev/'),false);
  assert.equal(f.rooms.values().next().value.status,'cancelled');
  await guest.tick();await settle();
  assert.equal(guest.popup('remote-result').hidden,true);
  assert.equal(guest.popup('remote-lobby').hidden,false);
  assert.equal(guest.get('remote-actions').hidden,false);
  assert.match(guest.get('remote-status').textContent,/other player left/i);
  assert.equal(guest.window.BLOCKS_REMOTE.active,false);
  assert.equal(guest.storage.has('blocks:remote-match:/blocks/dev/'),false);
});

test('close X works while ready to play again and frees waiting opponent',async()=>{
  const f=fixture(),{host,guest}=await matched(f);
  guest.window.BLOCKS_REMOTE.reportLoss();await settle();
  await host.tick();await guest.tick();await settle();
  host.get('remote-restart').onclick();await settle();
  await guest.tick();await settle();
  assert.equal(host.get('remote-restart').textContent,'READY TO PLAY AGAIN');
  assert.equal(host.get('remote-restart').disabled,true);
  host.get('remote-result-exit').onclick();await settle();
  assert.equal(host.get('remote-actions').hidden,false);
  await guest.tick();await settle();
  assert.equal(guest.popup('remote-result').hidden,true);
  assert.equal(guest.get('remote-actions').hidden,false);
  assert.equal(guest.window.BLOCKS_REMOTE.active,false);
  assert.equal(f.rooms.values().next().value.status,'cancelled');
});

test('a finished room can be exited and a fresh room created without reloading',async()=>{
  const f=fixture(),{host,guest}=await matched(f);
  guest.window.BLOCKS_REMOTE.reportLoss();await settle();
  await host.tick();await guest.tick();await settle();
  host.get('remote-result-exit').onclick();await settle();
  host.get('remote-create').onclick();await settle();
  assert.equal(f.rooms.size,2);
  assert.equal(host.window.BLOCKS_REMOTE.active,true);
  assert.equal(host.get('remote-code').textContent,'BRT');
});


test('session wins are shown from each player perspective on both result screens',async()=>{
  const f=fixture(),{host,guest}=await matched(f);
  // First match: Player 1 wins.
  guest.window.BLOCKS_REMOTE.reportLoss();await settle();
  await host.tick();await guest.tick();await settle();
  assert.equal(host.get('remote-score-you').textContent,'1');
  assert.equal(host.get('remote-score-opponent').textContent,'0');
  assert.equal(guest.get('remote-score-you').textContent,'0');
  assert.equal(guest.get('remote-score-opponent').textContent,'1');
  assert.equal(f.rooms.values().next().value.host_wins,1);
  assert.equal(f.rooms.values().next().value.guest_wins,0);

  // Both press Play Again; no new room and no loss of the accumulated score.
  host.get('remote-restart').onclick();await settle();
  guest.get('remote-restart').onclick();await settle();
  await host.tick();await guest.tick();await settle();
  assert.equal(host.window.BLOCKS_REMOTE.ready,true);
  assert.equal(guest.window.BLOCKS_REMOTE.ready,true);
  assert.equal(f.rooms.size,1);

  // Second match: Player 2 wins. The session is now tied 1–1.
  host.window.BLOCKS_REMOTE.reportLoss();await settle();
  await host.tick();await guest.tick();await settle();
  assert.equal(host.get('remote-score-you').textContent,'1');
  assert.equal(host.get('remote-score-opponent').textContent,'1');
  assert.equal(guest.get('remote-score-you').textContent,'1');
  assert.equal(guest.get('remote-score-opponent').textContent,'1');
  assert.equal(f.rooms.values().next().value.host_wins,1);
  assert.equal(f.rooms.values().next().value.guest_wins,1);

  // A repeated poll does not credit another victory.
  await host.tick();await guest.tick();await settle();
  assert.equal(f.rooms.values().next().value.host_wins,1);
  assert.equal(f.rooms.values().next().value.guest_wins,1);
});

test('ready screen survives reconnect and preserves first player Start readiness',async()=>{
  const f=fixture();
  const host=f.browser(),guest=f.browser();
  host.get('remote-create').onclick();await settle();
  guest.get('remote-join').onclick();
  guest.get('remote-input').value='BRT';
  guest.get('remote-input').listeners.input();
  await settle();await host.tick();await settle();

  host.get('remote-restart').onclick();
  await settle();await host.tick();await guest.tick();await settle();
  assert.equal(host.get('remote-restart').textContent,'READY TO START');
  assert.equal(host.window.BLOCKS_REMOTE.ready,false);
  assert.equal(guest.window.BLOCKS_REMOTE.ready,false);

  const restoredHost=f.browser(host.storage);
  await settle();await restoredHost.tick();await settle();
  assert.equal(restoredHost.get('remote-result-title').textContent,'READY TO START');
  assert.equal(restoredHost.get('remote-restart').disabled,true);
  assert.match(restoredHost.get('remote-rematch-status').textContent,/Waiting for the other player/);
  assert.equal(restoredHost.get('remote-score-you').textContent,'0');

  guest.get('remote-restart').onclick();
  await settle();await restoredHost.tick();await guest.tick();await settle();
  assert.equal(restoredHost.window.BLOCKS_REMOTE.ready,true);
  assert.equal(guest.window.BLOCKS_REMOTE.ready,true);
});

test('close X on initial ready screen cancels the room for both players',async()=>{
  const f=fixture();
  const host=f.browser(),guest=f.browser();
  host.get('remote-create').onclick();await settle();
  guest.get('remote-join').onclick();
  guest.get('remote-input').value='BRT';
  guest.get('remote-input').listeners.input();
  await settle();await host.tick();await settle();
  assert.equal(host.get('remote-result-title').textContent,'READY TO START');
  assert.equal(guest.get('remote-result-title').textContent,'READY TO START');
  guest.get('remote-result-exit').onclick();await settle();
  assert.equal(guest.get('remote-actions').hidden,false);
  await host.tick();await settle();
  assert.equal(host.get('remote-actions').hidden,false);
  assert.equal(host.window.BLOCKS_REMOTE.active,false);
  assert.equal(guest.window.BLOCKS_REMOTE.active,false);
  assert.equal(f.starts,0);
});

test('new room starts a fresh 0–0 score after leaving a won session',async()=>{
  const f=fixture(),{host,guest}=await matched(f);
  guest.window.BLOCKS_REMOTE.reportLoss();await settle();
  await host.tick();await guest.tick();await settle();
  assert.equal(host.get('remote-score-you').textContent,'1');
  host.get('remote-result-exit').onclick();await settle();
  host.get('remote-create').onclick();await settle();
  assert.equal(f.rooms.size,2);
  const recent=[...f.rooms.values()].at(-1);
  assert.equal(recent.host_wins,0);
  assert.equal(recent.guest_wins,0);
});


test('room difficulty and allowed pieces are enforced on the joining phone',async()=>{
  const f=fixture();
  const host=f.browser(new Map(),{difficulty:2,piece_set:'IO'});
  const guest=f.browser(new Map(),{difficulty:0,piece_set:'ALL'});
  host.get('remote-create').onclick();await settle();
  guest.get('remote-join').onclick();
  guest.get('remote-input').value='BRT';
  guest.get('remote-input').listeners.input();await settle();
  await host.tick();await guest.tick();await settle();
  const room=[...f.rooms.values()][0];
  assert.equal(room.difficulty,2);
  assert.equal(room.piece_set,'IO');
  assert.deepEqual(JSON.parse(JSON.stringify(guest.configs)),[{difficulty:2,piece_set:'IO'}]);
  assert.equal(host.get('remote-result-title').textContent,'READY TO START');
  assert.equal(guest.get('remote-result-title').textContent,'READY TO START');
});

test('lost join acknowledgement retries with the same token and starts a single room',async()=>{
  const f=fixture();
  const host=f.browser(),guest=f.browser();
  host.get('remote-create').onclick();await settle();
  guest.get('remote-join').onclick();
  f.setDropJoinAck();
  guest.get('remote-input').value='BRT';
  guest.get('remote-input').listeners.input();await settle();
  const pending=JSON.parse(guest.storage.get('blocks:remote-pending-join:/blocks/dev/'));
  assert.equal(pending.code,'BRT');
  assert.equal(typeof pending.token,'string');
  assert.equal(f.rooms.size,1);
  assert.equal([...f.rooms.values()][0].guestToken,pending.token);
  guest.get('remote-input').value='BRT';
  guest.get('remote-input').listeners.input();await settle();
  assert.equal(f.rooms.size,1);
  assert.equal(guest.storage.has('blocks:remote-pending-join:/blocks/dev/'),false);
  assert.equal(guest.get('remote-result-title').textContent,'READY TO START');
});

test('host can cancel waiting room and return to create and join options',async()=>{
  const f=fixture(),host=f.browser();
  host.get('remote-create').onclick();await settle();
  assert.equal(host.get('remote-code-panel').hidden,false);
  host.get('remote-code-exit').onclick();await settle();
  assert.equal(host.window.BLOCKS_REMOTE.active,false);
  assert.equal(host.get('remote-actions').hidden,false);
  assert.equal([...f.rooms.values()][0].status,'cancelled');
});

test('presence interruption pauses and resumes both-player local board as announced',async()=>{
  const f=fixture(),{host,guest}=await matched(f);
  const room=[...f.rooms.values()][0];
  room.host_online=false;
  await guest.tick();await settle();
  assert.deepEqual(guest.holds,['hold']);
  assert.equal(guest.unholds.length,0);
  await guest.tick();await settle();
  assert.deepEqual(guest.holds,['hold'],'No duplicate pause events');
  room.host_online=true;
  await guest.tick();await settle();
  assert.deepEqual(guest.unholds,['unhold']);
  assert.equal(guest.window.BLOCKS_REMOTE.ready,true);
});

test('first Create Game touch starts a single room without waiting for click',async()=>{
  const f=fixture(),phone=f.browser();
  const button=phone.get('remote-create');
  assert.equal(typeof button.listeners.touchstart,'function');
  let prevented=0;
  button.listeners.touchstart({preventDefault(){prevented++}});
  assert.equal(prevented,1,"touch should suppress delayed synthetic click");
  assert.equal(button.disabled,true,"request starts synchronously on touchstart");
  assert.equal(button.classList.contains('is-loading'),true);
  button.onclick({detail:1,preventDefault(){prevented++}});
  assert.equal(prevented,2,"compatibility click should be consumed");
  await settle();
  assert.equal(f.rooms.size,1,"one touch must not create duplicate rooms");
  assert.equal(phone.get('remote-code-panel').hidden,false);
  assert.equal(button.disabled,false);
});

test('Join Game touch runs once, preserving typed code after compatibility click',()=>{
  const f=fixture(),phone=f.browser();
  const join=phone.get('remote-join');
  let prevented=0;
  join.listeners.touchstart({preventDefault(){prevented++}});
  const entry=phone.get('remote-entry'),input=phone.get('remote-input');
  assert.equal(prevented,1);
  assert.equal(entry.hidden,false);
  assert.equal(input.focused,true);
  input.value='BR';
  join.onclick({detail:1,preventDefault(){prevented++}});
  assert.equal(prevented,2);
  assert.equal(input.value,'BR',"synthetic click must not reopen and clear code entry");
  const close=phone.get('remote-menu-exit');
  close.listeners.touchstart({preventDefault(){}});
  assert.equal(entry.hidden,true,"X also responds on first touch");
  assert.equal(input.focused,false);
  join.onclick({detail:0,preventDefault(){}});
  assert.equal(entry.hidden,false,"keyboard-generated click must remain usable");
  assert.equal(input.focused,true);
  assert.equal(f.joins,0);
});

test('Play Together X returns to the main New Game selector without creating a room',()=>{
  const f=fixture(),phone=f.browser();
  const button=phone.get('remote-menu-exit');
  assert.equal(button.hidden,false);
  assert.equal(phone.get('remote-actions').hidden,false);
  assert.equal(phone.window.BLOCKS_REMOTE.active,false);
  button.onclick();
  assert.equal(phone.session.get('blocks:show-new-game-screen:v1:/blocks/dev/'),'1');
  assert.equal(phone.location.href,'https://example.test/blocks/dev/');
  assert.equal(f.rooms.size,0);
});

test('Join Game X returns to Play Together without attempting to join',async()=>{
  const f=fixture(),phone=f.browser();
  const exit=phone.get('remote-menu-exit');
  assert.equal(exit.hidden,false);
  phone.get('remote-join').onclick();
  assert.equal(exit.hidden,false);
  assert.equal(exit.attrs['aria-label'],'Back to Play Together');
  assert.equal(phone.get('remote-entry').hidden,false);
  assert.equal(phone.get('remote-status').hidden,true);
  assert.equal(phone.get('remote-status').textContent,'');
  assert.equal(phone.get('remote-input').focused,true);
  exit.onclick();
  assert.equal(phone.get('remote-input').focused,false);
  assert.equal(phone.get('remote-actions').hidden,false);
  assert.equal(phone.get('remote-entry').hidden,true);
  assert.equal(phone.get('remote-status').hidden,false);
  assert.equal(exit.hidden,false);
  assert.equal(exit.attrs['aria-label'],'Back to New Game');
  assert.equal(f.joins,0);
  assert.equal(f.rooms.size,0);
});

test('Room Created shows its own cancellation X in place of menu X',async()=>{
  const f=fixture(),phone=f.browser();
  phone.get('remote-create').onclick();
  await settle();
  assert.equal(phone.get('remote-code-panel').hidden,false);
  assert.equal(phone.get('remote-menu-exit').hidden,true);
  assert.equal(phone.get('remote-code-exit').hidden,false);
  assert.equal(phone.get('remote-status').textContent,
    'Share this code with Player 2. Once they join, each player taps Start Game.');
});

test('Create, Join and Room Created X buttons share viewport corner placement',()=>{
  const css=fs.readFileSync(path.join(__dirname,'..','styles.css'),'utf8');
  assert.match(css,/#remote-lobby #remote-menu-exit,\s*#remote-lobby #remote-code-exit\s*\{/);
  assert.match(css,/position:fixed;\s*top:calc\(env\(safe-area-inset-top, 0px\) \+ 16px\);/);
  assert.match(css,/right:calc\(env\(safe-area-inset-right, 0px\) \+ 16px\);/);
});

test('New Game screen launch flag is consumed by the main app',()=>{
  const main=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
  assert.match(main,/sessionStorage\.getItem\(SHOW_NEW_GAME_KEY\)==="1"/);
  assert.match(main,/const initialStart=showNewGameOnLaunch\|\|/);
});


test('three-consonant room code displays countdown and expires without ending a match',async()=>{
  const f=fixture(),host=f.browser();
  host.get('remote-create').onclick();await settle();
  assert.equal(host.get('remote-code').textContent,'BRT');
  assert.match(host.get('remote-code-expires').textContent,/Code expires in (?:3:00|2:5\d)/);
  const state=JSON.parse(host.storage.get('blocks:remote-match:/blocks/dev/'));
  assert.match(state.inviteExpiresAt,/Z$/);
  f.expireCode();
  state.inviteExpiresAt=new Date(Date.now()-30000).toISOString();
  host.storage.set('blocks:remote-match:/blocks/dev/',JSON.stringify(state));
  const reopened=f.browser(host.storage);
  await settle();await reopened.tick();await settle();
  assert.equal([...f.rooms.values()][0].status,'cancelled');
  assert.equal(reopened.window.BLOCKS_REMOTE.active,false);
  assert.equal(reopened.get('remote-actions').hidden,false);
  assert.match(reopened.get('remote-status').textContent,/Room code expired/);
});

test('an already joined match continues after its original code expires',async()=>{
  const f=fixture(),{host,guest}=await matched(f);
  f.expireCode();
  await host.tick();await guest.tick();await settle();
  assert.equal(host.window.BLOCKS_REMOTE.ready,true);
  assert.equal(guest.window.BLOCKS_REMOTE.ready,true);
  assert.equal([...f.rooms.values()][0].status,'playing');
  guest.window.BLOCKS_REMOTE.reportLoss();await settle();
  await host.tick();await guest.tick();await settle();
  assert.equal(host.get('remote-score-you').textContent,'1');
  assert.equal(host.get('remote-restart').textContent,'PLAY AGAIN');
});

test('join input excludes vowels and auto-submits only after three consonants',async()=>{
  const f=fixture(),host=f.browser(),guest=f.browser();
  host.get('remote-create').onclick();await settle();
  guest.get('remote-join').onclick();
  const input=guest.get('remote-input');
  input.value='Bae';
  input.listeners.input();
  assert.equal(input.value,'B');
  assert.equal(guest.get('remote-slots').textContent,'B — —');
  assert.equal(f.joins,0);
  input.value='brt';
  input.listeners.input();await settle();
  assert.equal(f.joins,1);
  assert.equal(guest.get('remote-result-title').textContent,'READY TO START');
});


test('room creation accepts the actual PostgREST RETURNS TABLE array response',async()=>{
  const f=fixture(),host=f.browser();
  host.get('remote-create').onclick();
  await settle();
  assert.equal(f.rooms.size,1);
  assert.equal(host.window.BLOCKS_REMOTE.active,true);
  assert.equal(host.get('remote-code').textContent,'BRT');
  assert.equal(host.get('remote-code-panel').hidden,false);
  assert.equal(host.get('remote-error').textContent,'');
});

test('code entry resizes to visible iPhone viewport and restores layout on exit',()=>{
  const f=fixture(),phone=f.browser();
  const lobby=phone.popup('remote-lobby');
  assert.equal(lobby.classList.contains('remote-keyboard-open'),false);
  phone.get('remote-join').onclick();
  assert.equal(phone.get('remote-input').focused,true);
  assert.equal(lobby.classList.contains('remote-keyboard-open'),true);
  assert.equal(lobby.style.getPropertyValue('--remote-visible-height'),'400px');
  phone.window.visualViewport.resizeTo(285,14);
  assert.equal(lobby.style.getPropertyValue('--remote-visible-height'),'285px');
  assert.equal(lobby.style.getPropertyValue('--remote-visible-top'),'14px');
  phone.get('remote-menu-exit').onclick();
  assert.equal(lobby.classList.contains('remote-keyboard-open'),false);
  assert.equal(lobby.style.getPropertyValue('--remote-visible-height'),'');
  assert.equal(phone.get('remote-input').focused,false);
});

test('Join Game has no duplicate Back link and uses the top-right X',()=>{
  const css=fs.readFileSync(path.join(__dirname,'..','styles.css'),'utf8');
  assert.doesNotMatch(source,/remote-entry-back/);
  assert.doesNotMatch(css,/#remote-lobby #remote-entry-back/);
  assert.match(source,/menuExit\.onclick=\(\)=>\{/);
  // Legacy UI selectors from earlier two-phone screens are no longer present.
  for(const selector of ['#remote-resume','#remote-new','#remote-back']){
    assert.equal(css.includes(selector),false,selector+' must not remain in CSS');
  }
});

test('keyboard-safe layout is scrollable and limited to the visual viewport',()=>{
  const css=fs.readFileSync(path.join(__dirname,'..','styles.css'),'utf8');
  assert.match(css,/#remote-lobby\.remote-keyboard-open\s*\{/);
  assert.match(css,/height:var\(--remote-visible-height,100dvh\)/);
  assert.match(css,/overflow-y:auto/);
  assert.match(css,/#remote-lobby\.remote-keyboard-open \.remote-panel/);
});
