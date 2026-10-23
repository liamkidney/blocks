-- Two-phone rematches: same match, same player tokens, a new isolated round.
alter table public.blocks_matches
  add column if not exists round integer not null default 1
    check (round between 1 and 1000000),
  add column if not exists host_ready boolean not null default false,
  add column if not exists guest_ready boolean not null default false;

alter table public.blocks_match_events
  add column if not exists round integer not null default 1;
create index if not exists blocks_match_events_round_cursor
  on public.blocks_match_events(match_id,round,id);

create or replace function public.blocks_match_poll(p_match uuid,p_token uuid,p_after bigint default 0)
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
    'events',coalesce((select jsonb_agg(jsonb_build_object(
      'id',e.id,'sender',e.sender,'type',e.event_type,'rows',e.rows) order by e.id)
      from public.blocks_match_events e
      where e.match_id=m.id and e.round=m.round and e.id>greatest(p_after,0)),
      '[]'::jsonb)
  );
end $$;

-- Old signature is revoked and removed, so old clients cannot send
-- an attack from a previous game after a new round has started.
revoke all on function public.blocks_match_send(uuid,uuid,text,integer,uuid) from anon,authenticated,public;
drop function public.blocks_match_send(uuid,uuid,text,integer,uuid);
create or replace function public.blocks_match_send(
  p_match uuid,p_token uuid,p_type text,p_rows integer default null,
  p_key uuid default null,p_round integer default null)
returns bigint language plpgsql security definer set search_path = ''
as $$
declare m public.blocks_matches%rowtype; sender_no smallint; event_id bigint;
begin
  select * into m from public.blocks_matches
    where id=p_match and (host_token=p_token or guest_token=p_token) and expires_at>now()
    for update;
  if m.id is null then raise exception 'Match not found or access denied'; end if;
  sender_no:=case when m.host_token=p_token then 1 else 2 end;
  if p_key is null or p_round is null then raise exception 'Missing round or event id'; end if;
  -- A lost acknowledgement can be retried even after a match finishes.
  select id into event_id from public.blocks_match_events
    where match_id=p_match and sender=sender_no and event_key=p_key;
  if event_id is not null then return event_id; end if;
  if m.status<>'playing' or m.round<>p_round then raise exception 'Match round not active'; end if;
  if not ((p_type='attack' and p_rows between 1 and 20) or
          (p_type='lost' and p_rows is null)) then raise exception 'Invalid event'; end if;
  insert into public.blocks_match_events(match_id,sender,event_type,rows,event_key,round)
    values(p_match,sender_no,p_type,p_rows,p_key,p_round)
    on conflict(match_id,sender,event_key) do nothing returning id into event_id;
  if event_id is null then
    select id into event_id from public.blocks_match_events
      where match_id=p_match and sender=sender_no and event_key=p_key;
  end if;
  if p_type='lost' then
    update public.blocks_matches set status='finished',winner=3-sender_no,
      host_ready=false,guest_ready=false,updated_at=now()
      where id=p_match;
  end if;
  return event_id;
end $$;

create or replace function public.blocks_match_rematch(
  p_match uuid,p_token uuid,p_round integer)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare m public.blocks_matches%rowtype; player_number smallint;
begin
  select * into m from public.blocks_matches
    where id=p_match and (host_token=p_token or guest_token=p_token) and expires_at>now()
    for update;
  if m.id is null then raise exception 'Match not found or access denied'; end if;
  if m.round>p_round then
    return jsonb_build_object('status',m.status,'round',m.round);
  end if;
  if m.round<>p_round or m.status<>'finished' then
    raise exception 'Rematch not available';
  end if;
  player_number:=case when m.host_token=p_token then 1 else 2 end;
  update public.blocks_matches
    set host_ready=(host_ready or player_number=1),
        guest_ready=(guest_ready or player_number=2),
        updated_at=now()
    where id=p_match returning * into m;
  if m.host_ready and m.guest_ready then
    update public.blocks_matches
      set status='playing',round=round+1,winner=null,
          host_ready=false,guest_ready=false,updated_at=now()
      where id=p_match returning * into m;
  end if;
  return jsonb_build_object('status',m.status,'round',m.round,
    'host_ready',m.host_ready,'guest_ready',m.guest_ready);
end $$;

revoke all on function public.blocks_match_send(uuid,uuid,text,integer,uuid,integer) from public;
revoke all on function public.blocks_match_rematch(uuid,uuid,integer) from public;
grant execute on function public.blocks_match_send(uuid,uuid,text,integer,uuid,integer)
  to anon,authenticated;
grant execute on function public.blocks_match_rematch(uuid,uuid,integer)
  to anon,authenticated;

-- Wake both phones when a rematch is requested or accepted.
drop trigger if exists blocks_match_status_notify on public.blocks_matches;
create trigger blocks_match_status_notify
  after update of status,round,host_ready,guest_ready on public.blocks_matches
  for each row when (
    old.status is distinct from new.status
    or old.round is distinct from new.round
    or old.host_ready is distinct from new.host_ready
    or old.guest_ready is distinct from new.guest_ready
  )
  execute function public.blocks_notify_match_status();