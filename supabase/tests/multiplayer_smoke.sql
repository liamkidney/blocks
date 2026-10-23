-- Blocks multiplayer integration smoke test. Run in Supabase SQL editor.
-- All inserted rooms/events and test clock changes are rolled back.
begin;
do $blocks_test$
declare
  host record; guest record; state jsonb; key uuid:=gen_random_uuid();
  id_first bigint; id_retry bigint; denied boolean;
begin
  select * into host from public.blocks_create_match_config(2,'IO');
  select * into guest from public.blocks_join_match_v2(host.room_code,gen_random_uuid());
  if guest.match_id<>host.match_id then raise exception 'Join wrong room'; end if;
  if (select player_token from public.blocks_join_match_v2(host.room_code,guest.player_token))<>guest.player_token
    then raise exception 'Idempotent join failed'; end if;
  state:=public.blocks_match_poll(host.match_id,host.player_token,0);
  if state->>'status'<>'ready' or state->>'difficulty'<>'2'
    or state->>'piece_set'<>'IO' or state->>'presence_enabled'<>'true'
    then raise exception 'Configured ready room mismatch'; end if;
  perform public.blocks_match_heartbeat(host.match_id,host.player_token,1);
  perform public.blocks_match_heartbeat(guest.match_id,guest.player_token,1);
  state:=public.blocks_match_start(host.match_id,host.player_token,1);
  if state->>'status'<>'ready' then raise exception 'First Start should wait'; end if;
  state:=public.blocks_match_start(guest.match_id,guest.player_token,1);
  if state->>'status'<>'playing' then raise exception 'Second Start should play'; end if;
  id_first:=public.blocks_match_send(host.match_id,host.player_token,'attack',2,key,1);
  id_retry:=public.blocks_match_send(host.match_id,host.player_token,'attack',2,key,1);
  if id_first<>id_retry then raise exception 'Duplicated attack'; end if;
  perform public.blocks_match_send(guest.match_id,guest.player_token,'lost',null,gen_random_uuid(),1);
  state:=public.blocks_match_poll(host.match_id,host.player_token,0);
  if state->>'winner'<>'1' or state->>'host_wins'<>'1'
    then raise exception 'First winner not counted exactly once'; end if;
  state:=public.blocks_match_rematch(host.match_id,host.player_token,1);
  if state->>'status'<>'finished' then raise exception 'Rematch did not wait'; end if;
  state:=public.blocks_match_rematch(guest.match_id,guest.player_token,1);
  if state->>'status'<>'playing' or state->>'round'<>'2'
    then raise exception 'Second rematch did not start'; end if;
  denied:=false;
  begin
    perform public.blocks_match_exit(host.match_id,host.player_token,1);
  exception when others then denied:=true;
  end;
  if not denied then raise exception 'Stale exit cancelled new round'; end if;
  denied:=false;
  begin
    perform public.blocks_match_poll(host.match_id,gen_random_uuid(),0);
  exception when others then denied:=true;
  end;
  if not denied then raise exception 'Unrecognised token gained access'; end if;
  update public.blocks_matches
    set guest_seen_at=now()-interval '80 seconds',host_seen_at=now()
    where id=host.match_id;
  state:=public.blocks_match_poll(host.match_id,host.player_token,0);
  if state->>'winner'<>'1' or state->>'host_wins'<>'2'
    then raise exception 'Disconnect did not settle winner exactly once'; end if;
  state:=public.blocks_match_exit(host.match_id,host.player_token,2);
  if state->>'status'<>'cancelled' then raise exception 'Exit failed'; end if;
end $blocks_test$;
rollback;
