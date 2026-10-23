-- Schedule only Blocks-scoped expired-room cleanup, leaving other apps untouched.
create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule(
  'blocks-expired-rooms-daily',
  '17 3 * * *',
  'select public.blocks_prune_expired_matches();'
);