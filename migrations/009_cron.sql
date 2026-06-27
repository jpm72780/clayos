-- Migration 009: scheduled jobs (pg_cron).
--
-- Guarded on pg_cron presence, so this is a clean no-op on local PG (the
-- pgvector image has no pg_cron) and active on Supabase.
--
--   * refresh_all_kpis  — every 30 min
--   * snapshot_kpis     — nightly 04:20 UTC (feeds kpi_history trend charts)
--   * kg_reproject_all  — nightly 04:40 UTC (reconcile any graph/relational drift)
--
-- The async embedding drain (calling the embed-entities edge function via pg_net)
-- is added at PROVISIONING time once the function URL exists — see the commented
-- template at the bottom. Until then, embeddings are written by seed/generate.py.
-- ─────────────────────────────────────────────────────────────────────────────

SET search_path TO clayos, public, extensions;

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('clayos_refresh_kpis')   WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'clayos_refresh_kpis');
    PERFORM cron.schedule('clayos_refresh_kpis', '*/30 * * * *', $$SELECT clayos.refresh_all_kpis()$$);

    PERFORM cron.unschedule('clayos_snapshot_kpis')  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'clayos_snapshot_kpis');
    PERFORM cron.schedule('clayos_snapshot_kpis', '20 4 * * *', $$SELECT clayos.snapshot_kpis()$$);

    PERFORM cron.unschedule('clayos_reproject')      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'clayos_reproject');
    PERFORM cron.schedule('clayos_reproject', '40 4 * * *', $$SELECT clayos.kg_reproject_all()$$);
  ELSE
    RAISE NOTICE 'pg_cron not installed — skipping schedules (expected on local dev).';
  END IF;
END $do$;

-- ── PROVISIONING TEMPLATE: async embedding drain (enable after deploy) ───────
-- DO $$
-- BEGIN
--   PERFORM cron.schedule('clayos_embed_drain', '* * * * *', format(
--     $cmd$ SELECT net.http_post(
--       url := %L,
--       headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '|| current_setting('app.service_key')),
--       body := jsonb_build_object('batch_size', 100)) $cmd$,
--     'https://<CLAYOS_REF>.supabase.co/functions/v1/embed-entities'));
-- END $$;
