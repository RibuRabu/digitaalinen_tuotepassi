import {
  json, newId, newSlug,
  TEXT_FIELDS, JSON_ARRAY_FIELDS, VISIBILITY_ELIGIBLE_FIELDS,
  STATUSES, COMPLIANCE_STATUSES, DATA_CARRIER_TYPES, IDENTIFIER_LEVELS,
  SUPPORTED_LANGS, TRANS_TEXT_FIELDS, TRANS_LIST_FIELDS,
  ALLOWED_FILE_TYPES, MAX_FILE_SIZE,
} from '../utils.js';
import { verifyClerkJWT, extractBearerToken, getTenantContext } from '../auth/clerk.js';
import { buildCreateProductColumns, buildCreateProductValues } from './admin.js';

async function requireTenant(request, env) {
  console.log('[requireTenant-enter]');
  const token = extractBearerToken(request);
  const payload = await verifyClerkJWT(token, env);
  if (!payload) return { error: 'unauthorized', status: 401 };

  // org_id may be absent from the JWT when the Clerk session template does not
  // include org claims, or the user has not set an active org in their session.
  // Accept X-Organization-Id header as a verified fallback (the user is still
  // authenticated via the JWT — we just need the org they're operating under).
  const orgId = payload.org_id || request.headers.get('X-Organization-Id') || null;
  const headerOrgId = request.headers.get('X-Organization-Id') ?? null;
  const jwtOrgId = payload.org_id ?? null;

  console.log('[tenant-auth]', JSON.stringify({
    path: new URL(request.url).pathname,
    hasToken: Boolean(token),
    jwtOrgId,
    headerOrgId,
    resolvedOrgId: orgId,
    sub: payload.sub ?? null,
    azp: payload.azp ?? null,
  }));

  if (!orgId) {
    console.log('[no-active-org]', JSON.stringify({ jwtOrgId, headerOrgId, resolvedOrgId: orgId }));
    return { error: 'no_active_organization', status: 403 };
  }

  const ctx = await getTenantContext({ ...payload, org_id: orgId }, env);
  if (!ctx) return { error: 'tenant_not_found', status: 403 };
  // getTenantContext may return { error, status } for blocked tenants
  if (ctx.error) return ctx;
  return ctx;
}

// GET /api/tenant/self
export async function handleGetTenantSelf(request, env) {
  const ctx = await requireTenant(request, env);
  if (ctx.error) {
    console.log('[tenant-self] auth error', JSON.stringify({ error: ctx.error, status: ctx.status }));
    return json({ error: ctx.error }, ctx.status);
  }

  const countRow = await env.DB.prepare(
    "SELECT COUNT(*) as n FROM products WHERE tenant_id = ? AND status != 'archived'"
  ).bind(ctx.tenant.id).first();

  const result = { ...ctx.tenant, product_count: countRow?.n ?? 0 };
  console.log('[tenant-self] ok', JSON.stringify({
    tenantId: ctx.tenant.id,
    name: ctx.tenant.name,
    status: ctx.tenant.status,
    product_count: result.product_count,
  }));
  return json(result);
}

// GET /api/tenant/products
export async function handleListProducts(request, env) {
  console.log('[products-handler-enter]', { path: request.url });
  console.log('[before-requireTenant]');
  const ctx = await requireTenant(request, env);
  if (ctx.error) return json({ error: ctx.error }, ctx.status);

  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);
  const status = url.searchParams.get('status') || null;

  let sql = `SELECT id, public_slug, product_uid, product_name, brand_name, status,
             version, data_carrier_type, created_at, updated_at, published_at
             FROM products WHERE tenant_id = ?`;
  const binds = [ctx.tenant.id];
  if (status) { sql += ' AND status = ?'; binds.push(status); }
  sql += ' ORDER BY updated_at DESC LIMIT ? OFFSET ?';
  binds.push(limit, offset);

  const { results } = await env.DB.prepare(sql).bind(...binds).all();
  return json({ products: results, limit, offset });
}

// POST /api/tenant/product
export async function handleCreateProduct(request, env) {
  const ctx = await requireTenant(request, env);
  if (ctx.error) return json({ error: ctx.error }, ctx.status);

  // Enforce product limit
  const countRow = await env.DB.prepare(
    "SELECT COUNT(*) as n FROM products WHERE tenant_id = ? AND status != 'archived'"
  ).bind(ctx.tenant.id).first();
  if ((countRow?.n || 0) >= ctx.tenant.product_limit) {
    return json({ error: 'product_limit_reached', limit: ctx.tenant.product_limit }, 403);
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
  const token = newId();
  const productUid = crypto.randomUUID();
  const passportUid = crypto.randomUUID();

  const baseColumns = buildCreateProductColumns();
  const baseValues = buildCreateProductValues(body, id, slug, token, productUid, passportUid);

  // #2: tenant_id is always derived from JWT — never from request body
  if (!ctx.tenant.id) return json({ error: 'internal_error' }, 500);
  const columns = [...baseColumns, 'tenant_id'];
  const values = [...baseValues, ctx.tenant.id];

  await env.DB.prepare(
    `INSERT INTO products (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`
  ).bind(...values).run();

  await env.DB.prepare(
    "INSERT INTO product_events (id, product_id, event_type, event_data_json, actor_type) VALUES (?, ?, 'created', ?, 'tenant')"
  ).bind(newId(), id, JSON.stringify({ tenant_id: ctx.tenant.id, by: ctx.userId })).run();

  return json({ slug, token, product_uid: productUid, passport_uid: passportUid }, 201);
}

// GET /api/tenant/product/:slug
export async function handleGetProduct(request, env, slug) {
  const ctx = await requireTenant(request, env);
  if (ctx.error) return json({ error: ctx.error }, ctx.status);

  const product = await env.DB.prepare(
    'SELECT * FROM products WHERE public_slug = ? AND tenant_id = ?'
  ).bind(slug, ctx.tenant.id).first();
  if (!product) return json({ error: 'not_found' }, 404);

  // #4: build compliance_documents_json from product_documents table; fall back to JSON blob for legacy products
  const { results: dbDocs } = await env.DB.prepare(
    'SELECT id, name, file_key, file_type, file_size, uploaded_at FROM product_documents WHERE product_id = ? ORDER BY uploaded_at ASC'
  ).bind(product.id).all();
  const complianceDocsJson = dbDocs.length > 0
    ? JSON.stringify(dbDocs.map(d => ({ id: d.id, name: d.name, url: `/api/files/${d.file_key}`, uploaded_at: d.uploaded_at })))
    : product.compliance_documents_json;

  // #5: build translations_json from product_translations table; fall back to JSON blob for legacy products
  const { results: dbTrans } = await env.DB.prepare(
    'SELECT lang, data_json FROM product_translations WHERE product_id = ?'
  ).bind(product.id).all();
  let translationsJson = product.translations_json;
  if (dbTrans.length > 0) {
    const merged = {};
    for (const row of dbTrans) {
      try { merged[row.lang] = JSON.parse(row.data_json); } catch { merged[row.lang] = {}; }
    }
    translationsJson = JSON.stringify(merged);
  }

  return json({ ...product, compliance_documents_json: complianceDocsJson, translations_json: translationsJson });
}

// POST /api/tenant/product/:slug (update)
export async function handleUpdateProduct(request, env, slug) {
  const ctx = await requireTenant(request, env);
  if (ctx.error) return json({ error: ctx.error }, ctx.status);

  const existing = await env.DB.prepare(
    'SELECT * FROM products WHERE public_slug = ? AND tenant_id = ?'
  ).bind(slug, ctx.tenant.id).first();
  if (!existing) return json({ error: 'not_found' }, 404);

  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'invalid_json' }, 400); }

  const updates = {};

  for (const field of TEXT_FIELDS) {
    if (field in body) updates[field] = String(body[field] ?? '');
  }

  if (updates.product_name !== undefined && updates.product_name.trim() === '') {
    return json({ error: 'product_name_required' }, 400);
  }

  for (const [key, column] of Object.entries(JSON_ARRAY_FIELDS)) {
    if (key in body) {
      if (!Array.isArray(body[key])) return json({ error: `invalid_${key}` }, 400);
      updates[column] = JSON.stringify(body[key]);
    }
  }

  let needsPublishedAt = false;
  if ('status' in body) {
    if (!STATUSES.includes(body.status)) return json({ error: 'invalid_status' }, 400);
    updates.status = body.status;
    if (body.status === 'active' && !existing.published_at) needsPublishedAt = true;
  }

  // #9: compliance workflow status — separate from publication status
  if ('compliance_status' in body) {
    if (!COMPLIANCE_STATUSES.includes(body.compliance_status)) return json({ error: 'invalid_compliance_status' }, 400);
    updates.compliance_status = body.compliance_status;
  }

  if ('visible_to_consumer' in body) {
    if (!Array.isArray(body.visible_to_consumer)) return json({ error: 'invalid_visibility' }, 400);
    let visibility = {};
    try { visibility = JSON.parse(existing.visibility_json || '{}'); } catch {}
    visibility.consumer = body.visible_to_consumer.filter(f => VISIBILITY_ELIGIBLE_FIELDS.includes(f));
    updates.visibility_json = JSON.stringify(visibility);
  }

  if ('category_id' in body) {
    updates.category_id = body.category_id || null;
  }

  if ('target_markets' in body) {
    if (!Array.isArray(body.target_markets)) return json({ error: 'invalid_target_markets' }, 400);
    const VALID = new Set(['EU','FI','DE','FR','SE','EE','LV','LT','PL','DK','NO','ES','IT','NL']);
    const markets = body.target_markets.filter(m => VALID.has(m));
    updates.target_markets_json = JSON.stringify(markets.length > 0 ? markets : ['EU']);
  }

  if ('translations' in body && body.translations !== null && typeof body.translations === 'object') {
    const clean = {};
    for (const [lang, fields] of Object.entries(body.translations)) {
      if (!SUPPORTED_LANGS.includes(lang) || typeof fields !== 'object' || fields === null) continue;
      clean[lang] = {};
      for (const f of TRANS_TEXT_FIELDS) {
        if (f in fields) clean[lang][f] = String(fields[f] ?? '');
      }
      for (const f of TRANS_LIST_FIELDS) {
        if (f in fields) clean[lang][f] = Array.isArray(fields[f]) ? fields[f] : [];
      }
    }
    updates.translations_json = JSON.stringify(clean);
    // #5: also write per-language rows to product_translations for queryability
    for (const [lang, data] of Object.entries(clean)) {
      await env.DB.prepare(
        `INSERT INTO product_translations (id, product_id, lang, data_json, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'))
         ON CONFLICT(product_id, lang) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at`
      ).bind(newId(), existing.id, lang, JSON.stringify(data)).run();
    }
  }

  if (Object.keys(updates).length === 0) return json({ error: 'no_fields' }, 400);

  const setParts = Object.keys(updates).map(f => `${f} = ?`);
  if (needsPublishedAt) setParts.push("published_at = datetime('now')");
  setParts.push("version = version + 1", "updated_at = datetime('now')");

  await env.DB.prepare(
    `UPDATE products SET ${setParts.join(', ')} WHERE public_slug = ? AND tenant_id = ?`
  ).bind(...Object.values(updates), slug, ctx.tenant.id).run();

  await env.DB.prepare(
    "INSERT INTO product_events (id, product_id, event_type, event_data_json, actor_type) VALUES (?, ?, 'updated', ?, 'tenant')"
  ).bind(newId(), existing.id, JSON.stringify({ fields: Object.keys(updates), by: ctx.userId })).run();

  const updated = await env.DB.prepare(
    'SELECT * FROM products WHERE public_slug = ? AND tenant_id = ?'
  ).bind(slug, ctx.tenant.id).first();
  return json(updated);
}

// DELETE /api/tenant/product/:slug (soft delete — sets status to archived)
export async function handleDeleteProduct(request, env, slug) {
  const ctx = await requireTenant(request, env);
  if (ctx.error) return json({ error: ctx.error }, ctx.status);

  const product = await env.DB.prepare(
    'SELECT id FROM products WHERE public_slug = ? AND tenant_id = ?'
  ).bind(slug, ctx.tenant.id).first();
  if (!product) return json({ error: 'not_found' }, 404);

  await env.DB.prepare(
    "UPDATE products SET status = 'archived', version = version + 1, updated_at = datetime('now') WHERE public_slug = ? AND tenant_id = ?"
  ).bind(slug, ctx.tenant.id).run();

  await env.DB.prepare(
    "INSERT INTO product_events (id, product_id, event_type, event_data_json, actor_type) VALUES (?, ?, 'archived', ?, 'tenant')"
  ).bind(newId(), product.id, JSON.stringify({ by: ctx.userId })).run();

  return json({ ok: true });
}

// POST /api/tenant/product/:slug/document
export async function handleUploadDocument(request, env, slug) {
  const ctx = await requireTenant(request, env);
  if (ctx.error) return json({ error: ctx.error }, ctx.status);

  const product = await env.DB.prepare(
    'SELECT * FROM products WHERE public_slug = ? AND tenant_id = ?'
  ).bind(slug, ctx.tenant.id).first();
  if (!product) return json({ error: 'not_found' }, 404);

  let formData;
  try { formData = await request.formData(); }
  catch { return json({ error: 'invalid_form' }, 400); }

  const file = formData.get('file');
  if (!file || !file.stream) return json({ error: 'no_file' }, 400);
  if (!ALLOWED_FILE_TYPES.includes(file.type)) return json({ error: 'invalid_file_type' }, 400);
  if (file.size > MAX_FILE_SIZE) return json({ error: 'file_too_large' }, 400);

  const ext = (file.name.split('.').pop() || 'bin').toLowerCase().slice(0, 10);
  const key = `${ctx.tenant.id}/${product.id}/${crypto.randomUUID()}.${ext}`;

  await env.BUCKET.put(key, file.stream(), {
    httpMetadata: { contentType: file.type },
    customMetadata: { originalName: file.name },
  });

  const fileUrl = `/api/files/${key}`;
  const docId = newId();

  // #4: write to product_documents table (primary store going forward)
  await env.DB.prepare(
    'INSERT INTO product_documents (id, product_id, tenant_id, name, file_key, file_type, file_size) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(docId, product.id, ctx.tenant.id, file.name, key, file.type, file.size || 0).run();

  // Keep JSON blob updated so legacy reads and existing products still work
  let docs = [];
  try { docs = JSON.parse(product.compliance_documents_json || '[]'); } catch {}
  docs = docs.map(d => typeof d === 'string' ? { name: d, url: '' } : d);
  docs.push({ id: docId, name: file.name, url: fileUrl });

  await env.DB.prepare(
    "UPDATE products SET compliance_documents_json = ?, version = version + 1, updated_at = datetime('now') WHERE public_slug = ? AND tenant_id = ?"
  ).bind(JSON.stringify(docs), slug, ctx.tenant.id).run();

  await env.DB.prepare(
    "INSERT INTO product_events (id, product_id, event_type, event_data_json, actor_type) VALUES (?, ?, 'document_uploaded', ?, 'tenant')"
  ).bind(newId(), product.id, JSON.stringify({ key, name: file.name, by: ctx.userId })).run();

  return json({ id: docId, url: fileUrl, name: file.name }, 201);
}

// POST /api/tenant/product/:slug/share-link
// Regenerates owner_token — old /owner/{token} links stop working
export async function handleRegenerateShareLink(request, env, slug) {
  const ctx = await requireTenant(request, env);
  if (ctx.error) return json({ error: ctx.error }, ctx.status);

  const product = await env.DB.prepare(
    'SELECT id FROM products WHERE public_slug = ? AND tenant_id = ?'
  ).bind(slug, ctx.tenant.id).first();
  if (!product) return json({ error: 'not_found' }, 404);

  const newToken = newId();
  await env.DB.prepare(
    "UPDATE products SET owner_token = ?, version = version + 1, updated_at = datetime('now') WHERE public_slug = ? AND tenant_id = ?"
  ).bind(newToken, slug, ctx.tenant.id).run();

  await env.DB.prepare(
    "INSERT INTO product_events (id, product_id, event_type, event_data_json, actor_type) VALUES (?, ?, 'share_link_regenerated', ?, 'tenant')"
  ).bind(newId(), product.id, JSON.stringify({ by: ctx.userId })).run();

  const ownerUrl = `/owner/${newToken}`;
  return json({ owner_url: ownerUrl, token: newToken });
}

// POST /api/tenant/claim/:token
// Claims an unclaimed legacy product by its owner_token
export async function handleClaimProduct(request, env, token) {
  const ctx = await requireTenant(request, env);
  if (ctx.error) return json({ error: ctx.error }, ctx.status);

  const product = await env.DB.prepare(
    'SELECT id, public_slug, tenant_id FROM products WHERE owner_token = ?'
  ).bind(token).first();
  if (!product) return json({ error: 'not_found' }, 404);
  if (product.tenant_id) return json({ error: 'already_claimed', tenant_id: product.tenant_id }, 409);

  await env.DB.prepare(
    "UPDATE products SET tenant_id = ?, updated_at = datetime('now') WHERE owner_token = ?"
  ).bind(ctx.tenant.id, token).run();

  await env.DB.prepare(
    "INSERT INTO product_events (id, product_id, event_type, event_data_json, actor_type) VALUES (?, ?, 'claimed', ?, 'tenant')"
  ).bind(newId(), product.id, JSON.stringify({ tenant_id: ctx.tenant.id, by: ctx.userId })).run();

  return json({ ok: true, slug: product.public_slug, tenant_id: ctx.tenant.id });
}
