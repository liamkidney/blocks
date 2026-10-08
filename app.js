const game=new Game(window.BLOCKS_CONFIG||{});
const board=document.getElementById("board");
const preview=document.getElementById("preview");
const boardCells=[];
let lastTime=performance.now(),boardTouch=null,repeatTimer=null;
const REPEAT_DELAY=220,REPEAT_INTERVAL=80;

for(let y=19;y>=0;y--) for(let x=0;x<10;x++){
  const cell=document.createElement("div");cell.className="cell";board.appendChild(cell);boardCells.push(cell);
}

const boardIndex=(x,y)=>(19-y)*10+x;
function paintBoard(x,y,name){
  if(x<0||x>=10||y<0||y>=20)return;
  const cell=boardCells[boardIndex(x,y)];
  const className=cell.classList.contains("clearing")&&game.phase==="clearing_lines"?"cell filled clearing":"cell filled";
  if(cell.className!==className)cell.className=className;
  cell.style.backgroundColor=TETROMINO_BY_NAME[name].color;
}
function render(){
  for(const cell of boardCells){
    if(!(game.phase==="clearing_lines"&&cell.classList.contains("clearing")))cell.className="cell";
    cell.style.background="";
  }
  for(let y=0;y<20;y++) for(let x=0;x<10;x++) if(game.grid[y][x]) paintBoard(x,y,game.grid[y][x]);
  if(game.active) for(const [ox,oy] of game.offsets) paintBoard(game.active.x+ox,game.active.y+oy,game.active.tetromino.name);
  document.getElementById("score").textContent=game.score;
  document.getElementById("lines").textContent=game.lines;
  renderPreview();
  if(game.phase==="clearing_lines") for(const y of game.completedRows) for(let x=0;x<10;x++) boardCells[boardIndex(x,y)].classList.add("clearing");
}
function renderPreview(){
  preview.replaceChildren();
  const t=game.nextTetromino;if(!t)return;
  const offsets=t.orientations[0],xs=offsets.map(p=>p[0]),ys=offsets.map(p=>p[1]);
  const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
  const width=maxX-minX+1,height=maxY-minY+1;
  const cellPercent=width===4?21:25;
  const pieceWidth=width*cellPercent,pieceHeight=height*cellPercent;
  const left=(100-pieceWidth)/2,top=(100-pieceHeight)/2;
  for(const [x,y] of offsets){
    const cell=document.createElement("div");
    cell.className="preview-cell filled";
    cell.style.backgroundColor=t.color;
    cell.style.width=cellPercent+"%";cell.style.height=cellPercent+"%";
    cell.style.left=left+(x-minX)*cellPercent+"%";
    cell.style.top=top+(maxY-y)*cellPercent+"%";
    preview.appendChild(cell);
  }
}
function loop(now){game.update(Math.min((now-lastTime)/1000,.25));lastTime=now;render();requestAnimationFrame(loop)}
requestAnimationFrame(loop);

board.addEventListener("animationend",event=>{
  if(event.animationName==="clearFlash"&&event.pseudoElement==="::after"&&event.target.classList.contains("clearing")&&event.target===board.querySelector(".cell.clearing")) game.presentationComplete();
});

function repeat(command){
  if(command==="down") game.dropOne(); else game.press(command);
  repeatTimer=setTimeout(()=>repeat(command),REPEAT_INTERVAL);
}
function press(button){
  const command=button.dataset.command;button.classList.add("pressed");
  if(command==="down"){
    game.dropOne();
    clearTimeout(repeatTimer);repeatTimer=setTimeout(()=>repeat(command),REPEAT_DELAY);
  }else{
    game.press(command);
    if(command==="left"||command==="right"){
      clearTimeout(repeatTimer);repeatTimer=setTimeout(()=>repeat(command),REPEAT_DELAY);
    }
  }
}
function release(button){
  const command=button.dataset.command;button.classList.remove("pressed");
  if(command==="down"||command==="left"||command==="right"){clearTimeout(repeatTimer);repeatTimer=null}
}
// Prefer real touch events on touch devices. Pythonista's WebView emits a
// second synthetic pointerdown/click after touchend, which must be ignored.
document.querySelectorAll(".control").forEach(button=>{
  let touchActive=false;
  let lastTouchAt=-Infinity;
  const suppressSyntheticPointer=e=>e.pointerType==="touch"||performance.now()-lastTouchAt<750;
  button.addEventListener("touchstart",e=>{
    e.preventDefault();
    lastTouchAt=performance.now();
    if(touchActive)return;
    touchActive=true;
    press(button);
  },{passive:false});
  button.addEventListener("touchend",e=>{
    e.preventDefault();
    lastTouchAt=performance.now();
    if(touchActive)release(button);
    touchActive=false;
  },{passive:false});
  button.addEventListener("touchcancel",e=>{
    e.preventDefault();
    lastTouchAt=performance.now();
    if(touchActive)release(button);
    touchActive=false;
  },{passive:false});
  button.addEventListener("pointerdown",e=>{
    if(suppressSyntheticPointer(e)){e.preventDefault();return;}
    e.preventDefault();
    button.setPointerCapture(e.pointerId);
    press(button);
  });
  button.addEventListener("pointerup",e=>{
    if(suppressSyntheticPointer(e)){e.preventDefault();return;}
    e.preventDefault();
    release(button);
  });
  button.addEventListener("pointercancel",()=>{
    if(!touchActive){button.classList.remove("pressed");clearTimeout(repeatTimer);repeatTimer=null;}
  });
});
board.addEventListener("pointerdown",e=>{e.preventDefault();board.setPointerCapture(e.pointerId);boardTouch={x:e.clientX,y:e.clientY}});
board.addEventListener("pointerup",e=>{
  e.preventDefault();if(!boardTouch)return;
  const dx=e.clientX-boardTouch.x,dy=e.clientY-boardTouch.y,threshold=board.clientWidth/10;
  if(Math.abs(dy)>=threshold&&Math.abs(dy)>Math.abs(dx)&&dy>0)game.dropOne();
  else if(Math.abs(dx)>=threshold&&Math.abs(dx)>Math.abs(dy))game.press(dx>0?"right":"left");
  else if(Math.abs(dx)<threshold&&Math.abs(dy)<threshold){
    if(dy>2)game.dropOne();
    else{const r=board.getBoundingClientRect();game.press(boardTouch.x>=r.left+r.width/2?"rotate_cw":"rotate_ccw")}
  }
  boardTouch=null;
});
document.addEventListener("keydown",e=>{
  const map={ArrowLeft:"left",ArrowRight:"right",ArrowUp:"rotate_cw",z:"rotate_ccw",Z:"rotate_ccw"};
  if(e.key==="ArrowDown"){e.preventDefault();game.dropOne()}
  else if(map[e.key]){e.preventDefault();game.press(map[e.key])}
});
if("serviceWorker" in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("sw.js"));

document.addEventListener("contextmenu",e=>e.preventDefault());
document.addEventListener("selectstart",e=>e.preventDefault());

const versionElement=document.getElementById("version");
if(versionElement&&window.BLOCKS_VERSION)versionElement.textContent=window.BLOCKS_VERSION;
