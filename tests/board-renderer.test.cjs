const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

const source=fs.readFileSync(path.join(__dirname,"..","board-renderer.js"),"utf8");
function boot(){
 const classes=[],colors=[];
 const cells=Array.from({length:200},(_,i)=>{
   const cell={style:{}};
   Object.defineProperty(cell,"className",{
     get(){return classes[i]??"";},
     set(value){classes[i]=value;cell.classUpdates=(cell.classUpdates||0)+1;},
   });
   Object.defineProperty(cell.style,"backgroundColor",{
     get(){return colors[i]??"";},
     set(value){colors[i]=value;cell.colorUpdates=(cell.colorUpdates||0)+1;},
   });
   return cell;
 });
 const context=vm.createContext({TETROMINO_BY_NAME:{
  I:{color:"blue"},O:{color:"yellow"},T:{color:"purple"}
 }});
 vm.runInContext(source,context);
 const draw=vm.runInContext("createBoardRenderer",context)(cells);
 const freshGame=()=>({
   grid:Array.from({length:20},()=>Array(10).fill(null)),
   active:null,phase:"falling",completedRows:[],ghostY:0,offsets:[]
 });
 const at=(x,y)=>(19-y)*10+x;
 const writes=()=>cells.reduce((sum,c)=>sum+(c.classUpdates||0)+(c.colorUpdates||0),0);
 return {cells,draw,freshGame,at,writes};
}
test("an unchanged scene causes no DOM writes on successive frames",()=>{
 const b=boot(),game=b.freshGame();
 game.grid[0][0]="I";
 b.draw(game,false);
 const first=b.writes();
 assert.ok(first>0);
 for(let i=0;i<60;i++)b.draw(game,false);
 assert.equal(b.writes(),first);
});
test("moving a piece updates only the affected cells",()=>{
 const b=boot(),game=b.freshGame();
 game.active={x:4,y:10,tetromino:{name:"O"}};
 game.offsets=[[0,0],[1,0],[0,1],[1,1]];
 b.draw(game);
 const before=b.writes();
 game.active.x=5;
 b.draw(game);
 const delta=b.writes()-before;
 assert.ok(delta>0);
 assert.ok(delta<=8,"Only vacated/newly covered cells should change");
 assert.equal(b.cells[b.at(4,10)].className,"cell");
 assert.equal(b.cells[b.at(6,10)].className,"cell filled");
});
test("ghost cells appear/disappear without a full redraw",()=>{
 const b=boot(),game=b.freshGame();
 game.active={x:4,y:15,tetromino:{name:"O"}};
 game.offsets=[[0,0],[1,0],[0,1],[1,1]];
 game.ghostY=2;
 b.draw(game,true);
 assert.equal(b.cells[b.at(4,2)].className,"cell ghost");
 assert.equal(b.cells[b.at(4,15)].className,"cell filled");
 const before=b.writes();
 b.draw(game,true);
 assert.equal(b.writes(),before);
 b.draw(game,false);
 assert.equal(b.cells[b.at(4,2)].className,"cell");
 assert.equal(b.cells[b.at(4,15)].className,"cell filled");
});
test("clearing rows preserve their animation classes through repeated frames and pause",()=>{
 const b=boot(),game=b.freshGame();
 game.grid[0].fill("I");
 game.phase="clearing_lines";
 game.completedRows=[0];
 b.draw(game);
 const old=b.writes();
 assert.equal(b.cells[b.at(5,0)].className,"cell filled clearing");
 b.draw(game);
 assert.equal(b.writes(),old,"Do not restart the clear animation each frame");
 game.phase="paused";game.pausedPhase="clearing_lines";
 b.draw(game);
 assert.equal(b.writes(),old);
 game.phase="falling";game.completedRows=[];
 b.draw(game);
 assert.equal(b.cells[b.at(5,0)].className,"cell filled");
});
test("separate renderer instances isolate player one and player two",()=>{
 const p1=boot(),p2=boot();
 const game1=p1.freshGame(),game2=p2.freshGame();
 game1.grid[2][1]="I";
 game2.grid[3][2]="T";
 p1.draw(game1);p2.draw(game2);
 assert.equal(p1.cells[p1.at(1,2)].className,"cell filled");
 assert.equal(p2.cells[p2.at(1,2)].className,"cell");
 assert.equal(p2.cells[p2.at(2,3)].className,"cell filled");
});
