-- Migration 010: per-entity facts for the ontology viewer's recent-activity flow
-- and $-weighted vessels. Read-only projection over the domain tables' SEMANTIC
-- dates (entities.updated_at is all seed-time, so it can't drive recency) and the
-- records' dollar amounts. Consumed by the frontend; never authoritative.
-- ─────────────────────────────────────────────────────────────────────────────

SET search_path TO clayos, public, extensions;

CREATE OR REPLACE FUNCTION clayos.kg_entity_facts()
RETURNS TABLE(entity_id uuid, activity_at timestamptz, amount numeric)
LANGUAGE sql STABLE AS $$
  -- transactional records (carry a real "last touched" date; some carry $)
  SELECT e.id, COALESCE(r.answered_date, r.submitted_date)::timestamptz, r.cost_impact
    FROM clayos.entities e JOIN clayos.rfis r ON e.source_table = 'rfis' AND e.source_id = r.id
  UNION ALL
  SELECT e.id, d.log_date::timestamptz, NULL::numeric
    FROM clayos.entities e JOIN clayos.daily_logs d ON e.source_table = 'daily_logs' AND e.source_id = d.id
  UNION ALL
  SELECT e.id, COALESCE(s.returned_date, s.submitted_date)::timestamptz, NULL
    FROM clayos.entities e JOIN clayos.submittals s ON e.source_table = 'submittals' AND e.source_id = s.id
  UNION ALL
  SELECT e.id, se.event_date::timestamptz, NULL
    FROM clayos.entities e JOIN clayos.safety_events se ON e.source_table = 'safety_events' AND e.source_id = se.id
  UNION ALL
  SELECT e.id, COALESCE(q.resolved_date, q.identified_date)::timestamptz, NULL
    FROM clayos.entities e JOIN clayos.quality_events q ON e.source_table = 'quality_events' AND e.source_id = q.id
  UNION ALL
  SELECT e.id, COALESCE(pa.approved_date, pa.submitted_date, pa.period_end)::timestamptz,
         (SELECT sum(l.scheduled_value) FROM clayos.pay_app_lines l WHERE l.pay_app_id = pa.id)
    FROM clayos.entities e JOIN clayos.pay_apps pa ON e.source_table = 'pay_apps' AND e.source_id = pa.id
  UNION ALL
  SELECT e.id, c.executed_date::timestamptz, c.value
    FROM clayos.entities e JOIN clayos.contracts c ON e.source_table = 'contracts' AND e.source_id = c.id
  UNION ALL
  SELECT e.id, COALESCE(a.actual_finish, a.actual_start, a.planned_finish, a.planned_start)::timestamptz, NULL
    FROM clayos.entities e JOIN clayos.schedule_activities a ON e.source_table = 'schedule_activities' AND e.source_id = a.id
  UNION ALL
  SELECT e.id, dc.issued_date::timestamptz, NULL
    FROM clayos.entities e JOIN clayos.documents dc ON e.source_table = 'documents' AND e.source_id = dc.id
  UNION ALL
  SELECT e.id, p.hire_date::timestamptz, NULL
    FROM clayos.entities e JOIN clayos.persons p ON e.source_table = 'persons' AND e.source_id = p.id
  UNION ALL
  SELECT e.id, COALESCE(pu.decision_date, pu.identified_date)::timestamptz, pu.est_value
    FROM clayos.entities e JOIN clayos.pursuits pu ON e.source_table = 'pursuits' AND e.source_id = pu.id
  UNION ALL
  SELECT e.id, COALESCE(rq.filled_date, rq.opened_date)::timestamptz, NULL
    FROM clayos.entities e JOIN clayos.requisitions rq ON e.source_table = 'requisitions' AND e.source_id = rq.id
  UNION ALL
  SELECT e.id, it.purchase_date::timestamptz, NULL
    FROM clayos.entities e JOIN clayos.it_assets it ON e.source_table = 'it_assets' AND e.source_id = it.id
  UNION ALL
  SELECT e.id, COALESCE(ph.end_date, ph.start_date)::timestamptz, NULL
    FROM clayos.entities e JOIN clayos.phases ph ON e.source_table = 'phases' AND e.source_id = ph.id
  UNION ALL
  SELECT e.id, COALESCE(pr.actual_finish, pr.start_date)::timestamptz, pr.contract_value
    FROM clayos.entities e JOIN clayos.projects pr ON e.source_table = 'projects' AND e.source_id = pr.id
  -- structural records (no meaningful "moved" date; carry $ for vessel weight)
  UNION ALL
  SELECT e.id, NULL::timestamptz, ca.bac
    FROM clayos.entities e JOIN clayos.cost_accounts ca ON e.source_table = 'cost_accounts' AND e.source_id = ca.id
  UNION ALL
  SELECT e.id, NULL::timestamptz, es.total_value
    FROM clayos.entities e JOIN clayos.estimates es ON e.source_table = 'estimates' AND e.source_id = es.id
$$;

GRANT EXECUTE ON FUNCTION clayos.kg_entity_facts() TO PUBLIC;
