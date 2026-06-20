-- ─────────────────────────────────────────────────────────────────────────────
-- 0004_compliance_engine.sql
--
-- Adds the compliance validation data model.
-- Engine logic lives in the Worker; all rule definitions are data in this schema.
--
-- Design constraints honoured:
--   - tenant_regulations is an override layer only — default behaviour derives
--     from category_regulations; no tenant row is needed for mandatory regs
--   - compliance_status = 'verified' is never set by the engine automatically;
--     result_json carries "verification_suggested" for human/admin action
--   - products.version already exists (0001_create_products.sql); not re-added
--   - GPSR CE document requirement is seeded as severity = 'info' only;
--     CE applicability depends on product-specific harmonisation legislation
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Product taxonomy ──────────────────────────────────────────────────────────
-- Hierarchical; parent_id NULL = top-level category.
-- code is stable and used by condition_json in regulation_rules.

CREATE TABLE IF NOT EXISTS product_categories (
  id         TEXT PRIMARY KEY,
  code       TEXT NOT NULL UNIQUE,
  parent_id  TEXT REFERENCES product_categories(id),
  name_fi    TEXT NOT NULL,
  name_en    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO product_categories (id, code, parent_id, name_fi, name_en) VALUES
  ('cat_textiles',    'TEXTILES',    NULL, 'Tekstiilit ja vaatteet',       'Textiles and apparel'),
  ('cat_electronics', 'ELECTRONICS', NULL, 'Elektroniikka',                'Electronics'),
  ('cat_batteries',   'BATTERIES',   NULL, 'Akut ja paristot',             'Batteries'),
  ('cat_furniture',   'FURNITURE',   NULL, 'Huonekalut',                   'Furniture'),
  ('cat_other',       'OTHER',       NULL, 'Muu tuoteryhmä',               'Other');

-- ── Regulations ───────────────────────────────────────────────────────────────
-- One row per regulation + version.
-- superseded_by links old regulation rows to their replacement when a new
-- version is adopted; old rules remain queryable for historical audit.

CREATE TABLE IF NOT EXISTS regulations (
  id             TEXT PRIMARY KEY,
  code           TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL,
  description    TEXT,
  version        TEXT NOT NULL DEFAULT '1',
  effective_date TEXT,
  status         TEXT NOT NULL DEFAULT 'active', -- 'draft' | 'active' | 'superseded'
  superseded_by  TEXT REFERENCES regulations(id),
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO regulations (id, code, name, description, version, effective_date, status) VALUES
  (
    'reg_gpsr',
    'GPSR',
    'General Product Safety Regulation',
    'EU 2023/988 — baseline safety obligations for all consumer products placed on the EU market',
    '2023/988',
    '2024-12-13',
    'active'
  ),
  (
    'reg_epr',
    'EPR',
    'Extended Producer Responsibility',
    'Repairability, reuse and end-of-life take-back obligations for electronics and batteries',
    '2024',
    '2024-01-01',
    'active'
  ),
  (
    'reg_espr_textiles',
    'ESPR_TEXTILES',
    'Ecodesign for Sustainable Products — Textiles',
    'Draft delegated act under ESPR (EU 2024/1781) covering material composition, durability and recyclability for textiles',
    '2026-draft',
    NULL,
    'draft'
  );

-- ── Validation rules ──────────────────────────────────────────────────────────
-- rule_code is the stable external identifier — never changes.
-- rule_version increments when the rule logic or message is updated while
--   keeping the same rule_code (e.g. article number corrected, threshold raised).
-- condition_json is a JSON object interpreted by the Worker engine.
--   Recognised keys:
--     "always": true             — rule applies unconditionally
--     "category_codes": [...]    — rule activates only for listed category codes
--     "min": N                   — for required_array_min: minimum item count
--     "doc_name_pattern": "..."  — for required_document: regex against doc name
-- severity:
--     "error"   — failure prevents status reaching "complete"; counted double in score
--     "warning" — does not block "complete"; counted once in score
--     "info"    — surfaced in response but not counted in score; never blocks anything

CREATE TABLE IF NOT EXISTS regulation_rules (
  id             TEXT PRIMARY KEY,
  regulation_id  TEXT NOT NULL REFERENCES regulations(id),
  rule_code      TEXT NOT NULL UNIQUE,
  rule_version   INTEGER NOT NULL DEFAULT 1,
  rule_type      TEXT NOT NULL,
  -- rule_type values:
  --   required_field       field must be non-null and non-empty string
  --   required_array_min   field must be a JSON array with >= min items
  --   required_document    product_documents must have a row whose name matches doc_name_pattern
  --   conditional          field required only when another field equals a value (future use)
  --   translation_required product_translations must have a row for lang with field non-empty (future use)
  field_path     TEXT,
  condition_json TEXT NOT NULL DEFAULT '{"always":true}',
  severity       TEXT NOT NULL DEFAULT 'error',
  message_en     TEXT NOT NULL,
  message_fi     TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- GPSR rules — apply to all product categories, all EU markets
INSERT INTO regulation_rules
  (id, regulation_id, rule_code, rule_version, rule_type, field_path, condition_json, severity, message_en, message_fi)
VALUES
  (
    'rule_gpsr_01', 'reg_gpsr', 'GPSR_PRODUCT_NAME', 1,
    'required_field', 'product_name',
    '{"always":true}',
    'error',
    'Product name is required (GPSR Art. 8.7)',
    'Tuotteen nimi vaaditaan (GPSR Art. 8.7)'
  ),
  (
    'rule_gpsr_02', 'reg_gpsr', 'GPSR_MANUFACTURER_NAME', 1,
    'required_field', 'manufacturer_name',
    '{"always":true}',
    'error',
    'Manufacturer or responsible person name is required (GPSR Art. 9.2)',
    'Valmistajan tai vastuullisen henkilön nimi vaaditaan (GPSR Art. 9.2)'
  ),
  (
    'rule_gpsr_03', 'reg_gpsr', 'GPSR_MANUFACTURER_ADDRESS', 1,
    'required_field', 'manufacturer_address',
    '{"always":true}',
    'error',
    'Manufacturer or responsible person postal address is required (GPSR Art. 9.2)',
    'Valmistajan tai vastuullisen henkilön postiosoite vaaditaan (GPSR Art. 9.2)'
  ),
  (
    'rule_gpsr_04', 'reg_gpsr', 'GPSR_MANUFACTURER_CONTACT', 1,
    'required_field', 'manufacturer_email',
    '{"always":true}',
    'warning',
    'Manufacturer contact email is recommended for digital communications (GPSR Art. 9.2)',
    'Valmistajan sähköpostiosoite on suositeltava digitaalista yhteydenpitoa varten (GPSR Art. 9.2)'
  ),
  (
    'rule_gpsr_05', 'reg_gpsr', 'GPSR_SAFETY_NOTES', 1,
    'required_array_min', 'safety_notes_json',
    '{"always":true,"min":1}',
    'warning',
    'At least one safety note or instruction is recommended (GPSR Art. 9.5)',
    'Vähintään yksi turvallisuusohje tai -tieto on suositeltava (GPSR Art. 9.5)'
  ),
  -- CE marking: info only — applicability depends on product-specific EU harmonisation
  -- legislation (LVD, RED, MDR, etc.), not on GPSR alone.
  (
    'rule_gpsr_06', 'reg_gpsr', 'GPSR_CE_MARKING_INFO', 1,
    'required_document', 'compliance_documents_json',
    '{"category_codes":["ELECTRONICS"],"doc_name_pattern":"(?i).*CE.*|.*conformity.*|.*declaration.*"}',
    'info',
    'CE marking documentation may be required depending on applicable EU harmonisation legislation (e.g. LVD 2014/35/EU, RED 2014/53/EU). Verify whether CE marking applies to your specific product before placing it on the market.',
    'CE-merkintädokumentaatio saattaa olla tarpeen sovellettavan EU-yhdenmukaistamislainsäädännön (esim. LVD 2014/35/EU, RED 2014/53/EU) mukaan. Tarkista CE-merkinnän sovellettavuus tuotekohtaisesti ennen markkinoille saattamista.'
  );

-- ESPR Textiles rules — apply only when category_codes includes TEXTILES
INSERT INTO regulation_rules
  (id, regulation_id, rule_code, rule_version, rule_type, field_path, condition_json, severity, message_en, message_fi)
VALUES
  (
    'rule_espr_t_01', 'reg_espr_textiles', 'ESPR_TEXTILES_MATERIALS', 1,
    'required_array_min', 'materials_json',
    '{"category_codes":["TEXTILES"],"min":1}',
    'error',
    'Material composition must be declared for textile products (ESPR delegated act — textiles)',
    'Materiaalitiedot on ilmoitettava tekstiilituotteille (ESPR-delegoitu asetus — tekstiilit)'
  ),
  (
    'rule_espr_t_02', 'reg_espr_textiles', 'ESPR_TEXTILES_CARE', 1,
    'required_array_min', 'care_instructions_json',
    '{"category_codes":["TEXTILES"],"min":1}',
    'error',
    'Care instructions must be provided for textile products (ESPR delegated act — textiles)',
    'Hoito-ohjeet on annettava tekstiilituotteille (ESPR-delegoitu asetus — tekstiilit)'
  ),
  (
    'rule_espr_t_03', 'reg_espr_textiles', 'ESPR_TEXTILES_RECYCLING', 1,
    'required_array_min', 'recycling_instructions_json',
    '{"category_codes":["TEXTILES"],"min":1}',
    'warning',
    'End-of-life recycling information is recommended for textile products (ESPR delegated act — textiles)',
    'Elinkaaren lopun kierrätystiedot ovat suositeltavia tekstiilituotteille (ESPR-delegoitu asetus — tekstiilit)'
  );

-- EPR rules — apply to ELECTRONICS and BATTERIES
INSERT INTO regulation_rules
  (id, regulation_id, rule_code, rule_version, rule_type, field_path, condition_json, severity, message_en, message_fi)
VALUES
  (
    'rule_epr_01', 'reg_epr', 'EPR_REPAIR_INSTRUCTIONS', 1,
    'required_array_min', 'repair_instructions_json',
    '{"category_codes":["ELECTRONICS","BATTERIES"],"min":1}',
    'warning',
    'Repair instructions are recommended to support repairability obligations (EPR)',
    'Korjausohjeet ovat suositeltavia korjattavuusvelvoitteiden tueksi (EPR)'
  );

-- ── Category → regulation mappings ───────────────────────────────────────────
-- mandatory = 1: regulation applies by default when no tenant_regulations row exists
-- mandatory = 0: informational / opt-in; tenant must set enabled = 1 to activate
-- market = '*': applies to all target markets; future rows can use 'DE', 'FI', etc.
--   for country-specific regulation activation

CREATE TABLE IF NOT EXISTS category_regulations (
  id            TEXT PRIMARY KEY,
  category_id   TEXT NOT NULL REFERENCES product_categories(id),
  regulation_id TEXT NOT NULL REFERENCES regulations(id),
  market        TEXT NOT NULL DEFAULT '*',
  mandatory     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(category_id, regulation_id, market)
);

CREATE INDEX IF NOT EXISTS idx_cat_reg_category ON category_regulations(category_id);

INSERT INTO category_regulations (id, category_id, regulation_id, market, mandatory) VALUES
  -- GPSR is mandatory for all categories (all markets)
  ('cr_gpsr_tex', 'cat_textiles',    'reg_gpsr', '*', 1),
  ('cr_gpsr_ele', 'cat_electronics', 'reg_gpsr', '*', 1),
  ('cr_gpsr_bat', 'cat_batteries',   'reg_gpsr', '*', 1),
  ('cr_gpsr_fur', 'cat_furniture',   'reg_gpsr', '*', 1),
  ('cr_gpsr_oth', 'cat_other',       'reg_gpsr', '*', 1),
  -- EPR is mandatory for electronics and batteries
  ('cr_epr_ele',  'cat_electronics', 'reg_epr',           '*', 1),
  ('cr_epr_bat',  'cat_batteries',   'reg_epr',           '*', 1),
  -- ESPR Textiles is draft — mandatory = 0; tenants opt in via tenant_regulations
  ('cr_espr_tex', 'cat_textiles',    'reg_espr_textiles', '*', 0);

-- ── Tenant regulation overrides ───────────────────────────────────────────────
-- No row present  →  default from category_regulations applies
--                    (mandatory = 1 regs are active; mandatory = 0 regs are inactive)
-- enabled = 0     →  tenant disables a regulation that would otherwise be active
-- enabled = 1     →  tenant explicitly activates a draft / optional regulation
--                    (e.g. ESPR_TEXTILES before it becomes mandatory)
-- markets_json    →  the markets this tenant targets; used by translation_required
--                    and market-scoped rules in the future

CREATE TABLE IF NOT EXISTS tenant_regulations (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id),
  regulation_id TEXT NOT NULL REFERENCES regulations(id),
  enabled       INTEGER NOT NULL DEFAULT 1,
  markets_json  TEXT NOT NULL DEFAULT '["EU"]',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(tenant_id, regulation_id)
);

CREATE INDEX IF NOT EXISTS idx_tenant_reg_tenant ON tenant_regulations(tenant_id);

-- ── Compliance result cache ───────────────────────────────────────────────────
-- One row per product. Invalidated when product.version > compliance_results.product_version.
-- status is 'incomplete' or 'complete' only — the engine never writes 'verified'.
-- result_json carries "verification_suggested": true when score >= 95 and status = 'complete',
--   signalling that a human or admin can promote compliance_status to 'verified'.

CREATE TABLE IF NOT EXISTS compliance_results (
  id              TEXT PRIMARY KEY,
  product_id      TEXT NOT NULL UNIQUE REFERENCES products(id),
  computed_at     TEXT NOT NULL DEFAULT (datetime('now')),
  product_version INTEGER NOT NULL,
  status          TEXT NOT NULL, -- 'incomplete' | 'complete'
  score           INTEGER NOT NULL,
  result_json     TEXT NOT NULL DEFAULT '{}'
);

-- ── New columns on products ───────────────────────────────────────────────────
-- products.version is INTEGER NOT NULL DEFAULT 1 — present since 0001_create_products.sql.
-- No re-add needed (correction #4).

ALTER TABLE products ADD COLUMN category_id          TEXT REFERENCES product_categories(id);
ALTER TABLE products ADD COLUMN target_markets_json  TEXT NOT NULL DEFAULT '["EU"]';
