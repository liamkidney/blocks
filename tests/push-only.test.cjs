const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const file=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');

test('friend invitations are push-only and use the existing room codes internally',()=>{
  const remote=file('remote-multiplayer.js');
  const edge=file('supabase/functions/blocks-push/index.ts');
  const push=file('push-client.js');
  assert.match(remote,/id="remote-invite-friend"/);
  assert.match(remote,/id="remote-add-friend"/);
  assert.match(remote,/id="remote-enable-push"/);
  assert.doesNotMatch(remote,/navigator[.]share|shareInvite|INVITE LINK|remote-share/);
  assert.match(remote,/get\(['"]push_join['"]\)/);
  assert.match(edge,/[?]remote=1&push_join=/);
  assert.match(push,/Notification[.]requestPermission/);
  assert.match(push,/window[.]BLOCKS_ENSURE_PLAYER/);
  assert.match(file('player-name.js'),/blocks:player:v1/);
});

test('push shows a scoped notification and clicking it launches the installed app',async()=>{
  const handlers={};
  const shown=[],opened=[];
  const scope='https://example.test/blocks/dev/';
  const self={
    registration:{scope,async showNotification(title,details){shown.push({title,details})}},
    clients:{matchAll:async()=>[],openWindow:async url=>{opened.push(url)}},
    addEventListener:(event,fn)=>{handlers[event]=fn}
  };
  vm.runInNewContext(file('sw.js'),{self,URL,Set,Request,console});
  let pushPromise;
  handlers.push({
    data:{json:()=>({title:'BLOCKS',body:'Pat invited you to play BLOCKS',
      path:'/blocks/dev/?remote=1&push_join=BRT',matchId:'match-1'})},
    waitUntil:p=>{pushPromise=p}
  });
  await pushPromise;
  assert.equal(shown.length,1);
  assert.equal(shown[0].title,'BLOCKS');
  assert.equal(shown[0].details.body,'Pat invited you to play BLOCKS');
  let clickPromise;
  const notification={data:shown[0].details.data,close(){}};
  handlers.notificationclick({notification,waitUntil:p=>{clickPromise=p}});
  await clickPromise;
  assert.equal(opened[0],scope+'?remote=1&push_join=BRT');
});

test('notification focuses an open PWA without navigating away from its message handler',async()=>{
  const handlers={},messages=[],operations=[];
  const scope='https://example.test/blocks/dev/';
  const existing={
    url:scope+'?remote=1',
    navigate(){throw Error('Never replace the active page before it handles the message')},
    async focus(){operations.push('focus')},
    postMessage(message){messages.push(message);operations.push('message')}
  };
  const self={
    registration:{scope},
    clients:{matchAll:async()=>[existing],openWindow:async()=>{throw Error('Already open')}},
    addEventListener:(type,fn)=>{handlers[type]=fn}
  };
  vm.runInNewContext(file('sw.js'),{self,URL,Set,Request,console});
  let done;
  handlers.notificationclick({
    notification:{
      data:{url:scope+'?remote=1&push_join=BRT'},close(){}
    },
    waitUntil:p=>{done=p}
  });
  await done;
  assert.equal(operations[0],'message');
  assert.equal(operations[1],'focus');
  assert.equal(messages.length,1);
  assert.equal(messages[0].type,'BLOCKS_PUSH_INVITATION');
  assert.equal(messages[0].url,scope+'?remote=1&push_join=BRT');
});

test('notification message survives a focus rejection in an already open PWA',async()=>{
  const handlers={},messages=[];
  const scope='https://example.test/blocks/dev/';
  const existing={
    url:scope+'?remote=1',
    navigate(){throw Error('Unexpected navigation')},
    async focus(){throw Error('Focus denied by iOS')},
    postMessage(message){messages.push(message)}
  };
  const self={
    registration:{scope},
    clients:{matchAll:async()=>[existing]},
    addEventListener:(type,fn)=>{handlers[type]=fn}
  };
  vm.runInNewContext(file('sw.js'),{self,URL,Set,Request,console});
  let done;
  handlers.notificationclick({
    notification:{data:{url:scope+'?remote=1&push_join=BRT'},close(){}},
    waitUntil:p=>{done=p}
  });
  await done;
  assert.equal(messages.length,1);
  assert.equal(messages[0].type,'BLOCKS_PUSH_INVITATION');
});

test('notification in the installed PWA New Game dialog routes to multiplayer',()=>{
  const app=file('app.js');
  const begin=app.indexOf('// A tapped invitation can arrive while');
  const end=app.indexOf('let remoteStored=null;',begin);
  assert.ok(begin>0&&end>begin,'new game notification handler must be present');
  const listeners={};
  const location={href:'https://example.test/blocks/dev/',pathname:'/blocks/dev/'};
  const navigator={standalone:true,serviceWorker:{
    addEventListener:(name,fn)=>{listeners[name]=fn}
  }};
  const window={matchMedia:()=>({matches:false})};
  const context=vm.createContext({navigator,window,location,URL,REMOTE_PLAYER:false});
  vm.runInContext(app.slice(begin,end),context);
  listeners.message({data:{
    type:'BLOCKS_PUSH_INVITATION',
    url:'https://example.test/blocks/dev/?remote=1&push_join=BRT'
  }});
  assert.equal(location.href,'https://example.test/blocks/dev/?remote=1&push_join=BRT');
});

test('notification cannot redirect a browser tab or another domain',()=>{
  const app=file('app.js');
  const begin=app.indexOf('// A tapped invitation can arrive while');
  const end=app.indexOf('let remoteStored=null;',begin);
  const listeners={},location={
    href:'https://example.test/blocks/dev/',pathname:'/blocks/dev/'
  };
  const navigator={standalone:false,serviceWorker:{
    addEventListener:(name,fn)=>{listeners[name]=fn}
  }};
  const window={matchMedia:()=>({matches:false})};
  const context=vm.createContext({navigator,window,location,URL,REMOTE_PLAYER:false});
  vm.runInContext(app.slice(begin,end),context);
  for(const url of [
    'https://example.test/blocks/dev/?remote=1&push_join=BRT',
    'https://other.test/blocks/dev/?remote=1&push_join=BRT',
    'https://example.test/blocks/dev/?remote=1&push_join=INVALID'
  ])listeners.message({data:{type:'BLOCKS_PUSH_INVITATION',url}});
  assert.equal(location.href,'https://example.test/blocks/dev/');
});

test('push notifications refuse off-origin or other-app destinations',async()=>{
  const handlers={};
  const shown=[];
  const self={
    registration:{scope:'https://example.test/blocks/dev/',
      showNotification:async(_title,details)=>shown.push(details)},
    addEventListener:(name,fn)=>{handlers[name]=fn}
  };
  vm.runInNewContext(file('sw.js'),{self,URL,Set,Request,console});
  for(const target of ['https://attacker.test/blocks/dev/?remote=1',
    '/blocks/?remote=1','//attacker.test/blocks/dev/']){
    let done;
    handlers.push({data:{json:()=>({body:'bad',path:target})},waitUntil:p=>{done=p}});
    await done;
  }
  assert.equal(shown.length,0);
});

test('ordinary browser mode never initializes push or registers a player',()=>{
  const window={matchMedia:()=>({matches:false})};
  const navigator={standalone:false};
  const storage={
    getItem:()=>{throw Error('browser should not read push credentials')},
    setItem:()=>{throw Error('browser should not create push credentials')}
  };
  vm.runInNewContext(file('push-client.js'),{
    window,navigator,location:{search:'?remote=1',pathname:'/blocks/dev/'},
    URLSearchParams,localStorage:storage
  });
  assert.equal(window.BLOCKS_PUSH,undefined);
});

test('push client explicitly supports installed iOS and standalone PWAs',()=>{
  const push=file('push-client.js');
  const remote=file('remote-multiplayer.js');
  assert.match(push,/navigator\.standalone===true/);
  assert.match(push,/display-mode: standalone/);
  assert.match(push,/if\(!installedPwa\)return/);
  assert.match(remote,/if\(!installedPwa\|\|!match\|\|!finished/);
  assert.match(remote,/inviteFriend\.hidden=list\.length===0/);
});

test('friend deletion requires installation credentials and clears mutual relationship',()=>{
  const edge=file('supabase/functions/blocks-push/index.ts');
  const client=file('push-client.js');
  const sql=file('supabase/migrations/20261102_remove_push_friend.sql');
  assert.match(edge,/const device=await installation\(body\)/);
  assert.match(edge,/if\(action==="remove_friend"\)/);
  assert.match(edge,/p_self:device\.id,p_friend:body\.friendId/);
  assert.match(client,/removeFriend:friendId=>authenticated\('remove_friend'/);
  assert.match(sql,/delete from public\.blocks_push_friends/);
  assert.match(sql,/set wants_friend = false/);
  assert.match(sql,/grant execute on function public\.blocks_push_remove_friend\(uuid,uuid\) to service_role/);
  assert.doesNotMatch(sql,/grant execute .* to anon/);
});


function handoffWorker(){
  const scope='https://example.test/blocks/dev/';
  const handlers={},messages=[],saved=new Map();
  let now=10_000;
  class FakeResponse{
    constructor(body){this.body=body}
    async json(){return JSON.parse(this.body)}
  }
  const cache={
    async put(key,value){saved.set(String(key),value)},
    async match(key){return saved.get(String(key))||null},
    async delete(key){return saved.delete(String(key))}
  };
  const windows=[];
  const opened=[];
  const clients={
    async matchAll(){return windows},
    async openWindow(url){opened.push(url);return null}
  };
  const self={
    registration:{scope},
    clients,
    addEventListener(type,listener){handlers[type]=listener}
  };
  const DateMock=class extends Date {static now(){return now}};
  vm.runInNewContext(file('sw.js'),{
    self,URL,console,caches:{open:async()=>cache},Response:FakeResponse,
    Date:DateMock
  },{filename:'sw.js'});
  async function fire(type,data,source){
    let work;
    handlers[type]({
      ...(type==='notificationclick'?{
        notification:{data:{url:data},close(){}}
      }:type==='message'?{data,source}:{}),
      waitUntil:p=>{work=p}
    });
    await work;
  }
  return {scope,opened,windows,messages,fire,saved,setNow:value=>{now=value}};
}

test('notification starts opening the PWA before touching CacheStorage',async()=>{
  const scope='https://example.test/blocks/dev/';
  const events=[],handlers={},saved=new Map();
  const cache={
    async put(k,v){events.push('cache put');saved.set(k,v)},
    async match(k){return saved.get(k)},
    async delete(k){return saved.delete(k)}
  };
  const self={
    registration:{scope},
    clients:{
      async matchAll(){events.push('match all');return []},
      openWindow(url){events.push('open window');return Promise.resolve(null)}
    },
    addEventListener:(type,fn)=>{handlers[type]=fn}
  };
  class FakeResponse{
    constructor(value){this.value=value}
    async json(){return JSON.parse(this.value)}
  }
  vm.runInNewContext(file('sw.js'),{
    self,console,URL,Date,Response:FakeResponse,
    caches:{async open(){events.push('cache open');return cache}}
  },{filename:'sw.js'});
  let done;
  handlers.notificationclick({
    notification:{data:{url:scope+'?remote=1&push_join=BRT'},close(){}},
    waitUntil:p=>{done=p}
  });
  await done;
  assert.ok(events.indexOf('open window')>=0);
  assert.ok(events.indexOf('cache open')>=0);
  assert.ok(events.indexOf('open window')<events.indexOf('cache open'),
    'iOS user activation must be used before any awaited storage operation');
});

test('already-open PWA handles notifications before handoff persistence begins',async()=>{
  const scope='https://example.test/blocks/dev/';
  const events=[],handlers={};
  const existing={
    url:scope+'?remote=1',
    postMessage(){events.push('message')},
    focus(){events.push('focus');return Promise.resolve()},
    navigate(){throw Error('Navigate would destroy message handler')}
  };
  const self={
    registration:{scope},
    clients:{async matchAll(){return [existing]}},
    addEventListener:(type,fn)=>{handlers[type]=fn}
  };
  const cache={async put(){},async match(){return null},async delete(){}};
  vm.runInNewContext(file('sw.js'),{
    self,console,URL,Date,Response:class {},
    caches:{async open(){events.push('cache open');return cache}}
  },{filename:'sw.js'});
  let done;
  handlers.notificationclick({
    notification:{data:{url:scope+'?remote=1&push_join=BRT'},close(){}},
    waitUntil:p=>{done=p}
  });
  await done;
  assert.deepEqual(events.slice(0,3),['message','focus','cache open']);
});

test('a cold iPhone launch recovers the clicked invite even if iOS opens at start URL',async()=>{
  const worker=handoffWorker();
  const invite=worker.scope+'?remote=1&push_join=BRT';
  await worker.fire('notificationclick',invite);
  assert.deepEqual(worker.opened,[invite],
    'service worker still requests the invitation destination');
  assert.equal(worker.saved.size,1,'worker retains intent across page creation');
  const received=[];
  await worker.fire('message',{type:'BLOCKS_GET_PUSH_INVITATION'},
    {postMessage:m=>received.push(m)});
  assert.equal(received.length,1);
  assert.equal(received[0].type,'BLOCKS_PUSH_INVITATION');
  assert.equal(received[0].url,invite);
  await worker.fire('message',{type:'BLOCKS_ACK_PUSH_INVITATION',url:invite});
  const again=[];
  await worker.fire('message',{type:'BLOCKS_GET_PUSH_INVITATION'},
    {postMessage:m=>again.push(m)});
  assert.equal(again.length,0,'ack clears the completed handoff');
});

test('a pending invitation survives a page reload but expires after three minutes',async()=>{
  const worker=handoffWorker();
  const invite=worker.scope+'?remote=1&push_join=BRT';
  await worker.fire('notificationclick',invite);
  worker.setNow(10_000+179_000);
  let received=[];
  await worker.fire('message',{type:'BLOCKS_GET_PUSH_INVITATION'},
    {postMessage:m=>received.push(m)});
  assert.equal(received.length,1);
  worker.setNow(10_000+181_000);
  received=[];
  await worker.fire('message',{type:'BLOCKS_GET_PUSH_INVITATION'},
    {postMessage:m=>received.push(m)});
  assert.equal(received.length,0);
  assert.equal(worker.saved.size,0,'expired handoff is discarded');
});

test('only the matching invitation can clear a saved push handoff',async()=>{
  const worker=handoffWorker();
  const invite=worker.scope+'?remote=1&push_join=BRT';
  await worker.fire('notificationclick',invite);
  await worker.fire('message',{
    type:'BLOCKS_ACK_PUSH_INVITATION',
    url:worker.scope+'?remote=1&push_join=XYZ'
  });
  assert.equal(worker.saved.size,1);
  await worker.fire('message',{type:'BLOCKS_ACK_PUSH_INVITATION',url:invite});
  assert.equal(worker.saved.size,0);
});

test('notification data cannot persist external, unscoped or arbitrary redirects',async()=>{
  const worker=handoffWorker();
  for(const url of [
    'https://attacker.example/blocks/dev/?remote=1&push_join=BRT',
    worker.scope+'?remote=1&join=BRT',
    worker.scope+'?remote=1&push_join=NOTACODE',
    'https://example.test/blocks/?remote=1&push_join=BRT'
  ])await worker.fire('notificationclick',url);
  assert.equal(worker.saved.size,0);
  assert.equal(worker.opened.length,0);
});


test('installed New Game requests a pending push intent when worker becomes ready',async()=>{
  const app=file('app.js');
  const start=app.indexOf('// A tapped invitation can arrive while');
  const end=app.indexOf('let remoteStored=null;',start);
  const requests=[],listeners={};
  const location={pathname:'/blocks/dev/',
    href:'https://example.test/blocks/dev/'};
  const worker={postMessage:message=>requests.push(message)};
  const navigator={standalone:true,serviceWorker:{
    controller:worker,
    ready:Promise.resolve({active:worker}),
    addEventListener:(name,fn)=>{listeners[name]=fn}
  }};
  const window={matchMedia:()=>({matches:false}),
    addEventListener:(name,fn)=>{listeners[name]=fn}};
  const document={visibilityState:'visible',
    addEventListener:(name,fn)=>{listeners[name]=fn}};
  const context=vm.createContext({navigator,window,document,location,URL,REMOTE_PLAYER:false});
  vm.runInContext(app.slice(start,end),context);
  await Promise.resolve();
  assert.equal(requests.filter(x=>x.type==='BLOCKS_GET_PUSH_INVITATION').length,2);
  listeners.message({data:{
    type:'BLOCKS_PUSH_INVITATION',
    url:'https://example.test/blocks/dev/?remote=1&push_join=BRT'
  }});
  assert.equal(location.href,
    'https://example.test/blocks/dev/?remote=1&push_join=BRT');
  listeners.visibilitychange();
  assert.equal(requests.filter(x=>x.type==='BLOCKS_GET_PUSH_INVITATION').length,3);
});


test('push receipt shows an invitation in an already visible installed game',async()=>{
  const scope='https://example.test/blocks/dev/';
  const handlers={},received=[],shown=[];
  const client={url:scope+'?remote=1',visibilityState:'visible',
    postMessage:message=>received.push(message)};
  const background={url:scope,visibilityState:'hidden',
    postMessage:()=>{throw Error('Background tabs must not display prompt')}};
  const self={
    registration:{scope,async showNotification(_title,detail){shown.push(detail)}},
    clients:{matchAll:async()=>[client,background]},
    addEventListener:(type,listener)=>{handlers[type]=listener}
  };
  vm.runInNewContext(file('sw.js'),{self,URL,console});
  let done;
  handlers.push({
    data:{json:()=>({body:'Alex invited you to play BLOCKS',
      path:'/blocks/dev/?remote=1&push_join=NCK'})},
    waitUntil:p=>{done=p}
  });
  await done;
  assert.equal(shown.length,1,'system push notification is still shown');
  assert.equal(received.length,1,'visible game receives its own Join/Dismiss intent');
  assert.equal(received[0].type,'BLOCKS_PUSH_RECEIVED');
  assert.equal(received[0].url,scope+'?remote=1&push_join=NCK');
  assert.match(received[0].body,/Alex invited you/);
});

function bootInGameInvitePrompt({remote=false,phase='falling',awaitingStart=false}={}){
  const app=file('app.js');
  const begin=app.indexOf('// One invitation dialog works for solo');
  const end=app.indexOf('const cancelRestartButton=',begin);
  assert.ok(begin>0&&end>begin,'shared invitation choice must exist');
  const nodes=new Map(),storage=new Map([['game-save','in-progress']]);
  let paused=0,resumed=0,saved=0;
  const document={activeElement:null};
  function element(id=''){
    return {
      id,hidden:false,textContent:'',disabled:false,innerHTML:'',onclick:null,
      focus(){document.activeElement=this}
    };
  }
  const get=id=>{
    if(!nodes.has(id))nodes.set(id,element(id));
    return nodes.get(id);
  };
  document.createElement=()=>element();
  document.getElementById=get;
  document.body={appendChild(){}};
  const game={
    phase,
    pause(){paused++;this.phase='paused'},
    resume(){resumed++;this.phase='falling'}
  };
  const session={
    pause(){paused++;game.phase='paused'},
    resume(){resumed++;game.phase='falling'}
  };
  const window={
    matchMedia:()=>({matches:false}),
    BLOCKS_REMOTE:{active:remote}
  };
  const location={href:'https://example.test/blocks/dev/'+(remote?'?remote=1':'')};
  const navigator={standalone:true,serviceWorker:{
    controller:{postMessage(message){this.messages.push(message)},messages:[]}
  }};
  const sandbox={
    document,window,location,navigator,URL,console,game,session,
    TWO_PLAYER:false,REMOTE_PLAYER:remote,awaitingInitialStart:awaitingStart,
    SAVE_KEY:'game-save',skipSaveOnNavigation:false,
    localStorage:{removeItem:key=>storage.delete(key)},
    renderActions(){},saveGame(){saved++}
  };
  vm.runInNewContext(app.slice(begin,end),sandbox,{filename:'app-invite-dialog.js'});
  return {
    get,game,window,location,navigator,sandbox,storage,
    get paused(){return paused},get resumed(){return resumed},
    get saved(){return saved}
  };
}

test('foreground invitation pauses solo game; Dismiss restores exactly that game',()=>{
  const b=bootInGameInvitePrompt();
  const invite='https://example.test/blocks/dev/?remote=1&push_join=NCK';
  assert.equal(b.window.BLOCKS_PRESENT_INVITATION(invite,{
    foreground:true,body:'Alex invited you to play BLOCKS'
  }),true);
  assert.equal(b.paused,1);
  assert.equal(b.get('blocks-invite-dialog').hidden,true,
    'fake document does not parse innerHTML, but appended dialog is controlled');
  // The created overlay is the first appended div in a real browser.
  // Its state is exposed via the Join and Dismiss button handlers.
  assert.match(b.get('blocks-invite-warning').textContent,/abandons your current game/i);
  assert.equal(b.get('blocks-invite-message').textContent,'Alex invited you to play BLOCKS');
  b.get('blocks-invite-dismiss').onclick();
  assert.equal(b.resumed,1);
  assert.equal(b.game.phase,'falling');
  assert.equal(b.navigator.serviceWorker.controller.messages[0].type,
    'BLOCKS_ACK_PUSH_INVITATION');
  assert.equal(b.location.href,'https://example.test/blocks/dev/');
});

test('joining an invitation from a solo game abandons it only after explicit Join',async()=>{
  const b=bootInGameInvitePrompt();
  const invite='https://example.test/blocks/dev/?remote=1&push_join=NCK';
  b.window.BLOCKS_PRESENT_INVITATION(invite,{foreground:true});
  assert.equal(b.location.href,'https://example.test/blocks/dev/');
  assert.equal(b.storage.has('game-save'),true);
  await b.get('blocks-invite-join').onclick();
  assert.equal(b.location.href,invite);
  assert.equal(b.storage.has('game-save'),false);
  assert.equal(b.sandbox.skipSaveOnNavigation,true);
  assert.equal(b.resumed,0,'old game is not resumed during navigation');
});

test('live multiplayer invitation shows a forfeit warning and does not auto-switch',async()=>{
  const b=bootInGameInvitePrompt({remote:true});
  let joins=0;
  const invite='https://example.test/blocks/dev/?remote=1&push_join=NCK';
  b.window.BLOCKS_PRESENT_INVITATION(invite,{onJoin:async()=>{joins++;return true}});
  assert.equal(joins,0);
  assert.match(b.get('blocks-invite-warning').textContent,/forfeits your current match/i);
  assert.equal(b.get('blocks-invite-join').disabled,false);
  await b.get('blocks-invite-join').onclick();
  assert.equal(joins,1);
});

test('invalid or cross-app invitations cannot display an in-game Join prompt',()=>{
  const b=bootInGameInvitePrompt();
  for(const invalid of [
    'https://attacker.test/blocks/dev/?remote=1&push_join=NCK',
    'https://example.test/blocks/?remote=1&push_join=NCK',
    'https://example.test/blocks/dev/?remote=1&push_join=INVALID'
  ])assert.equal(b.window.BLOCKS_PRESENT_INVITATION(invalid),false);
  assert.equal(b.paused,0);
});
