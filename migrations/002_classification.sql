-- Migration 002: classification backbone.
--
-- The industry standards the knowledge graph anchors on: OmniClass tables,
-- MasterFormat (CSI) divisions/sections, UniFormat elements, and an internal
-- WBS code system. Codes form trees (ltree). Domain rows attach to codes via
-- FKs (e.g. cost_accounts.masterformat_code_id), and that FK is copied onto the
-- projected entity so the viewer/agent can filter "everything under Division 03".
-- ─────────────────────────────────────────────────────────────────────────────

SET search_path TO clayos, public, extensions;

CREATE TABLE IF NOT EXISTS clayos.classification_systems (
  id          text PRIMARY KEY,                 -- slug, e.g. 'masterformat','uniformat','omniclass_t22','wbs'
  title       text NOT NULL,
  standard    text,                             -- 'CSI MasterFormat 2020', 'OmniClass', 'ISO 19650', internal
  description text
);

CREATE TABLE IF NOT EXISTS clayos.classification_codes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  system_id  text  NOT NULL REFERENCES clayos.classification_systems(id) ON DELETE CASCADE,
  code       text  NOT NULL,                    -- '03 30 00', '23-13 11 11', 'B1010'
  title      text  NOT NULL,
  parent_id  uuid  REFERENCES clayos.classification_codes(id) ON DELETE CASCADE,
  path       ltree NOT NULL,
  depth      int   NOT NULL DEFAULT 0,
  metadata   jsonb NOT NULL DEFAULT '{}',
  UNIQUE (system_id, code)
);

CREATE INDEX IF NOT EXISTS cc_path_gist  ON clayos.classification_codes USING GIST (path);
CREATE INDEX IF NOT EXISTS cc_system_idx ON clayos.classification_codes (system_id);
CREATE INDEX IF NOT EXISTS cc_parent_idx ON clayos.classification_codes (parent_id);

DROP TRIGGER IF EXISTS trg_cc_path ON clayos.classification_codes;
CREATE TRIGGER trg_cc_path
  BEFORE INSERT OR UPDATE OF parent_id ON clayos.classification_codes
  FOR EACH ROW EXECUTE FUNCTION clayos.maintain_path();

-- Seed the systems themselves; the codes are loaded by seed/generate.py from CSVs.
INSERT INTO clayos.classification_systems (id, title, standard, description) VALUES
  ('masterformat',  'MasterFormat (Work Results)', 'CSI MasterFormat 2020', 'Trade/work-result classification used for cost codes, specs, submittals.'),
  ('uniformat',     'UniFormat (Elements)',        'ASTM UniFormat II',     'Functional building-element classification used for building elements & estimates.'),
  ('omniclass_t22', 'OmniClass Table 22 (Work Results)', 'OmniClass',        'OmniClass work-results table (aligns with MasterFormat).'),
  ('omniclass_t21', 'OmniClass Table 21 (Elements)',     'OmniClass',        'OmniClass elements table (aligns with UniFormat).'),
  ('wbs',           'Work Breakdown Structure',    'PMI WBS (internal)',    'Project work breakdown used to roll up cost and schedule.')
ON CONFLICT (id) DO NOTHING;

GRANT USAGE ON SCHEMA clayos TO PUBLIC;
GRANT SELECT ON clayos.classification_systems, clayos.classification_codes TO PUBLIC;
