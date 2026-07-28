-- 0011_nfc_tag_type_mini.sql
-- Phase 7.5 — correct the NFC product model so tag_type describes the ACTUAL
-- ordered product instead of the earlier fake mapping.
--
-- Background:
--   In Phase 7 the dashboard offered two SKUs (NFC Mini, NFC Standard) but the
--   Worker enum only had 'standard' and 'on_metal', so NFC Mini was stored as
--   'on_metal'. There was NO genuine on-metal product, so every existing
--   'on_metal' row originates from the commercial Mini product.
--
-- What this migration does:
--   Re-label those historical Mini rows from 'on_metal' to 'mini'. This is a
--   value correction only — no rows are deleted and no other column changes,
--   so order numbers, quantities, addresses and timestamps are preserved.
--
-- Why this is safe / must run once at the 7.5 boundary:
--   'on_metal' only regains a REAL meaning (Metallitunniste) once the new Worker
--   (which accepts 'mini' | 'standard' | 'on_metal') and the new dashboard (which
--   sends 'mini' | 'standard' directly, and does not yet offer on-metal) are
--   deployed. This migration is applied BEFORE any genuine on-metal order can be
--   placed, so it cannot mislabel a real Metallitunniste order. Apply it exactly
--   once as part of the 7.5 deployment, ahead of the Worker/dashboard rollout.
--
--   In production this touches zero rows (NFC ordering was never deployed); it is
--   written for correctness in any environment where 0010 was already applied.

UPDATE nfc_orders
   SET tag_type = 'mini',
       updated_at = datetime('now')
 WHERE tag_type = 'on_metal';
