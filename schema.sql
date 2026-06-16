CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  public_slug TEXT NOT NULL UNIQUE,
  owner_token TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  brand_name TEXT,
  manufacturer_name TEXT,
  manufacturer_email TEXT,
  manufacturer_address TEXT,
  product_type TEXT,
  sku TEXT,
  materials_json TEXT NOT NULL DEFAULT '[]',
  safety_notes TEXT,
  care_instructions TEXT,
  recycling_instructions TEXT,
  languages_json TEXT NOT NULL DEFAULT '["fi"]',
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS product_events (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  event_type TEXT NOT NULL,
  event_data_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_product_events_product_id ON product_events(product_id);
