-- 015_schedule_detail.sql — richer schedules for the Time view (Gantt + history).
--
-- Adds two columns to schedule_activities and one guard to the projection.
--
--   activity_kind  'task' (a bar) | 'milestone' (zero-duration marker)
--   is_summary     a coarse, project-level bar generated for the 192 "light"
--                  projects so the Gantt covers the whole portfolio.
--
-- ─── Why summary rows are NOT projected into the graph (ADR-016) ──────────────
-- The graph sits at ~6,345 entities against a client subgraph limit of 6,500
-- (Lifecycle3DView.jsx and GraphView.jsx both request `limit: 6500`). Projecting
-- ~1,150 summary bars would silently truncate whole entity types out of the 3D
-- and Network views — precisely the bug fixed in session 11 — and push the 3D
-- scene past its ~5k-node comfort zone.
--
-- So summary rows stay RELATIONAL ONLY, exactly like cost_progress and
-- pay_app_lines: the Gantt reads schedule_activities directly over PostgREST,
-- and the knowledge graph never sees them. Milestones and the 8 deep projects'
-- real activities DO project — they're few and genuinely interesting as nodes.
--
-- The guard lives in _upsert_entity (the single choke point every projection
-- branch funnels through) rather than in project_entity's 130-line branch
-- ladder, so triggers AND kg_reproject_all honour it without duplicating that
-- function. _add_edge already skips edges whose endpoints are missing, so the
-- dependency edges of summary rows simply never materialise.

ALTER TABLE clayos.schedule_activities
  ADD COLUMN IF NOT EXISTS is_summary    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS activity_kind text    NOT NULL DEFAULT 'task';

DO $$ BEGIN
  ALTER TABLE clayos.schedule_activities
    ADD CONSTRAINT schedule_activities_kind_chk
    CHECK (activity_kind IN ('task', 'milestone'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Gantt reads are always project-scoped and ordered by start.
CREATE INDEX IF NOT EXISTS schedule_activities_proj_start_idx
  ON clayos.schedule_activities (project_id, planned_start);

-- ─── The graph-budget guard ──────────────────────────────────────────────────
-- Identical to migration 006's version except for the early RETURN.
CREATE OR REPLACE FUNCTION clayos._upsert_entity(
  p_type text, p_bu uuid, p_table text, p_id uuid,
  p_label text, p_class uuid, p_domain text, p_props jsonb)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_eid uuid;
BEGIN
  -- Summary-grain schedule rows are relational-only; never nodes. See header.
  IF p_table = 'schedule_activities'
     AND EXISTS (SELECT 1 FROM clayos.schedule_activities
                  WHERE id = p_id AND is_summary) THEN
    RETURN NULL;
  END IF;

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

-- Sanity after a reseed:
--   SELECT is_summary, activity_kind, count(*) FROM clayos.schedule_activities GROUP BY 1,2;
--   SELECT count(*) FROM clayos.entities;                        -- must stay under 6,500
--   SELECT count(*) FROM clayos.entities e JOIN clayos.schedule_activities a
--     ON a.id = e.source_id WHERE e.source_table='schedule_activities' AND a.is_summary;  -- must be 0
