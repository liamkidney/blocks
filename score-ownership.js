// Possession of a private, random installation key authorises removal of scores
// created on that installation. Public player IDs are never treated as credentials.
(()=>{
 const STORAGE_KEY="blocks:score-owner-key:v1";
 const API="https://psoncybkfsdmjksyrcvv.supabase.co/rest/v1/rpc/";
 const API_KEY="sb_publishable_z-Aumyx5v_WMPTbY77u88A_H3oEEzFH";
 const headers={apikey:API_KEY,"Content-Type":"application/json"};
 let hashPromise=null;

 function key(){
  try{
   let value=localStorage.getItem(STORAGE_KEY);
   if(typeof value==="string"&&/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value))
    return value;
   if(!crypto?.randomUUID)return null;
   value=crypto.randomUUID();
   localStorage.setItem(STORAGE_KEY,value);
   return value;
  }catch(_){return null;}
 }
 async function hash(){
  const secret=key();
  if(!secret||!crypto?.subtle)return null;
  if(!hashPromise){
   hashPromise=crypto.subtle.digest("SHA-256",new TextEncoder().encode(secret))
    .then(bytes=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,"0")).join(""))
    .catch(()=>null);
  }
  return hashPromise;
 }
 async function rpc(name,arguments_){
  const response=await fetch(API+name,{
   method:"POST",headers,body:JSON.stringify(arguments_)
  });
  if(!response.ok)throw new Error("Score ownership request failed: "+response.status);
  return response.json();
 }
 async function ownedScoreIds(){
  const secret=key();
  if(!secret)return new Set();
  const data=await rpc("owned_score_ids",{owner_key:secret});
  return new Set(data.map(record=>record.session_id));
 }
 async function removeScore(sessionId){
  const secret=key();
  if(!secret)throw new Error("Score ownership key is unavailable");
  return (await rpc("remove_owned_score",{score_id:sessionId,owner_key:secret}))===true;
 }
 window.BLOCKS_SCORE_OWNER=Object.freeze({hash,ownedScoreIds,removeScore});
})();
