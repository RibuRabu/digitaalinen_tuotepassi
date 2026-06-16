CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  product_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_products_created_at ON products (created_at DESC);
