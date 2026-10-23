// Two-phone match transport. One local board per device; attack rules remain in session.js.
// Loaded only for ?remote=1. Requires the blocks_* Supabase RPC migration.
(()=>{
  if(new URLSearchParams(location.search).get('remote')!=='1')return;
  const API='https://psoncybkfsdmjksyrcvv.supabase.co/rest/v1/rpc/';
  const KEY='sb_publishable_z-Aumyx5v_WMPTbY77u88A_H3oEEzFH';
  const headers={'apikey':KEY,'Content-Type':'application/json'};
  const storageKey='blocks:remote-match:'+location.pathname;
  let match=null, cursor=0, pending=[], polling=false, sending=false, timer=null;
  const rpc=async(name,args={})=>{
    const response=await fetch(API+name,{method:'POST',headers,body:JSON.stringify(args)});
    if(!response.ok)throw Error((await response.text()).slice(0,240));
    return response.json();
  };
  const overlay=document.createElement('div');
  overlay.id='remote-lobby';
  overlay.style.cssText='position:fixed;inset:0;z-index:10000;background:#f3efe3;display:grid;place-items:center;padding:20px;color:#222;font:inherit';
  overlay.innerHTML='<div style="width:min(360px,100%);text-align:center"><h2>TWO PHONES</h2><p id="remote-status">Create a match or join with a six-letter code.</p><p id="remote-code" style="font-size:32px;letter-spacing:5px;font-weight:bold"></p><input id="remote-input" maxlength="6" autocapitalize="characters" placeholder="ROOM CODE" style="font-size:20px;text-transform:uppercase;width:90%;padding:12px;text-align:center"><div style="display:flex;gap:10px;justify-content:center;margin:16px"><button id="remote-create">CREATE</button><button id="remote-join">JOIN</button></div><button id="remote-resume" hidden>RECONNECT</button><p id="remote-error" role="alert"></p></div>';
  document.body.append(overlay);
  const status=overlay.querySelector('#remote-status'),code=overlay.querySelector('#remote-code'),error=overlay.querySelector('#remote-error');
  const create=overlay.querySelector('#remote-create'),join=overlay.querySelector('#remote-join'),resume=overlay.querySelector('#remote-resume');
  const input=overlay.querySelector('#remote-input');
  const stored=(()=>{try{return JSON.parse(localStorage.getItem(storageKey)||'null')}catch(_){return null}})();
  if(stored?.id&&stored?.token){resume.hidden=false;resume.onclick=()=>connect(stored);}
  function persist(){try{localStorage.setItem(storageKey,JSON.stringify(match))}catch(_){}}
  function setError(e){error.textContent=e?.message||String(e)}
  async function connect(value){
    match=value;persist();error.textContent='';
    code.textContent=match.code||'';
    status.textContent='Connecting…';
    create.disabled=join.disabled=true;
    await poll();
    timer=setInterval(poll,650);
  }
  create.onclick=async()=>{
    create.disabled=join.disabled=true;
    try{
      const rows=await rpc('blocks_create_match');
      const r=rows[0];
      await connect({id:r.match_id,token:r.player_token,code:r.room_code,player:1});
    }catch(e){setError(e);create.disabled=join.disabled=false;}
  };
  join.onclick=async()=>{
    const room=input.value.trim().toUpperCase();
    if(!/^[A-Z]{6}$/.test(room)){setError('Enter a six-letter code.');return;}
    create.disabled=join.disabled=true;
    try{
      const rows=await rpc('blocks_join_match',{p_code:room});
      const r=rows[0];
      await connect({id:r.match_id,token:r.player_token,code:room,player:2});
    }catch(e){setError(e);create.disabled=join.disabled=false;}
  };
  async function poll(){
    if(!match||polling)return;
    polling=true;
    try{
      const data=await rpc('blocks_match_poll',{p_match:match.id,p_token:match.token,p_after:cursor});
      for(const event of data.events||[]){
        if(event.id<=cursor)continue;
        cursor=event.id;
        if(event.sender!==match.player){
          if(event.type==='attack')window.dispatchEvent(new CustomEvent('blocks:remote-attack',{detail:{rows:event.rows}}));
          if(event.type==='lost')window.dispatchEvent(new CustomEvent('blocks:remote-win'));
        }
      }
      if(data.status==='playing'){
        overlay.hidden=true;
        window.dispatchEvent(new CustomEvent('blocks:remote-ready'));
      }else if(data.status==='waiting'){
        overlay.hidden=false;status.textContent='Waiting for the other player. Share this code:';
      }else if(data.status==='finished'){
        window.dispatchEvent(new CustomEvent('blocks:remote-finished',{detail:{winner:data.winner}}));
        clearInterval(timer);
      }
      error.textContent='';
    }catch(e){setError(e)}
    finally{polling=false}
  }
  async function flush(){
    if(sending||!match||!pending.length)return;
    sending=true;
    try{
      while(pending.length){
        const item=pending[0];
        await rpc('blocks_match_send',{p_match:match.id,p_token:match.token,p_type:item.type,p_rows:item.rows});
        pending.shift();
      }
    }catch(e){setError(e)}
    finally{sending=false}
  }
  window.BLOCKS_REMOTE={
    get active(){return Boolean(match)},
    get player(){return match?.player||null},
    sendAttack(rows){if(!Number.isInteger(rows)||rows<1)return;pending.push({type:'attack',rows});void flush()},
    reportLoss(){pending.push({type:'lost',rows:null});void flush()},
    poll(){return poll()}
  };
  window.addEventListener('online',()=>{void poll();void flush()});
  setInterval(flush,1500);
})();
