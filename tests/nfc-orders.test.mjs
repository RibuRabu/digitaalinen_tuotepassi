// Tests for programmed NFC tag orders (Phase 6).
// Run: node --test tests/nfc-orders.test.mjs
// Pure logic + post-auth handler logic exercised against an in-memory env.DB mock.
// No network, no real Clerk — synthetic tenants/products/orders only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateNfcOrderInput, canTransition, NFC_STATUS_TRANSITIONS, NFC_STATUSES,
  programmingUrlFor, customerOrderView,
  createNfcOrderForTenant, listNfcOrdersForTenant,
} from '../src/routes/nfc.js';

// ── A minimal in-memory D1 mock ───────────────────────────────────────────────
// Implements exactly the queries nfc.js runs. Tables are plain arrays.
function mockDb({ products = [], orders = [] } = {}) {
  const db = { _products: products, _orders: orders, _events: [] };
  db.prepare = function (sql) {
    return {
      _b: [],
      bind(...a) { this._b = a; return this; },
      async first() {
        if (sql.includes('FROM products WHERE public_slug = ? AND tenant_id = ?')) {
          const [slug, tenantId] = this._b;
          return db._products.find(p => p.public_slug === slug && p.tenant_id === tenantId) ?? null;
        }
        if (sql.includes('FROM nfc_orders WHERE order_number LIKE ?')) {
          const [likePrefix] = this._b;
          const prefix = likePrefix.replace(/%$/, '');
          const matches = db._orders
            .filter(o => o.order_number.startsWith(prefix))
            .sort((a, b) => (a.order_number < b.order_number ? 1 : -1));
          return matches[0] ?? null;
        }
        if (sql.includes('SELECT * FROM nfc_orders WHERE id = ?')) {
          const [id] = this._b;
          return db._orders.find(o => o.id === id) ?? null;
        }
        throw new Error('unexpected first() query: ' + sql);
      },
      async all() {
        if (sql.includes('FROM nfc_orders WHERE tenant_id = ? AND product_id = ?')) {
          const [tenantId, productId] = this._b;
          const results = db._orders
            .filter(o => o.tenant_id === tenantId && o.product_id === productId)
            .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
          return { results };
        }
        throw new Error('unexpected all() query: ' + sql);
      },
      async run() {
        if (sql.startsWith('INSERT INTO nfc_orders')) {
          const b = this._b;
          const row = {
            id: b[0], order_number: b[1], tenant_id: b[2], product_id: b[3],
            public_slug_snapshot: b[4], programming_url_snapshot: b[5],
            tag_type: b[6], quantity: b[7], status: 'new',
            recipient_name: b[8], company_name: b[9], address_line: b[10],
            postal_code: b[11], city: b[12], country_code: b[13], customer_note: b[14],
            admin_note: null, tracking_code: null, tracking_url: null,
            created_at: '2026-07-28 00:00:00', updated_at: '2026-07-28 00:00:00',
            confirmed_at: null, programmed_at: null, shipped_at: null, cancelled_at: null,
          };
          if (db._orders.some(o => o.order_number === row.order_number)) {
            throw new Error('UNIQUE constraint failed: nfc_orders.order_number');
          }
          db._orders.push(row);
          return { success: true };
        }
        if (sql.startsWith('INSERT INTO product_events')) {
          db._events.push(this._b);
          return { success: true };
        }
        throw new Error('unexpected run() query: ' + sql);
      },
    };
  };
  return db;
}

const req = (url = 'https://api.digitaalinentuotepassi.tulkintatila.fi/api/tenant/product/slug1/nfc-orders', body = {}) => ({
  url,
  async json() { return body; },
});
const ctxFor = (tenantId, userId = 'user_1') => ({ tenant: { id: tenantId }, userId });

const validBody = {
  tag_type: 'standard', quantity: 50,
  recipient_name: 'Riikka Kallio', company_name: 'Liminall',
  address_line: 'Testikatu 1', postal_code: '00100', city: 'Helsinki', country_code: 'fi',
  customer_note: 'Kiitos',
};

// ── validateNfcOrderInput ─────────────────────────────────────────────────────

test('valid input normalises country code and trims', () => {
  const { value, error } = validateNfcOrderInput(validBody);
  assert.equal(error, undefined);
  assert.equal(value.country_code, 'FI');
  assert.equal(value.tag_type, 'standard');
  assert.equal(value.quantity, 50);
});

test('tag_type defaults to standard when omitted', () => {
  const { value } = validateNfcOrderInput({ ...validBody, tag_type: undefined });
  assert.equal(value.tag_type, 'standard');
});

test('rejects unknown tag_type', () => {
  assert.equal(validateNfcOrderInput({ ...validBody, tag_type: 'giant' }).error, 'invalid_tag_type');
});

test('accepts on_metal tag_type', () => {
  assert.equal(validateNfcOrderInput({ ...validBody, tag_type: 'on_metal' }).value.tag_type, 'on_metal');
});

test('rejects quantity below 1, above max, and non-integer', () => {
  assert.equal(validateNfcOrderInput({ ...validBody, quantity: 0 }).error, 'invalid_quantity');
  assert.equal(validateNfcOrderInput({ ...validBody, quantity: 10001 }).error, 'invalid_quantity');
  assert.equal(validateNfcOrderInput({ ...validBody, quantity: 2.5 }).error, 'invalid_quantity');
  assert.equal(validateNfcOrderInput({ ...validBody, quantity: 'x' }).error, 'invalid_quantity');
});

test('requires recipient/address/postal/city', () => {
  assert.equal(validateNfcOrderInput({ ...validBody, recipient_name: '  ' }).error, 'recipient_name_required');
  assert.equal(validateNfcOrderInput({ ...validBody, address_line: '' }).error, 'address_line_required');
  assert.equal(validateNfcOrderInput({ ...validBody, postal_code: '' }).error, 'postal_code_required');
  assert.equal(validateNfcOrderInput({ ...validBody, city: '' }).error, 'city_required');
});

test('rejects malformed country_code', () => {
  assert.equal(validateNfcOrderInput({ ...validBody, country_code: 'FIN' }).error, 'invalid_country_code');
  assert.equal(validateNfcOrderInput({ ...validBody, country_code: '1' }).error, 'invalid_country_code');
});

test('rejects over-long free text', () => {
  assert.equal(validateNfcOrderInput({ ...validBody, customer_note: 'x'.repeat(2001) }).error, 'customer_note_too_long');
});

test('company_name and customer_note are optional -> null', () => {
  const { value } = validateNfcOrderInput({ ...validBody, company_name: '', customer_note: '' });
  assert.equal(value.company_name, null);
  assert.equal(value.customer_note, null);
});

// ── Status transitions ────────────────────────────────────────────────────────

test('forward transitions are allowed', () => {
  assert.ok(canTransition('new', 'confirmed'));
  assert.ok(canTransition('confirmed', 'processing'));
  assert.ok(canTransition('processing', 'programmed'));
  assert.ok(canTransition('programmed', 'shipped'));
});

test('any non-terminal status can be cancelled', () => {
  for (const s of ['new', 'confirmed', 'processing', 'programmed']) {
    assert.ok(canTransition(s, 'cancelled'), `${s} -> cancelled`);
  }
});

test('terminal states allow no further transitions', () => {
  assert.deepEqual(NFC_STATUS_TRANSITIONS.shipped, []);
  assert.deepEqual(NFC_STATUS_TRANSITIONS.cancelled, []);
  assert.equal(canTransition('shipped', 'programmed'), false);
});

test('cancelled -> shipped is forbidden (the core guard)', () => {
  assert.equal(canTransition('cancelled', 'shipped'), false);
});

test('backward transitions are forbidden', () => {
  assert.equal(canTransition('programmed', 'processing'), false);
  assert.equal(canTransition('shipped', 'new'), false);
});

test('unknown target status is forbidden', () => {
  assert.equal(canTransition('new', 'delivered'), false);
});

test('all statuses appear in the transition map', () => {
  for (const s of NFC_STATUSES) assert.ok(s in NFC_STATUS_TRANSITIONS, s);
});

// ── programmingUrlFor ─────────────────────────────────────────────────────────

test('programming URL derives from the request origin, not client input', () => {
  const url = programmingUrlFor({ url: 'https://api.digitaalinentuotepassi.tulkintatila.fi/api/tenant/product/abc/nfc-orders' }, 'abc123');
  assert.equal(url, 'https://api.digitaalinentuotepassi.tulkintatila.fi/p/abc123');
});

// ── customerOrderView never leaks admin_note ──────────────────────────────────

test('customer view excludes admin_note', () => {
  const view = customerOrderView({
    id: 'o1', order_number: 'NFC-2026-000001', product_id: 'p1',
    public_slug_snapshot: 'slug1', programming_url_snapshot: 'https://x/p/slug1',
    tag_type: 'standard', quantity: 10, status: 'new',
    recipient_name: 'R', company_name: null, address_line: 'A', postal_code: '1', city: 'H', country_code: 'FI',
    customer_note: null, admin_note: 'INTERNAL — do not disclose', tracking_code: null, tracking_url: null,
    created_at: 't', updated_at: 't', confirmed_at: null, programmed_at: null, shipped_at: null, cancelled_at: null,
  });
  assert.equal('admin_note' in view, false);
  assert.equal(view.public_slug, 'slug1');
});

// ── Post-auth create/list: server-derived identity + cross-tenant isolation ───

const PRODUCTS = [
  { id: 'prod_A', public_slug: 'slug-A', tenant_id: 'tenant_A', status: 'active' },
  { id: 'prod_B', public_slug: 'slug-B', tenant_id: 'tenant_B', status: 'active' },
  { id: 'prod_draft', public_slug: 'slug-draft', tenant_id: 'tenant_A', status: 'draft' },
  { id: 'prod_arch', public_slug: 'slug-arch', tenant_id: 'tenant_A', status: 'archived' },
];

test('create derives tenant_id/product_id/URL server-side and ignores client-supplied tenant_id', async () => {
  const db = mockDb({ products: structuredClone(PRODUCTS) });
  const env = { DB: db };
  // Client tries to spoof tenant_id and product_id in the body — must be ignored.
  const body = { ...validBody, tenant_id: 'tenant_B', product_id: 'prod_B', programming_url: 'https://evil/p/x' };
  const res = await createNfcOrderForTenant(req(undefined, body), env, 'slug-A', ctxFor('tenant_A'));
  assert.equal(res.status, 201);
  const json = await res.json();
  assert.equal(json.order.product_id, 'prod_A');           // from (slug, tenant) lookup, not body
  assert.equal(json.order.public_slug, 'slug-A');
  assert.equal(json.order.programming_url, 'https://api.digitaalinentuotepassi.tulkintatila.fi/p/slug-A');
  assert.equal(json.order.order_number, 'NFC-2026-000001');
  assert.equal(db._orders[0].tenant_id, 'tenant_A');        // stored tenant is the authed one
  assert.equal('admin_note' in json.order, false);
});

test('cross-tenant slug is not found (member of A ordering B\'s product)', async () => {
  const db = mockDb({ products: structuredClone(PRODUCTS) });
  const res = await createNfcOrderForTenant(req(undefined, validBody), { DB: db }, 'slug-B', ctxFor('tenant_A'));
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, 'not_found');
  assert.equal(db._orders.length, 0);
});

test('archived product cannot be ordered', async () => {
  const db = mockDb({ products: structuredClone(PRODUCTS) });
  const res = await createNfcOrderForTenant(req(undefined, validBody), { DB: db }, 'slug-arch', ctxFor('tenant_A'));
  assert.equal(res.status, 409);
  assert.equal((await res.json()).error, 'product_archived');
});

test('draft product is orderable but flagged unpublished', async () => {
  const db = mockDb({ products: structuredClone(PRODUCTS) });
  const res = await createNfcOrderForTenant(req(undefined, validBody), { DB: db }, 'slug-draft', ctxFor('tenant_A'));
  assert.equal(res.status, 201);
  assert.equal((await res.json()).product_unpublished, true);
});

test('order numbers increment per year and stay collision-safe', async () => {
  const db = mockDb({ products: structuredClone(PRODUCTS) });
  const env = { DB: db };
  const r1 = await (await createNfcOrderForTenant(req(undefined, validBody), env, 'slug-A', ctxFor('tenant_A'))).json();
  const r2 = await (await createNfcOrderForTenant(req(undefined, validBody), env, 'slug-A', ctxFor('tenant_A'))).json();
  assert.equal(r1.order.order_number, 'NFC-2026-000001');
  assert.equal(r2.order.order_number, 'NFC-2026-000002');
});

test('list is scoped to the tenant AND product', async () => {
  const orders = [
    { id: 'o1', order_number: 'NFC-2026-000001', tenant_id: 'tenant_A', product_id: 'prod_A', public_slug_snapshot: 'slug-A', programming_url_snapshot: 'u', tag_type: 'standard', quantity: 1, status: 'new', recipient_name: 'R', company_name: null, address_line: 'A', postal_code: '1', city: 'H', country_code: 'FI', customer_note: null, admin_note: 'secret', tracking_code: null, tracking_url: null, created_at: '2026-07-28 01:00:00', updated_at: 't', confirmed_at: null, programmed_at: null, shipped_at: null, cancelled_at: null },
    { id: 'o2', order_number: 'NFC-2026-000002', tenant_id: 'tenant_B', product_id: 'prod_B', public_slug_snapshot: 'slug-B', programming_url_snapshot: 'u', tag_type: 'standard', quantity: 1, status: 'new', recipient_name: 'R', company_name: null, address_line: 'A', postal_code: '1', city: 'H', country_code: 'FI', customer_note: null, admin_note: null, tracking_code: null, tracking_url: null, created_at: '2026-07-28 02:00:00', updated_at: 't', confirmed_at: null, programmed_at: null, shipped_at: null, cancelled_at: null },
  ];
  const db = mockDb({ products: structuredClone(PRODUCTS), orders });
  const res = await listNfcOrdersForTenant({ DB: db }, 'slug-A', ctxFor('tenant_A'));
  const json = await res.json();
  assert.equal(json.orders.length, 1);
  assert.equal(json.orders[0].id, 'o1');
  assert.equal('admin_note' in json.orders[0], false); // customer list also strips admin_note
});
