-- Migration 005: the generic knowledge graph (projection target).
--
-- `entities` + `edges` are a denormalized projection over the per-domain tables,
-- consumed ONLY by the ontology viewer and the agent's traversal/search tools.
-- They are never authoritative — migration 006 keeps them in sync via triggers,
-- and kg_reproject_all() can rebuild them from scratch.
-- ─────────────────────────────────────────────────────────────────────────────

SET search_path TO clayos, public, extensions;

-- ─── Nodes ───────────────────────────────────────────────────────────────────
CREATE TABLE clayos.entities (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type      text NOT NULL,              -- 'Project','RFI','CostAccount','Person', ...
  business_unit_id uuid REFERENCES clayos.business_units(id) ON DELETE SET NULL,
  source_table     text NOT NULL,              -- domain table of record
  source_id        uuid NOT NULL,              -- pk in that table
  label            text NOT NULL,              -- human display name
  classification_id uuid REFERENCES clayos.classification_codes(id) ON DELETE SET NULL,
  domain           text,                       -- lifecycle domain or service group
  properties       jsonb NOT NULL DEFAULT '{}',-- denormalized props for hover/filter
  embedding        vector(1536),               -- semantic search (written async)
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_table, source_id)
);

CREATE INDEX entities_type_idx   ON clayos.entities (entity_type);
CREATE INDEX entities_bu_idx     ON clayos.entities (business_unit_id);
CREATE INDEX entities_domain_idx ON clayos.entities (domain);
CREATE INDEX entities_class_idx  ON clayos.entities (classification_id);
CREATE INDEX entities_props_gin  ON clayos.entities USING GIN (properties);
-- Partial HNSW so the index ignores rows still pending an embedding.
CREATE INDEX entities_emb_hnsw   ON clayos.entities USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64)
  WHERE embedding IS NOT NULL;

-- ─── Edges (typed, directed, property-bearing) ──────────────────────────────
CREATE TABLE clayos.edges (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  edge_type   text NOT NULL,                   -- 'has_rfi','depends_on','located_in', ...
  src_id      uuid NOT NULL REFERENCES clayos.entities(id) ON DELETE CASCADE,
  dst_id      uuid NOT NULL REFERENCES clayos.entities(id) ON DELETE CASCADE,
  weight      numeric,
  properties  jsonb NOT NULL DEFAULT '{}',
  UNIQUE (edge_type, src_id, dst_id)
);

CREATE INDEX edges_src_idx ON clayos.edges (src_id, edge_type);
CREATE INDEX edges_dst_idx ON clayos.edges (dst_id, edge_type);

-- ─── RPC: kg_traverse — undirected N-hop walk with cycle-safety ─────────────
-- Follows edges in BOTH directions (so you can reach a Project from its RFI and
-- vice-versa). Tracks the visited path to terminate; caps at p_max_depth.
CREATE OR REPLACE FUNCTION clayos.kg_traverse(
  p_start      uuid,
  p_max_depth  int     DEFAULT 2,
  p_edge_types text[]  DEFAULT NULL
)
RETURNS TABLE(entity_id uuid, label text, entity_type text, domain text, depth int, via_edge text)
LANGUAGE sql STABLE AS $$
  WITH RECURSIVE walk AS (
    SELECT e.id, e.label, e.entity_type, e.domain, 0 AS depth, NULL::text AS via_edge, ARRAY[e.id] AS visited
    FROM clayos.entities e
    WHERE e.id = p_start
    UNION ALL
    SELECT e2.id, e2.label, e2.entity_type, e2.domain, w.depth + 1, ed.edge_type, w.visited || e2.id
    FROM walk w
    JOIN clayos.edges ed
      ON (ed.src_id = w.id OR ed.dst_id = w.id)
    JOIN clayos.entities e2
      ON e2.id = CASE WHEN ed.src_id = w.id THEN ed.dst_id ELSE ed.src_id END
    WHERE w.depth < p_max_depth
      AND NOT e2.id = ANY(w.visited)
      AND (p_edge_types IS NULL OR ed.edge_type = ANY(p_edge_types))
  )
  SELECT id, label, entity_type, domain,
         min(depth) AS depth,
         (array_agg(via_edge ORDER BY depth))[1] AS via_edge
  FROM walk
  WHERE id <> p_start
  GROUP BY id, label, entity_type, domain;
$$;

-- ─── RPC: kg_subgraph — filtered nodes+edges for the viewer (capped) ────────
CREATE OR REPLACE FUNCTION clayos.kg_subgraph(
  p_business_unit uuid    DEFAULT NULL,
  p_domains       text[]  DEFAULT NULL,
  p_entity_types  text[]  DEFAULT NULL,
  p_limit         int     DEFAULT 1500
)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE result jsonb;
BEGIN
  WITH picked AS (
    SELECT e.id, e.label, e.entity_type, e.domain, e.business_unit_id, e.properties
    FROM clayos.entities e
    WHERE (p_business_unit IS NULL OR e.business_unit_id = p_business_unit)
      AND (p_domains      IS NULL OR e.domain = ANY(p_domains))
      AND (p_entity_types IS NULL OR e.entity_type = ANY(p_entity_types))
    ORDER BY e.entity_type
    LIMIT p_limit
  )
  SELECT jsonb_build_object(
    'nodes', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'id', id, 'label', label, 'type', entity_type, 'domain', domain,
                'business_unit_id', business_unit_id, 'properties', properties)) FROM picked), '[]'::jsonb),
    'edges', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'id', ed.id, 'type', ed.edge_type, 'source', ed.src_id, 'target', ed.dst_id))
                FROM clayos.edges ed
                WHERE ed.src_id IN (SELECT id FROM picked)
                  AND ed.dst_id IN (SELECT id FROM picked)), '[]'::jsonb)
  ) INTO result;
  RETURN result;
END $$;

-- ─── RPC: kg_neighbors — 1-hop expand (for click-to-expand in the viewer) ───
CREATE OR REPLACE FUNCTION clayos.kg_neighbors(p_entity uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE result jsonb;
BEGIN
  WITH nbr AS (
    SELECT e2.id, e2.label, e2.entity_type, e2.domain, e2.business_unit_id, e2.properties
    FROM clayos.edges ed
    JOIN clayos.entities e2 ON e2.id = CASE WHEN ed.src_id = p_entity THEN ed.dst_id ELSE ed.src_id END
    WHERE ed.src_id = p_entity OR ed.dst_id = p_entity
    UNION
    SELECT e.id, e.label, e.entity_type, e.domain, e.business_unit_id, e.properties
    FROM clayos.entities e WHERE e.id = p_entity
  )
  SELECT jsonb_build_object(
    'nodes', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'id', id, 'label', label, 'type', entity_type, 'domain', domain,
                'business_unit_id', business_unit_id, 'properties', properties)) FROM nbr), '[]'::jsonb),
    'edges', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'id', ed.id, 'type', ed.edge_type, 'source', ed.src_id, 'target', ed.dst_id))
                FROM clayos.edges ed
                WHERE ed.src_id = p_entity OR ed.dst_id = p_entity), '[]'::jsonb)
  ) INTO result;
  RETURN result;
END $$;

-- ─── RPC: kg_search — semantic ANN over entity embeddings ───────────────────
CREATE OR REPLACE FUNCTION clayos.kg_search(
  p_query_vec     vector(1536),
  p_limit         int    DEFAULT 12,
  p_business_unit uuid   DEFAULT NULL,
  p_domains       text[] DEFAULT NULL
)
RETURNS TABLE(id uuid, entity_type text, label text, domain text, source_table text, source_id uuid, sim numeric)
LANGUAGE sql STABLE AS $$
  SELECT e.id, e.entity_type, e.label, e.domain, e.source_table, e.source_id,
         (1 - (e.embedding <=> p_query_vec))::numeric AS sim
  FROM clayos.entities e
  WHERE e.embedding IS NOT NULL
    AND (p_business_unit IS NULL OR e.business_unit_id = p_business_unit)
    AND (p_domains      IS NULL OR e.domain = ANY(p_domains))
  ORDER BY e.embedding <=> p_query_vec
  LIMIT p_limit;
$$;

GRANT SELECT ON clayos.entities, clayos.edges TO PUBLIC;
GRANT EXECUTE ON FUNCTION clayos.kg_traverse(uuid, int, text[])              TO PUBLIC;
GRANT EXECUTE ON FUNCTION clayos.kg_subgraph(uuid, text[], text[], int)      TO PUBLIC;
GRANT EXECUTE ON FUNCTION clayos.kg_neighbors(uuid)                          TO PUBLIC;
GRANT EXECUTE ON FUNCTION clayos.kg_search(vector, int, uuid, text[])        TO PUBLIC;
