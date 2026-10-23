-- Short-code integration regression. Creates temporary test rooms inside a
-- transaction and rolls back every change. Execute in the Supabase SQL editor.
begin;
do $smoke$
declare
  host record; host2 record; legacy record; legacy_guest record;
  joined jsonb; result jsonb; participant uuid:=gen_random_uuid();
  tries integer; i integer;
begin
  perform set_config('request.headers','{"x-forwarded-for":"203.0.113.31"}',true);

  select * into host from public.blocks_create_match_short(2,'IO');
  if host.room_code !~ '^[BCDFGHJKLMNPQRSTVWXYZ]{3}$' then
    raise exception 'Invalid three-consonant code: %',host.room_code;
  end if;
  if host.code_expires_at < now()+interval '2 minutes 55 seconds' or
     host.code_expires_at > now()+interval '3 minutes 5 seconds' then
    raise exception 'Code lifetime differs from three minutes';
  end if;
  if exists(select 1 from public.blocks_short_code_denylist d
            where d.code=host.room_code) then
    raise exception 'A denylisted code was issued';
  end if;
  if (select m.code from public.blocks_matches m where m.id=host.match_id)
     !~ '^[A-Z]{6}$' then
    raise exception 'Internal legacy code was altered';
  end if;

  result:=public.blocks_expire_short_invite(host.match_id,host.player_token);
  if result->>'status'<>'waiting' then
    raise exception 'Unexpired invitation cancelled early';
  end if;

  joined:=public.blocks_join_match_short(host.room_code,participant);
  if joined->>'match_id'<>host.match_id::text or
     joined->>'player_token'<>participant::text then
    raise exception 'Joining a three-letter room failed: %',joined;
  end if;
  if exists(select 1 from public.blocks_short_invites i
            where i.code=host.room_code) then
    raise exception 'Join did not consume the invitation';
  end if;
  result:=public.blocks_join_match_short(host.room_code,participant);
  if result->>'match_id'<>host.match_id::text then
    raise exception 'Lost-response retry not idempotent';
  end if;
  result:=public.blocks_join_match_short(host.room_code,gen_random_uuid());
  if result->>'error' is null then
    raise exception 'Consumed invitation admitted an intruder';
  end if;
  result:=public.blocks_expire_short_invite(host.match_id,host.player_token);
  if result->>'status'<>'ready' then
    raise exception 'Post-join expiry cancelled the room';
  end if;
  perform public.blocks_match_start(host.match_id,host.player_token,1);
  perform public.blocks_match_start(host.match_id,participant,1);
  if (public.blocks_match_poll(host.match_id,host.player_token,0)->>'status')
     <> 'playing' then
    raise exception 'Session did not continue after invite consumption';
  end if;

  select * into host2 from public.blocks_create_match_short(1,'ALL');
  update public.blocks_short_invites
    set expires_at=now()-interval '1 second'
    where match_id=host2.match_id;
  result:=public.blocks_join_match_short(host2.room_code,gen_random_uuid());
  if result->>'error' is null then raise exception 'Expired invite allowed join'; end if;
  result:=public.blocks_expire_short_invite(host2.match_id,host2.player_token);
  if result->>'status'<>'expired' then
    raise exception 'Creator did not retire expired invitation';
  end if;

  -- All five attempted guesses are committed within this transaction, even
  -- though they have an error response. The sixth request is blocked.
  perform set_config('request.headers','{"x-forwarded-for":"203.0.113.32"}',true);
  for tries in 1..5 loop
    result:=public.blocks_join_match_short('ZZZ',gen_random_uuid());
  end loop;
  result:=public.blocks_join_match_short(host2.room_code,gen_random_uuid());
  if result->>'error' not like 'Too many attempts%' then
    raise exception 'Join rate limiter not enforced: %',result;
  end if;

  -- Ensure the generator repeatedly excludes denylisted combinations.
  for i in 1..15 loop
    select * into host2 from public.blocks_create_match_short(1,'ALL');
    if host2.room_code !~ '^[BCDFGHJKLMNPQRSTVWXYZ]{3}$'
       or exists(select 1 from public.blocks_short_code_denylist d
                 where d.code=host2.room_code) then
      raise exception 'Generated unsafe code %',host2.room_code;
    end if;
  end loop;

  -- Production's six-letter RPCs still work exactly as before.
  select * into legacy from public.blocks_create_match();
  if legacy.room_code !~ '^[A-Z]{6}$' then
    raise exception 'Legacy six-letter code changed';
  end if;
  select * into legacy_guest from public.blocks_join_match(legacy.room_code);
  if legacy_guest.match_id<>legacy.match_id then
    raise exception 'Legacy guest joining broken';
  end if;
end $smoke$;
rollback;