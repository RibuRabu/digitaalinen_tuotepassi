-- ─────────────────────────────────────────────────────────────────────────────
-- 0006_rules_metadata.sql
--
-- Adds metadata columns to regulation_rules so that generated rule packs
-- (data/rules/*.json) can be fully persisted and validated in D1.
--
-- These columns are non-breaking additions — all existing rules remain valid;
-- the engine in src/routes/compliance.js does not read these columns and does
-- not need to be updated for this migration.
--
-- Column semantics:
--   legal_reference      — citation(s) to the specific article / annex / standard
--                          that grounds the rule. Free text; not machine-evaluated.
--   confidence_level     — 0–100 integer. Rules seeded below 90 must have
--                          requires_human_review = 1. The engine does not use this
--                          value; it is used by tooling and reviewers.
--   requires_human_review — 1 = a human reviewer must verify the rule before it
--                          is treated as authoritative. 0 = rule is asserted with
--                          sufficient confidence. Engine does not filter on this;
--                          it is surfaced in the compliance API response for client
--                          display and admin review queues.
--   requirement_scope    — one of: 'mandatory_EU' | 'country_specific' | 'draft' |
--                          'best_practice'. Informational; not machine-evaluated yet.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE regulation_rules ADD COLUMN legal_reference       TEXT;
ALTER TABLE regulation_rules ADD COLUMN confidence_level      INTEGER;
ALTER TABLE regulation_rules ADD COLUMN requires_human_review INTEGER NOT NULL DEFAULT 0;
ALTER TABLE regulation_rules ADD COLUMN requirement_scope      TEXT;
