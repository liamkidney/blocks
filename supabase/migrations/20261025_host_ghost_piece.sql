-- Host-selected Ghost Piece is a room rule, just like difficulty and piece set.
-- Keep existing anonymous room RPCs unchanged for already-deployed clients.
-- NULL denotes a legacy room that predates this setting.
alter table public.blocks_matches
  add column if not exists ghost_piece boolean;

-- Explicitly version the short-room creator to avoid modifying the signature
-- used by existing production clients sharing this Supabase project.
create or replace function public.blocks_create_match_short_v2(
  p_difficulty integer,p_piece_set text,p_ghost_piece boolean)
returns table(match_id uuid,room_code text,player_token uuid,code_expires_at timestamptz)
language plpgsql security definer set search_path=''
as $$
declare created record;
begin
  if p_ghost_piece is null then
    raise exception 'Invalid Ghost Piece setting';
  end if;
  select * into created
    from public.blocks_create_match_short(p_difficulty,p_piece_set);
  if created.match_id is null then
    raise exception 'Unable to create game';
  end if;
  update public.blocks_matches
    set ghost_piece=p_ghost_piece
    where id=created.match_id;
  return query
    select created.match_id,created.room_code,created.player_token,created.code_expires_at;
end $$;
revoke all on function public.blocks_create_match_short_v2(integer,text,boolean)
  from public;
grant execute on function public.blocks_create_match_short_v2(integer,text,boolean)
  to anon,authenticated;

-- Preserve presence adjudication and idempotent event retrieval, while adding
-- the immutable host Ghost Piece setting to both host and guest poll responses.
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
    'ghost_piece',m.ghost_piece,
    'presence_enabled',m.presence_enabled,
    'host_online',host_online,'guest_online',guest_online,
    'events',coalesce((select jsonb_agg(jsonb_build_object(
      'id',e.id,'sender',e.sender,'type',e.event_type,'rows',e.rows)
       order by e.id) from public.blocks_match_events e
      where e.match_id=m.id and e.round=m.round
       and e.id>greatest(p_after,0)),'[]'::jsonb)
  );
end $$;

-- Refresh PostgREST's RPC schema so the new creator is callable immediately.
notify pgrst, 'reload schema';
