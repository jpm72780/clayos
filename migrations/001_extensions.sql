-- Migration 001: schema, extensions, shared helpers.
--
-- ClayOS lives in its own `clayos` schema. Everything is forward-only and
-- idempotent where practical. Designed to run on both a plain pgvector Postgres
-- (local dev) and Supabase. pg_cron is optional and guarded in 009.
--
-- Run order: 001 → 002 → … → 009
-- ─────────────────────────────────────────────────────────────────────────────

CREATE SCHEMA IF NOT EXISTS clayos;

-- Extensions. No WITH SCHEMA so they land in the default (public locally,
-- works on Supabase too). search_path below makes their types resolvable.
CREATE EXTENSION IF NOT EXISTS ltree;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

SET search_path TO clayos, public, extensions;

-- ─── Shared: updated_at maintenance ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION clayos.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- ─── Shared: generic ltree path maintenance ──────────────────────────────────
-- Any table with columns (id uuid, parent_id uuid, path ltree, depth int) can
-- attach this as a BEFORE INSERT OR UPDATE OF parent_id trigger. It looks the
-- parent up in the *same* table via dynamic SQL (TG_TABLE_NAME), so one function
-- serves business_units, classification_codes, wbs_nodes, etc.
--
-- Path labels are the row's hex UUID (dashes stripped) — a valid single ltree
-- label — so paths are stable and collision-free regardless of human slugs.
CREATE OR REPLACE FUNCTION clayos.maintain_path()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  p_path  ltree;
  p_depth int;
  hexid   text := replace(NEW.id::text, '-', '');
BEGIN
  IF NEW.parent_id IS NULL THEN
    NEW.path  := hexid::ltree;
    NEW.depth := 0;
  ELSE
    EXECUTE format('SELECT path, depth FROM %I.%I WHERE id = $1', TG_TABLE_SCHEMA, TG_TABLE_NAME)
      INTO p_path, p_depth USING NEW.parent_id;
    IF p_path IS NULL THEN
      RAISE EXCEPTION 'maintain_path: parent % not found in %.%', NEW.parent_id, TG_TABLE_SCHEMA, TG_TABLE_NAME;
    END IF;
    NEW.path  := p_path || hexid::ltree;
    NEW.depth := p_depth + 1;
  END IF;
  RETURN NEW;
END $$;

COMMENT ON SCHEMA clayos IS 'ClayOS — company operating system POC (construction/design-build, modeled on Clayco).';
