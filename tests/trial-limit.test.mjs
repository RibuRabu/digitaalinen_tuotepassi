// Tests for the free-trial one-product limit (Phase 9).
// Run: node --test tests/trial-limit.test.mjs
// Pure logic + post-auth handler logic against an in-memory env.DB mock.
// No network, no real Clerk — synthetic tenants/products only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  trialProductLimitExceeded, createProductForTenant, updateProductForTenant,
} from '../src/routes/tenant.js';
import { TRIAL_PLAN, TRIAL_PRODUCT_LIMIT } from '../src/utils.js';

// ── In-memory D1 mock ─────────────────────────────────────────────────────────
// Products is an array of { status }. The count query mirrors the real one:
// COUNT(*) WHERE tenant_id = ? AND status != 'archived'.
function mockDb({ products = [] } = {}) {
  const db = { _products: products.map((p, i) => ({ id: `p${i}`, status: p.status, ...p })), _inserted: [], _events: [] };
  db.prepare = function (sql) {
    return {
      _b: [],
      bind(...a) { this._b = a; return this; },
      async first() {
        if (sql.includes("COUNT(*) as n FROM products")) {
          const n = db._products.filter(p => p.status !== 'archived').length;
          return { n };
        }
        if (sql.includes('SELECT * FROM products WHERE public_slug = ? AND tenant_id = ?')) {
          const [slug] = this._b;
          return db._products.find(p => p.public_slug === slug) ?? null;
        }
        throw new Error('unexpected first(): ' + sql);
      },
      async all() {
        // product_documents / product_translations lookups during update → empty
        if (sql.includes('FROM product_documents') || sql.includes('FROM product_translations')) return { results: [] };
        throw new Error('unexpected all(): ' + sql);
      },
      async run() {
        if (sql.startsWith('INSERT INTO products')) { db._inserted.push(this._b); db._products.push({ status: 'draft' }); return { success: true }; }
        if (sql.startsWith('INSERT INTO product_events')) { db._events.push(this._b); return { success: true }; }
        if (sql.startsWith('UPDATE products')) { db._updated = this._b; return { success: true }; }
        if (sql.startsWith('INSERT INTO product_translations')) return { success: true };
        throw new Error('unexpected run(): ' + sql);
      },
    };
  };
  return db;
}

const ctxFor = (tenant) => ({ tenant: { id: 'tenant_A', ...tenant }, userId: 'user_1' });
const trialTenant = (over = {}) => ctxFor({ plan: 'free', product_limit: 25, ...over });
const paidTenant = (over = {}) => ctxFor({ plan: 'starter', product_limit: 25, ...over });
const req = (body = { product_name: 'Testi' }) => ({ async json() { return body; }, url: 'https://x/api/tenant/product' });

// ── Pure helper ───────────────────────────────────────────────────────────────

test('constants: trial plan is free, limit is 1', () => {
  assert.equal(TRIAL_PLAN, 'free');
  assert.equal(TRIAL_PRODUCT_LIMIT, 1);
});

test('trialProductLimitExceeded: free plan blocked at 1, paid never blocked here', () => {
  assert.equal(trialProductLimitExceeded({ plan: 'free' }, 0), false);
  assert.equal(trialProductLimitExceeded({ plan: 'free' }, 1), true);
  assert.equal(trialProductLimitExceeded({ plan: 'free' }, 5), true);
  assert.equal(trialProductLimitExceeded({ plan: 'starter' }, 1), false);
  assert.equal(trialProductLimitExceeded({ plan: 'pro' }, 50), false);
});

// ── Create: trial ─────────────────────────────────────────────────────────────

test('trial tenant with 0 products can create the first product', async () => {
  const db = mockDb({ products: [] });
  const res = await createProductForTenant(req(), { DB: db }, trialTenant());
  assert.equal(res.status, 201);
  assert.equal(db._inserted.length, 1);
});

test('trial tenant with 1 counted product cannot create a second', async () => {
  const db = mockDb({ products: [{ status: 'active' }] });
  const res = await createProductForTenant(req(), { DB: db }, trialTenant());
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error, 'trial_product_limit_reached');
  assert.equal(db._inserted.length, 0);
});

test('a draft product counts toward the trial limit', async () => {
  const db = mockDb({ products: [{ status: 'draft' }] });
  const res = await createProductForTenant(req(), { DB: db }, trialTenant());
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error, 'trial_product_limit_reached');
});

test('a published (active) product counts toward the trial limit', async () => {
  const db = mockDb({ products: [{ status: 'active' }] });
  const res = await createProductForTenant(req(), { DB: db }, trialTenant());
  assert.equal(res.status, 403);
});

test('an archived product does NOT count — trial slot is freed', async () => {
  const db = mockDb({ products: [{ status: 'archived' }] });
  const res = await createProductForTenant(req(), { DB: db }, trialTenant());
  assert.equal(res.status, 201);
  assert.equal(db._inserted.length, 1);
});

// ── Create: paid keeps existing behaviour ─────────────────────────────────────

test('paid tenant may create additional products beyond one', async () => {
  const db = mockDb({ products: [{ status: 'active' }, { status: 'active' }] });
  const res = await createProductForTenant(req(), { DB: db }, paidTenant());
  assert.equal(res.status, 201);
});

test('paid tenant is still bounded by its own product_limit (generic error)', async () => {
  const db = mockDb({ products: Array.from({ length: 25 }, () => ({ status: 'active' })) });
  const res = await createProductForTenant(req(), { DB: db }, paidTenant({ product_limit: 25 }));
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error, 'product_limit_reached');
});

// ── Spoofing ──────────────────────────────────────────────────────────────────

test('spoofing plan/tenant_id in the body cannot bypass the trial limit', async () => {
  const db = mockDb({ products: [{ status: 'active' }] });
  // Body claims a paid plan and a different tenant — both ignored; ctx wins.
  const body = { product_name: 'X', plan: 'enterprise', tenant_id: 'tenant_OTHER', product_limit: 9999 };
  const res = await createProductForTenant(req(body), { DB: db }, trialTenant());
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error, 'trial_product_limit_reached');
});

// ── Update: editing/publishing remain allowed after the limit ─────────────────

test('trial tenant at the limit can still edit its existing product', async () => {
  const db = mockDb({ products: [{ status: 'active', public_slug: 'slug1', id: 'p0', translations_json: '{}', visibility_json: '{}', compliance_documents_json: '[]' }] });
  const res = await updateProductForTenant(req({ product_name: 'Uusi nimi' }), { DB: db }, 'slug1', trialTenant());
  assert.equal(res.status, 200);
});

test('trial tenant at the limit can still publish its existing product', async () => {
  const db = mockDb({ products: [{ status: 'draft', published_at: null, public_slug: 'slug1', id: 'p0', translations_json: '{}', visibility_json: '{}', compliance_documents_json: '[]' }] });
  const res = await updateProductForTenant(req({ status: 'active' }), { DB: db }, 'slug1', trialTenant());
  assert.equal(res.status, 200);
});
