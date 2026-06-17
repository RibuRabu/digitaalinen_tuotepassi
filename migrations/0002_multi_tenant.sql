-- Multi-tenant foundation migration
-- Adds tenant tables and nullable tenant_id + published_at to products
-- Safe: additive only, no existing columns touched

CREATE TABLE IF NOT EXISTS tenants (
  id                     TEXT PRIMARY KEY,
  clerk_org_id           TEXT NOT NULL UNIQUE,
  name                   TEXT NOT NULL,
  slug                   TEXT UNIQUE,
  plan                   TEXT NOT NULL DEFAULT 'free',
  billing_status         TEXT NOT NULL DEFAULT 'trial',
  status                 TEXT NOT NULL DEFAULT 'trial',
  product_limit          INTEGER NOT NULL DEFAULT 25,
  stripe_customer_id     TEXT,
  stripe_subscription_id TEXT,
  deleted_at             TEXT,
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tenant_users (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id),
  clerk_user_id TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'member',
  invited_by    TEXT,
  joined_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(tenant_id, clerk_user_id)
);

-- Platform admins: manually inserted by developer, not self-service
CREATE TABLE IF NOT EXISTS platform_users (
  id            TEXT PRIMARY KEY,
  clerk_user_id TEXT NOT NULL UNIQUE,
  role          TEXT NOT NULL DEFAULT 'platform_admin',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Scaffold only — no application logic yet
CREATE TABLE IF NOT EXISTS product_transfers (
  id             TEXT PRIMARY KEY,
  product_id     TEXT NOT NULL REFERENCES products(id),
  from_tenant_id TEXT NOT NULL REFERENCES tenants(id),
  to_tenant_id   TEXT NOT NULL REFERENCES tenants(id),
  initiated_by   TEXT NOT NULL,
  approved_by    TEXT,
  status         TEXT NOT NULL DEFAULT 'pending',
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at   TEXT
);

ALTER TABLE products ADD COLUMN tenant_id TEXT REFERENCES tenants(id);
ALTER TABLE products ADD COLUMN published_at TEXT;

CREATE INDEX IF NOT EXISTS idx_products_tenant_id ON products(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_users_clerk_user_id ON tenant_users(clerk_user_id);
CREATE INDEX IF NOT EXISTS idx_tenant_users_tenant_id ON tenant_users(tenant_id);
