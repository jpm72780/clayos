-- Migration 004: per-domain tables (the system of record).
--
-- These hold the real data with real FKs/constraints. The KPI views query them
-- directly; the graph (005/006) is a denormalized projection over them. Tables
-- are grouped by the 10 construction lifecycle domains + service groups.
-- Full column spec also lives in docs/ARCHITECTURE.md (§Domain tables).
-- ─────────────────────────────────────────────────────────────────────────────

SET search_path TO clayos, public, extensions;

-- ═══ ENTERPRISE MASTER DATA ══════════════════════════════════════════════════
CREATE TABLE clayos.organizations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  org_type   text NOT NULL CHECK (org_type IN
             ('client','owner','gc','subcontractor','supplier','architect','engineer','developer','authority')),
  trade      text,                              -- for subs/suppliers (e.g. 'Electrical', 'Concrete')
  city       text,
  state      text,
  metadata   jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE clayos.persons (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_unit_id uuid REFERENCES clayos.business_units(id) ON DELETE SET NULL,
  full_name        text NOT NULL,
  email            text,
  title            text,
  role_category    text CHECK (role_category IN
                   ('executive','project_management','field','design','estimating','safety','recruiting','it','staffing','finance','admin')),
  hire_date        date,
  hourly_rate      numeric(10,2),
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX persons_bu_idx ON clayos.persons (business_unit_id);

-- ═══ PROJECT CORE ════════════════════════════════════════════════════════════
CREATE TABLE clayos.projects (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_unit_id uuid NOT NULL REFERENCES clayos.business_units(id) ON DELETE CASCADE,
  code             text UNIQUE,
  name             text NOT NULL,
  sector           text,                        -- 'data_center','life_sciences','industrial','commercial', ...
  lifecycle_stage  text NOT NULL DEFAULT 'construction' CHECK (lifecycle_stage IN
                   ('pursuit','precon','design','construction','closeout','warranty','complete')),
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active','on_hold','complete','cancelled')),
  contract_value   numeric(16,2),
  owner_org_id     uuid REFERENCES clayos.organizations(id) ON DELETE SET NULL,
  gc_org_id        uuid REFERENCES clayos.organizations(id) ON DELETE SET NULL,
  architect_org_id uuid REFERENCES clayos.organizations(id) ON DELETE SET NULL,
  developer_org_id uuid REFERENCES clayos.organizations(id) ON DELETE SET NULL,
  city             text,
  state            text,
  gross_sf         numeric(14,2),
  start_date       date,
  end_date         date,                        -- planned substantial completion
  actual_finish    date,
  description      text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX projects_bu_idx ON clayos.projects (business_unit_id);

CREATE TABLE clayos.phases (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES clayos.projects(id) ON DELETE CASCADE,
  name        text NOT NULL,
  seq         int  NOT NULL DEFAULT 0,
  start_date  date,
  end_date    date,
  status      text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','active','complete'))
);
CREATE INDEX phases_project_idx ON clayos.phases (project_id);

-- WBS is a tree (ltree) tied to MasterFormat/UniFormat codes; costs & schedule roll up it.
CREATE TABLE clayos.wbs_nodes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES clayos.projects(id) ON DELETE CASCADE,
  parent_id  uuid REFERENCES clayos.wbs_nodes(id) ON DELETE CASCADE,
  code       text,                              -- WBS code, e.g. '1.2.3'
  name       text NOT NULL,
  code_id    uuid REFERENCES clayos.classification_codes(id) ON DELETE SET NULL,  -- MasterFormat/UniFormat anchor
  path       ltree NOT NULL,
  depth      int   NOT NULL DEFAULT 0
);
CREATE INDEX wbs_project_idx ON clayos.wbs_nodes (project_id);
CREATE INDEX wbs_path_gist   ON clayos.wbs_nodes USING GIST (path);
DROP TRIGGER IF EXISTS trg_wbs_path ON clayos.wbs_nodes;
CREATE TRIGGER trg_wbs_path
  BEFORE INSERT OR UPDATE OF parent_id ON clayos.wbs_nodes
  FOR EACH ROW EXECUTE FUNCTION clayos.maintain_path();

-- ═══ DESIGN / BIM ════════════════════════════════════════════════════════════
CREATE TABLE clayos.spaces (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES clayos.projects(id) ON DELETE CASCADE,
  building   text,
  level      text,
  name       text NOT NULL,
  space_type text,
  area_sf    numeric(12,2)
);
CREATE INDEX spaces_project_idx ON clayos.spaces (project_id);

CREATE TABLE clayos.building_elements (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES clayos.projects(id) ON DELETE CASCADE,
  space_id     uuid REFERENCES clayos.spaces(id) ON DELETE SET NULL,
  uniformat_code_id uuid REFERENCES clayos.classification_codes(id) ON DELETE SET NULL,
  ifc_class    text,                            -- 'IfcWall', 'IfcAirTerminal', ...
  name         text NOT NULL,
  manufacturer text,
  model        text,
  status       text NOT NULL DEFAULT 'design' CHECK (status IN ('design','procured','installed','commissioned')),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX be_project_idx ON clayos.building_elements (project_id);
CREATE INDEX be_space_idx   ON clayos.building_elements (space_id);

CREATE TABLE clayos.documents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES clayos.projects(id) ON DELETE CASCADE,
  doc_type      text NOT NULL CHECK (doc_type IN
                ('drawing','specification','rfi','submittal','report','model','contract','manual')),
  number        text,
  revision      text,
  title         text NOT NULL,
  discipline    text,
  status        text,
  author_person_id uuid REFERENCES clayos.persons(id) ON DELETE SET NULL,
  issued_date   date
);
CREATE INDEX documents_project_idx ON clayos.documents (project_id);

-- ═══ PROJECT CONTROLS — COST (EVM) ═══════════════════════════════════════════
CREATE TABLE clayos.cost_accounts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          uuid NOT NULL REFERENCES clayos.projects(id) ON DELETE CASCADE,
  wbs_node_id         uuid REFERENCES clayos.wbs_nodes(id) ON DELETE SET NULL,
  masterformat_code_id uuid REFERENCES clayos.classification_codes(id) ON DELETE SET NULL,
  name                text NOT NULL,
  cost_type           text CHECK (cost_type IN ('labor','material','equipment','subcontract','overhead')),
  bac                 numeric(16,2) NOT NULL DEFAULT 0,  -- Budget At Completion (also schedule-of-values value)
  committed           numeric(16,2) NOT NULL DEFAULT 0,  -- bought-out / committed
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ca_project_idx ON clayos.cost_accounts (project_id);
CREATE INDEX ca_wbs_idx     ON clayos.cost_accounts (wbs_node_id);

-- Cumulative EVM measurements per account per period (month-end). Latest period = current EVM.
CREATE TABLE clayos.cost_progress (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cost_account_id uuid NOT NULL REFERENCES clayos.cost_accounts(id) ON DELETE CASCADE,
  period          date NOT NULL,               -- month-end
  pv              numeric(16,2) NOT NULL DEFAULT 0,  -- cumulative Planned Value (BCWS)
  ev              numeric(16,2) NOT NULL DEFAULT 0,  -- cumulative Earned Value (BCWP)
  ac              numeric(16,2) NOT NULL DEFAULT 0,  -- cumulative Actual Cost (ACWP)
  UNIQUE (cost_account_id, period)
);
CREATE INDEX cp_account_idx ON clayos.cost_progress (cost_account_id, period);

-- ═══ PROJECT CONTROLS — SCHEDULE ═════════════════════════════════════════════
CREATE TABLE clayos.schedule_activities (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES clayos.projects(id) ON DELETE CASCADE,
  wbs_node_id     uuid REFERENCES clayos.wbs_nodes(id) ON DELETE SET NULL,
  activity_code   text,
  name            text NOT NULL,
  planned_start   date,
  planned_finish  date,
  actual_start    date,
  actual_finish   date,
  pct_complete    numeric(5,2) NOT NULL DEFAULT 0 CHECK (pct_complete BETWEEN 0 AND 100),
  is_critical     boolean NOT NULL DEFAULT false,
  total_float_days int NOT NULL DEFAULT 0
);
CREATE INDEX sa_project_idx ON clayos.schedule_activities (project_id);

CREATE TABLE clayos.schedule_dependencies (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  predecessor_id uuid NOT NULL REFERENCES clayos.schedule_activities(id) ON DELETE CASCADE,
  successor_id   uuid NOT NULL REFERENCES clayos.schedule_activities(id) ON DELETE CASCADE,
  dep_type       text NOT NULL DEFAULT 'FS' CHECK (dep_type IN ('FS','SS','FF','SF')),
  lag_days       int  NOT NULL DEFAULT 0,
  UNIQUE (predecessor_id, successor_id)
);

-- ═══ FIELD OPERATIONS ════════════════════════════════════════════════════════
CREATE TABLE clayos.rfis (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          uuid NOT NULL REFERENCES clayos.projects(id) ON DELETE CASCADE,
  number              text,
  subject             text NOT NULL,
  body                text,
  discipline          text,
  spec_section_code_id uuid REFERENCES clayos.classification_codes(id) ON DELETE SET NULL,
  status              text NOT NULL DEFAULT 'open' CHECK (status IN ('open','answered','closed','void')),
  ball_in_court       text CHECK (ball_in_court IN ('GC','Architect','Owner','Sub','Engineer')),
  submitted_date      date,
  due_date            date,
  answered_date       date,
  cost_impact         numeric(14,2),
  schedule_impact_days int,
  building_element_id uuid REFERENCES clayos.building_elements(id) ON DELETE SET NULL,
  created_by_person_id uuid REFERENCES clayos.persons(id) ON DELETE SET NULL
);
CREATE INDEX rfis_project_idx ON clayos.rfis (project_id);
CREATE INDEX rfis_status_idx  ON clayos.rfis (status);

CREATE TABLE clayos.submittals (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          uuid NOT NULL REFERENCES clayos.projects(id) ON DELETE CASCADE,
  number              text,
  title               text NOT NULL,
  spec_section_code_id uuid REFERENCES clayos.classification_codes(id) ON DELETE SET NULL,
  status              text NOT NULL DEFAULT 'submitted' CHECK (status IN
                      ('draft','submitted','under_review','approved','approved_as_noted','revise_resubmit','rejected')),
  submitted_date      date,
  returned_date       date,
  ball_in_court       text
);
CREATE INDEX submittals_project_idx ON clayos.submittals (project_id);

CREATE TABLE clayos.daily_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES clayos.projects(id) ON DELETE CASCADE,
  log_date        date NOT NULL,
  weather         text,
  temp_high       int,
  temp_low        int,
  manpower_count  int NOT NULL DEFAULT 0,       -- workers on site (× 8h ≈ labor hours, feeds TRIR denominator)
  work_performed  text,
  delays          text,
  author_person_id uuid REFERENCES clayos.persons(id) ON DELETE SET NULL
);
CREATE INDEX daily_logs_project_idx ON clayos.daily_logs (project_id, log_date);

-- ═══ SAFETY / EHS ════════════════════════════════════════════════════════════
CREATE TABLE clayos.safety_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid NOT NULL REFERENCES clayos.projects(id) ON DELETE CASCADE,
  event_date       date NOT NULL,
  type             text NOT NULL CHECK (type IN
                   ('near_miss','first_aid','recordable','lost_time','property_damage','observation')),
  severity         text CHECK (severity IN ('low','medium','high')),
  recordable       boolean NOT NULL DEFAULT false,
  lost_time        boolean NOT NULL DEFAULT false,
  description      text,
  corrective_action text,
  person_id        uuid REFERENCES clayos.persons(id) ON DELETE SET NULL,
  location         text
);
CREATE INDEX safety_project_idx ON clayos.safety_events (project_id);

-- ═══ QUALITY / QA-QC ═════════════════════════════════════════════════════════
CREATE TABLE clayos.quality_events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          uuid NOT NULL REFERENCES clayos.projects(id) ON DELETE CASCADE,
  type                text NOT NULL CHECK (type IN ('inspection','nonconformance','punch_item','test')),
  status              text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','passed','failed')),
  building_element_id uuid REFERENCES clayos.building_elements(id) ON DELETE SET NULL,
  wbs_node_id         uuid REFERENCES clayos.wbs_nodes(id) ON DELETE SET NULL,
  description         text,
  severity            text,
  identified_date     date,
  resolved_date       date
);
CREATE INDEX quality_project_idx ON clayos.quality_events (project_id);

-- ═══ FINANCIALS / BILLING (AIA G702/G703) ═══════════════════════════════════
CREATE TABLE clayos.pay_apps (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL REFERENCES clayos.projects(id) ON DELETE CASCADE,
  number         int  NOT NULL,
  period_end     date NOT NULL,
  status         text NOT NULL DEFAULT 'submitted' CHECK (status IN ('draft','submitted','approved','paid')),
  submitted_date date,
  approved_date  date,
  UNIQUE (project_id, number)
);
CREATE INDEX payapps_project_idx ON clayos.pay_apps (project_id);

CREATE TABLE clayos.pay_app_lines (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pay_app_id               uuid NOT NULL REFERENCES clayos.pay_apps(id) ON DELETE CASCADE,
  cost_account_id          uuid REFERENCES clayos.cost_accounts(id) ON DELETE SET NULL,
  description              text,
  scheduled_value          numeric(16,2) NOT NULL DEFAULT 0,
  work_completed_this_period numeric(16,2) NOT NULL DEFAULT 0,
  work_completed_to_date   numeric(16,2) NOT NULL DEFAULT 0,
  materials_stored         numeric(16,2) NOT NULL DEFAULT 0,
  retainage_pct            numeric(5,2)  NOT NULL DEFAULT 5.0,
  retainage_amount         numeric(16,2) NOT NULL DEFAULT 0
);
CREATE INDEX payapplines_payapp_idx ON clayos.pay_app_lines (pay_app_id);

-- ═══ BUSINESS DEVELOPMENT / ESTIMATING ═══════════════════════════════════════
CREATE TABLE clayos.pursuits (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_unit_id uuid NOT NULL REFERENCES clayos.business_units(id) ON DELETE CASCADE,
  name             text NOT NULL,
  client_org_id    uuid REFERENCES clayos.organizations(id) ON DELETE SET NULL,
  sector           text,
  stage            text NOT NULL DEFAULT 'identified' CHECK (stage IN
                   ('identified','qualified','proposal','shortlisted','won','lost')),
  est_value        numeric(16,2),
  win_probability  numeric(5,2),
  go_decision      boolean,
  identified_date  date,
  decision_date    date
);
CREATE INDEX pursuits_bu_idx ON clayos.pursuits (business_unit_id);

CREATE TABLE clayos.estimates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid REFERENCES clayos.projects(id) ON DELETE CASCADE,
  pursuit_id    uuid REFERENCES clayos.pursuits(id) ON DELETE CASCADE,
  version       int NOT NULL DEFAULT 1,
  estimate_type text CHECK (estimate_type IN ('conceptual','schematic','dd','gmp')),
  total_value   numeric(16,2),
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','awarded','lost')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ═══ PROCUREMENT / BUYOUT ════════════════════════════════════════════════════
CREATE TABLE clayos.contracts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          uuid NOT NULL REFERENCES clayos.projects(id) ON DELETE CASCADE,
  org_id              uuid REFERENCES clayos.organizations(id) ON DELETE SET NULL,
  contract_type       text NOT NULL CHECK (contract_type IN ('prime','subcontract','purchase_order','change_order')),
  masterformat_code_id uuid REFERENCES clayos.classification_codes(id) ON DELETE SET NULL,
  value               numeric(16,2),
  executed_date       date,
  status              text NOT NULL DEFAULT 'executed' CHECK (status IN ('draft','executed','closed')),
  scope               text
);
CREATE INDEX contracts_project_idx ON clayos.contracts (project_id);

-- ═══ SERVICE GROUPS (non-project) ════════════════════════════════════════════
CREATE TABLE clayos.requisitions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_unit_id     uuid REFERENCES clayos.business_units(id) ON DELETE SET NULL,
  title                text NOT NULL,
  department           text,
  status               text NOT NULL DEFAULT 'open' CHECK (status IN ('open','interviewing','offer','filled','closed')),
  opened_date          date,
  filled_date          date,
  hiring_manager_person_id uuid REFERENCES clayos.persons(id) ON DELETE SET NULL,
  location             text
);

CREATE TABLE clayos.staffing_assignments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id       uuid NOT NULL REFERENCES clayos.persons(id) ON DELETE CASCADE,
  project_id      uuid NOT NULL REFERENCES clayos.projects(id) ON DELETE CASCADE,
  role_on_project text,
  allocation_pct  numeric(5,2) NOT NULL DEFAULT 100,
  start_date      date,
  end_date        date
);
CREATE INDEX staffing_person_idx  ON clayos.staffing_assignments (person_id);
CREATE INDEX staffing_project_idx ON clayos.staffing_assignments (project_id);

CREATE TABLE clayos.it_assets (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_tag         text,
  asset_type        text CHECK (asset_type IN ('laptop','workstation','tablet','phone','server','license')),
  assigned_person_id uuid REFERENCES clayos.persons(id) ON DELETE SET NULL,
  business_unit_id  uuid REFERENCES clayos.business_units(id) ON DELETE SET NULL,
  status            text NOT NULL DEFAULT 'in_use' CHECK (status IN ('in_use','available','retired','repair')),
  purchase_date     date
);

-- ═══ APP / WORKFLOW BUILDER (roadmap stubs — schema-forward only) ════════════
CREATE TABLE clayos.app_definitions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text UNIQUE NOT NULL,
  name          text NOT NULL,
  description   text,
  system_prompt text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE clayos.app_scopes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id        uuid NOT NULL REFERENCES clayos.app_definitions(id) ON DELETE CASCADE,
  entity_type   text,                           -- null = all
  business_unit_id uuid REFERENCES clayos.business_units(id) ON DELETE CASCADE,
  domain        text,
  access        text NOT NULL DEFAULT 'read' CHECK (access IN ('read','write'))
);

CREATE TABLE clayos.app_tools (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id  uuid NOT NULL REFERENCES clayos.app_definitions(id) ON DELETE CASCADE,
  tool    text NOT NULL                         -- e.g. 'kg_search', 'kg_kpi'
);

-- updated_at maintenance on projects
DROP TRIGGER IF EXISTS trg_projects_updated ON clayos.projects;
CREATE TRIGGER trg_projects_updated
  BEFORE UPDATE ON clayos.projects
  FOR EACH ROW EXECUTE FUNCTION clayos.set_updated_at();

-- Broad read grant for the POC (RLS hardening deferred to 008/Phase 2).
GRANT SELECT ON ALL TABLES IN SCHEMA clayos TO PUBLIC;
