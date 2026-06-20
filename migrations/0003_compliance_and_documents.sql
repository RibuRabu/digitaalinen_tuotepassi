-- #9: compliance workflow status — separate from publication status (draft/active/archived)
ALTER TABLE products ADD COLUMN compliance_status TEXT NOT NULL DEFAULT 'not_started';

-- #4: dedicated document rows instead of JSON blob — new uploads land here, blob kept for legacy reads
CREATE TABLE IF NOT EXISTS product_documents (
  id          TEXT PRIMARY KEY,
  product_id  TEXT NOT NULL REFERENCES products(id),
  tenant_id   TEXT REFERENCES tenants(id),
  name        TEXT NOT NULL,
  file_key    TEXT NOT NULL UNIQUE,
  file_type   TEXT NOT NULL DEFAULT 'application/octet-stream',
  file_size   INTEGER NOT NULL DEFAULT 0,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_product_docs_product ON product_documents(product_id);

-- #5: per-language translation rows instead of JSON blob — new saves land here, blob kept for legacy reads
CREATE TABLE IF NOT EXISTS product_translations (
  id         TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  lang       TEXT NOT NULL,
  data_json  TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(product_id, lang)
);
CREATE INDEX IF NOT EXISTS idx_product_trans_product ON product_translations(product_id);
