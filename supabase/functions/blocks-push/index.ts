// BLOCKS dev-only Web Push gateway. Device secrets and VAPID private keys never reach browsers.
// REST tables have RLS enabled and no anon grants; all authorization happens here.
import { createClient } from "npm:@supabase/supabase-js@2.76.1";
import * as webpush from "jsr:@negrel/webpush@0.5.0";

const projectUrl=Deno.env.get("SUPABASE_URL")!;
const secretKeys=Deno.env.get("SUPABASE_SECRET_KEYS");
const adminKey=(secretKeys?JSON.parse(secretKeys).default:null)||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db=createClient(projectUrl,adminKey,{auth:{persistSession:false,autoRefreshToken:false}});
const allowedOrigin="https://liamkidney.github.io";
const cors={"Access-Control-Allow-Origin":allowedOrigin,"Access-Control-Allow-Headers":"content-type,apikey,authorization","Access-Control-Allow-Methods":"POST,OPTIONS","Vary":"Origin"};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json",...cors}});
const fail=(message:string,status=400)=>reply({error:message},status);
const uuid=(s:unknown)=>typeof s==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
const sha=async(text:string)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(text)))).map(n=>n.toString(16).padStart(2,"0")).join("");
const result=async <T>(query:PromiseLike<{data:T,error:{message:string}|null}>):Promise<T>=>{
  const {data,error}=await query;
  if(error)throw Error(error.message);
  return data;
};
type Input=Record<string,unknown>;
type Installation={id:string,secret_hash:string,player_id:string,display_name:string,subscription:unknown,channel:string};
let vapidCache:Promise<{keys:CryptoKeyPair,publicKey:string}>|null=null;
async function vapid(){
  if(!vapidCache)vapidCache=(async()=>{
    let rows=await result(db.from("blocks_push_vapid").select("keypair").eq("id",1).limit(1));
    if(!rows.length){
      const keys=await webpush.generateVapidKeys({extractable:true});
      const keypair=await webpush.exportVapidKeys(keys);
      // If two functions initialize concurrently, keep the first persisted key.
      await db.from("blocks_push_vapid").upsert({id:1,keypair},{onConflict:"id",ignoreDuplicates:true});
      rows=await result(db.from("blocks_push_vapid").select("keypair").eq("id",1).limit(1));
    }
    if(!rows.length)throw Error("VAPID setup failed");
    const keys=await webpush.importVapidKeys(rows[0].keypair);
    return {keys,publicKey:await webpush.exportApplicationServerKey(keys)};
  })().catch(err=>{vapidCache=null;throw err});
  return vapidCache;
}
async function installation(body:Input):Promise<Installation>{
  if(!uuid(body.deviceId)||!uuid(body.deviceSecret))throw Error("Invalid device identity");
  const id=body.deviceId as string;
  const rows=await result(db.from("blocks_push_installations").select("*").eq("id",id).limit(1));
  const record=rows[0] as Installation|undefined;
  if(!record||record.channel!=="dev"||record.secret_hash!==await sha(body.deviceSecret as string))
    throw Error("Device not registered or credentials changed");
  return record;
}
async function participant(body:Input,device:Installation){
  if(!uuid(body.matchId)||!uuid(body.matchToken))throw Error("Invalid room credentials");
  const rows=await result(db.from("blocks_matches").select("id,host_token,guest_token,status,short_code").eq("id",body.matchId).limit(1));
  const room=rows[0];
  if(!room)throw Error("Room not found");
  const side=room.host_token===body.matchToken?1:room.guest_token===body.matchToken?2:0;
  if(!side)throw Error("You cannot access this room");
  const pairs=await result(db.from("blocks_push_pairs").select("installation_id").eq("match_id",room.id).eq("side",side).limit(1));
  if(pairs[0]&&pairs[0].installation_id!==device.id)throw Error("Room already associated with another installation");
  return {room,side};
}
async function friendStatus(matchId:string,device:Installation){
  const pairs=await result(db.from("blocks_push_pairs").select("side,installation_id,wants_friend").eq("match_id",matchId));
  const own=pairs.find(p=>p.installation_id===device.id);
  const other=pairs.find(p=>p.side!==own?.side);
  const existing=own&&other?await result(db.from("blocks_push_friends").select("first_id").eq("first_id",own.installation_id<other.installation_id?own.installation_id:other.installation_id).eq("second_id",own.installation_id>other.installation_id?own.installation_id:other.installation_id).limit(1)):[];
  return {mine:!!own?.wants_friend,theirs:!!other?.wants_friend,friends:existing.length>0};
}
async function handle(body:Input){
  const action=body.action;
  if(action==="config")return reply({publicKey:(await vapid()).publicKey});
  if(action==="register"){
    if(!uuid(body.deviceId)||!uuid(body.deviceSecret)||!uuid(body.playerId))
      return fail("Invalid player identity");
    const name=typeof body.name==="string"&&body.name.trim()?body.name.trim().slice(0,40):"Anonymous";
    let subscription=body.subscription??null;
    if(subscription!==null){
      const x=subscription as {endpoint?:unknown,keys?:{auth?:unknown,p256dh?:unknown}};
      if(typeof x?.endpoint!=="string"||x.endpoint.length>2048||
          !/^https:\/\//.test(x.endpoint)||typeof x.keys?.auth!=="string"||
          typeof x.keys?.p256dh!=="string")return fail("Invalid push subscription");
      const hostname=new URL(x.endpoint).hostname;
      // Do not allow arbitrary network targets through the server-side sender.
      if(!["push.apple.com","web.push.apple.com","fcm.googleapis.com","updates.push.services.mozilla.com"].includes(hostname)&&
        !hostname.endsWith(".push.apple.com"))return fail("Unsupported push service");
    }
    const hashed=await sha(body.deviceSecret as string);
    const old=await result(db.from("blocks_push_installations").select("secret_hash,subscription").eq("id",body.deviceId).limit(1));
    if(old.length&&old[0].secret_hash!==hashed)return fail("Identity already exists",403);
    if(old.length&&subscription===null)subscription=old[0].subscription;
    await result(db.from("blocks_push_installations").upsert({
      id:body.deviceId,secret_hash:hashed,player_id:body.playerId,
      display_name:name,subscription,channel:"dev",updated_at:new Date().toISOString()
    },{onConflict:"id"}).select("id"));
    return reply({ok:true});
  }
  const device=await installation(body);
  if(action==="attach"){
    const {room,side}=await participant(body,device);
    await result(db.from("blocks_push_pairs").upsert({
      match_id:room.id,side,installation_id:device.id,updated_at:new Date().toISOString()
    },{onConflict:"match_id,side"}).select("match_id"));
    return reply({ok:true});
  }
  if(action==="friend_status"){
    const {room}=await participant(body,device);
    return reply(await friendStatus(room.id,device));
  }
  if(action==="offer_friend"){
    const {room,side}=await participant(body,device);
    if(room.status!=="finished")return fail("Finish the game before adding a friend");
    const accepted=await result(db.rpc("blocks_push_offer_friend",{
      p_match:room.id,p_side:side,p_installation:device.id
    }));
    return reply({ok:true,friends:accepted});
  }
  if(action==="friends"){
    const pairs=await result(db.from("blocks_push_friends").select("first_id,second_id").or("first_id.eq."+device.id+",second_id.eq."+device.id));
    const ids=pairs.map(p=>p.first_id===device.id?p.second_id:p.first_id);
    if(!ids.length)return reply({friends:[]});
    const people=await result(db.from("blocks_push_installations").select("id,display_name,subscription").in("id",ids).eq("channel","dev"));
    return reply({friends:people.map(p=>({id:p.id,name:p.display_name,canNotify:!!p.subscription}))});
  }
  if(action==="invite"){
    if(!uuid(body.friendId))return fail("Unknown friend");
    const {room,side}=await participant(body,device);
    if(side!==1||room.status!=="waiting")return fail("Only a waiting room's creator can invite");
    const friendId=body.friendId as string;
    if(friendId===device.id)return fail("You cannot invite yourself");
    const ids=[device.id,friendId].sort();
    const friendship=await result(db.from("blocks_push_friends").select("first_id").eq("first_id",ids[0]).eq("second_id",ids[1]).limit(1));
    if(!friendship.length)return fail("Only saved friends may be invited",403);
    const invites=await result(db.from("blocks_short_invites").select("code,expires_at").eq("match_id",room.id).limit(1));
    const invitation=invites[0];
    if(!invitation||Date.parse(invitation.expires_at)<Date.now()+5000)return fail("Room code expired");
    const recent=await result(db.from("blocks_push_invites").select("id").eq("sender_id",device.id).eq("recipient_id",friendId).gte("created_at",new Date(Date.now()-30000).toISOString()).limit(1));
    if(recent.length)return fail("Invitation recently sent. Try again shortly.",429);
    const receivers=await result(db.from("blocks_push_installations").select("subscription").eq("id",friendId).eq("channel","dev").limit(1));
    if(!receivers[0]?.subscription)return fail("Friend has not enabled notifications");
    const {keys}=await vapid();
    const appServer=await webpush.ApplicationServer.new({
      contactInformation:"https://liamkidney.github.io/blocks/",
      vapidKeys:keys
    });
    const bodyText=(device.display_name==="Anonymous"?"A friend":device.display_name)+" invites you to play BLOCKS";
    const payload=JSON.stringify({title:"BLOCKS",body:bodyText,
      path:"/blocks/dev/?remote=1&push_join="+encodeURIComponent(invitation.code),
      matchId:room.id});
    await appServer.subscribe(receivers[0].subscription).pushTextMessage(payload,{
      ttl:180,urgency:webpush.Urgency.High
    });
    await result(db.from("blocks_push_invites").insert({
      match_id:room.id,sender_id:device.id,recipient_id:friendId
    }).select("id"));
    return reply({ok:true});
  }
  return fail("Unknown action");
}
Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
  if(req.method!=="POST")return fail("Method not supported",405);
  const origin=req.headers.get("origin");
  if(origin&&origin!==allowedOrigin)return fail("Origin not allowed",403);
  try{
    const text=await req.text();
    if(text.length>6000)return fail("Request too large",413);
    const body=JSON.parse(text);
    if(!body||typeof body!=="object"||Array.isArray(body))return fail("Invalid request");
    return await handle(body);
  }catch(err){
    console.error("Blocks push:",err instanceof Error?err.message:err);
    return fail(err instanceof Error?err.message:"Request failed",400);
  }
});
