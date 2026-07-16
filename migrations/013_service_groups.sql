-- 013 — Service groups as first-class graph nodes.
--
-- Clayco's 17 service groups become ServiceGroup entities that exchange data with
-- projects and each other, mirroring how a Person flows across the graph:
--   · clayos.service_groups        — system of record (entityDetail reads source_table)
--   · kg_project_service_groups()  — idempotent projection: entities + edges. entities/
--     edges are a TRUNCATE-and-rebuild projection, so reseed-cloud.sh re-runs this fn.
--
-- Edge model (new edge_types: `services`, `shares_data_with`):
--   · services (group → Project): per-project groups link to every project they touch,
--     weight = count of that project's records of the group's mapped entity types
--     (precon: stage-based — projects still in design/precon). Data-derived, no fakes.
--   · shares_data_with (group → group): the hand-off chain (precon → scheduling/PM →
--     field ops → cost/quality/safety …).
--   · staffed_on (Person → group): existing type, same direction as Person → Project;
--     mapped from properties.role_category.
--
-- Idempotent + additive: deterministic md5-based UUIDs (portable — cloud has uuid-ossp
-- in `extensions`, local may not), ON CONFLICT upserts, no DELETEs. Safe to re-run.
BEGIN;

-- ─── System of record ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clayos.service_groups (
  id          uuid PRIMARY KEY,
  slug        text UNIQUE NOT NULL,
  name        text NOT NULL,
  nature      text NOT NULL CHECK (nature IN ('shared', 'per_project')),
  description text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
-- grants guarded like 008 — anon/authenticated only exist on Supabase, not local PG
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'clayos_readonly'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT ON clayos.service_groups TO %I', r);
    END IF;
  END LOOP;
END $$;

INSERT INTO clayos.service_groups (id, slug, name, nature, description) VALUES
  (md5('clayos:sg:employee_relations')::uuid, 'employee_relations', 'Employee Relations', 'shared',      'Employee relations, engagement, and workforce support across all business units.'),
  (md5('clayos:sg:it')::uuid,                 'it',                 'IT',                 'shared',      'Enterprise information technology: systems, infrastructure, and support.'),
  (md5('clayos:sg:marketing')::uuid,          'marketing',          'Marketing',          'shared',      'Brand, proposals, and pursuit marketing support.'),
  (md5('clayos:sg:legal')::uuid,              'legal',              'Legal',              'shared',      'Contracts, claims, and corporate legal counsel.'),
  (md5('clayos:sg:insurance')::uuid,          'insurance',          'Insurance',          'shared',      'Corporate insurance and risk-transfer programs.'),
  (md5('clayos:sg:community_affairs')::uuid,  'community_affairs',  'Community Affairs',  'shared',      'Community engagement, philanthropy, and local partnerships.'),
  (md5('clayos:sg:precon')::uuid,             'precon',             'Precon',             'per_project', 'Preconstruction: estimating, budgeting, and early-stage planning.'),
  (md5('clayos:sg:scheduling')::uuid,         'scheduling',         'Scheduling',         'per_project', 'Project scheduling: phases, activities, and sequence management.'),
  (md5('clayos:sg:project_management')::uuid, 'project_management', 'Project Management', 'per_project', 'Project delivery: RFI, submittal, and contract coordination.'),
  (md5('clayos:sg:field_operations')::uuid,   'field_operations',   'Field Operations',   'per_project', 'Field execution: daily logs, work packages, and site operations.'),
  (md5('clayos:sg:safety')::uuid,             'safety',             'Safety',             'per_project', 'Site safety programs and incident management.'),
  (md5('clayos:sg:cost')::uuid,               'cost',               'Cost',               'per_project', 'Cost management: cost accounts and pay applications.'),
  (md5('clayos:sg:quality')::uuid,            'quality',            'Quality',            'per_project', 'Quality assurance and control.'),
  (md5('clayos:sg:tag')::uuid,                'tag',                'TAG',                'shared',      'TAG — expansion unconfirmed (likely Technology/Advanced Group); shared design-technology services.'),
  (md5('clayos:sg:vdc')::uuid,                'vdc',                'VDC',                'per_project', 'Virtual Design & Construction: BIM models, building elements, spatial coordination.'),
  (md5('clayos:sg:cdc')::uuid,                'cdc',                'CDC',                'shared',      'CDC — expansion unconfirmed; shared design services group.'),
  (md5('clayos:sg:sustainability')::uuid,     'sustainability',     'Sustainability',     'shared',      'Sustainability and green-building services.')
ON CONFLICT (slug) DO UPDATE
  SET name = EXCLUDED.name, nature = EXCLUDED.nature, description = EXCLUDED.description;

-- ─── Projection: entities + edges (re-run after any reseed/reprojection) ─────
CREATE OR REPLACE FUNCTION clayos.kg_project_service_groups()
RETURNS TABLE (entities_upserted int, edges_upserted int)
LANGUAGE plpgsql AS $$
DECLARE
  v_bu  uuid;
  v_ent int := 0;
  v_e1  int := 0; v_e2 int := 0; v_e3 int := 0;
BEGIN
  SELECT bu.id INTO v_bu FROM clayos.business_units bu WHERE bu.slug = 'shared-services';
  IF v_bu IS NULL THEN RAISE EXCEPTION 'shared-services business unit not found'; END IF;

  -- nodes (domain = the group''s own slug, per the integration brief)
  INSERT INTO clayos.entities (id, entity_type, business_unit_id, source_table, source_id, label, domain, properties, updated_at)
  SELECT sg.id, 'ServiceGroup', v_bu, 'service_groups', sg.id, sg.name, sg.slug,
         jsonb_build_object('slug', sg.slug, 'nature', sg.nature, 'description', sg.description),
         now()
  FROM clayos.service_groups sg
  ON CONFLICT (source_table, source_id) DO UPDATE
    SET label = EXCLUDED.label, domain = EXCLUDED.domain,
        properties = EXCLUDED.properties, updated_at = now();
  GET DIAGNOSTICS v_ent = ROW_COUNT;

  -- embeddings for semantic search (drained by the embed-entities edge fn)
  INSERT INTO clayos.graph_embed_jobs (entity_id)
  SELECT e.id FROM clayos.entities e
  WHERE e.source_table = 'service_groups' AND e.embedding IS NULL
  ON CONFLICT (entity_id) DO NOTHING;

  -- services: per-project group → Project, weight = matched record count
  WITH sg AS (
    SELECT e.id, e.properties->>'slug' AS slug FROM clayos.entities e WHERE e.source_table = 'service_groups'
  ), proj AS (
    SELECT e.id, e.source_id, e.properties->>'lifecycle_stage' AS stage
    FROM clayos.entities e WHERE e.entity_type = 'Project'
  ), typemap(slug, etype) AS (VALUES
    ('scheduling', 'Phase'), ('scheduling', 'Activity'),
    ('project_management', 'RFI'), ('project_management', 'Submittal'), ('project_management', 'Contract'),
    ('field_operations', 'DailyLog'), ('field_operations', 'Work'),
    ('safety', 'SafetyEvent'),
    ('cost', 'CostAccount'), ('cost', 'PayApp'),
    ('quality', 'QualityEvent'),
    ('vdc', 'BuildingElement'), ('vdc', 'Space')
  ), rec_edges AS (
    SELECT sg.id AS src, p.id AS dst, count(*)::numeric AS w
    FROM clayos.entities rec
    JOIN typemap tm ON tm.etype = rec.entity_type
    JOIN sg ON sg.slug = tm.slug
    JOIN proj p ON (rec.properties->>'project_id') IS NOT NULL
               AND p.source_id = (rec.properties->>'project_id')::uuid
    GROUP BY sg.id, p.id
  ), precon_edges AS (
    SELECT sg.id AS src, p.id AS dst, 1::numeric AS w
    FROM sg, proj p
    WHERE sg.slug = 'precon' AND p.stage IN ('pursuit', 'design', 'precon')
  ), all_svc AS (
    SELECT * FROM rec_edges UNION ALL SELECT * FROM precon_edges
  )
  INSERT INTO clayos.edges (id, edge_type, src_id, dst_id, weight, properties)
  SELECT md5('clayos:sge:services:' || src || ':' || dst)::uuid, 'services', src, dst, w,
         jsonb_build_object('origin', 'service_groups', 'origin_id', src)
  FROM all_svc
  ON CONFLICT (id) DO UPDATE SET weight = EXCLUDED.weight;
  GET DIAGNOSTICS v_e1 = ROW_COUNT;

  -- shares_data_with: the hand-off chain between groups
  WITH sg AS (
    SELECT e.id, e.properties->>'slug' AS slug FROM clayos.entities e WHERE e.source_table = 'service_groups'
  ), handoff(a, b) AS (VALUES
    ('precon', 'scheduling'), ('precon', 'project_management'),
    ('scheduling', 'project_management'), ('project_management', 'field_operations'),
    ('field_operations', 'cost'), ('field_operations', 'quality'), ('field_operations', 'safety'),
    ('cost', 'insurance'), ('vdc', 'precon'), ('vdc', 'field_operations'),
    ('tag', 'vdc'), ('cdc', 'vdc'), ('sustainability', 'precon'),
    ('marketing', 'precon'), ('legal', 'project_management'),
    ('employee_relations', 'field_operations'), ('it', 'project_management'),
    ('community_affairs', 'marketing')
  )
  INSERT INTO clayos.edges (id, edge_type, src_id, dst_id, weight, properties)
  SELECT md5('clayos:sge:shares:' || s1.id || ':' || s2.id)::uuid, 'shares_data_with', s1.id, s2.id, 1,
         jsonb_build_object('origin', 'service_groups', 'origin_id', s1.id)
  FROM handoff h JOIN sg s1 ON s1.slug = h.a JOIN sg s2 ON s2.slug = h.b
  ON CONFLICT (id) DO NOTHING;
  GET DIAGNOSTICS v_e2 = ROW_COUNT;

  -- staffed_on: Person → group via properties.role_category (same src→dst shape as
  -- the existing Person → Project staffed_on edges). Unmapped categories are skipped.
  WITH sg AS (
    SELECT e.id, e.properties->>'slug' AS slug FROM clayos.entities e WHERE e.source_table = 'service_groups'
  ), rolemap(role_category, slug) AS (VALUES
    ('project_management', 'project_management'), ('field', 'field_operations'),
    ('design', 'vdc'), ('finance', 'cost'), ('recruiting', 'employee_relations'),
    ('staffing', 'employee_relations'), ('safety', 'safety'), ('it', 'it'),
    ('estimating', 'precon')
  )
  INSERT INTO clayos.edges (id, edge_type, src_id, dst_id, weight, properties)
  SELECT md5('clayos:sge:staffed:' || p.id || ':' || sg.id)::uuid, 'staffed_on', p.id, sg.id, 1,
         jsonb_build_object('origin', 'service_groups', 'origin_id', sg.id)
  FROM clayos.entities p
  JOIN rolemap rm ON rm.role_category = p.properties->>'role_category'
  JOIN sg ON sg.slug = rm.slug
  WHERE p.entity_type = 'Person'
  ON CONFLICT (id) DO NOTHING;
  GET DIAGNOSTICS v_e3 = ROW_COUNT;

  RETURN QUERY SELECT v_ent, v_e1 + v_e2 + v_e3;
END $$;

-- projection writes — not for API roles (table grants block anon writes anyway)
REVOKE EXECUTE ON FUNCTION clayos.kg_project_service_groups() FROM PUBLIC;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION clayos.kg_project_service_groups() FROM %I', r);
    END IF;
  END LOOP;
END $$;

-- ─── Run it (with before/after counts printed) ───────────────────────────────
SELECT 'BEFORE  entities=' || (SELECT count(*) FROM clayos.entities)
    || '  edges='          || (SELECT count(*) FROM clayos.edges) AS counts;

SELECT * FROM clayos.kg_project_service_groups();

SELECT 'AFTER   entities=' || (SELECT count(*) FROM clayos.entities)
    || '  edges='          || (SELECT count(*) FROM clayos.edges) AS counts;

COMMIT;

NOTIFY pgrst, 'reload schema';
