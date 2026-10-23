-- Guarded exits: a delayed exit from a completed earlier round must not
-- cancel the opponent's newly started game.
create or replace function public.blocks_match_exit(
  p_match uuid,p_token uuid,p_round integer)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare m public.blocks_matches%rowtype;
begin
  select * into m from public.blocks_matches
  where id=p_match and (host_token=p_token or guest_token=p_token)
    and expires_at>now()
  for update;
  if m.id is null then raise exception 'Match not found or access denied'; end if;
  if m.status='cancelled' then
    return jsonb_build_object('status','cancelled','round',m.round);
  end if;
  if p_round is null or p_round<>m.round then
    raise exception 'Stale match round; refresh before exiting';
  end if;
  if m.status not in ('waiting','ready','playing','finished') then
    raise exception 'Match cannot be exited';
  end if;
  update public.blocks_matches
  set status='cancelled',host_ready=false,guest_ready=false,updated_at=now()
  where id=p_match returning * into m;
  return jsonb_build_object('status',m.status,'round',m.round);
end $$;
revoke all on function public.blocks_match_exit(uuid,uuid,integer) from public;
grant execute on function public.blocks_match_exit(uuid,uuid,integer) to anon,authenticated;