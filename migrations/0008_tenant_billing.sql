-- Tenant billing tracking table
-- Stores manual billing metadata (Holvi invoicing, MRR tracking)
-- billing_status lives in tenants table; per-invoice fields live here

CREATE TABLE IF NOT EXISTS tenant_billing (
  tenant_id            TEXT PRIMARY KEY REFERENCES tenants(id),
  billing_period       TEXT NOT NULL DEFAULT 'monthly',
  price_eur            INTEGER NOT NULL DEFAULT 0,
  vat_rate             INTEGER NOT NULL DEFAULT 25,
  next_invoice_date    TEXT,
  last_invoice_date    TEXT,
  holvi_invoice_number TEXT,
  notes                TEXT,
  updated_at           TEXT
);
