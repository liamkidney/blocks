const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

const elements=[];
const document={
  createElement:()=>{
    const node={className:'',hidden:false,attrs:{},children:[],
      setAttribute(name,value){this.attrs[name]=value},
      appendChild(child){this.children.push(child)}
    };
    elements.push(node);
    return node;
  }
};
const context=vm.createContext({document});
vm.runInContext(fs.readFileSync(path.join(__dirname,'..','board-renderer.js'),'utf8'),context);
const encode=vm.runInContext('encodeOpponentBoard',context);
const valid=vm.runInContext('validOpponentBoard',context);
const create=vm.runInContext('createOpponentBoardOverlay',context);
const fresh=()=>({grid:Array.from({length:20},()=>Array(10).fill(null)),
  active:null,offsets:[]});

test('board codec packs settled and active cells across all 20 rows',()=>{
  const game=fresh();
  game.grid[0][0]='I';game.grid[19][9]='T';
  game.active={x:3,y:8};
  game.offsets=[[0,0],[1,0],[0,1],[1,1]];
  const rows=encode(game);
  assert.equal(rows.length,20);
  assert.equal(rows[0],1);
  assert.equal(rows[19],512);
  assert.equal(rows[8],(1<<13)|(1<<14));
  assert.equal(rows[9],(1<<13)|(1<<14));
  assert.equal(valid(rows),true);
  assert.ok(JSON.stringify(rows).length<110,'board payload should remain compact');
});

test('out-of-bounds falling piece cells are omitted',()=>{
  const game=fresh();
  game.active={x:9,y:19};
  game.offsets=[[0,0],[1,0],[0,1],[1,1]];
  const rows=encode(game);
  assert.equal(rows[19],1<<19);
  assert.equal(rows[0],0);
});

test('malformed or oversized opponent frames are rejected',()=>{
  assert.equal(valid(Array(20).fill(0)),true);
  for(const data of [[],Array(19).fill(0),Array(20).fill(-1),
     Array(20).fill(1.5),Array(20).fill(1048576),Array(20).fill('5')]){
    assert.equal(valid(data),false);
  }
});

test('opponent overlay maps y up to screen rows and distinguishes active blocks',()=>{
  const board={children:[],classes:new Set(),
    appendChild(node){this.children.push(node)},
    classList:{add(name){board.classes.add(name)}}
  };
  const overlay=create(board);
  const layer=board.children[0];
  assert.equal(layer.id,'remote-opponent-overlay');
  assert.equal(board.classes.has('has-opponent-overlay'),true);
  assert.equal(layer.attrs['aria-hidden'],'true');
  assert.equal(layer.children.length,200);
  assert.equal(layer.hidden,true);
  const rows=Array(20).fill(0);
  rows[0]=1;
  rows[19]=1<<(9+10);
  assert.equal(overlay.show(rows),true);
  assert.equal(overlay.visible,true);
  assert.equal(layer.children[190].className,'remote-opponent-cell occupied');
  assert.equal(layer.children[9].className,'remote-opponent-cell active');
  overlay.setStale(true);
  assert.equal(overlay.stale,true);
  assert.equal(overlay.visible,true,'stale board is retained, not hidden');
  assert.equal(layer.className,'stale');
  overlay.setStale(true);
  assert.equal(layer.className,'stale');
  const wrong=Array(20).fill(1048576);
  assert.equal(overlay.show(wrong),false);
  assert.equal(layer.children[9].className,'remote-opponent-cell active');
  overlay.hide();
  assert.equal(overlay.visible,false);
  assert.equal(overlay.stale,false,'reset removes stale state');
  const cleared=Array(20).fill(0);
  overlay.setStale(true);
  assert.equal(overlay.show(cleared),true);
  assert.equal(overlay.stale,false,'fresh opponent frame brightens overlay again');
  assert.equal(layer.children[9].className,'remote-opponent-cell');
  assert.equal(layer.children[190].className,'remote-opponent-cell');
});

test('overlay cannot steal taps or reserve screen space',()=>{
  const css=fs.readFileSync(path.join(__dirname,'..','styles.css'),'utf8');
  assert.match(css,/#remote-opponent-overlay\s*\{[^}]*position:absolute;inset:0/);
  assert.match(css,/#remote-opponent-overlay\s*\{[^}]*pointer-events:none/);
  assert.match(css,/#remote-opponent-overlay\[hidden\]\{display:none!important\}/);
  assert.match(css,/#remote-opponent-overlay\.stale\{opacity:\.45\}/);
  assert.match(css,/#board\.has-opponent-overlay > \.cell\.filled\{z-index:5\}/);
  assert.match(css,/\.remote-opponent-cell\.occupied,\s*\.remote-opponent-cell\.active\s*\{[^}]*radial-gradient/);
  assert.doesNotMatch(css,/#remote-opponent-overlay\{[^}]*pointer-events:auto/);
});
