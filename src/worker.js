const TEXT_FIELDS = [
  'name',
  'brand_name',
  'manufacturer_name',
  'manufacturer_email',
  'manufacturer_address',
  'product_type',
  'sku',
  'safety_notes',
  'care_instructions',
  'recycling_instructions',
];

const STATUSES = ['draft', 'active', 'archived'];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname.startsWith('/p/')) {
      return serveAsset(request, env, '/product.html');
    }

    if (pathname.startsWith('/owner/')) {
      return serveAsset(request, env, '/owner.html');
    }

    if (pathname.startsWith('/api/public/product/') && request.method === 'GET') {
      return getPublicProduct(env, decodeURIComponent(pathname.slice('/api/public/product/'.length)));
    }

    if (pathname.startsWith('/api/owner/product/')) {
      const token = decodeURIComponent(pathname.slice('/api/owner/product/'.length));
      if (request.method === 'GET') return getOwnerProduct(env, token);
      if (request.method === 'POST') return updateOwnerProduct(request, env, token);
    }

    if (pathname === '/api/admin/product/create' && request.method === 'POST') {
      return createProduct(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};

function serveAsset(request, env, pathname) {
  const target = new URL(request.url);
  target.pathname = pathname;
  return env.ASSETS.fetch(new Request(target, request));
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function newId() {
  return crypto.randomUUID().replace(/-/g, '');
}

function newSlug() {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 10);
}

async function getPublicProduct(env, slug) {
  if (!slug) return json({ error: 'not_found' }, 404);

  const product = await env.DB.prepare(
    `SELECT public_slug, name, brand_name, manufacturer_name, manufacturer_email,
            manufacturer_address, product_type, sku, materials_json, safety_notes,
            care_instructions, recycling_instructions, languages_json, status
     FROM products WHERE public_slug = ?`
  ).bind(slug).first();

  if (!product || product.status === 'archived') {
    return json({ error: 'not_found' }, 404);
  }

  return json(product);
}

async function getOwnerProduct(env, token) {
  if (!token) return json({ error: 'not_found' }, 404);

  const product = await env.DB.prepare(
    'SELECT * FROM products WHERE owner_token = ?'
  ).bind(token).first();

  if (!product) return json({ error: 'not_found' }, 404);

  return json(product);
}

async function updateOwnerProduct(request, env, token) {
  if (!token) return json({ error: 'not_found' }, 404);

  const existing = await env.DB.prepare(
    'SELECT id FROM products WHERE owner_token = ?'
  ).bind(token).first();

  if (!existing) return json({ error: 'not_found' }, 404);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const updates = {};

  for (const field of TEXT_FIELDS) {
    if (field in body) updates[field] = String(body[field] ?? '');
  }

  if (updates.name !== undefined && updates.name.trim() === '') {
    return json({ error: 'name_required' }, 400);
  }

  if ('materials' in body) {
    if (!Array.isArray(body.materials)) {
      return json({ error: 'invalid_materials' }, 400);
    }
    updates.materials_json = JSON.stringify(body.materials);
  }

  if ('status' in body) {
    if (!STATUSES.includes(body.status)) {
      return json({ error: 'invalid_status' }, 400);
    }
    updates.status = body.status;
  }

  if (Object.keys(updates).length === 0) {
    return json({ error: 'no_fields' }, 400);
  }

  const setClause = Object.keys(updates).map((f) => `${f} = ?`).join(', ');
  const values = Object.values(updates);

  await env.DB.prepare(
    `UPDATE products SET ${setClause}, updated_at = datetime('now') WHERE owner_token = ?`
  ).bind(...values, token).run();

  await env.DB.prepare(
    "INSERT INTO product_events (id, product_id, event_type, event_data_json) VALUES (?, ?, 'updated', ?)"
  ).bind(newId(), existing.id, JSON.stringify({ fields: Object.keys(updates) })).run();

  const updated = await env.DB.prepare(
    'SELECT * FROM products WHERE owner_token = ?'
  ).bind(token).first();

  return json(updated);
}

async function createProduct(request, env) {
  const expected = env.ADMIN_SECRET ? `Bearer ${env.ADMIN_SECRET}` : null;
  if (!expected || request.headers.get('authorization') !== expected) {
    return json({ error: 'unauthorized' }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
    return json({ error: 'name_required' }, 400);
  }

  const id = newId();
  const slug = newSlug();
  const token = newId();

  await env.DB.prepare(
    `INSERT INTO products (
      id, public_slug, owner_token, name, brand_name, manufacturer_name,
      manufacturer_email, manufacturer_address, product_type, sku,
      materials_json, safety_notes, care_instructions, recycling_instructions,
      languages_json, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')`
  ).bind(
    id,
    slug,
    token,
    body.name.trim(),
    body.brand_name || null,
    body.manufacturer_name || null,
    body.manufacturer_email || null,
    body.manufacturer_address || null,
    body.product_type || null,
    body.sku || null,
    JSON.stringify(Array.isArray(body.materials) ? body.materials : []),
    body.safety_notes || null,
    body.care_instructions || null,
    body.recycling_instructions || null,
    JSON.stringify(Array.isArray(body.languages) ? body.languages : ['fi'])
  ).run();

  await env.DB.prepare(
    "INSERT INTO product_events (id, product_id, event_type, event_data_json) VALUES (?, ?, 'created', '{}')"
  ).bind(newId(), id).run();

  return json({ slug, token }, 201);
}
