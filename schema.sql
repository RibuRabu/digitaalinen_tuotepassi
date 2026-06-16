CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  public_slug TEXT NOT NULL UNIQUE,
  owner_token TEXT NOT NULL UNIQUE,
  product_uid TEXT NOT NULL UNIQUE,
  passport_uid TEXT NOT NULL UNIQUE,
  data_carrier_type TEXT NOT NULL DEFAULT 'qr',
  data_carrier_url TEXT,
  identifier_level TEXT NOT NULL DEFAULT 'model',
  product_name TEXT NOT NULL,
  brand_name TEXT,
  manufacturer_name TEXT,
  manufacturer_email TEXT,
  manufacturer_address TEXT,
  responsible_operator_name TEXT,
  responsible_operator_email TEXT,
  responsible_operator_address TEXT,
  sku TEXT,
  gtin TEXT,
  batch_number TEXT,
  serial_number TEXT,
  product_type TEXT,
  materials_json TEXT NOT NULL DEFAULT '[]',
  substances_json TEXT NOT NULL DEFAULT '[]',
  safety_notes_json TEXT NOT NULL DEFAULT '[]',
  care_instructions_json TEXT NOT NULL DEFAULT '[]',
  repair_instructions_json TEXT NOT NULL DEFAULT '[]',
  recycling_instructions_json TEXT NOT NULL DEFAULT '[]',
  compliance_documents_json TEXT NOT NULL DEFAULT '[]',
  languages_json TEXT NOT NULL DEFAULT '["fi"]',
  visibility_json TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS product_events (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  event_type TEXT NOT NULL,
  event_data_json TEXT NOT NULL DEFAULT '{}',
  actor_type TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_product_events_product_id ON product_events(product_id);
