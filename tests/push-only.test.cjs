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
