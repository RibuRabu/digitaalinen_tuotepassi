export const TEXT_FIELDS = [
  'product_name', 'brand_name', 'manufacturer_name', 'manufacturer_email',
  'manufacturer_address', 'responsible_operator_name', 'responsible_operator_email',
  'responsible_operator_address', 'sku', 'gtin', 'batch_number', 'serial_number', 'product_type',
];

export const JSON_ARRAY_FIELDS = {
  materials: 'materials_json',
  substances: 'substances_json',
  safety_notes: 'safety_notes_json',
  care_instructions: 'care_instructions_json',
  repair_instructions: 'repair_instructions_json',
  recycling_instructions: 'recycling_instructions_json',
  compliance_documents: 'compliance_documents_json',
};

export const VISIBILITY_ELIGIBLE_FIELDS = [
  'product_name', 'brand_name', 'manufacturer_name', 'manufacturer_email',
  'manufacturer_address', 'responsible_operator_name', 'responsible_operator_email',
  'responsible_operator_address', 'sku', 'gtin', 'batch_number', 'serial_number',
  'product_type', 'materials_json', 'substances_json', 'safety_notes_json',
  'care_instructions_json', 'repair_instructions_json', 'recycling_instructions_json',
  'compliance_documents_json',
];

export const ALWAYS_VISIBLE_FIELDS = [
  'public_slug', 'product_uid', 'passport_uid', 'data_carrier_type',
  'data_carrier_url', 'identifier_level', 'status', 'version', 'languages_json',
  'translations_json', 'updated_at', 'created_at',
];

export const DEFAULT_CONSUMER_VISIBILITY = [
  'product_name', 'brand_name', 'manufacturer_name', 'manufacturer_email',
  'manufacturer_address', 'responsible_operator_name', 'responsible_operator_email',
  'responsible_operator_address', 'product_type', 'materials_json',
  'care_instructions_json', 'repair_instructions_json',
  'recycling_instructions_json', 'safety_notes_json',
];

export const STATUSES = ['draft', 'active', 'archived'];
export const COMPLIANCE_STATUSES = ['not_started', 'in_progress', 'complete', 'verified'];
export const DATA_CARRIER_TYPES = ['qr', 'nfc', 'rfid', 'barcode'];
export const IDENTIFIER_LEVELS = ['model', 'batch', 'item'];
export const SUPPORTED_LANGS = ['en', 'sv', 'de', 'fr', 'et', 'lv', 'lt', 'pl'];
export const TRANS_TEXT_FIELDS = ['product_name', 'brand_name', 'product_type'];
export const TRANS_LIST_FIELDS = ['materials', 'care_instructions', 'repair_instructions', 'recycling_instructions', 'safety_notes'];

export const ALLOWED_FILE_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
export const MAX_FILE_SIZE = 10 * 1024 * 1024;

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export function newId() {
  return crypto.randomUUID().replace(/-/g, '');
}

export function newSlug() {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 10);
}

export function requireAdmin(request, env) {
  const expected = env.ADMIN_SECRET ? `Bearer ${env.ADMIN_SECRET}` : null;
  return Boolean(expected) && request.headers.get('authorization') === expected;
}

export function consumerDataFields(row) {
  let visibility = {};
  try { visibility = JSON.parse(row.visibility_json || '{}'); } catch {}
  const allowed = Array.isArray(visibility.consumer) ? visibility.consumer : DEFAULT_CONSUMER_VISIBILITY;
  const out = {};
  for (const field of allowed) {
    if (VISIBILITY_ELIGIBLE_FIELDS.includes(field)) out[field] = row[field];
  }
  return out;
}
