-- 0010_nfc_orders.sql
-- Programmed NFC tag orders (Phase 6).
--
-- A tenant customer orders physical NFC tags pre-programmed to open an existing
-- product's PUBLIC passport (the same target as its QR code). Orders are fulfilled
-- by platform admins. No payment is handled in this phase.
--
-- Security / integrity notes:
--   * tenant_id and product_id are always derived server-side from the authenticated
--     tenant context and the product looked up by (public_slug, tenant_id) — never
--     from the client. See src/routes/nfc.js.
--   * public_slug_snapshot / programming_url_snapshot capture the programming target
--     at order time so fulfilment is stable even if product data later changes.
--   * order_number is a human-readable, unique, D1-safe identifier (NFC-YYYY-000001).
--   * Child-first cleanup compatibility: this table references products(id) and
--     tenants(id); when purging a tenant/product, delete nfc_orders rows first
--     (same pattern as product_events / product_documents).

CREATE TABLE IF NOT EXISTS nfc_orders (
  id                       TEXT PRIMARY KEY,
  order_number             TEXT NOT NULL UNIQUE,
  tenant_id                TEXT NOT NULL REFERENCES tenants(id),
  product_id               TEXT NOT NULL REFERENCES products(id),
  public_slug_snapshot     TEXT NOT NULL,
  programming_url_snapshot TEXT NOT NULL,
  tag_type                 TEXT NOT NULL DEFAULT 'standard',
  quantity                 INTEGER NOT NULL DEFAULT 1,
  status                   TEXT NOT NULL DEFAULT 'new',
  recipient_name           TEXT NOT NULL,
  company_name             TEXT,
  address_line             TEXT NOT NULL,
  postal_code              TEXT NOT NULL,
  city                     TEXT NOT NULL,
  country_code             TEXT NOT NULL,
  customer_note            TEXT,
  admin_note               TEXT,
  tracking_code            TEXT,
  tracking_url             TEXT,
  created_at               TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at               TEXT NOT NULL DEFAULT (datetime('now')),
  confirmed_at             TEXT,
  programmed_at            TEXT,
  shipped_at               TEXT,
  cancelled_at             TEXT
);

CREATE INDEX IF NOT EXISTS idx_nfc_orders_tenant_id   ON nfc_orders(tenant_id);
CREATE INDEX IF NOT EXISTS idx_nfc_orders_product_id  ON nfc_orders(product_id);
CREATE INDEX IF NOT EXISTS idx_nfc_orders_status      ON nfc_orders(status);
CREATE INDEX IF NOT EXISTS idx_nfc_orders_created_at  ON nfc_orders(created_at);
CREATE INDEX IF NOT EXISTS idx_nfc_orders_order_number ON nfc_orders(order_number);
