-- Migration 003: business units.
--
-- Clayco's operating companies / divisions form a tree under one enterprise
-- root (ltree). The reporting layer rolls every KPI up this hierarchy. `kind`
-- distinguishes construction vs. architecture vs. real-estate vs. service group.
-- ─────────────────────────────────────────────────────────────────────────────

SET search_path TO clayos, public, extensions;

CREATE TABLE IF NOT EXISTS clayos.business_units (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id  uuid REFERENCES clayos.business_units(id) ON DELETE CASCADE,
  slug       text UNIQUE NOT NULL,
  name       text NOT NULL,
  kind       text NOT NULL DEFAULT 'construction'
             CHECK (kind IN ('enterprise','construction','architecture','engineering','real_estate','self_perform','service_group')),
  path       ltree NOT NULL,
  depth      int   NOT NULL DEFAULT 0,
  description text,
  metadata   jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bu_path_gist ON clayos.business_units USING GIST (path);
CREATE INDEX IF NOT EXISTS bu_parent_idx ON clayos.business_units (parent_id);

DROP TRIGGER IF EXISTS trg_bu_path ON clayos.business_units;
CREATE TRIGGER trg_bu_path
  BEFORE INSERT OR UPDATE OF parent_id ON clayos.business_units
  FOR EACH ROW EXECUTE FUNCTION clayos.maintain_path();

GRANT SELECT ON clayos.business_units TO PUBLIC;
