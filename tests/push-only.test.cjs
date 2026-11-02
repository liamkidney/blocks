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

test('tapping push while PWA is open posts invitation to existing screen',async()=>{
  const handlers={},messages=[],focuses=[];
  const scope='https://example.test/blocks/dev/';
  const existing={
    url:scope+'?remote=1',
    async navigate(url){
      assert.equal(url,scope+'?remote=1&push_join=BRT');
      // On iOS navigation may leave the same running window visible.
      return this;
    },
    async focus(){focuses.push('focused')},
    postMessage(message){messages.push(message)}
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
  assert.equal(focuses.length,1);
  assert.equal(messages.length,1);
  assert.equal(messages[0].type,'BLOCKS_PUSH_INVITATION');
  assert.equal(messages[0].url,scope+'?remote=1&push_join=BRT');
});

test('notification still reaches running PWA if iOS focus rejects',async()=>{
  const handlers={},messages=[];
  const scope='https://example.test/blocks/dev/';
  const existing={
    url:scope+'?remote=1',
    async navigate(){return this},
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

test('push messages still arrive if existing PWA navigation is rejected',async()=>{
  const handlers={},messages=[];
  const scope='https://example.test/blocks/dev/';
  const existing={
    url:scope+'?remote=1',
    async navigate(){throw Error('iOS did not navigate')},
    async focus(){},
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
