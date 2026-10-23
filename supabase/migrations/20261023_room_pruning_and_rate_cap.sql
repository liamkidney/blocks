-- Room lifecycle housekeeping for the shared Supabase apps project.
-- Keep recently expired records for diagnosis and to return a useful error
-- to clients; delete rooms older than expiry + 24h. FK cascades event rows.
create index if not exists blocks_matches_created_at on public.blocks_matches(created_at);

create or replace function public.blocks_prune_expired_matches()
returns integer language plpgsql security definer set search_path=''
as $$
declare deleted_count integer;
begin
  delete from public.blocks_matches where expires_at<now()-interval '24 hours';
  get diagnostics deleted_count=row_count;
  return deleted_count;
end $$;
revoke all on function public.blocks_prune_expired_matches() from public,anon,authenticated;

-- Safety cap across both old and new anonymous room creation endpoints.
-- Guard the check with one advisory transaction lock so parallel creates
-- cannot all pass the same check simultaneously.
create or replace function public.blocks_create_match()
returns table(match_id uuid,room_code text,player_token uuid)
language plpgsql security definer set search_path=''
as $$
declare m public.blocks_matches%rowtype; candidate text; attempt integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('blocks-room-creation'));
  if (select count(*) from public.blocks_matches
    where created_at>now()-interval '1 minute')>=60 then
    raise exception 'Too many new games; try again shortly';
  end if;
  for attempt in 1..20 loop
    select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ',
      1+(get_byte(decode(replace(gen_random_uuid()::text,'-',''),'hex'),n)%24),1),'')
      into candidate from generate_series(0,5) n;
    insert into public.blocks_matches(code)
      values(candidate) on conflict(code) do nothing returning * into m;
    exit when m.id is not null;
  end loop;
  if m.id is null then raise exception 'Unable to allocate room code'; end if;
  return query select m.id,m.code,m.host_token;
end $$;

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
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('blocks-room-creation'));
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