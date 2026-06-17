import { json, consumerDataFields, ALWAYS_VISIBLE_FIELDS } from '../utils.js';

export async function handlePublicProduct(env, slug) {
  if (!slug) return json({ error: 'not_found' }, 404);

  const product = await env.DB.prepare(
    'SELECT * FROM products WHERE public_slug = ?'
  ).bind(slug).first();

  if (!product || product.status === 'archived') return json({ error: 'not_found' }, 404);

  const out = consumerDataFields(product);
  for (const field of ALWAYS_VISIBLE_FIELDS) out[field] = product[field];
  return json(out);
}

export async function handlePassport(env, productUid) {
  if (!productUid) return json({ error: 'not_found' }, 404);

  const product = await env.DB.prepare(
    'SELECT * FROM products WHERE product_uid = ?'
  ).bind(productUid).first();

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
