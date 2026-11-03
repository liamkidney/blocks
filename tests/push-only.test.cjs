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
