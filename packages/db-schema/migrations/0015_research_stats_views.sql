CREATE OR REPLACE VIEW vw_research_stats_counts AS
SELECT
  (SELECT count(*)::int FROM satellite) AS satellites,
  (SELECT count(*)::int FROM conjunction_event) AS conjunctions,
  (SELECT count(*)::int FROM research_finding) AS findings,
  (SELECT count(*)::int FROM research_edge) AS kg_edges,
  (SELECT count(*)::int FROM research_cycle) AS research_cycles;

CREATE OR REPLACE VIEW vw_research_findings_by_status AS
SELECT status::text AS status, count(*)::int AS count
FROM research_finding
GROUP BY status;

CREATE OR REPLACE VIEW vw_research_findings_by_cortex AS
SELECT cortex::text AS cortex, count(*)::int AS count
FROM research_finding
GROUP BY cortex;
