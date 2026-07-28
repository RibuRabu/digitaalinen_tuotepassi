// Programmed NFC tag orders (Phase 6).
//
// Customer endpoints (tenant, Clerk JWT + membership):
//   POST /api/tenant/product/:slug/nfc-orders   create an order for a product
//   GET  /api/tenant/product/:slug/nfc-orders   list this product's orders (own tenant only)
//
// Platform admin endpoints (Clerk JWT + platform_users):
//   GET  /api/admin/nfc-orders                  list/fulfilment queue
//   GET  /api/admin/nfc-orders/:id              order detail (includes admin_note)
//   POST /api/admin/nfc-orders/:id/status       advance status (validated transitions)
//
// Security invariants:
//   * tenant_id / product_id are ALWAYS server-derived. The client never supplies them.
//   * The product is resolved by (public_slug, tenant_id); a slug that belongs to
//     another tenant yields 404, so cross-tenant ordering is impossible.
//   * The programming target (public URL) is derived from the request origin +
//     '/p/{public_slug}', never from client input, and snapshotted at order time.
//   * The customer response never exposes admin_note.

import { json, newId } from '../utils.js';
import { verifyClerkJWT, extractBearerToken, getTenantContext, getPlatformContext } from '../auth/clerk.js';

// ── Domain constants ──────────────────────────────────────────────────────────

// Real, self-describing product types. 'mini' and 'standard' are the two SKUs a
// customer can order today; 'on_metal' (Metallitunniste) is accepted for future
// orders and historical rows. Unknown values are rejected. (Phase 7.5 replaced the
// earlier fake mapping where 'on_metal' stood in for the Mini product.)
export const NFC_TAG_TYPES = ['mini', 'standard', 'on_metal'];
export const NFC_STATUSES = ['new', 'confirmed', 'processing', 'programmed', 'shipped', 'cancelled'];
export const NFC_QUANTITY_MIN = 1;
export const NFC_QUANTITY_MAX = 10000;

// Free-text length caps (defensive; keeps rows bounded and predictable).
const MAX_LEN = {
  recipient_name: 200,
  company_name: 200,
  address_line: 300,
  postal_code: 20,
  city: 120,
  country_code: 2,
  customer_note: 2000,
  admin_note: 2000,
  tracking_code: 120,
  tracking_url: 500,
};

// Allowed forward transitions. Terminal states (shipped, cancelled) allow none,
// which is what prevents e.g. cancelled -> shipped. Every non-terminal state may
// be cancelled. Progression is forward-only (no going back to an earlier stage).
export const NFC_STATUS_TRANSITIONS = {
  new:        ['confirmed', 'processing', 'programmed', 'shipped', 'cancelled'],
  confirmed:  ['processing', 'programmed', 'shipped', 'cancelled'],
  processing: ['programmed', 'shipped', 'cancelled'],
  programmed: ['shipped', 'cancelled'],
  shipped:    [],
  cancelled:  [],
};

export function canTransition(from, to) {
  if (!NFC_STATUSES.includes(to)) return false;
  return (NFC_STATUS_TRANSITIONS[from] || []).includes(to);
}

// ── Validation ────────────────────────────────────────────────────────────────

// Validate + normalise a create-order body. Returns { value } or { error }.
// Pure (no I/O) so it is unit-testable in isolation.
export function validateNfcOrderInput(body) {
  if (!body || typeof body !== 'object') return { error: 'invalid_json' };

  const tagType = body.tag_type ?? 'standard';
  if (!NFC_TAG_TYPES.includes(tagType)) return { error: 'invalid_tag_type' };

  const quantity = Number(body.quantity);
  if (!Number.isInteger(quantity) || quantity < NFC_QUANTITY_MIN || quantity > NFC_QUANTITY_MAX) {
    return { error: 'invalid_quantity' };
  }

  const str = (v) => (v == null ? '' : String(v).trim());

  const recipientName = str(body.recipient_name);
  const addressLine = str(body.address_line);
  const postalCode = str(body.postal_code);
  const city = str(body.city);
  const countryCode = str(body.country_code).toUpperCase();
  const companyName = str(body.company_name);
  const customerNote = str(body.customer_note);

  if (!recipientName) return { error: 'recipient_name_required' };
  if (!addressLine) return { error: 'address_line_required' };
  if (!postalCode) return { error: 'postal_code_required' };
  if (!city) return { error: 'city_required' };
  if (!/^[A-Z]{2}$/.test(countryCode)) return { error: 'invalid_country_code' };

  const fields = { recipient_name: recipientName, company_name: companyName, address_line: addressLine,
    postal_code: postalCode, city, country_code: countryCode, customer_note: customerNote };
  for (const [k, v] of Object.entries(fields)) {
    if (v.length > MAX_LEN[k]) return { error: `${k}_too_long` };
  }

  return {
    value: {
      tag_type: tagType,
      quantity,
      recipient_name: recipientName,
      company_name: companyName || null,
      address_line: addressLine,
      postal_code: postalCode,
      city,
      country_code: countryCode,
      customer_note: customerNote || null,
    },
  };
}

// ── Order number generation ───────────────────────────────────────────────────

// Human-readable, unique, D1-safe: NFC-YYYY-000001. Sequence is per-calendar-year,
// derived from the current max for the year, with a UNIQUE-constraint retry loop so
// concurrent inserts cannot collide.
function formatOrderNumber(year, seq) {
  return `NFC-${year}-${String(seq).padStart(6, '0')}`;
}

async function nextOrderSeq(env, year) {
  const prefix = `NFC-${year}-`;
  const row = await env.DB.prepare(
    "SELECT order_number FROM nfc_orders WHERE order_number LIKE ? ORDER BY order_number DESC LIMIT 1"
  ).bind(`${prefix}%`).first();
  if (!row) return 1;
  const suffix = parseInt(String(row.order_number).slice(prefix.length), 10);
  return Number.isFinite(suffix) ? suffix + 1 : 1;
}

// ── Fulfilment target derivation ──────────────────────────────────────────────

// The public passport URL the tag will be programmed to open. Derived from the
// request origin (the Worker's own host that serves /p/{slug}) — never from client
// input — so the tag always points at the canonical public passport.
export function programmingUrlFor(request, publicSlug) {
  const origin = new URL(request.url).origin;
  return `${origin}/p/${publicSlug}`;
}

// Shape returned to a customer. Never includes admin_note.
export function customerOrderView(row) {
  return {
    id: row.id,
    order_number: row.order_number,
    product_id: row.product_id,
    public_slug: row.public_slug_snapshot,
    programming_url: row.programming_url_snapshot,
    tag_type: row.tag_type,
    quantity: row.quantity,
    status: row.status,
    recipient_name: row.recipient_name,
    company_name: row.company_name,
    address_line: row.address_line,
    postal_code: row.postal_code,
    city: row.city,
    country_code: row.country_code,
    customer_note: row.customer_note,
    tracking_code: row.tracking_code,
    tracking_url: row.tracking_url,
    created_at: row.created_at,
    updated_at: row.updated_at,
    confirmed_at: row.confirmed_at,
    programmed_at: row.programmed_at,
    shipped_at: row.shipped_at,
    cancelled_at: row.cancelled_at,
  };
}

// ── Tenant auth (mirrors src/routes/tenant.js requireTenant) ──────────────────

async function requireTenant(request, env) {
  const token = extractBearerToken(request);
  const payload = await verifyClerkJWT(token, env);
  if (!payload) return { error: 'unauthorized', status: 401 };

  const orgId = payload.org_id || request.headers.get('X-Organization-Id') || null;
  if (!orgId) return { error: 'no_active_organization', status: 403 };

  const ctx = await getTenantContext({ ...payload, org_id: orgId }, env);
  if (!ctx) return { error: 'tenant_not_found', status: 403 };
  if (ctx.error) return ctx;
  return ctx;
}

async function requirePlatformAdmin(request, env) {
  const token = extractBearerToken(request);
  const payload = await verifyClerkJWT(token, env);
  return getPlatformContext(payload, env);
}

// ── Customer handlers ─────────────────────────────────────────────────────────

// POST /api/tenant/product/:slug/nfc-orders
export async function handleCreateNfcOrder(request, env, slug) {
  const ctx = await requireTenant(request, env);
  if (ctx.error) return json({ error: ctx.error }, ctx.status);
  return createNfcOrderForTenant(request, env, slug, ctx);
}

// Post-auth create logic (exported for unit testing). ctx is a verified tenant
// context { tenant: { id }, userId }. The client body is NEVER trusted for
// tenant_id/product_id/URL — all are derived here.
export async function createNfcOrderForTenant(request, env, slug, ctx) {
  // Product ownership: resolve by (public_slug, tenant_id). A slug belonging to
  // another tenant simply does not match -> 404. tenant_id/product_id come from here.
  const product = await env.DB.prepare(
    'SELECT id, public_slug, status FROM products WHERE public_slug = ? AND tenant_id = ?'
  ).bind(slug, ctx.tenant.id).first();
  if (!product) return json({ error: 'not_found' }, 404);

  // Archived products have no usable public passport — refuse to create a dead order.
  if (product.status === 'archived') return json({ error: 'product_archived' }, 409);

  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'invalid_json' }, 400); }

  const parsed = validateNfcOrderInput(body);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const v = parsed.value;

  const programmingUrl = programmingUrlFor(request, product.public_slug);
  const year = new Date().getUTCFullYear();

  // Insert with a small retry loop to stay collision-safe under concurrency.
  let created = null;
  let lastErr = null;
  for (let attempt = 0; attempt < 5 && !created; attempt++) {
    const seq = (await nextOrderSeq(env, year)) + attempt;
    const orderNumber = formatOrderNumber(year, seq);
    const id = newId();
    try {
      await env.DB.prepare(
        `INSERT INTO nfc_orders
           (id, order_number, tenant_id, product_id, public_slug_snapshot, programming_url_snapshot,
            tag_type, quantity, status, recipient_name, company_name, address_line, postal_code,
            city, country_code, customer_note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        id, orderNumber, ctx.tenant.id, product.id, product.public_slug, programmingUrl,
        v.tag_type, v.quantity, v.recipient_name, v.company_name, v.address_line, v.postal_code,
        v.city, v.country_code, v.customer_note
      ).run();
      created = await env.DB.prepare('SELECT * FROM nfc_orders WHERE id = ?').bind(id).first();
    } catch (e) {
      // UNIQUE(order_number) race — recompute and retry.
      lastErr = e;
      if (!String(e?.message || e).toUpperCase().includes('UNIQUE')) throw e;
    }
  }
  if (!created) throw lastErr || new Error('order_number_generation_failed');

  await env.DB.prepare(
    "INSERT INTO product_events (id, product_id, event_type, event_data_json, actor_type) VALUES (?, ?, 'nfc_order_created', ?, 'tenant')"
  ).bind(newId(), product.id, JSON.stringify({ order_number: created.order_number, quantity: v.quantity, by: ctx.userId })).run();

  return json({ order: customerOrderView(created), product_unpublished: product.status !== 'active' }, 201);
}

// GET /api/tenant/product/:slug/nfc-orders
export async function handleListNfcOrders(request, env, slug) {
  const ctx = await requireTenant(request, env);
  if (ctx.error) return json({ error: ctx.error }, ctx.status);
  return listNfcOrdersForTenant(env, slug, ctx);
}

// Post-auth list logic (exported for unit testing). Scoped by BOTH tenant_id and
// product_id.
export async function listNfcOrdersForTenant(env, slug, ctx) {
  const product = await env.DB.prepare(
    'SELECT id FROM products WHERE public_slug = ? AND tenant_id = ?'
  ).bind(slug, ctx.tenant.id).first();
  if (!product) return json({ error: 'not_found' }, 404);

  // Scope by BOTH tenant_id and product_id — defence in depth.
  const { results } = await env.DB.prepare(
    'SELECT * FROM nfc_orders WHERE tenant_id = ? AND product_id = ? ORDER BY created_at DESC'
  ).bind(ctx.tenant.id, product.id).all();

  return json({ orders: results.map(customerOrderView) });
}

// ── Platform admin handlers ───────────────────────────────────────────────────

// GET /api/admin/nfc-orders
export async function handleAdminListNfcOrders(request, env) {
  const admin = await requirePlatformAdmin(request, env);
  if (!admin) return json({ error: 'unauthorized' }, 401);

  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10), 200);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);
  const status = url.searchParams.get('status');

  let sql = `SELECT o.*, t.name AS tenant_name, p.product_name AS product_name
             FROM nfc_orders o
             LEFT JOIN tenants t ON t.id = o.tenant_id
             LEFT JOIN products p ON p.id = o.product_id`;
  const binds = [];
  if (status && NFC_STATUSES.includes(status)) { sql += ' WHERE o.status = ?'; binds.push(status); }
  sql += ' ORDER BY o.created_at DESC LIMIT ? OFFSET ?';
  binds.push(limit, offset);

  const { results } = await env.DB.prepare(sql).bind(...binds).all();
  return json({ orders: results, limit, offset });
}

// GET /api/admin/nfc-orders/:id
export async function handleAdminGetNfcOrder(request, env, id) {
  const admin = await requirePlatformAdmin(request, env);
  if (!admin) return json({ error: 'unauthorized' }, 401);

  const order = await env.DB.prepare(
    `SELECT o.*, t.name AS tenant_name, p.product_name AS product_name, p.status AS product_status
     FROM nfc_orders o
     LEFT JOIN tenants t ON t.id = o.tenant_id
     LEFT JOIN products p ON p.id = o.product_id
     WHERE o.id = ?`
  ).bind(id).first();
  if (!order) return json({ error: 'not_found' }, 404);
  return json({ order });
}

// POST /api/admin/nfc-orders/:id/status
export async function handleAdminUpdateNfcOrderStatus(request, env, id) {
  const admin = await requirePlatformAdmin(request, env);
  if (!admin) return json({ error: 'unauthorized' }, 401);

  const order = await env.DB.prepare('SELECT * FROM nfc_orders WHERE id = ?').bind(id).first();
  if (!order) return json({ error: 'not_found' }, 404);

  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'invalid_json' }, 400); }

  const to = body.status;
  if (!NFC_STATUSES.includes(to)) return json({ error: 'invalid_status' }, 400);
  if (!canTransition(order.status, to)) {
    return json({ error: 'invalid_transition', from: order.status, to }, 409);
  }

  const updates = { status: to };

  // Timestamp the transition into a lifecycle state (only stamp once).
  const stamp = { confirmed: 'confirmed_at', programmed: 'programmed_at', shipped: 'shipped_at', cancelled: 'cancelled_at' }[to];
  if (stamp && !order[stamp]) updates[stamp] = null; // placeholder; set via datetime('now') below

  // Tracking is allowed (and only meaningful) when marking shipped.
  if (to === 'shipped') {
    if ('tracking_code' in body) {
      const tc = body.tracking_code == null ? null : String(body.tracking_code).trim();
      if (tc && tc.length > MAX_LEN.tracking_code) return json({ error: 'tracking_code_too_long' }, 400);
      updates.tracking_code = tc || null;
    }
    if ('tracking_url' in body) {
      const tu = body.tracking_url == null ? null : String(body.tracking_url).trim();
      if (tu && tu.length > MAX_LEN.tracking_url) return json({ error: 'tracking_url_too_long' }, 400);
      updates.tracking_url = tu || null;
    }
  }

  if ('admin_note' in body) {
    const an = body.admin_note == null ? null : String(body.admin_note).trim();
    if (an && an.length > MAX_LEN.admin_note) return json({ error: 'admin_note_too_long' }, 400);
    updates.admin_note = an || null;
  }

  // Build SET clause. Timestamp columns use datetime('now'); others are bound.
  const setParts = [];
  const binds = [];
  for (const [k, val] of Object.entries(updates)) {
    if (val === null && ['confirmed_at', 'programmed_at', 'shipped_at', 'cancelled_at'].includes(k)) {
      setParts.push(`${k} = datetime('now')`);
    } else {
      setParts.push(`${k} = ?`);
      binds.push(val);
    }
  }
  setParts.push("updated_at = datetime('now')");
  binds.push(id);

  await env.DB.prepare(`UPDATE nfc_orders SET ${setParts.join(', ')} WHERE id = ?`).bind(...binds).run();

  await env.DB.prepare(
    "INSERT INTO product_events (id, product_id, event_type, event_data_json, actor_type) VALUES (?, ?, 'nfc_order_status', ?, 'platform_admin')"
  ).bind(newId(), order.product_id, JSON.stringify({ order_number: order.order_number, from: order.status, to, by: admin.clerk_user_id })).run();

  const updated = await env.DB.prepare('SELECT * FROM nfc_orders WHERE id = ?').bind(id).first();
  return json({ order: updated });
}
