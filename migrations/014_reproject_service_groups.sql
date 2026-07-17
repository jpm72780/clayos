-- 014 — kg_reproject_all() must rebuild service groups too.
--
-- kg_reproject_all() (006) DELETEs all entities/edges and rebuilds them from the
-- domain tables — but service groups (013) project from clayos.service_groups,
-- which it doesn't know about. With 009's nightly cron reprojection enabled they
-- would silently vanish every night at 04:40 UTC. Chain the service-group
-- projection at the end so EVERY reprojection path (cron, manual, reseed) keeps
-- them. Body otherwise identical to 006.
BEGIN;

SET search_path TO clayos, public, extensions;

CREATE OR REPLACE FUNCTION clayos.kg_reproject_all()
RETURNS void LANGUAGE plpgsql AS $$
DECLARE t text; r record;
BEGIN
  DELETE FROM clayos.edges;
  DELETE FROM clayos.entities;
  -- pass 1: all nodes
  FOREACH t IN ARRAY ARRAY[
    'organizations','persons','projects','phases','wbs_nodes','spaces','building_elements',
    'documents','cost_accounts','schedule_activities','rfis','submittals','daily_logs',
    'safety_events','quality_events','pay_apps','pursuits','estimates','contracts',
    'requisitions','it_assets'
  ] LOOP
    FOR r IN EXECUTE format('SELECT id FROM clayos.%I', t) LOOP
      PERFORM clayos.project_entity(t, r.id);
    END LOOP;
  END LOOP;
  -- pass 2: all edges (now every endpoint entity exists)
  FOREACH t IN ARRAY ARRAY[
    'projects','phases','wbs_nodes','spaces','building_elements','documents','cost_accounts',
    'schedule_activities','rfis','submittals','daily_logs','safety_events','quality_events',
    'pay_apps','pursuits','estimates','contracts','requisitions','it_assets',
    'schedule_dependencies','staffing_assignments'
  ] LOOP
    FOR r IN EXECUTE format('SELECT id FROM clayos.%I', t) LOOP
      PERFORM clayos.project_edges(t, r.id);
    END LOOP;
  END LOOP;
  -- pass 3: service groups (013) — entities + services/shares_data_with/staffed_on edges
  PERFORM clayos.kg_project_service_groups();
END $$;

COMMIT;
