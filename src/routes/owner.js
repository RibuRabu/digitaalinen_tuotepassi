import {
  json, newId,
  TEXT_FIELDS, JSON_ARRAY_FIELDS, VISIBILITY_ELIGIBLE_FIELDS,
  STATUSES, SUPPORTED_LANGS, TRANS_TEXT_FIELDS, TRANS_LIST_FIELDS,
  ALLOWED_FILE_TYPES, MAX_FILE_SIZE,
} from '../utils.js';

export async function handleGetOwnerProduct(env, token) {
  if (!token) return json({ error: 'not_found' }, 404);
  const product = await env.DB.prepare(
    'SELECT * FROM products WHERE owner_token = ?'
  ).bind(token).first();
  if (!product) return json({ error: 'not_found' }, 404);
  return json(product);
}

export async function handleUpdateOwnerProduct(request, env, token) {
  if (!token) return json({ error: 'not_found' }, 404);

  const existing = await env.DB.prepare(
    'SELECT * FROM products WHERE owner_token = ?'
  ).bind(token).first();
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
  }

  if (Object.keys(updates).length === 0) return json({ error: 'no_fields' }, 400);

  const setParts = Object.keys(updates).map(f => `${f} = ?`);
  if (needsPublishedAt) setParts.push("published_at = datetime('now')");
  setParts.push("version = version + 1", "updated_at = datetime('now')");

  await env.DB.prepare(
    `UPDATE products SET ${setParts.join(', ')} WHERE owner_token = ?`
  ).bind(...Object.values(updates), token).run();

  await env.DB.prepare(
    "INSERT INTO product_events (id, product_id, event_type, event_data_json, actor_type) VALUES (?, ?, 'updated', ?, 'owner')"
  ).bind(newId(), existing.id, JSON.stringify({ fields: Object.keys(updates) })).run();

  const updated = await env.DB.prepare(
    'SELECT * FROM products WHERE owner_token = ?'
  ).bind(token).first();
  return json(updated);
}

export async function handleOwnerUploadDocument(request, env, token) {
  if (!token) return json({ error: 'not_found' }, 404);

  const product = await env.DB.prepare(
    'SELECT * FROM products WHERE owner_token = ?'
  ).bind(token).first();
  if (!product) return json({ error: 'not_found' }, 404);

  let formData;
  try { formData = await request.formData(); }
  catch { return json({ error: 'invalid_form' }, 400); }

  const file = formData.get('file');
  if (!file || !file.stream) return json({ error: 'no_file' }, 400);
  if (!ALLOWED_FILE_TYPES.includes(file.type)) return json({ error: 'invalid_file_type' }, 400);
  if (file.size > MAX_FILE_SIZE) return json({ error: 'file_too_large' }, 400);

  const ext = (file.name.split('.').pop() || 'bin').toLowerCase().slice(0, 10);
  const key = `${product.id}/${crypto.randomUUID()}.${ext}`;

  await env.BUCKET.put(key, file.stream(), {
    httpMetadata: { contentType: file.type },
    customMetadata: { originalName: file.name },
  });

  const fileUrl = `/api/files/${key}`;
  const docId = newId();

  // Write to product_documents (primary store) so tenant dashboard reads see the doc
  await env.DB.prepare(
    'INSERT INTO product_documents (id, product_id, tenant_id, name, file_key, file_type, file_size) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(docId, product.id, product.tenant_id || null, file.name, key, file.type, file.size || 0).run();
  let docs = [];
  try { docs = JSON.parse(product.compliance_documents_json || '[]'); } catch {}
  docs = docs.map(d => typeof d === 'string' ? { name: d, url: '' } : d);
  docs.push({ id: docId, name: file.name, url: fileUrl });

  await env.DB.prepare(
    "UPDATE products SET compliance_documents_json = ?, version = version + 1, updated_at = datetime('now') WHERE owner_token = ?"
  ).bind(JSON.stringify(docs), token).run();

  await env.DB.prepare(
    "INSERT INTO product_events (id, product_id, event_type, event_data_json, actor_type) VALUES (?, ?, 'document_uploaded', ?, 'owner')"
  ).bind(newId(), product.id, JSON.stringify({ key, name: file.name })).run();

  return json({ url: fileUrl, name: file.name }, 201);
}
