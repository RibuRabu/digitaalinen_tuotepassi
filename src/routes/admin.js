import {
  json, newId, newSlug, requireAdmin,
  TEXT_FIELDS, DATA_CARRIER_TYPES, IDENTIFIER_LEVELS, DEFAULT_CONSUMER_VISIBILITY,
} from '../utils.js';
import { verifyClerkJWT, extractBearerToken, getPlatformContext } from '../auth/clerk.js';

// ── Shared product creation logic (used by legacy admin and tenant routes) ────

export function buildCreateProductColumns() {
  return [
    'id', 'public_slug', 'owner_token', 'product_uid', 'passport_uid',
    'data_carrier_type', 'data_carrier_url', 'identifier_level',
    'product_name', 'brand_name', 'manufacturer_name', 'manufacturer_email', 'manufacturer_address',
    'responsible_operator_name', 'responsible_operator_email', 'responsible_operator_address',
    'sku', 'gtin', 'batch_number', 'serial_number', 'product_type',
    'materials_json', 'substances_json', 'safety_notes_json', 'care_instructions_json',
    'repair_instructions_json', 'recycling_instructions_json', 'compliance_documents_json',
    'languages_json', 'visibility_json', 'version', 'status',
    'customer_name', 'customer_email',
  ];
}

export function buildCreateProductValues(body, id, slug, token, productUid, passportUid) {
  const dataCarrierType = body.data_carrier_type || 'qr';
  const identifierLevel = body.identifier_level || 'model';
  return [
    id, slug, token, productUid, passportUid,
    dataCarrierType, `/p/${slug}`, identifierLevel,
    body.product_name.trim(),
    body.brand_name || null,
    body.manufacturer_name || null,
    body.manufacturer_email || null,
    body.manufacturer_address || null,
    body.responsible_operator_name || null,
    body.responsible_operator_email || null,
    body.responsible_operator_address || null,
    body.sku || null,
    body.gtin || null,
    body.batch_number || null,
    body.serial_number || null,
    body.product_type || null,
    JSON.stringify(Array.isArray(body.materials) ? body.materials : []),
    JSON.stringify(Array.isArray(body.substances) ? body.substances : []),
    JSON.stringify(Array.isArray(body.safety_notes) ? body.safety_notes : []),
    JSON.stringify(Array.isArray(body.care_instructions) ? body.care_instructions : []),
    JSON.stringify(Array.isArray(body.repair_instructions) ? body.repair_instructions : []),
    JSON.stringify(Array.isArray(body.recycling_instructions) ? body.recycling_instructions : []),
    JSON.stringify([]),
    JSON.stringify(Array.isArray(body.languages) ? body.languages : ['fi']),
    JSON.stringify({ consumer: DEFAULT_CONSUMER_VISIBILITY, authority: ['*'], operator: ['*'] }),
    1,
    'draft',
    body.customer_name || null,
    body.customer_email || null,
  ];
}

// ── Legacy admin routes (ADMIN_SECRET auth) ───────────────────────────────────

export async function handleGetAdminProduct(request, env, slug) {
  if (!requireAdmin(request, env)) return json({ error: 'unauthorized' }, 401);
  const product = await env.DB.prepare(
    'SELECT * FROM products WHERE public_slug = ?'
  ).bind(slug).first();
  if (!product) return json({ error: 'not_found' }, 404);
  return json(product);
}

export async function handleCreateProduct(request, env) {
  if (!requireAdmin(request, env)) return json({ error: 'unauthorized' }, 401);

  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'invalid_json' }, 400); }

  if (!body.product_name?.trim()) return json({ error: 'product_name_required' }, 400);
  if (body.identifier_level && !IDENTIFIER_LEVELS.includes(body.identifier_level))
    return json({ error: 'invalid_identifier_level' }, 400);
  if (body.data_carrier_type && !DATA_CARRIER_TYPES.includes(body.data_carrier_type))
    return json({ error: 'invalid_data_carrier_type' }, 400);

  const id = newId();
  const slug = newSlug();
  const token = newId();
  const productUid = crypto.randomUUID();
  const passportUid = crypto.randomUUID();

  const columns = buildCreateProductColumns();
  const values = buildCreateProductValues(body, id, slug, token, productUid, passportUid);

  await env.DB.prepare(
    `INSERT INTO products (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`
  ).bind(...values).run();

  await env.DB.prepare(
    "INSERT INTO product_events (id, product_id, event_type, event_data_json, actor_type) VALUES (?, ?, 'created', '{}', 'admin')"
  ).bind(newId(), id).run();

  return json({ slug, token, product_uid: productUid, passport_uid: passportUid }, 201);
}

export async function handleUpdateCarrier(request, env, slug) {
  if (!requireAdmin(request, env)) return json({ error: 'unauthorized' }, 401);

  const existing = await env.DB.prepare(
    'SELECT id FROM products WHERE public_slug = ?'
  ).bind(slug).first();
  if (!existing) return json({ error: 'not_found' }, 404);

  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'invalid_json' }, 400); }

  if (!DATA_CARRIER_TYPES.includes(body.data_carrier_type))
    return json({ error: 'invalid_data_carrier_type' }, 400);

  const dataCarrierUrl = typeof body.data_carrier_url === 'string' && body.data_carrier_url.trim()
    ? body.data_carrier_url.trim()
    : `/p/${slug}`;

  await env.DB.prepare(
    "UPDATE products SET data_carrier_type = ?, data_carrier_url = ?, version = version + 1, updated_at = datetime('now') WHERE public_slug = ?"
  ).bind(body.data_carrier_type, dataCarrierUrl, slug).run();

  await env.DB.prepare(
    "INSERT INTO product_events (id, product_id, event_type, event_data_json, actor_type) VALUES (?, ?, 'carrier_updated', ?, 'admin')"
  ).bind(newId(), existing.id, JSON.stringify({ data_carrier_type: body.data_carrier_type, data_carrier_url: dataCarrierUrl })).run();

  const updated = await env.DB.prepare(
    'SELECT * FROM products WHERE public_slug = ?'
  ).bind(slug).first();
  return json(updated);
}

// ── Platform admin routes (Clerk JWT auth) ────────────────────────────────────

async function requirePlatformAdmin(request, env) {
  const token = extractBearerToken(request);
  const payload = await verifyClerkJWT(token, env);
  const platformUser = await getPlatformContext(payload, env);
  return platformUser;
}

export async function handleListTenants(request, env) {
  const admin = await requirePlatformAdmin(request, env);
  if (!admin) return json({ error: 'unauthorized' }, 401);

  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);

  const { results } = await env.DB.prepare(
    `SELECT id, name, slug, plan, status, billing_status, product_limit, created_at
     FROM tenants ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).bind(limit, offset).all();

  return json({ tenants: results, limit, offset });
}

export async function handleGetTenant(request, env, tenantId) {
  const admin = await requirePlatformAdmin(request, env);
  if (!admin) return json({ error: 'unauthorized' }, 401);

  const tenant = await env.DB.prepare(
    'SELECT * FROM tenants WHERE id = ?'
  ).bind(tenantId).first();
  if (!tenant) return json({ error: 'not_found' }, 404);

  const { results: products } = await env.DB.prepare(
    `SELECT id, public_slug, product_name, status, version, created_at, owner_token
     FROM products WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 100`
  ).bind(tenantId).all();

  const { results: users } = await env.DB.prepare(
    'SELECT id, clerk_user_id, role, joined_at FROM tenant_users WHERE tenant_id = ?'
  ).bind(tenantId).all();

  return json({ tenant, products, users });
}

export async function handleListUnclaimedProducts(request, env) {
  const admin = await requirePlatformAdmin(request, env);
  if (!admin) return json({ error: 'unauthorized' }, 401);

  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);
  const email = url.searchParams.get('customer_email') || null;

  let sql = `SELECT id, public_slug, product_uid, product_name, status, customer_name, customer_email, created_at
             FROM products WHERE tenant_id IS NULL`;
  const binds = [];
  if (email) { sql += ' AND customer_email = ?'; binds.push(email); }
  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  binds.push(limit, offset);

  const { results } = await env.DB.prepare(sql).bind(...binds).all();
  return json({ products: results, limit, offset });
}

export async function handleAdminClaimProduct(request, env, tenantId, slug) {
  const admin = await requirePlatformAdmin(request, env);
  if (!admin) return json({ error: 'unauthorized' }, 401);

  const tenant = await env.DB.prepare(
    'SELECT id FROM tenants WHERE id = ?'
  ).bind(tenantId).first();
  if (!tenant) return json({ error: 'tenant_not_found' }, 404);

  const product = await env.DB.prepare(
    'SELECT id, tenant_id FROM products WHERE public_slug = ?'
  ).bind(slug).first();
  if (!product) return json({ error: 'product_not_found' }, 404);
  if (product.tenant_id) return json({ error: 'already_claimed', tenant_id: product.tenant_id }, 409);

  await env.DB.prepare(
    "UPDATE products SET tenant_id = ?, updated_at = datetime('now') WHERE public_slug = ?"
  ).bind(tenantId, slug).run();

  await env.DB.prepare(
    "INSERT INTO product_events (id, product_id, event_type, event_data_json, actor_type) VALUES (?, ?, 'claimed', ?, 'platform_admin')"
  ).bind(newId(), product.id, JSON.stringify({ tenant_id: tenantId, by: admin.clerk_user_id })).run();

  return json({ ok: true, tenant_id: tenantId, slug });
}

export async function handleAdminCreateProductForTenant(request, env, tenantId) {
  const admin = await requirePlatformAdmin(request, env);
  if (!admin) return json({ error: 'unauthorized' }, 401);

  const tenant = await env.DB.prepare(
    'SELECT id, product_limit, status FROM tenants WHERE id = ? AND deleted_at IS NULL'
  ).bind(tenantId).first();
  if (!tenant) return json({ error: 'tenant_not_found' }, 404);
  if (!['trial', 'active'].includes(tenant.status)) return json({ error: 'tenant_inactive' }, 403);

  const countRow = await env.DB.prepare(
    "SELECT COUNT(*) as n FROM products WHERE tenant_id = ? AND status != 'archived'"
  ).bind(tenantId).first();
  if ((countRow?.n || 0) >= tenant.product_limit) {
    return json({ error: 'product_limit_reached', limit: tenant.product_limit }, 403);
  }

  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'invalid_json' }, 400); }

  if (!body.product_name?.trim()) return json({ error: 'product_name_required' }, 400);
  if (body.identifier_level && !IDENTIFIER_LEVELS.includes(body.identifier_level))
    return json({ error: 'invalid_identifier_level' }, 400);
  if (body.data_carrier_type && !DATA_CARRIER_TYPES.includes(body.data_carrier_type))
    return json({ error: 'invalid_data_carrier_type' }, 400);

  const id = newId();
  const slug = newSlug();
  const ownerToken = newId();
  const productUid = crypto.randomUUID();
  const passportUid = crypto.randomUUID();

  const columns = [...buildCreateProductColumns(), 'tenant_id'];
  const values = [...buildCreateProductValues(body, id, slug, ownerToken, productUid, passportUid), tenantId];

  await env.DB.prepare(
    `INSERT INTO products (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`
  ).bind(...values).run();

  await env.DB.prepare(
    "INSERT INTO product_events (id, product_id, event_type, event_data_json, actor_type) VALUES (?, ?, 'created', ?, 'platform_admin')"
  ).bind(newId(), id, JSON.stringify({ tenant_id: tenantId, by: admin.clerk_user_id })).run();

  return json({ id, product_uid: productUid, public_slug: slug, owner_token: ownerToken, passport_uid: passportUid }, 201);
}

export async function handleUpdateTenant(request, env, tenantId) {
  const admin = await requirePlatformAdmin(request, env);
  if (!admin) return json({ error: 'unauthorized' }, 401);

  const tenant = await env.DB.prepare(
    'SELECT id FROM tenants WHERE id = ?'
  ).bind(tenantId).first();
  if (!tenant) return json({ error: 'not_found' }, 404);

  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'invalid_json' }, 400); }

  const ALLOWED = ['plan', 'status', 'billing_status', 'product_limit', 'stripe_customer_id', 'stripe_subscription_id'];
  const updates = {};
  for (const k of ALLOWED) {
    if (k in body) updates[k] = body[k];
  }
  if (Object.keys(updates).length === 0) return json({ error: 'no_fields' }, 400);

  const setParts = Object.keys(updates).map(k => `${k} = ?`);
  setParts.push("updated_at = datetime('now')");

  await env.DB.prepare(
    `UPDATE tenants SET ${setParts.join(', ')} WHERE id = ?`
  ).bind(...Object.values(updates), tenantId).run();

  return json({ ok: true });
}
