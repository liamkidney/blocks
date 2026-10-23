-- Opt-in presence. Legacy production rooms are unaffected.
alter table public.blocks_matches
  add column if not exists presence_enabled boolean not null default false,
  add column if not exists host_seen_at timestamptz,
  add column if not exists guest_seen_at timestamptz;

create or replace function public.blocks_create_match_config(
  p_difficulty integer,p_piece_set text)
returns table(match_id uuid,room_code text,player_token uuid)
language plpgsql security definer set search_path=''
as $$
declare m public.blocks_matches%rowtype; candidate text; attempt integer;
begin
  if p_difficulty is null or p_difficulty not between 0 and 2
     or p_piece_set is null or p_piece_set not in ('ALL','IO') then
    raise exception 'Invalid multiplayer settings';
  end if;
  if (select count(*) from public.blocks_matches
      where created_at>now()-interval '1 minute')>=60 then
    raise exception 'Too many new games; try again shortly';
  end if;
  for attempt in 1..20 loop
    select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ',
      1+(get_byte(decode(replace(gen_random_uuid()::text,'-',''),'hex'),n)%24),1),'')
      into candidate from generate_series(0,5) n;
    insert into public.blocks_matches(code,difficulty,piece_set,presence_enabled,host_seen_at)
      values(candidate,p_difficulty,p_piece_set,true,now())
      on conflict(code) do nothing returning * into m;
    exit when m.id is not null;
  end loop;
  if m.id is null then raise exception 'Unable to allocate room code'; end if;
  return query select m.id,m.code,m.host_token;
end $$;

-- The idempotent guest endpoint registers its presence at join time.
create or replace function public.blocks_join_match_v2(p_code text,p_join_token uuid)
returns table(match_id uuid,player_token uuid)
language plpgsql security definer set search_path=''
as $$
declare m public.blocks_matches%rowtype;
begin
  if p_join_token is null or p_code is null or p_code !~* '^[A-Z]{6}$' then
    raise exception 'Invalid join request';
  end if;
  update public.blocks_matches
    set guest_token=p_join_token,status='ready',host_ready=false,guest_ready=false,
        guest_seen_at=now(),updated_at=now()
  where code=upper(p_code) and status='waiting' and expires_at>now()
  returning * into m;
  if m.id is null then
    select * into m from public.blocks_matches
    where code=upper(p_code) and guest_token=p_join_token
      and status in ('ready','playing','finished') and expires_at>now();
  end if;
  if m.id is null then raise exception 'Room unavailable or already joined'; end if;
  return query select m.id,p_join_token;
end $$;

-- Only the appropriate player can renew their heartbeat. Do not emit room
-- events on heartbeats. Extend TTL while an actual session remains active.
create or replace function public.blocks_match_heartbeat(
  p_match uuid,p_token uuid,p_round integer)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare m public.blocks_matches%rowtype;
begin
  update public.blocks_matches
    set host_seen_at=case when host_token=p_token then now() else host_seen_at end,
        guest_seen_at=case when guest_token=p_token then now() else guest_seen_at end,
        expires_at=greatest(expires_at,now()+interval '12 hours')
  where id=p_match and (host_token=p_token or guest_token=p_token)
    and round=p_round and status in ('waiting','ready','playing','finished')
    and expires_at>now()
  returning * into m;
  if m.id is null then raise exception 'Match not found or access denied'; end if;
  return jsonb_build_object('round',m.round,'status',m.status);
end $$;

-- The poll publishes presence state and adjudicates a one-sided disconnection
-- after 75 s. A single missing heartbeat never awards a match while the
-- other player is ALSO absent. In-flight and non-opt-in rooms are untouched.
create or replace function public.blocks_match_poll(
  p_match uuid,p_token uuid,p_after bigint default 0)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare m public.blocks_matches%rowtype;
    host_online boolean;guest_online boolean;
begin
  select * into m from public.blocks_matches
  where id=p_match and (host_token=p_token or guest_token=p_token)
    and expires_at>now()
  for update;
  if m.id is null then raise exception 'Match not found or access denied'; end if;
  host_online:=not m.presence_enabled or
    coalesce(m.host_seen_at>now()-interval '9 seconds',false);
  guest_online:=not m.presence_enabled or
    coalesce(m.guest_seen_at>now()-interval '9 seconds',false);
  if m.presence_enabled and m.status='playing' then
    if host_online and coalesce(m.guest_seen_at<now()-interval '75 seconds',false) then
      update public.blocks_matches
        set status='finished',winner=1,host_ready=false,guest_ready=false,
            updated_at=now() where id=m.id returning * into m;
    elsif guest_online and coalesce(m.host_seen_at<now()-interval '75 seconds',false) then
      update public.blocks_matches
        set status='finished',winner=2,host_ready=false,guest_ready=false,
            updated_at=now() where id=m.id returning * into m;
    end if;
  end if;
  return jsonb_build_object(
    'status',m.status,'winner',m.winner,'round',m.round,
    'host_ready',m.host_ready,'guest_ready',m.guest_ready,
    'host_wins',m.host_wins,'guest_wins',m.guest_wins,
    'difficulty',m.difficulty,'piece_set',m.piece_set,
    'presence_enabled',m.presence_enabled,
    'host_online',host_online,'guest_online',guest_online,
    'events',coalesce((select jsonb_agg(jsonb_build_object(
      'id',e.id,'sender',e.sender,'type',e.event_type,'rows',e.rows)
       order by e.id) from public.blocks_match_events e
      where e.match_id=m.id and e.round=m.round
       and e.id>greatest(p_after,0)),'[]'::jsonb)
  );
end $$;
revoke all on function public.blocks_match_heartbeat(uuid,uuid,integer) from public;
grant execute on function public.blocks_match_heartbeat(uuid,uuid,integer) to anon,authenticated;