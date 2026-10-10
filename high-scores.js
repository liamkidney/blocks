// Show the existing leaderboard without navigating away from the active game.
(()=>{
 const button=document.getElementById('high-scores-button');
 const overlay=document.createElement('div');
 overlay.id='high-scores-overlay';overlay.hidden=true;
 overlay.innerHTML='<iframe title="High scores" src="about:blank"></iframe>';
 document.body.appendChild(overlay);
 const frame=overlay.querySelector('iframe');
 let resumeOnClose=false;
 function open(){
  if(!overlay.hidden)return;
  resumeOnClose=game.phase!=='paused'&&game.phase!=='game_over'&&!session.outcome;
  if(resumeOnClose)togglePause();
  saveGame(true);
  overlay.hidden=false;
  frame.src='leaderboard.html?embedded=1';
 }
 function close(){
  if(overlay.hidden)return;
  overlay.hidden=true;
  frame.src='about:blank';
  if(resumeOnClose&&game.phase==='paused')togglePause();
  resumeOnClose=false;
  button.focus();
 }
 button.addEventListener('click',open);
 window.addEventListener('message',event=>{
  if(event.origin!==location.origin||event.source!==frame.contentWindow)return;
  if(event.data?.type==='blocks:close-high-scores')close();
 });
 document.addEventListener('keydown',event=>{
  if(!overlay.hidden&&event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();close();}
 },true);
})();
