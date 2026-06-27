-- Migration 006: graph projection (per-domain tables → entities/edges).
--
-- project_entity()  upserts the node for one source row (+ enqueues an embed job).
-- project_edges()   (re)builds that row's outgoing edges, tagged with origin so
--                   re-projection is idempotent and each source row owns its edges.
-- project_to_graph() = both; triggers call it on INSERT/UPDATE, and remove on DELETE.
-- kg_reproject_all() rebuilds the whole graph in two passes (entities, then edges)
--                   so completeness never depends on seed insert order.
-- ─────────────────────────────────────────────────────────────────────────────

SET search_path TO clayos, public, extensions;

-- ─── Embed job queue ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clayos.graph_embed_jobs (
  entity_id   uuid PRIMARY KEY REFERENCES clayos.entities(id) ON DELETE CASCADE,
  enqueued_at timestamptz NOT NULL DEFAULT now(),
  claimed_at  timestamptz,
  attempts    int NOT NULL DEFAULT 0,
  last_error  text
);
CREATE INDEX IF NOT EXISTS embed_jobs_pending_idx
  ON clayos.graph_embed_jobs (enqueued_at) WHERE claimed_at IS NULL;

-- ─── Helpers ─────────────────────────────────────────────────────────────────
-- Resolve the entity id for a (source_table, source_id) pair. NULL if absent.
CREATE OR REPLACE FUNCTION clayos._eid(p_table text, p_id uuid)
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM clayos.entities WHERE source_table = p_table AND source_id = p_id;
$$;

-- Insert one edge, skipping if either endpoint is missing. Tags origin so the
-- creating row can later delete+rebuild exactly its own edges.
CREATE OR REPLACE FUNCTION clayos._add_edge(p_type text, p_src uuid, p_dst uuid, p_origin text, p_origin_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_src IS NULL OR p_dst IS NULL OR p_src = p_dst THEN RETURN; END IF;
  INSERT INTO clayos.edges (edge_type, src_id, dst_id, properties)
  VALUES (p_type, p_src, p_dst, jsonb_build_object('origin', p_origin, 'origin_id', p_origin_id))
  ON CONFLICT (edge_type, src_id, dst_id) DO UPDATE SET properties = EXCLUDED.properties;
END $$;

-- Upsert one entity by (source_table, source_id) and enqueue it for embedding.
CREATE OR REPLACE FUNCTION clayos._upsert_entity(
  p_type text, p_bu uuid, p_table text, p_id uuid,
  p_label text, p_class uuid, p_domain text, p_props jsonb)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_eid uuid;
BEGIN
  INSERT INTO clayos.entities (entity_type, business_unit_id, source_table, source_id, label, classification_id, domain, properties)
  VALUES (p_type, p_bu, p_table, p_id, COALESCE(NULLIF(btrim(p_label), ''), '(unnamed)'), p_class, p_domain, COALESCE(p_props, '{}'::jsonb))
  ON CONFLICT (source_table, source_id) DO UPDATE
    SET entity_type = EXCLUDED.entity_type, business_unit_id = EXCLUDED.business_unit_id,
        label = EXCLUDED.label, classification_id = EXCLUDED.classification_id,
        domain = EXCLUDED.domain, properties = EXCLUDED.properties, updated_at = now()
  RETURNING id INTO v_eid;
  INSERT INTO clayos.graph_embed_jobs (entity_id) VALUES (v_eid) ON CONFLICT (entity_id) DO NOTHING;
  RETURN v_eid;
END $$;

-- ─── project_entity: source row → node ──────────────────────────────────────
CREATE OR REPLACE FUNCTION clayos.project_entity(p_table text, p_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE rec record; v_bu uuid;
BEGIN
  IF p_table = 'organizations' THEN
    SELECT * INTO rec FROM clayos.organizations WHERE id = p_id; IF NOT FOUND THEN RETURN; END IF;
    PERFORM clayos._upsert_entity('Organization', NULL, p_table, p_id, rec.name, NULL, 'enterprise',
      jsonb_build_object('org_type', rec.org_type, 'trade', rec.trade, 'city', rec.city, 'state', rec.state));

  ELSIF p_table = 'persons' THEN
    SELECT * INTO rec FROM clayos.persons WHERE id = p_id; IF NOT FOUND THEN RETURN; END IF;
    PERFORM clayos._upsert_entity('Person', rec.business_unit_id, p_table, p_id, rec.full_name, NULL, 'hr',
      jsonb_build_object('title', rec.title, 'role_category', rec.role_category, 'is_active', rec.is_active));

  ELSIF p_table = 'projects' THEN
    SELECT * INTO rec FROM clayos.projects WHERE id = p_id; IF NOT FOUND THEN RETURN; END IF;
    PERFORM clayos._upsert_entity('Project', rec.business_unit_id, p_table, p_id, rec.name, NULL, 'project',
      jsonb_build_object('code', rec.code, 'sector', rec.sector, 'lifecycle_stage', rec.lifecycle_stage,
                         'status', rec.status, 'contract_value', rec.contract_value, 'city', rec.city, 'state', rec.state));

  ELSIF p_table = 'phases' THEN
    SELECT * INTO rec FROM clayos.phases WHERE id = p_id; IF NOT FOUND THEN RETURN; END IF;
    v_bu := (SELECT business_unit_id FROM clayos.projects WHERE id = rec.project_id);
    PERFORM clayos._upsert_entity('Phase', v_bu, p_table, p_id, rec.name, NULL, 'project_controls',
      jsonb_build_object('seq', rec.seq, 'status', rec.status, 'project_id', rec.project_id));

  ELSIF p_table = 'wbs_nodes' THEN
    SELECT * INTO rec FROM clayos.wbs_nodes WHERE id = p_id; IF NOT FOUND THEN RETURN; END IF;
    v_bu := (SELECT business_unit_id FROM clayos.projects WHERE id = rec.project_id);
    PERFORM clayos._upsert_entity('Work', v_bu, p_table, p_id, concat_ws(' ', rec.code, rec.name), rec.code_id, 'project_controls',
      jsonb_build_object('code', rec.code, 'project_id', rec.project_id));

  ELSIF p_table = 'spaces' THEN
    SELECT * INTO rec FROM clayos.spaces WHERE id = p_id; IF NOT FOUND THEN RETURN; END IF;
    v_bu := (SELECT business_unit_id FROM clayos.projects WHERE id = rec.project_id);
    PERFORM clayos._upsert_entity('Space', v_bu, p_table, p_id, rec.name, NULL, 'design',
      jsonb_build_object('building', rec.building, 'level', rec.level, 'space_type', rec.space_type, 'area_sf', rec.area_sf, 'project_id', rec.project_id));

  ELSIF p_table = 'building_elements' THEN
    SELECT * INTO rec FROM clayos.building_elements WHERE id = p_id; IF NOT FOUND THEN RETURN; END IF;
    v_bu := (SELECT business_unit_id FROM clayos.projects WHERE id = rec.project_id);
    PERFORM clayos._upsert_entity('BuildingElement', v_bu, p_table, p_id, rec.name, rec.uniformat_code_id, 'design',
      jsonb_build_object('ifc_class', rec.ifc_class, 'manufacturer', rec.manufacturer, 'model', rec.model, 'status', rec.status, 'project_id', rec.project_id));

  ELSIF p_table = 'documents' THEN
    SELECT * INTO rec FROM clayos.documents WHERE id = p_id; IF NOT FOUND THEN RETURN; END IF;
    v_bu := (SELECT business_unit_id FROM clayos.projects WHERE id = rec.project_id);
    PERFORM clayos._upsert_entity('Document', v_bu, p_table, p_id, concat_ws(' ', rec.number, rec.title), NULL, 'design',
      jsonb_build_object('doc_type', rec.doc_type, 'number', rec.number, 'revision', rec.revision, 'discipline', rec.discipline, 'project_id', rec.project_id));

  ELSIF p_table = 'cost_accounts' THEN
    SELECT * INTO rec FROM clayos.cost_accounts WHERE id = p_id; IF NOT FOUND THEN RETURN; END IF;
    v_bu := (SELECT business_unit_id FROM clayos.projects WHERE id = rec.project_id);
    PERFORM clayos._upsert_entity('CostAccount', v_bu, p_table, p_id, rec.name, rec.masterformat_code_id, 'project_controls',
      jsonb_build_object('cost_type', rec.cost_type, 'bac', rec.bac, 'committed', rec.committed, 'project_id', rec.project_id));

  ELSIF p_table = 'schedule_activities' THEN
    SELECT * INTO rec FROM clayos.schedule_activities WHERE id = p_id; IF NOT FOUND THEN RETURN; END IF;
    v_bu := (SELECT business_unit_id FROM clayos.projects WHERE id = rec.project_id);
    PERFORM clayos._upsert_entity('Activity', v_bu, p_table, p_id, rec.name, NULL, 'project_controls',
      jsonb_build_object('pct_complete', rec.pct_complete, 'is_critical', rec.is_critical,
                         'planned_start', rec.planned_start, 'planned_finish', rec.planned_finish, 'project_id', rec.project_id));

  ELSIF p_table = 'rfis' THEN
    SELECT * INTO rec FROM clayos.rfis WHERE id = p_id; IF NOT FOUND THEN RETURN; END IF;
    v_bu := (SELECT business_unit_id FROM clayos.projects WHERE id = rec.project_id);
    PERFORM clayos._upsert_entity('RFI', v_bu, p_table, p_id, 'RFI ' || COALESCE(rec.number, '') || ': ' || rec.subject, rec.spec_section_code_id, 'field_ops',
      jsonb_build_object('status', rec.status, 'ball_in_court', rec.ball_in_court, 'submitted_date', rec.submitted_date,
                         'answered_date', rec.answered_date, 'cost_impact', rec.cost_impact, 'project_id', rec.project_id));

  ELSIF p_table = 'submittals' THEN
    SELECT * INTO rec FROM clayos.submittals WHERE id = p_id; IF NOT FOUND THEN RETURN; END IF;
    v_bu := (SELECT business_unit_id FROM clayos.projects WHERE id = rec.project_id);
    PERFORM clayos._upsert_entity('Submittal', v_bu, p_table, p_id, concat_ws(' ', rec.number, rec.title), rec.spec_section_code_id, 'field_ops',
      jsonb_build_object('status', rec.status, 'submitted_date', rec.submitted_date, 'project_id', rec.project_id));

  ELSIF p_table = 'daily_logs' THEN
    SELECT * INTO rec FROM clayos.daily_logs WHERE id = p_id; IF NOT FOUND THEN RETURN; END IF;
    v_bu := (SELECT business_unit_id FROM clayos.projects WHERE id = rec.project_id);
    PERFORM clayos._upsert_entity('DailyLog', v_bu, p_table, p_id, 'Daily Log ' || rec.log_date, NULL, 'field_ops',
      jsonb_build_object('weather', rec.weather, 'manpower_count', rec.manpower_count, 'log_date', rec.log_date, 'project_id', rec.project_id));

  ELSIF p_table = 'safety_events' THEN
    SELECT * INTO rec FROM clayos.safety_events WHERE id = p_id; IF NOT FOUND THEN RETURN; END IF;
    v_bu := (SELECT business_unit_id FROM clayos.projects WHERE id = rec.project_id);
    PERFORM clayos._upsert_entity('SafetyEvent', v_bu, p_table, p_id, initcap(replace(rec.type, '_', ' ')) || ' (' || rec.event_date || ')', NULL, 'safety',
      jsonb_build_object('type', rec.type, 'severity', rec.severity, 'recordable', rec.recordable, 'lost_time', rec.lost_time, 'project_id', rec.project_id));

  ELSIF p_table = 'quality_events' THEN
    SELECT * INTO rec FROM clayos.quality_events WHERE id = p_id; IF NOT FOUND THEN RETURN; END IF;
    v_bu := (SELECT business_unit_id FROM clayos.projects WHERE id = rec.project_id);
    PERFORM clayos._upsert_entity('QualityEvent', v_bu, p_table, p_id, initcap(replace(rec.type, '_', ' ')) || COALESCE(' - ' || left(rec.description, 40), ''), NULL, 'quality',
      jsonb_build_object('type', rec.type, 'status', rec.status, 'severity', rec.severity, 'project_id', rec.project_id));

  ELSIF p_table = 'pay_apps' THEN
    SELECT * INTO rec FROM clayos.pay_apps WHERE id = p_id; IF NOT FOUND THEN RETURN; END IF;
    v_bu := (SELECT business_unit_id FROM clayos.projects WHERE id = rec.project_id);
    PERFORM clayos._upsert_entity('PayApp', v_bu, p_table, p_id, 'Pay App #' || rec.number, NULL, 'financials',
      jsonb_build_object('number', rec.number, 'period_end', rec.period_end, 'status', rec.status, 'project_id', rec.project_id));

  ELSIF p_table = 'pursuits' THEN
    SELECT * INTO rec FROM clayos.pursuits WHERE id = p_id; IF NOT FOUND THEN RETURN; END IF;
    PERFORM clayos._upsert_entity('Pursuit', rec.business_unit_id, p_table, p_id, rec.name, NULL, 'business_development',
      jsonb_build_object('stage', rec.stage, 'sector', rec.sector, 'est_value', rec.est_value, 'win_probability', rec.win_probability));

  ELSIF p_table = 'estimates' THEN
    SELECT * INTO rec FROM clayos.estimates WHERE id = p_id; IF NOT FOUND THEN RETURN; END IF;
    v_bu := COALESCE((SELECT business_unit_id FROM clayos.projects WHERE id = rec.project_id),
                     (SELECT business_unit_id FROM clayos.pursuits WHERE id = rec.pursuit_id));
    PERFORM clayos._upsert_entity('Estimate', v_bu, p_table, p_id, 'Estimate v' || rec.version || COALESCE(' (' || rec.estimate_type || ')', ''), NULL, 'estimating',
      jsonb_build_object('estimate_type', rec.estimate_type, 'total_value', rec.total_value, 'status', rec.status));

  ELSIF p_table = 'contracts' THEN
    SELECT * INTO rec FROM clayos.contracts WHERE id = p_id; IF NOT FOUND THEN RETURN; END IF;
    v_bu := (SELECT business_unit_id FROM clayos.projects WHERE id = rec.project_id);
    PERFORM clayos._upsert_entity('Contract', v_bu, p_table, p_id, initcap(replace(rec.contract_type, '_', ' ')) || COALESCE(': ' || left(rec.scope, 40), ''), rec.masterformat_code_id, 'procurement',
      jsonb_build_object('contract_type', rec.contract_type, 'value', rec.value, 'status', rec.status, 'project_id', rec.project_id));

  ELSIF p_table = 'requisitions' THEN
    SELECT * INTO rec FROM clayos.requisitions WHERE id = p_id; IF NOT FOUND THEN RETURN; END IF;
    PERFORM clayos._upsert_entity('Requisition', rec.business_unit_id, p_table, p_id, rec.title, NULL, 'recruiting',
      jsonb_build_object('department', rec.department, 'status', rec.status, 'opened_date', rec.opened_date));

  ELSIF p_table = 'it_assets' THEN
    SELECT * INTO rec FROM clayos.it_assets WHERE id = p_id; IF NOT FOUND THEN RETURN; END IF;
    PERFORM clayos._upsert_entity('ITAsset', rec.business_unit_id, p_table, p_id, COALESCE(rec.asset_tag, rec.asset_type), NULL, 'it',
      jsonb_build_object('asset_type', rec.asset_type, 'status', rec.status));
  END IF;
END $$;

-- ─── project_edges: source row → its outgoing edges ─────────────────────────
CREATE OR REPLACE FUNCTION clayos.project_edges(p_table text, p_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE rec record; e_self uuid := clayos._eid(p_table, p_id);
BEGIN
  -- Clear this row's previously-projected edges (idempotent rebuild).
  DELETE FROM clayos.edges WHERE properties->>'origin' = p_table AND properties->>'origin_id' = p_id::text;

  IF p_table = 'projects' THEN
    SELECT * INTO rec FROM clayos.projects WHERE id = p_id; IF NOT FOUND THEN RETURN; END IF;
    PERFORM clayos._add_edge('client_for',    clayos._eid('organizations', rec.owner_org_id),     e_self, p_table, p_id);
    PERFORM clayos._add_edge('gc_for',        clayos._eid('organizations', rec.gc_org_id),        e_self, p_table, p_id);
    PERFORM clayos._add_edge('architect_for', clayos._eid('organizations', rec.architect_org_id), e_self, p_table, p_id);
    PERFORM clayos._add_edge('developer_for', clayos._eid('organizations', rec.developer_org_id), e_self, p_table, p_id);

  ELSIF p_table = 'phases' THEN
    SELECT * INTO rec FROM clayos.phases WHERE id = p_id; IF NOT FOUND THEN RETURN; END IF;
    PERFORM clayos._add_edge('has_phase', clayos._eid('projects', rec.project_id), e_self, p_table, p_id);

  ELSIF p_table = 'wbs_nodes' THEN
    SELECT * INTO rec FROM clayos.wbs_nodes WHERE id = p_id; IF NOT FOUND THEN RETURN; END IF;
    IF rec.parent_id IS NULL THEN
      PERFORM clayos._add_edge('has_work', clayos._eid('projects', rec.project_id), e_self, p_table, p_id);
    ELSE
      PERFORM clayos._add_edge('part_of', e_self, clayos._eid('wbs_nodes', rec.parent_id), p_table, p_id);
    END IF;

  ELSIF p_table = 'spaces' THEN
    SELECT * INTO rec FROM clayos.spaces WHERE id = p_id; IF NOT FOUND THEN RETURN; END IF;
    PERFORM clayos._add_edge('contains_space', clayos._eid('projects', rec.project_id), e_self, p_table, p_id);

  ELSIF p_table = 'building_elements' THEN
    SELECT * INTO rec FROM clayos.building_elements WHERE id = p_id; IF NOT FOUND THEN RETURN; END IF;
    PERFORM clayos._add_edge('has_element', clayos._eid('projects', rec.project_id), e_self, p_table, p_id);
    PERFORM clayos._add_edge('located_in',  e_self, clayos._eid('spaces', rec.space_id), p_table, p_id);

  ELSIF p_table = 'documents' THEN
    SELECT * INTO rec FROM clayos.documents WHERE id = p_id; IF NOT FOUND THEN RETURN; END IF;
    PERFORM clayos._add_edge('has_document', clayos._eid('projects', rec.project_id), e_self, p_table, p_id);

  ELSIF p_table = 'cost_accounts' THEN
    SELECT * INTO rec FROM clayos.cost_accounts WHERE id = p_id; IF NOT FOUND THEN RETURN; END IF;
    PERFORM clayos._add_edge('has_cost_account', clayos._eid('projects', rec.project_id), e_self, p_table, p_id);
    PERFORM clayos._add_edge('costs_for', e_self, clayos._eid('wbs_nodes', rec.wbs_node_id), p_table, p_id);

  ELSIF p_table = 'schedule_activities' THEN
    SELECT * INTO rec FROM clayos.schedule_activities WHERE id = p_id; IF NOT FOUND THEN RETURN; END IF;
    PERFORM clayos._add_edge('has_activity', clayos._eid('projects', rec.project_id), e_self, p_table, p_id);
    PERFORM clayos._add_edge('for_work', e_self, clayos._eid('wbs_nodes', rec.wbs_node_id), p_table, p_id);

  ELSIF p_table = 'rfis' THEN
    SELECT * INTO rec FROM clayos.rfis WHERE id = p_id; IF NOT FOUND THEN RETURN; END IF;
    PERFORM clayos._add_edge('has_rfi', clayos._eid('projects', rec.project_id), e_self, p_table, p_id);
    PERFORM clayos._add_edge('pertains_to', e_self, clayos._eid('building_elements', rec.building_element_id), p_table, p_id);

  ELSIF p_table = 'submittals' THEN
    SELECT * INTO rec FROM clayos.submittals WHERE id = p_id; IF NOT FOUND THEN RETURN; END IF;
    PERFORM clayos._add_edge('has_submittal', clayos._eid('projects', rec.project_id), e_self, p_table, p_id);

  ELSIF p_table = 'daily_logs' THEN
    SELECT * INTO rec FROM clayos.daily_logs WHERE id = p_id; IF NOT FOUND THEN RETURN; END IF;
    PERFORM clayos._add_edge('has_daily_log', clayos._eid('projects', rec.project_id), e_self, p_table, p_id);

  ELSIF p_table = 'safety_events' THEN
    SELECT * INTO rec FROM clayos.safety_events WHERE id = p_id; IF NOT FOUND THEN RETURN; END IF;
    PERFORM clayos._add_edge('has_safety_event', clayos._eid('projects', rec.project_id), e_self, p_table, p_id);

  ELSIF p_table = 'quality_events' THEN
    SELECT * INTO rec FROM clayos.quality_events WHERE id = p_id; IF NOT FOUND THEN RETURN; END IF;
    PERFORM clayos._add_edge('has_quality_event', clayos._eid('projects', rec.project_id), e_self, p_table, p_id);
    PERFORM clayos._add_edge('concerns', e_self, clayos._eid('building_elements', rec.building_element_id), p_table, p_id);

  ELSIF p_table = 'pay_apps' THEN
    SELECT * INTO rec FROM clayos.pay_apps WHERE id = p_id; IF NOT FOUND THEN RETURN; END IF;
    PERFORM clayos._add_edge('has_pay_app', clayos._eid('projects', rec.project_id), e_self, p_table, p_id);

  ELSIF p_table = 'pursuits' THEN
    SELECT * INTO rec FROM clayos.pursuits WHERE id = p_id; IF NOT FOUND THEN RETURN; END IF;
    PERFORM clayos._add_edge('pursuing', e_self, clayos._eid('organizations', rec.client_org_id), p_table, p_id);

  ELSIF p_table = 'estimates' THEN
    SELECT * INTO rec FROM clayos.estimates WHERE id = p_id; IF NOT FOUND THEN RETURN; END IF;
    PERFORM clayos._add_edge('has_estimate', clayos._eid('projects', rec.project_id), e_self, p_table, p_id);
    PERFORM clayos._add_edge('estimate_for', clayos._eid('pursuits', rec.pursuit_id), e_self, p_table, p_id);

  ELSIF p_table = 'contracts' THEN
    SELECT * INTO rec FROM clayos.contracts WHERE id = p_id; IF NOT FOUND THEN RETURN; END IF;
    PERFORM clayos._add_edge('has_contract', clayos._eid('projects', rec.project_id), e_self, p_table, p_id);
    PERFORM clayos._add_edge('contracted_to', e_self, clayos._eid('organizations', rec.org_id), p_table, p_id);

  ELSIF p_table = 'requisitions' THEN
    SELECT * INTO rec FROM clayos.requisitions WHERE id = p_id; IF NOT FOUND THEN RETURN; END IF;
    PERFORM clayos._add_edge('hiring_manager', e_self, clayos._eid('persons', rec.hiring_manager_person_id), p_table, p_id);

  ELSIF p_table = 'it_assets' THEN
    SELECT * INTO rec FROM clayos.it_assets WHERE id = p_id; IF NOT FOUND THEN RETURN; END IF;
    PERFORM clayos._add_edge('assigned_to', e_self, clayos._eid('persons', rec.assigned_person_id), p_table, p_id);

  -- edge-only tables (no node of their own)
  ELSIF p_table = 'schedule_dependencies' THEN
    SELECT * INTO rec FROM clayos.schedule_dependencies WHERE id = p_id; IF NOT FOUND THEN RETURN; END IF;
    PERFORM clayos._add_edge('depends_on',
      clayos._eid('schedule_activities', rec.successor_id),
      clayos._eid('schedule_activities', rec.predecessor_id), p_table, p_id);

  ELSIF p_table = 'staffing_assignments' THEN
    SELECT * INTO rec FROM clayos.staffing_assignments WHERE id = p_id; IF NOT FOUND THEN RETURN; END IF;
    PERFORM clayos._add_edge('staffed_on',
      clayos._eid('persons', rec.person_id),
      clayos._eid('projects', rec.project_id), p_table, p_id);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION clayos.project_to_graph(p_table text, p_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM clayos.project_entity(p_table, p_id);
  PERFORM clayos.project_edges(p_table, p_id);
END $$;

-- ─── Generic trigger ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION clayos.trg_project()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM clayos.entities WHERE source_table = TG_TABLE_NAME AND source_id = OLD.id;
    DELETE FROM clayos.edges    WHERE properties->>'origin' = TG_TABLE_NAME AND properties->>'origin_id' = OLD.id::text;
    RETURN OLD;
  ELSE
    PERFORM clayos.project_to_graph(TG_TABLE_NAME, NEW.id);
    RETURN NEW;
  END IF;
END $$;

-- Attach to every projected table (node tables + the two edge-only tables).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'organizations','persons','projects','phases','wbs_nodes','spaces','building_elements',
    'documents','cost_accounts','schedule_activities','rfis','submittals','daily_logs',
    'safety_events','quality_events','pay_apps','pursuits','estimates','contracts',
    'requisitions','it_assets','schedule_dependencies','staffing_assignments'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_graph ON clayos.%1$s', t);
    EXECUTE format('CREATE TRIGGER trg_%1$s_graph AFTER INSERT OR UPDATE OR DELETE ON clayos.%1$s
                    FOR EACH ROW EXECUTE FUNCTION clayos.trg_project()', t);
  END LOOP;
END $$;

-- ─── Full reproject (run after bulk seed; nightly reconcile) ─────────────────
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
END $$;

-- ─── Embedding drain helpers (used by the embed-entities edge function) ─────
CREATE OR REPLACE FUNCTION clayos.claim_embed_jobs(p_limit int)
RETURNS TABLE(entity_id uuid, content text)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT j.entity_id FROM clayos.graph_embed_jobs j
    WHERE j.claimed_at IS NULL OR j.claimed_at < now() - interval '5 minutes'
    ORDER BY j.enqueued_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE clayos.graph_embed_jobs j
     SET claimed_at = now(), attempts = j.attempts + 1
    FROM due
   WHERE j.entity_id = due.entity_id
  RETURNING j.entity_id,
    (SELECT e.entity_type || ' — ' || e.label || ' · ' || COALESCE(e.domain, '') || ' ' || COALESCE(e.properties::text, '')
       FROM clayos.entities e WHERE e.id = j.entity_id);
END $$;

CREATE OR REPLACE FUNCTION clayos.set_entity_embedding(p_entity uuid, p_vec vector(1536))
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE clayos.entities SET embedding = p_vec, updated_at = now() WHERE id = p_entity;
  DELETE FROM clayos.graph_embed_jobs WHERE entity_id = p_entity;
END $$;

GRANT EXECUTE ON FUNCTION clayos.kg_reproject_all()                         TO PUBLIC;
GRANT EXECUTE ON FUNCTION clayos.claim_embed_jobs(int)                      TO PUBLIC;
GRANT EXECUTE ON FUNCTION clayos.set_entity_embedding(uuid, vector)         TO PUBLIC;
