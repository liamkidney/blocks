-- A room's first game needs both devices to explicitly press START.
-- Session wins survive rematches and reset only when a new room is created.
alter table public.blocks_matches
  add column if not exists host_wins integer not null default 0 check (host_wins >= 0),
  add column if not exists guest_wins integer not null default 0 check (guest_wins >= 0);

alter table public.blocks_matches
  drop constraint if exists blocks_matches_status_check;
alter table public.blocks_matches
  add constraint blocks_matches_status_check
  check (status in ('waiting','ready','playing','finished','cancelled'));

-- The joined room remains in the ready state until BOTH players press START.
create or replace function public.blocks_join_match(p_code text)
returns table(match_id uuid, player_token uuid)
language plpgsql security definer set search_path = ''
as $$
declare m public.blocks_matches%rowtype; token uuid := gen_random_uuid();
begin
  update public.blocks_matches
  set guest_token=token,status='ready',host_ready=false,guest_ready=false,
      updated_at=now()
  where code=upper(trim(p_code)) and status='waiting' and expires_at>now()
  returning * into m;
  if m.id is null then raise exception 'Room unavailable or already joined'; end if;
  return query select m.id,token;
end $$;

-- The scores are authoritative and can only be read by holders of room tokens.
create or replace function public.blocks_match_poll(
  p_match uuid,p_token uuid,p_after bigint default 0)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare m public.blocks_matches%rowtype;
begin
  select * into m from public.blocks_matches
    where id=p_match and (host_token=p_token or guest_token=p_token) and expires_at>now();
  if m.id is null then raise exception 'Match not found or access denied'; end if;
  return jsonb_build_object(
    'status',m.status,'winner',m.winner,'round',m.round,
    'host_ready',m.host_ready,'guest_ready',m.guest_ready,
    'host_wins',m.host_wins,'guest_wins',m.guest_wins,
    'events',coalesce((select jsonb_agg(jsonb_build_object(
      'id',e.id,'sender',e.sender,'type',e.event_type,'rows',e.rows) order by e.id)
      from public.blocks_match_events e
      where e.match_id=m.id and e.round=m.round and e.id>greatest(p_after,0)),
      '[]'::jsonb)
  );
end $$;

-- Count a winner exactly once per match, at the authoritative transition.
-- Identical/retried loss reports are already protected by the row lock and
-- the idempotent send RPC. This trigger also covers any future finish path.
create or replace function public.blocks_count_match_win()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if old.status = 'playing' and new.status = 'finished' then
    if new.winner = 1 then
      new.host_wins := old.host_wins + 1;
    elsif new.winner = 2 then
      new.guest_wins := old.guest_wins + 1;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists blocks_count_match_win_trigger on public.blocks_matches;
create trigger blocks_count_match_win_trigger
  before update of status on public.blocks_matches
  for each row execute function public.blocks_count_match_win();

-- Idempotent start handshake, scoped to an actual room and expected round.
-- The first press records readiness. The second starts BOTH players' game.
create or replace function public.blocks_match_start(
  p_match uuid,p_token uuid,p_round integer)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare m public.blocks_matches%rowtype; player_no smallint;
begin
  select * into m from public.blocks_matches
    where id=p_match and (host_token=p_token or guest_token=p_token)
      and expires_at>now()
    for update;
  if m.id is null then raise exception 'Match not found or access denied'; end if;
  if p_round is null or p_round <> m.round then
    raise exception 'Match round has changed';
  end if;
  if m.status = 'playing' then
    return jsonb_build_object('status',m.status,'round',m.round,
      'host_ready',m.host_ready,'guest_ready',m.guest_ready,
      'host_wins',m.host_wins,'guest_wins',m.guest_wins);
  end if;
  if m.status <> 'ready' then raise exception 'Match not ready to start'; end if;
  player_no := case when m.host_token=p_token then 1 else 2 end;
  update public.blocks_matches
    set host_ready=(host_ready or player_no=1),
        guest_ready=(guest_ready or player_no=2),
        updated_at=now()
    where id=p_match returning * into m;
  if m.host_ready and m.guest_ready then
    update public.blocks_matches
      set status='playing',host_ready=false,guest_ready=false,updated_at=now()
      where id=p_match returning * into m;
  end if;
  return jsonb_build_object('status',m.status,'round',m.round,
    'host_ready',m.host_ready,'guest_ready',m.guest_ready,
    'host_wins',m.host_wins,'guest_wins',m.guest_wins);
end $$;

-- Allow the X on the initial ready screen to cancel for both devices too.
create or replace function public.blocks_match_exit(
  p_match uuid,p_token uuid,p_round integer)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare m public.blocks_matches%rowtype;
begin
  select * into m from public.blocks_matches
    where id=p_match
      and (host_token=p_token or guest_token=p_token)
      and expires_at>now()
    for update;
  if m.id is null then raise exception 'Match not found or access denied'; end if;
  if p_round is null or p_round>m.round then
    raise exception 'Invalid match round';
  end if;
  if m.status='cancelled' then
    return jsonb_build_object('status','cancelled','round',m.round);
  end if;
  if m.status not in ('waiting','ready','finished','playing') then
    raise exception 'Match cannot be exited';
  end if;
  update public.blocks_matches
    set status='cancelled',host_ready=false,guest_ready=false,
        updated_at=now()
    where id=p_match returning * into m;
  return jsonb_build_object('status',m.status,'round',m.round);
end $$;

revoke all on function public.blocks_match_start(uuid,uuid,integer) from public;
grant execute on function public.blocks_match_start(uuid,uuid,integer)
  to anon,authenticated;
revoke all on function public.blocks_count_match_win() from public;