const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','settings.js'),'utf8');

function boot({installed=false,savedSpeed='1',savedGhost='false',name='Pat',friends=[]}={}){
  const storage=new Map([
    ['blocks:difficulty:v1:/blocks/dev/',savedSpeed],
    ['blocks:ghost:v1:/blocks/dev/',savedGhost],
    ['blocks:player:v1',JSON.stringify({player_id:'stable-leaderboard-id',display_name:name})]
  ]);
  const elements=new Map(),events=[],docEvents=new Map();
  let savedNames=[],profileUpdates=0,notificationPrompts=0,removed=[];
  let notificationEnabled=false;
  const document={activeElement:null};
  function element(id=''){
    let text='';
    return {
      id,hidden:false,value:'',disabled:false,children:[],innerHTML:'',
      get textContent(){return text},
      set textContent(value){text=String(value);this.children=[]},
      listeners:{},attrs:{},
      appendChild(child){this.children.push(child)},
      append(...children){this.children.push(...children)},
      setAttribute(key,value){this.attrs[key]=value},
      addEventListener(type,callback){this.listeners[type]=callback},
      querySelector(selector){return get(selector.slice(1))},
      focus(){document.activeElement=this},
    };
  }
  function get(id){
    if(!elements.has(id))elements.set(id,element(id));
    return elements.get(id);
  }
  document.createElement=()=>element();
  document.body=element('body');
  document.addEventListener=(type,callback)=>docEvents.set(type,callback);
  const window={
    BLOCKS_CONFIG:{ghostPiece:false},
    BLOCKS_PLAYER_NAME:()=>name,
    BLOCKS_SAVE_PLAYER_NAME:async value=>{
      savedNames.push(value);name=value;
      storage.set('blocks:player:v1',JSON.stringify({
        player_id:'stable-leaderboard-id',display_name:name
      }));
    },
    dispatchEvent:event=>events.push(event),
    confirm:()=>true
  };
  if(installed)window.BLOCKS_PUSH={
    get enabled(){return notificationEnabled},
    async enable(){notificationPrompts++;notificationEnabled=true},
    async friends(){return {friends:friends.slice()}},
    async removeFriend(id){
      removed.push(id);
      const i=friends.findIndex(f=>f.id===id);
      if(i>=0)friends.splice(i,1);
    },
    async refreshProfile(){profileUpdates++}
  };
  const sandbox={
    document,window,location:{pathname:'/blocks/dev/'},
    GAME_MODE_IDS:[0,1,2],
    GAME_MODES:{0:{label:'Beginner'},1:{label:'Easy'},2:{label:'Hard'}},
    DEFAULT_GAME_MODE:1,
    Notification:{permission:'default'},
    localStorage:{
      getItem:key=>storage.get(key)??null,
      setItem:(key,value)=>storage.set(key,String(value))
    },
    CustomEvent:class {constructor(type,{detail}){this.type=type;this.detail=detail}},
    Event:class {constructor(type){this.type=type}}
  };
  vm.runInNewContext(source,sandbox,{filename:'settings.js'});
  return {
    get,window,storage,events,document,
    get savedNames(){return savedNames},
    get profileUpdates(){return profileUpdates},
    get removed(){return removed},
    get notificationPrompts(){return notificationPrompts},
    escape(){docEvents.get('keydown')?.({key:'Escape',preventDefault(){}})}
  };
}
async function settle(){for(let i=0;i<12;i++)await Promise.resolve()}

test('Settings lets a player update the existing leaderboard nickname and friend name',async()=>{
  const b=boot({installed:true});
  b.window.BLOCKS_OPEN_SETTINGS();
  assert.equal(b.get('settings-name').value,'Pat');
  b.get('settings-name').value='  Alex  ';
  b.get('settings-name-form').onsubmit({preventDefault(){}});
  await settle();
  assert.deepEqual(b.savedNames,['Alex']);
  assert.equal(b.profileUpdates,1,'friend installation name is refreshed');
  assert.equal(JSON.parse(b.storage.get('blocks:player:v1')).player_id,
    'stable-leaderboard-id');
  assert.equal(b.get('settings-name-status').textContent,'Name saved.');
});

test('Gameplay defaults persist and notify app without changing a running match',()=>{
  const b=boot({savedSpeed:'0',savedGhost:'true'});
  b.window.BLOCKS_OPEN_SETTINGS();
  assert.equal(b.get('settings-speed').value,'0');
  assert.equal(b.get('settings-ghost').value,'true');
  b.get('settings-speed').value='2';
  b.get('settings-speed').onchange();
  b.get('settings-ghost').value='false';
  b.get('settings-ghost').onchange();
  assert.equal(b.storage.get('blocks:difficulty:v1:/blocks/dev/'),'2');
  assert.equal(b.storage.get('blocks:ghost:v1:/blocks/dev/'),'false');
  assert.equal(b.events.length,2);
  assert.deepEqual(JSON.parse(JSON.stringify(b.events[1].detail)),
    {difficulty:2,ghostPiece:false});
});

test('Safari Settings hides friends and notifications',()=>{
  const b=boot();
  b.window.BLOCKS_OPEN_SETTINGS();
  assert.equal(b.get('settings-social-section').hidden,true);
  assert.equal(b.get('settings-name').value,'Pat');
  assert.equal(b.get('settings-speed').value,'1');
});

test('Installed PWA settings remove friends without entering multiplayer',async()=>{
  const friends=[{id:'one',name:'Alex',canNotify:true},
    {id:'two',name:'Sam',canNotify:false}];
  const b=boot({installed:true,friends});
  b.window.BLOCKS_OPEN_SETTINGS();
  await settle();
  assert.equal(b.get('settings-social-section').hidden,false);
  const rows=b.get('settings-friends-list').children;
  assert.equal(rows.length,2);
  assert.equal(rows[0].children[0].textContent,'Alex');
  rows[0].children[1].onclick();
  await settle();
  assert.deepEqual(b.removed,['one']);
  assert.deepEqual(friends.map(f=>f.name),['Sam']);
  assert.equal(b.get('settings-friends-list').children.length,1);
  assert.equal(b.events.some(e=>e.type==='blocks:friends-changed'),true);
});

test('Notification permission is requested only from the Settings button tap',async()=>{
  const b=boot({installed:true});
  b.window.BLOCKS_OPEN_SETTINGS();
  await settle();
  assert.equal(b.notificationPrompts,0);
  assert.equal(b.get('settings-enable-notifications').hidden,false);
  b.get('settings-enable-notifications').onclick();
  await settle();
  assert.equal(b.notificationPrompts,1);
  assert.equal(b.get('settings-enable-notifications').hidden,true);
  assert.equal(b.get('settings-notification-status').textContent,
    'Notifications enabled.');
});

test('Escape closes Settings and does not change the current game',()=>{
  const b=boot();
  b.window.BLOCKS_OPEN_SETTINGS();
  assert.equal(b.document.body.children[0].hidden,false);
  b.escape();
  assert.equal(b.document.body.children[0].hidden,true);
});
