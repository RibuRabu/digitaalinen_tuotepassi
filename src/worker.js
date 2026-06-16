const TEXT_FIELDS = [
  'product_name',
  'brand_name',
  'manufacturer_name',
  'manufacturer_email',
  'manufacturer_address',
  'responsible_operator_name',
  'responsible_operator_email',
  'responsible_operator_address',
  'sku',
  'gtin',
  'batch_number',
  'serial_number',
  'product_type',
];

const JSON_ARRAY_FIELDS = {
  materials: 'materials_json',
  substances: 'substances_json',
  safety_notes: 'safety_notes_json',
  care_instructions: 'care_instructions_json',
  repair_instructions: 'repair_instructions_json',
  recycling_instructions: 'recycling_instructions_json',
  compliance_documents: 'compliance_documents_json',
};

const VISIBILITY_ELIGIBLE_FIELDS = [
  'product_name', 'brand_name', 'manufacturer_name', 'manufacturer_email',
  'manufacturer_address', 'responsible_operator_name', 'responsible_operator_email',
  'responsible_operator_address', 'sku', 'gtin', 'batch_number', 'serial_number',
  'product_type', 'materials_json', 'substances_json', 'safety_notes_json',
  'care_instructions_json', 'repair_instructions_json', 'recycling_instructions_json',
  'compliance_documents_json',
];

const ALWAYS_VISIBLE_FIELDS = [
  'public_slug', 'product_uid', 'passport_uid', 'data_carrier_type',
  'data_carrier_url', 'identifier_level', 'status', 'version', 'languages_json',
];

const DEFAULT_CONSUMER_VISIBILITY = [
  'product_name', 'brand_name', 'manufacturer_name', 'manufacturer_email',
  'manufacturer_address', 'product_type', 'materials_json',
  'care_instructions_json', 'repair_instructions_json',
  'recycling_instructions_json', 'safety_notes_json',
];

const STATUSES = ['draft', 'active', 'archived'];
const DATA_CARRIER_TYPES = ['qr', 'nfc', 'rfid', 'barcode'];
const IDENTIFIER_LEVELS = ['model', 'batch', 'item'];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname.startsWith('/p/')) {
      return serveAsset(request, env, '/product');
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

    if (pathname.startsWith('/api/admin/product/')) {
      const rest = pathname.slice('/api/admin/product/'.length);

      if (rest === 'create' && request.method === 'POST') {
        return createProduct(request, env);
      }

      if (rest.endsWith('/carrier') && request.method === 'POST') {
        const slug = decodeURIComponent(rest.slice(0, -'/carrier'.length));
        return updateCarrier(request, env, slug);
      }

      if (rest && request.method === 'GET') {
        return getAdminProduct(request, env, decodeURIComponent(rest));
      }
    }

    if (pathname.startsWith('/api/passport/') && request.method === 'GET') {
      return getPassport(env, decodeURIComponent(pathname.slice('/api/passport/'.length)));
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

function requireAdmin(request, env) {
  const expected = env.ADMIN_SECRET ? `Bearer ${env.ADMIN_SECRET}` : null;
  return Boolean(expected) && request.headers.get('authorization') === expected;
}

function consumerDataFields(row) {
  let visibility = {};
  try { visibility = JSON.parse(row.visibility_json || '{}'); } catch {}
  const allowed = Array.isArray(visibility.consumer) ? visibility.consumer : DEFAULT_CONSUMER_VISIBILITY;

  const out = {};
  for (const field of allowed) {
    if (VISIBILITY_ELIGIBLE_FIELDS.includes(field)) out[field] = row[field];
  }
  return out;
}

async function getPublicProduct(env, slug) {
  if (!slug) return json({ error: 'not_found' }, 404);

  const product = await env.DB.prepare('SELECT * FROM products WHERE public_slug = ?').bind(slug).first();
  if (!product || product.status === 'archived') return json({ error: 'not_found' }, 404);

  const out = consumerDataFields(product);
  for (const field of ALWAYS_VISIBLE_FIELDS) out[field] = product[field];
  return json(out);
}

async function getPassport(env, productUid) {
  if (!productUid) return json({ error: 'not_found' }, 404);

  const product = await env.DB.prepare('SELECT * FROM products WHERE product_uid = ?').bind(productUid).first();
  if (!product || product.status === 'archived') return json({ error: 'not_found' }, 404);

  let languages = [];
  try { languages = JSON.parse(product.languages_json || '[]'); } catch {}

  return json({
    passport_uid: product.passport_uid,
    product_uid: product.product_uid,
    identifier_level: product.identifier_level,
    version: product.version,
    status: product.status,
    data_carrier: { type: product.data_carrier_type, url: product.data_carrier_url },
    languages,
    product: consumerDataFields(product),
  });
}

async function getOwnerProduct(env, token) {
  if (!token) return json({ error: 'not_found' }, 404);

  const product = await env.DB.prepare('SELECT * FROM products WHERE owner_token = ?').bind(token).first();
  if (!product) return json({ error: 'not_found' }, 404);

  return json(product);
}

async function updateOwnerProduct(request, env, token) {
  if (!token) return json({ error: 'not_found' }, 404);

  const existing = await env.DB.prepare('SELECT * FROM products WHERE owner_token = ?').bind(token).first();
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

  if (updates.product_name !== undefined && updates.product_name.trim() === '') {
    return json({ error: 'product_name_required' }, 400);
  }

  for (const [key, column] of Object.entries(JSON_ARRAY_FIELDS)) {
    if (key in body) {
      if (!Array.isArray(body[key])) return json({ error: `invalid_${key}` }, 400);
      updates[column] = JSON.stringify(body[key]);
    }
  }

  if ('status' in body) {
    if (!STATUSES.includes(body.status)) return json({ error: 'invalid_status' }, 400);
    updates.status = body.status;
  }

  if ('visible_to_consumer' in body) {
    if (!Array.isArray(body.visible_to_consumer)) return json({ error: 'invalid_visibility' }, 400);
    let visibility = {};
    try { visibility = JSON.parse(existing.visibility_json || '{}'); } catch {}
    visibility.consumer = body.visible_to_consumer.filter((f) => VISIBILITY_ELIGIBLE_FIELDS.includes(f));
    updates.visibility_json = JSON.stringify(visibility);
  }

  if (Object.keys(updates).length === 0) {
    return json({ error: 'no_fields' }, 400);
  }

  const setClause = Object.keys(updates).map((f) => `${f} = ?`).join(', ');
  const values = Object.values(updates);

  await env.DB.prepare(
    `UPDATE products SET ${setClause}, version = version + 1, updated_at = datetime('now') WHERE owner_token = ?`
  ).bind(...values, token).run();

  await env.DB.prepare(
    "INSERT INTO product_events (id, product_id, event_type, event_data_json, actor_type) VALUES (?, ?, 'updated', ?, 'owner')"
  ).bind(newId(), existing.id, JSON.stringify({ fields: Object.keys(updates) })).run();

  const updated = await env.DB.prepare('SELECT * FROM products WHERE owner_token = ?').bind(token).first();
  return json(updated);
}

async function getAdminProduct(request, env, slug) {
  if (!requireAdmin(request, env)) return json({ error: 'unauthorized' }, 401);

  const product = await env.DB.prepare('SELECT * FROM products WHERE public_slug = ?').bind(slug).first();
  if (!product) return json({ error: 'not_found' }, 404);

  return json(product);
}

async function updateCarrier(request, env, slug) {
  if (!requireAdmin(request, env)) return json({ error: 'unauthorized' }, 401);

  const existing = await env.DB.prepare('SELECT id FROM products WHERE public_slug = ?').bind(slug).first();
  if (!existing) return json({ error: 'not_found' }, 404);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  if (!DATA_CARRIER_TYPES.includes(body.data_carrier_type)) {
    return json({ error: 'invalid_data_carrier_type' }, 400);
  }

  const dataCarrierUrl = typeof body.data_carrier_url === 'string' && body.data_carrier_url.trim()
    ? body.data_carrier_url.trim()
    : `/p/${slug}`;

  await env.DB.prepare(
    "UPDATE products SET data_carrier_type = ?, data_carrier_url = ?, version = version + 1, updated_at = datetime('now') WHERE public_slug = ?"
  ).bind(body.data_carrier_type, dataCarrierUrl, slug).run();

  await env.DB.prepare(
    "INSERT INTO product_events (id, product_id, event_type, event_data_json, actor_type) VALUES (?, ?, 'carrier_updated', ?, 'admin')"
  ).bind(newId(), existing.id, JSON.stringify({ data_carrier_type: body.data_carrier_type, data_carrier_url: dataCarrierUrl })).run();

  const updated = await env.DB.prepare('SELECT * FROM products WHERE public_slug = ?').bind(slug).first();
  return json(updated);
}

async function createProduct(request, env) {
  if (!requireAdmin(request, env)) return json({ error: 'unauthorized' }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  if (!body.product_name || typeof body.product_name !== 'string' || !body.product_name.trim()) {
    return json({ error: 'product_name_required' }, 400);
  }

  if (body.identifier_level && !IDENTIFIER_LEVELS.includes(body.identifier_level)) {
    return json({ error: 'invalid_identifier_level' }, 400);
  }

  if (body.data_carrier_type && !DATA_CARRIER_TYPES.includes(body.data_carrier_type)) {
    return json({ error: 'invalid_data_carrier_type' }, 400);
  }

  const id = newId();
  const slug = newSlug();
  const token = newId();
  const productUid = crypto.randomUUID();
  const passportUid = crypto.randomUUID();
  const dataCarrierType = body.data_carrier_type || 'qr';
  const identifierLevel = body.identifier_level || 'model';

  const columns = [
    'id', 'public_slug', 'owner_token', 'product_uid', 'passport_uid',
    'data_carrier_type', 'data_carrier_url', 'identifier_level',
    'product_name', 'brand_name', 'manufacturer_name', 'manufacturer_email', 'manufacturer_address',
    'responsible_operator_name', 'responsible_operator_email', 'responsible_operator_address',
    'sku', 'gtin', 'batch_number', 'serial_number', 'product_type',
    'materials_json', 'substances_json', 'safety_notes_json', 'care_instructions_json',
    'repair_instructions_json', 'recycling_instructions_json', 'compliance_documents_json',
    'languages_json', 'visibility_json', 'version', 'status',
  ];

  const values = [
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
    JSON.stringify(Array.isArray(body.compliance_documents) ? body.compliance_documents : []),
    JSON.stringify(Array.isArray(body.languages) ? body.languages : ['fi']),
    JSON.stringify({ consumer: DEFAULT_CONSUMER_VISIBILITY, authority: ['*'], operator: ['*'] }),
    1,
    'draft',
  ];

  await env.DB.prepare(
    `INSERT INTO products (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`
  ).bind(...values).run();

  await env.DB.prepare(
    "INSERT INTO product_events (id, product_id, event_type, event_data_json, actor_type) VALUES (?, ?, 'created', '{}', 'admin')"
  ).bind(newId(), id).run();

  return json({ slug, token, product_uid: productUid, passport_uid: passportUid }, 201);
}
