-- Store competition rules once on the room so two devices cannot
-- silently play at different speeds or with different tetromino sets.
alter table public.blocks_matches
  add column if not exists difficulty smallint not null default 1
    check (difficulty between 0 and 2),
  add column if not exists piece_set text not null default 'ALL'
    check (piece_set in ('ALL','IO'));

-- Preserve the no-argument create RPC used by the already-live release.
-- New clients use this named endpoint and must pass explicit rules.
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
  -- Prevent unlimited anonymous room creation across the shared project.
  -- This is a coarse global limit, not a per-client rate limit.
  if (select count(*) from public.blocks_matches
      where created_at>now()-interval '1 minute')>=60 then
    raise exception 'Too many new games; try again shortly';
  end if;
  for attempt in 1..20 loop
    select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ',
      1+(get_byte(decode(replace(gen_random_uuid()::text,'-',''),'hex'),n)%24),1),'')
      into candidate from generate_series(0,5) n;
    insert into public.blocks_matches(code,difficulty,piece_set)
      values(candidate,p_difficulty,p_piece_set)
      on conflict(code) do nothing returning * into m;
    exit when m.id is not null;
  end loop;
  if m.id is null then raise exception 'Unable to allocate room code'; end if;
  return query select m.id,m.code,m.host_token;
end $$;

-- The guest picks an unguessable token before joining. Retrying a lost
-- response with that token returns the same room instead of failing.
-- Keep old blocks_join_match(text) for production clients.
create or replace function public.blocks_join_match_v2(
  p_code text,p_join_token uuid)
returns table(match_id uuid,player_token uuid)
language plpgsql security definer set search_path=''
as $$
declare m public.blocks_matches%rowtype;
begin
  if p_join_token is null or p_code is null or p_code !~* '^[A-Z]{6}$' then
    raise exception 'Invalid join request';
  end if;
  update public.blocks_matches
    set guest_token=p_join_token,status='ready',host_ready=false,
        guest_ready=false,updated_at=now()
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

create or replace function public.blocks_match_poll(
  p_match uuid,p_token uuid,p_after bigint default 0)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare m public.blocks_matches%rowtype;
begin
  select * into m from public.blocks_matches
  where id=p_match and (host_token=p_token or guest_token=p_token)
    and expires_at>now();
  if m.id is null then raise exception 'Match not found or access denied'; end if;
  return jsonb_build_object(
    'status',m.status,'winner',m.winner,'round',m.round,
    'host_ready',m.host_ready,'guest_ready',m.guest_ready,
    'host_wins',m.host_wins,'guest_wins',m.guest_wins,
    'difficulty',m.difficulty,'piece_set',m.piece_set,
    'events',coalesce((select jsonb_agg(jsonb_build_object(
      'id',e.id,'sender',e.sender,'type',e.event_type,'rows',e.rows)
       order by e.id) from public.blocks_match_events e
      where e.match_id=m.id and e.round=m.round
       and e.id>greatest(p_after,0)),'[]'::jsonb)
  );
end $$;
revoke all on function public.blocks_create_match_config(integer,text) from public;
revoke all on function public.blocks_join_match_v2(text,uuid) from public;
grant execute on function public.blocks_create_match_config(integer,text) to anon,authenticated;
grant execute on function public.blocks_join_match_v2(text,uuid) to anon,authenticated;