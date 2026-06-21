var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/utils.js
var TEXT_FIELDS = [
  "product_name",
  "brand_name",
  "manufacturer_name",
  "manufacturer_email",
  "manufacturer_address",
  "responsible_operator_name",
  "responsible_operator_email",
  "responsible_operator_address",
  "sku",
  "gtin",
  "batch_number",
  "serial_number",
  "product_type"
];
var JSON_ARRAY_FIELDS = {
  materials: "materials_json",
  substances: "substances_json",
  safety_notes: "safety_notes_json",
  care_instructions: "care_instructions_json",
  repair_instructions: "repair_instructions_json",
  recycling_instructions: "recycling_instructions_json",
  compliance_documents: "compliance_documents_json"
};
var VISIBILITY_ELIGIBLE_FIELDS = [
  "product_name",
  "brand_name",
  "manufacturer_name",
  "manufacturer_email",
  "manufacturer_address",
  "responsible_operator_name",
  "responsible_operator_email",
  "responsible_operator_address",
  "sku",
  "gtin",
  "batch_number",
  "serial_number",
  "product_type",
  "materials_json",
  "substances_json",
  "safety_notes_json",
  "care_instructions_json",
  "repair_instructions_json",
  "recycling_instructions_json",
  "compliance_documents_json"
];
var ALWAYS_VISIBLE_FIELDS = [
  "public_slug",
  "product_uid",
  "passport_uid",
  "data_carrier_type",
  "data_carrier_url",
  "identifier_level",
  "status",
  "version",
  "languages_json",
  "translations_json",
  "updated_at",
  "created_at"
];
var DEFAULT_CONSUMER_VISIBILITY = [
  "product_name",
  "brand_name",
  "manufacturer_name",
  "manufacturer_email",
  "manufacturer_address",
  "product_type",
  "materials_json",
  "care_instructions_json",
  "repair_instructions_json",
  "recycling_instructions_json",
  "safety_notes_json"
];
var STATUSES = ["draft", "active", "archived"];
var COMPLIANCE_STATUSES = ["not_started", "in_progress", "complete", "verified"];
var DATA_CARRIER_TYPES = ["qr", "nfc", "rfid", "barcode"];
var IDENTIFIER_LEVELS = ["model", "batch", "item"];
var SUPPORTED_LANGS = ["en", "sv", "de", "fr", "et", "lv", "lt", "pl"];
var TRANS_TEXT_FIELDS = ["product_name", "brand_name", "product_type"];
var TRANS_LIST_FIELDS = ["materials", "care_instructions", "repair_instructions", "recycling_instructions", "safety_notes"];
var ALLOWED_FILE_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
var MAX_FILE_SIZE = 10 * 1024 * 1024;
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}
__name(json, "json");
function newId() {
  return crypto.randomUUID().replace(/-/g, "");
}
__name(newId, "newId");
function newSlug() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 10);
}
__name(newSlug, "newSlug");
function requireAdmin(request, env) {
  const expected = env.ADMIN_SECRET ? `Bearer ${env.ADMIN_SECRET}` : null;
  return Boolean(expected) && request.headers.get("authorization") === expected;
}
__name(requireAdmin, "requireAdmin");
function consumerDataFields(row) {
  let visibility = {};
  try {
    visibility = JSON.parse(row.visibility_json || "{}");
  } catch {
  }
  const allowed = Array.isArray(visibility.consumer) ? visibility.consumer : DEFAULT_CONSUMER_VISIBILITY;
  const out = {};
  for (const field of allowed) {
    if (VISIBILITY_ELIGIBLE_FIELDS.includes(field)) out[field] = row[field];
  }
  return out;
}
__name(consumerDataFields, "consumerDataFields");

// src/routes/public.js
async function handlePublicProduct(env, slug) {
  if (!slug) return json({ error: "not_found" }, 404);
  const product = await env.DB.prepare(
    "SELECT * FROM products WHERE public_slug = ?"
  ).bind(slug).first();
  if (!product || product.status === "archived") return json({ error: "not_found" }, 404);
  const out = consumerDataFields(product);
  for (const field of ALWAYS_VISIBLE_FIELDS) out[field] = product[field];
  return json(out);
}
__name(handlePublicProduct, "handlePublicProduct");
async function handlePassport(env, productUid) {
  if (!productUid) return json({ error: "not_found" }, 404);
  const product = await env.DB.prepare(
    "SELECT * FROM products WHERE product_uid = ?"
  ).bind(productUid).first();
  if (!product || product.status === "archived") return json({ error: "not_found" }, 404);
  let languages = [];
  try {
    languages = JSON.parse(product.languages_json || "[]");
  } catch {
  }
  return json({
    passport_uid: product.passport_uid,
    product_uid: product.product_uid,
    identifier_level: product.identifier_level,
    version: product.version,
    status: product.status,
    compliance_status: product.compliance_status ?? "not_started",
    data_carrier: { type: product.data_carrier_type, url: product.data_carrier_url },
    languages,
    product: consumerDataFields(product)
  });
}
__name(handlePassport, "handlePassport");

// src/routes/owner.js
async function handleGetOwnerProduct(env, token) {
  if (!token) return json({ error: "not_found" }, 404);
  const product = await env.DB.prepare(
    "SELECT * FROM products WHERE owner_token = ?"
  ).bind(token).first();
  if (!product) return json({ error: "not_found" }, 404);
  return json(product);
}
__name(handleGetOwnerProduct, "handleGetOwnerProduct");
async function handleUpdateOwnerProduct(request, env, token) {
  if (!token) return json({ error: "not_found" }, 404);
  const existing = await env.DB.prepare(
    "SELECT * FROM products WHERE owner_token = ?"
  ).bind(token).first();
  if (!existing) return json({ error: "not_found" }, 404);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const updates = {};
  for (const field of TEXT_FIELDS) {
    if (field in body) updates[field] = String(body[field] ?? "");
  }
  if (updates.product_name !== void 0 && updates.product_name.trim() === "") {
    return json({ error: "product_name_required" }, 400);
  }
  for (const [key, column] of Object.entries(JSON_ARRAY_FIELDS)) {
    if (key in body) {
      if (!Array.isArray(body[key])) return json({ error: `invalid_${key}` }, 400);
      updates[column] = JSON.stringify(body[key]);
    }
  }
  let needsPublishedAt = false;
  if ("status" in body) {
    if (!STATUSES.includes(body.status)) return json({ error: "invalid_status" }, 400);
    updates.status = body.status;
    if (body.status === "active" && !existing.published_at) needsPublishedAt = true;
  }
  if ("visible_to_consumer" in body) {
    if (!Array.isArray(body.visible_to_consumer)) return json({ error: "invalid_visibility" }, 400);
    let visibility = {};
    try {
      visibility = JSON.parse(existing.visibility_json || "{}");
    } catch {
    }
    visibility.consumer = body.visible_to_consumer.filter((f) => VISIBILITY_ELIGIBLE_FIELDS.includes(f));
    updates.visibility_json = JSON.stringify(visibility);
  }
  if ("translations" in body && body.translations !== null && typeof body.translations === "object") {
    const clean = {};
    for (const [lang, fields] of Object.entries(body.translations)) {
      if (!SUPPORTED_LANGS.includes(lang) || typeof fields !== "object" || fields === null) continue;
      clean[lang] = {};
      for (const f of TRANS_TEXT_FIELDS) {
        if (f in fields) clean[lang][f] = String(fields[f] ?? "");
      }
      for (const f of TRANS_LIST_FIELDS) {
        if (f in fields) clean[lang][f] = Array.isArray(fields[f]) ? fields[f] : [];
      }
    }
    updates.translations_json = JSON.stringify(clean);
  }
  if (Object.keys(updates).length === 0) return json({ error: "no_fields" }, 400);
  const setParts = Object.keys(updates).map((f) => `${f} = ?`);
  if (needsPublishedAt) setParts.push("published_at = datetime('now')");
  setParts.push("version = version + 1", "updated_at = datetime('now')");
  await env.DB.prepare(
    `UPDATE products SET ${setParts.join(", ")} WHERE owner_token = ?`
  ).bind(...Object.values(updates), token).run();
  await env.DB.prepare(
    "INSERT INTO product_events (id, product_id, event_type, event_data_json, actor_type) VALUES (?, ?, 'updated', ?, 'owner')"
  ).bind(newId(), existing.id, JSON.stringify({ fields: Object.keys(updates) })).run();
  const updated = await env.DB.prepare(
    "SELECT * FROM products WHERE owner_token = ?"
  ).bind(token).first();
  return json(updated);
}
__name(handleUpdateOwnerProduct, "handleUpdateOwnerProduct");
async function handleOwnerUploadDocument(request, env, token) {
  if (!token) return json({ error: "not_found" }, 404);
  const product = await env.DB.prepare(
    "SELECT * FROM products WHERE owner_token = ?"
  ).bind(token).first();
  if (!product) return json({ error: "not_found" }, 404);
  let formData;
  try {
    formData = await request.formData();
  } catch {
    return json({ error: "invalid_form" }, 400);
  }
  const file = formData.get("file");
  if (!file || !file.stream) return json({ error: "no_file" }, 400);
  if (!ALLOWED_FILE_TYPES.includes(file.type)) return json({ error: "invalid_file_type" }, 400);
  if (file.size > MAX_FILE_SIZE) return json({ error: "file_too_large" }, 400);
  const ext = (file.name.split(".").pop() || "bin").toLowerCase().slice(0, 10);
  const key = `${product.id}/${crypto.randomUUID()}.${ext}`;
  await env.BUCKET.put(key, file.stream(), {
    httpMetadata: { contentType: file.type },
    customMetadata: { originalName: file.name }
  });
  const fileUrl = `/api/files/${key}`;
  let docs = [];
  try {
    docs = JSON.parse(product.compliance_documents_json || "[]");
  } catch {
  }
  docs = docs.map((d) => typeof d === "string" ? { name: d, url: "" } : d);
  docs.push({ name: file.name, url: fileUrl });
  await env.DB.prepare(
    "UPDATE products SET compliance_documents_json = ?, version = version + 1, updated_at = datetime('now') WHERE owner_token = ?"
  ).bind(JSON.stringify(docs), token).run();
  await env.DB.prepare(
    "INSERT INTO product_events (id, product_id, event_type, event_data_json, actor_type) VALUES (?, ?, 'document_uploaded', ?, 'owner')"
  ).bind(newId(), product.id, JSON.stringify({ key, name: file.name })).run();
  return json({ url: fileUrl, name: file.name }, 201);
}
__name(handleOwnerUploadDocument, "handleOwnerUploadDocument");

// src/routes/files.js
async function handleServeFile(env, key) {
  if (!key) return json({ error: "not_found" }, 404);
  const obj = await env.BUCKET.get(key);
  if (!obj) return json({ error: "not_found" }, 404);
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  if (!headers.has("content-disposition")) headers.set("content-disposition", "inline");
  return new Response(obj.body, { headers });
}
__name(handleServeFile, "handleServeFile");

// src/auth/clerk.js
var JWKS_CACHE_KEY = "clerk_jwks";
var JWKS_CACHE_TTL = 21600;
async function fetchJWKS(env) {
  const url = env.CLERK_JWKS_URL;
  if (!url) throw new Error("CLERK_JWKS_URL not configured");
  const res = await fetch(url, { signal: AbortSignal.timeout(5e3) });
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
  return res.json();
}
__name(fetchJWKS, "fetchJWKS");
async function getJWKS(env) {
  if (env.KV) {
    const cached = await env.KV.get(JWKS_CACHE_KEY, "json");
    if (cached) return cached;
  }
  const jwks = await fetchJWKS(env);
  if (env.KV) {
    await env.KV.put(JWKS_CACHE_KEY, JSON.stringify(jwks), { expirationTtl: JWKS_CACHE_TTL });
  }
  return jwks;
}
__name(getJWKS, "getJWKS");
function b64urlDecode(str) {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/") + "==".slice(0, (4 - str.length % 4) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
__name(b64urlDecode, "b64urlDecode");
function b64Decode(str) {
  return Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
}
__name(b64Decode, "b64Decode");
function parseB64Json(str) {
  try {
    return JSON.parse(new TextDecoder().decode(b64urlDecode(str)));
  } catch {
    return null;
  }
}
__name(parseB64Json, "parseB64Json");
async function verifyClerkJWT(token, env) {
  if (!token || !env.CLERK_JWKS_URL) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const header = parseB64Json(parts[0]);
  if (!header) return null;
  let jwks;
  try {
    jwks = await getJWKS(env);
  } catch {
    if (env.KV) await env.KV.delete(JWKS_CACHE_KEY).catch(() => {
    });
    try {
      jwks = await fetchJWKS(env);
    } catch {
      return null;
    }
  }
  const jwk = (jwks.keys || []).find((k) => k.kid === header.kid && k.use === "sig");
  if (!jwk) return null;
  let key;
  try {
    key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );
  } catch {
    return null;
  }
  const message = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const signature = b64urlDecode(parts[2]);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, message);
  if (!valid) return null;
  const payload = parseB64Json(parts[1]);
  if (!payload) return null;
  if (payload.exp && Date.now() / 1e3 > payload.exp) return null;
  return payload;
}
__name(verifyClerkJWT, "verifyClerkJWT");
function extractBearerToken(request) {
  const auth = request.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}
__name(extractBearerToken, "extractBearerToken");
async function getTenantContext(payload, env) {
  if (!payload?.org_id) return null;
  const tenant = await env.DB.prepare(
    "SELECT * FROM tenants WHERE clerk_org_id = ? AND deleted_at IS NULL"
  ).bind(payload.org_id).first();
  if (!tenant) return null;
  if (!["trial", "active"].includes(tenant.status)) return null;
  return { tenant, userId: payload.sub, orgRole: payload.org_role };
}
__name(getTenantContext, "getTenantContext");
async function getPlatformContext(payload, env) {
  if (!payload?.sub) return null;
  return env.DB.prepare(
    "SELECT * FROM platform_users WHERE clerk_user_id = ?"
  ).bind(payload.sub).first();
}
__name(getPlatformContext, "getPlatformContext");
async function verifyWebhook(request, secret) {
  if (!secret) return null;
  const svixId = request.headers.get("svix-id");
  const svixTs = request.headers.get("svix-timestamp");
  const svixSig = request.headers.get("svix-signature");
  if (!svixId || !svixTs || !svixSig) return null;
  const ts = parseInt(svixTs, 10);
  if (isNaN(ts) || Math.abs(Date.now() / 1e3 - ts) > 300) return null;
  const body = await request.text();
  const msgBytes = new TextEncoder().encode(`${svixId}.${svixTs}.${body}`);
  const secretBase64 = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  const secretBytes = b64Decode(secretBase64);
  let key;
  try {
    key = await crypto.subtle.importKey(
      "raw",
      secretBytes,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );
  } catch {
    return null;
  }
  const sigs = svixSig.split(" ").filter((s) => s.startsWith("v1,"));
  for (const s of sigs) {
    const sigBytes = b64Decode(s.slice(3));
    if (await crypto.subtle.verify("HMAC", key, sigBytes, msgBytes)) {
      try {
        return JSON.parse(body);
      } catch {
        return null;
      }
    }
  }
  return null;
}
__name(verifyWebhook, "verifyWebhook");

// src/routes/admin.js
function buildCreateProductColumns() {
  return [
    "id",
    "public_slug",
    "owner_token",
    "product_uid",
    "passport_uid",
    "data_carrier_type",
    "data_carrier_url",
    "identifier_level",
    "product_name",
    "brand_name",
    "manufacturer_name",
    "manufacturer_email",
    "manufacturer_address",
    "responsible_operator_name",
    "responsible_operator_email",
    "responsible_operator_address",
    "sku",
    "gtin",
    "batch_number",
    "serial_number",
    "product_type",
    "materials_json",
    "substances_json",
    "safety_notes_json",
    "care_instructions_json",
    "repair_instructions_json",
    "recycling_instructions_json",
    "compliance_documents_json",
    "languages_json",
    "visibility_json",
    "version",
    "status",
    "customer_name",
    "customer_email"
  ];
}
__name(buildCreateProductColumns, "buildCreateProductColumns");
function buildCreateProductValues(body, id, slug, token, productUid, passportUid) {
  const dataCarrierType = body.data_carrier_type || "qr";
  const identifierLevel = body.identifier_level || "model";
  return [
    id,
    slug,
    token,
    productUid,
    passportUid,
    dataCarrierType,
    `/p/${slug}`,
    identifierLevel,
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
    JSON.stringify(Array.isArray(body.languages) ? body.languages : ["fi"]),
    JSON.stringify({ consumer: DEFAULT_CONSUMER_VISIBILITY, authority: ["*"], operator: ["*"] }),
    1,
    "draft",
    body.customer_name || null,
    body.customer_email || null
  ];
}
__name(buildCreateProductValues, "buildCreateProductValues");
async function handleGetAdminProduct(request, env, slug) {
  if (!requireAdmin(request, env)) return json({ error: "unauthorized" }, 401);
  const product = await env.DB.prepare(
    "SELECT * FROM products WHERE public_slug = ?"
  ).bind(slug).first();
  if (!product) return json({ error: "not_found" }, 404);
  return json(product);
}
__name(handleGetAdminProduct, "handleGetAdminProduct");
async function handleCreateProduct(request, env) {
  if (!requireAdmin(request, env)) return json({ error: "unauthorized" }, 401);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  if (!body.product_name?.trim()) return json({ error: "product_name_required" }, 400);
  if (body.identifier_level && !IDENTIFIER_LEVELS.includes(body.identifier_level))
    return json({ error: "invalid_identifier_level" }, 400);
  if (body.data_carrier_type && !DATA_CARRIER_TYPES.includes(body.data_carrier_type))
    return json({ error: "invalid_data_carrier_type" }, 400);
  const id = newId();
  const slug = newSlug();
  const token = newId();
  const productUid = crypto.randomUUID();
  const passportUid = crypto.randomUUID();
  const columns = buildCreateProductColumns();
  const values = buildCreateProductValues(body, id, slug, token, productUid, passportUid);
  await env.DB.prepare(
    `INSERT INTO products (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`
  ).bind(...values).run();
  await env.DB.prepare(
    "INSERT INTO product_events (id, product_id, event_type, event_data_json, actor_type) VALUES (?, ?, 'created', '{}', 'admin')"
  ).bind(newId(), id).run();
  return json({ slug, token, product_uid: productUid, passport_uid: passportUid }, 201);
}
__name(handleCreateProduct, "handleCreateProduct");
async function handleUpdateCarrier(request, env, slug) {
  if (!requireAdmin(request, env)) return json({ error: "unauthorized" }, 401);
  const existing = await env.DB.prepare(
    "SELECT id FROM products WHERE public_slug = ?"
  ).bind(slug).first();
  if (!existing) return json({ error: "not_found" }, 404);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  if (!DATA_CARRIER_TYPES.includes(body.data_carrier_type))
    return json({ error: "invalid_data_carrier_type" }, 400);
  const dataCarrierUrl = typeof body.data_carrier_url === "string" && body.data_carrier_url.trim() ? body.data_carrier_url.trim() : `/p/${slug}`;
  await env.DB.prepare(
    "UPDATE products SET data_carrier_type = ?, data_carrier_url = ?, version = version + 1, updated_at = datetime('now') WHERE public_slug = ?"
  ).bind(body.data_carrier_type, dataCarrierUrl, slug).run();
  await env.DB.prepare(
    "INSERT INTO product_events (id, product_id, event_type, event_data_json, actor_type) VALUES (?, ?, 'carrier_updated', ?, 'admin')"
  ).bind(newId(), existing.id, JSON.stringify({ data_carrier_type: body.data_carrier_type, data_carrier_url: dataCarrierUrl })).run();
  const updated = await env.DB.prepare(
    "SELECT * FROM products WHERE public_slug = ?"
  ).bind(slug).first();
  return json(updated);
}
__name(handleUpdateCarrier, "handleUpdateCarrier");
async function requirePlatformAdmin(request, env) {
  const token = extractBearerToken(request);
  const payload = await verifyClerkJWT(token, env);
  const platformUser = await getPlatformContext(payload, env);
  return platformUser;
}
__name(requirePlatformAdmin, "requirePlatformAdmin");
async function handleListTenants(request, env) {
  const admin = await requirePlatformAdmin(request, env);
  if (!admin) return json({ error: "unauthorized" }, 401);
  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 200);
  const offset = parseInt(url.searchParams.get("offset") || "0", 10);
  const { results } = await env.DB.prepare(
    `SELECT id, name, slug, plan, status, billing_status, product_limit, created_at
     FROM tenants ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).bind(limit, offset).all();
  return json({ tenants: results, limit, offset });
}
__name(handleListTenants, "handleListTenants");
async function handleGetTenant(request, env, tenantId) {
  const admin = await requirePlatformAdmin(request, env);
  if (!admin) return json({ error: "unauthorized" }, 401);
  const tenant = await env.DB.prepare(
    "SELECT * FROM tenants WHERE id = ?"
  ).bind(tenantId).first();
  if (!tenant) return json({ error: "not_found" }, 404);
  const { results: products } = await env.DB.prepare(
    `SELECT id, public_slug, product_name, status, version, created_at
     FROM products WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 100`
  ).bind(tenantId).all();
  const { results: users } = await env.DB.prepare(
    "SELECT id, clerk_user_id, role, joined_at FROM tenant_users WHERE tenant_id = ?"
  ).bind(tenantId).all();
  return json({ tenant, products, users });
}
__name(handleGetTenant, "handleGetTenant");
async function handleListUnclaimedProducts(request, env) {
  const admin = await requirePlatformAdmin(request, env);
  if (!admin) return json({ error: "unauthorized" }, 401);
  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 200);
  const offset = parseInt(url.searchParams.get("offset") || "0", 10);
  const email = url.searchParams.get("customer_email") || null;
  let sql = `SELECT id, public_slug, product_uid, product_name, status, customer_name, customer_email, created_at
             FROM products WHERE tenant_id IS NULL`;
  const binds = [];
  if (email) {
    sql += " AND customer_email = ?";
    binds.push(email);
  }
  sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
  binds.push(limit, offset);
  const { results } = await env.DB.prepare(sql).bind(...binds).all();
  return json({ products: results, limit, offset });
}
__name(handleListUnclaimedProducts, "handleListUnclaimedProducts");
async function handleAdminClaimProduct(request, env, tenantId, slug) {
  const admin = await requirePlatformAdmin(request, env);
  if (!admin) return json({ error: "unauthorized" }, 401);
  const tenant = await env.DB.prepare(
    "SELECT id FROM tenants WHERE id = ?"
  ).bind(tenantId).first();
  if (!tenant) return json({ error: "tenant_not_found" }, 404);
  const product = await env.DB.prepare(
    "SELECT id, tenant_id FROM products WHERE public_slug = ?"
  ).bind(slug).first();
  if (!product) return json({ error: "product_not_found" }, 404);
  if (product.tenant_id) return json({ error: "already_claimed", tenant_id: product.tenant_id }, 409);
  await env.DB.prepare(
    "UPDATE products SET tenant_id = ?, updated_at = datetime('now') WHERE public_slug = ?"
  ).bind(tenantId, slug).run();
  await env.DB.prepare(
    "INSERT INTO product_events (id, product_id, event_type, event_data_json, actor_type) VALUES (?, ?, 'claimed', ?, 'platform_admin')"
  ).bind(newId(), product.id, JSON.stringify({ tenant_id: tenantId, by: admin.clerk_user_id })).run();
  return json({ ok: true, tenant_id: tenantId, slug });
}
__name(handleAdminClaimProduct, "handleAdminClaimProduct");
async function handleAdminCreateProductForTenant(request, env, tenantId) {
  const admin = await requirePlatformAdmin(request, env);
  if (!admin) return json({ error: "unauthorized" }, 401);
  const tenant = await env.DB.prepare(
    "SELECT id, product_limit, status FROM tenants WHERE id = ? AND deleted_at IS NULL"
  ).bind(tenantId).first();
  if (!tenant) return json({ error: "tenant_not_found" }, 404);
  if (!["trial", "active"].includes(tenant.status)) return json({ error: "tenant_inactive" }, 403);
  const countRow = await env.DB.prepare(
    "SELECT COUNT(*) as n FROM products WHERE tenant_id = ? AND status != 'archived'"
  ).bind(tenantId).first();
  if ((countRow?.n || 0) >= tenant.product_limit) {
    return json({ error: "product_limit_reached", limit: tenant.product_limit }, 403);
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  if (!body.product_name?.trim()) return json({ error: "product_name_required" }, 400);
  if (body.identifier_level && !IDENTIFIER_LEVELS.includes(body.identifier_level))
    return json({ error: "invalid_identifier_level" }, 400);
  if (body.data_carrier_type && !DATA_CARRIER_TYPES.includes(body.data_carrier_type))
    return json({ error: "invalid_data_carrier_type" }, 400);
  const id = newId();
  const slug = newSlug();
  const ownerToken = newId();
  const productUid = crypto.randomUUID();
  const passportUid = crypto.randomUUID();
  const columns = [...buildCreateProductColumns(), "tenant_id"];
  const values = [...buildCreateProductValues(body, id, slug, ownerToken, productUid, passportUid), tenantId];
  await env.DB.prepare(
    `INSERT INTO products (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`
  ).bind(...values).run();
  await env.DB.prepare(
    "INSERT INTO product_events (id, product_id, event_type, event_data_json, actor_type) VALUES (?, ?, 'created', ?, 'platform_admin')"
  ).bind(newId(), id, JSON.stringify({ tenant_id: tenantId, by: admin.clerk_user_id })).run();
  return json({ id, product_uid: productUid, public_slug: slug, owner_token: ownerToken, passport_uid: passportUid }, 201);
}
__name(handleAdminCreateProductForTenant, "handleAdminCreateProductForTenant");
async function handleUpdateTenant(request, env, tenantId) {
  const admin = await requirePlatformAdmin(request, env);
  if (!admin) return json({ error: "unauthorized" }, 401);
  const tenant = await env.DB.prepare(
    "SELECT id FROM tenants WHERE id = ?"
  ).bind(tenantId).first();
  if (!tenant) return json({ error: "not_found" }, 404);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const ALLOWED = ["plan", "status", "billing_status", "product_limit", "stripe_customer_id", "stripe_subscription_id"];
  const updates = {};
  for (const k of ALLOWED) {
    if (k in body) updates[k] = body[k];
  }
  if (Object.keys(updates).length === 0) return json({ error: "no_fields" }, 400);
  const setParts = Object.keys(updates).map((k) => `${k} = ?`);
  setParts.push("updated_at = datetime('now')");
  await env.DB.prepare(
    `UPDATE tenants SET ${setParts.join(", ")} WHERE id = ?`
  ).bind(...Object.values(updates), tenantId).run();
  return json({ ok: true });
}
__name(handleUpdateTenant, "handleUpdateTenant");

// src/routes/tenant.js
async function requireTenant(request, env) {
  const token = extractBearerToken(request);
  const payload = await verifyClerkJWT(token, env);
  if (!payload) return { error: "unauthorized", status: 401 };
  if (!payload.org_id) return { error: "no_active_organization", status: 403 };
  const ctx = await getTenantContext(payload, env);
  if (!ctx) return { error: "tenant_not_found", status: 403 };
  return ctx;
}
__name(requireTenant, "requireTenant");
async function handleListProducts(request, env) {
  const ctx = await requireTenant(request, env);
  if (ctx.error) return json({ error: ctx.error }, ctx.status);
  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 200);
  const offset = parseInt(url.searchParams.get("offset") || "0", 10);
  const status = url.searchParams.get("status") || null;
  let sql = `SELECT id, public_slug, product_uid, product_name, brand_name, status,
             version, data_carrier_type, created_at, updated_at, published_at
             FROM products WHERE tenant_id = ?`;
  const binds = [ctx.tenant.id];
  if (status) {
    sql += " AND status = ?";
    binds.push(status);
  }
  sql += " ORDER BY updated_at DESC LIMIT ? OFFSET ?";
  binds.push(limit, offset);
  const { results } = await env.DB.prepare(sql).bind(...binds).all();
  return json({ products: results, limit, offset });
}
__name(handleListProducts, "handleListProducts");
async function handleCreateProduct2(request, env) {
  const ctx = await requireTenant(request, env);
  if (ctx.error) return json({ error: ctx.error }, ctx.status);
  const countRow = await env.DB.prepare(
    "SELECT COUNT(*) as n FROM products WHERE tenant_id = ? AND status != 'archived'"
  ).bind(ctx.tenant.id).first();
  if ((countRow?.n || 0) >= ctx.tenant.product_limit) {
    return json({ error: "product_limit_reached", limit: ctx.tenant.product_limit }, 403);
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  if (!body.product_name?.trim()) return json({ error: "product_name_required" }, 400);
  if (body.identifier_level && !IDENTIFIER_LEVELS.includes(body.identifier_level))
    return json({ error: "invalid_identifier_level" }, 400);
  if (body.data_carrier_type && !DATA_CARRIER_TYPES.includes(body.data_carrier_type))
    return json({ error: "invalid_data_carrier_type" }, 400);
  const id = newId();
  const slug = newSlug();
  const token = newId();
  const productUid = crypto.randomUUID();
  const passportUid = crypto.randomUUID();
  const baseColumns = buildCreateProductColumns();
  const baseValues = buildCreateProductValues(body, id, slug, token, productUid, passportUid);
  if (!ctx.tenant.id) return json({ error: "internal_error" }, 500);
  const columns = [...baseColumns, "tenant_id"];
  const values = [...baseValues, ctx.tenant.id];
  await env.DB.prepare(
    `INSERT INTO products (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`
  ).bind(...values).run();
  await env.DB.prepare(
    "INSERT INTO product_events (id, product_id, event_type, event_data_json, actor_type) VALUES (?, ?, 'created', ?, 'tenant')"
  ).bind(newId(), id, JSON.stringify({ tenant_id: ctx.tenant.id, by: ctx.userId })).run();
  return json({ slug, token, product_uid: productUid, passport_uid: passportUid }, 201);
}
__name(handleCreateProduct2, "handleCreateProduct");
async function handleGetProduct(request, env, slug) {
  const ctx = await requireTenant(request, env);
  if (ctx.error) return json({ error: ctx.error }, ctx.status);
  const product = await env.DB.prepare(
    "SELECT * FROM products WHERE public_slug = ? AND tenant_id = ?"
  ).bind(slug, ctx.tenant.id).first();
  if (!product) return json({ error: "not_found" }, 404);
  const { results: dbDocs } = await env.DB.prepare(
    "SELECT id, name, file_key, file_type, file_size, uploaded_at FROM product_documents WHERE product_id = ? ORDER BY uploaded_at ASC"
  ).bind(product.id).all();
  const complianceDocsJson = dbDocs.length > 0 ? JSON.stringify(dbDocs.map((d) => ({ id: d.id, name: d.name, url: `/api/files/${d.file_key}`, uploaded_at: d.uploaded_at }))) : product.compliance_documents_json;
  const { results: dbTrans } = await env.DB.prepare(
    "SELECT lang, data_json FROM product_translations WHERE product_id = ?"
  ).bind(product.id).all();
  let translationsJson = product.translations_json;
  if (dbTrans.length > 0) {
    const merged = {};
    for (const row of dbTrans) {
      try {
        merged[row.lang] = JSON.parse(row.data_json);
      } catch {
        merged[row.lang] = {};
      }
    }
    translationsJson = JSON.stringify(merged);
  }
  return json({ ...product, compliance_documents_json: complianceDocsJson, translations_json: translationsJson });
}
__name(handleGetProduct, "handleGetProduct");
async function handleUpdateProduct(request, env, slug) {
  const ctx = await requireTenant(request, env);
  if (ctx.error) return json({ error: ctx.error }, ctx.status);
  const existing = await env.DB.prepare(
    "SELECT * FROM products WHERE public_slug = ? AND tenant_id = ?"
  ).bind(slug, ctx.tenant.id).first();
  if (!existing) return json({ error: "not_found" }, 404);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const updates = {};
  for (const field of TEXT_FIELDS) {
    if (field in body) updates[field] = String(body[field] ?? "");
  }
  if (updates.product_name !== void 0 && updates.product_name.trim() === "") {
    return json({ error: "product_name_required" }, 400);
  }
  for (const [key, column] of Object.entries(JSON_ARRAY_FIELDS)) {
    if (key in body) {
      if (!Array.isArray(body[key])) return json({ error: `invalid_${key}` }, 400);
      updates[column] = JSON.stringify(body[key]);
    }
  }
  let needsPublishedAt = false;
  if ("status" in body) {
    if (!STATUSES.includes(body.status)) return json({ error: "invalid_status" }, 400);
    updates.status = body.status;
    if (body.status === "active" && !existing.published_at) needsPublishedAt = true;
  }
  if ("compliance_status" in body) {
    if (!COMPLIANCE_STATUSES.includes(body.compliance_status)) return json({ error: "invalid_compliance_status" }, 400);
    updates.compliance_status = body.compliance_status;
  }
  if ("visible_to_consumer" in body) {
    if (!Array.isArray(body.visible_to_consumer)) return json({ error: "invalid_visibility" }, 400);
    let visibility = {};
    try {
      visibility = JSON.parse(existing.visibility_json || "{}");
    } catch {
    }
    visibility.consumer = body.visible_to_consumer.filter((f) => VISIBILITY_ELIGIBLE_FIELDS.includes(f));
    updates.visibility_json = JSON.stringify(visibility);
  }
  if ("category_id" in body) {
    updates.category_id = body.category_id || null;
  }
  if ("target_markets" in body) {
    if (!Array.isArray(body.target_markets)) return json({ error: "invalid_target_markets" }, 400);
    const VALID = /* @__PURE__ */ new Set(["EU", "FI", "DE", "FR", "SE", "EE", "LV", "LT", "PL", "DK", "NO", "ES", "IT", "NL"]);
    const markets = body.target_markets.filter((m) => VALID.has(m));
    updates.target_markets_json = JSON.stringify(markets.length > 0 ? markets : ["EU"]);
  }
  if ("translations" in body && body.translations !== null && typeof body.translations === "object") {
    const clean = {};
    for (const [lang, fields] of Object.entries(body.translations)) {
      if (!SUPPORTED_LANGS.includes(lang) || typeof fields !== "object" || fields === null) continue;
      clean[lang] = {};
      for (const f of TRANS_TEXT_FIELDS) {
        if (f in fields) clean[lang][f] = String(fields[f] ?? "");
      }
      for (const f of TRANS_LIST_FIELDS) {
        if (f in fields) clean[lang][f] = Array.isArray(fields[f]) ? fields[f] : [];
      }
    }
    updates.translations_json = JSON.stringify(clean);
    for (const [lang, data] of Object.entries(clean)) {
      await env.DB.prepare(
        `INSERT INTO product_translations (id, product_id, lang, data_json, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'))
         ON CONFLICT(product_id, lang) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at`
      ).bind(newId(), existing.id, lang, JSON.stringify(data)).run();
    }
  }
  if (Object.keys(updates).length === 0) return json({ error: "no_fields" }, 400);
  const setParts = Object.keys(updates).map((f) => `${f} = ?`);
  if (needsPublishedAt) setParts.push("published_at = datetime('now')");
  setParts.push("version = version + 1", "updated_at = datetime('now')");
  await env.DB.prepare(
    `UPDATE products SET ${setParts.join(", ")} WHERE public_slug = ? AND tenant_id = ?`
  ).bind(...Object.values(updates), slug, ctx.tenant.id).run();
  await env.DB.prepare(
    "INSERT INTO product_events (id, product_id, event_type, event_data_json, actor_type) VALUES (?, ?, 'updated', ?, 'tenant')"
  ).bind(newId(), existing.id, JSON.stringify({ fields: Object.keys(updates), by: ctx.userId })).run();
  const updated = await env.DB.prepare(
    "SELECT * FROM products WHERE public_slug = ? AND tenant_id = ?"
  ).bind(slug, ctx.tenant.id).first();
  return json(updated);
}
__name(handleUpdateProduct, "handleUpdateProduct");
async function handleDeleteProduct(request, env, slug) {
  const ctx = await requireTenant(request, env);
  if (ctx.error) return json({ error: ctx.error }, ctx.status);
  const product = await env.DB.prepare(
    "SELECT id FROM products WHERE public_slug = ? AND tenant_id = ?"
  ).bind(slug, ctx.tenant.id).first();
  if (!product) return json({ error: "not_found" }, 404);
  await env.DB.prepare(
    "UPDATE products SET status = 'archived', version = version + 1, updated_at = datetime('now') WHERE public_slug = ? AND tenant_id = ?"
  ).bind(slug, ctx.tenant.id).run();
  await env.DB.prepare(
    "INSERT INTO product_events (id, product_id, event_type, event_data_json, actor_type) VALUES (?, ?, 'archived', ?, 'tenant')"
  ).bind(newId(), product.id, JSON.stringify({ by: ctx.userId })).run();
  return json({ ok: true });
}
__name(handleDeleteProduct, "handleDeleteProduct");
async function handleUploadDocument(request, env, slug) {
  const ctx = await requireTenant(request, env);
  if (ctx.error) return json({ error: ctx.error }, ctx.status);
  const product = await env.DB.prepare(
    "SELECT * FROM products WHERE public_slug = ? AND tenant_id = ?"
  ).bind(slug, ctx.tenant.id).first();
  if (!product) return json({ error: "not_found" }, 404);
  let formData;
  try {
    formData = await request.formData();
  } catch {
    return json({ error: "invalid_form" }, 400);
  }
  const file = formData.get("file");
  if (!file || !file.stream) return json({ error: "no_file" }, 400);
  if (!ALLOWED_FILE_TYPES.includes(file.type)) return json({ error: "invalid_file_type" }, 400);
  if (file.size > MAX_FILE_SIZE) return json({ error: "file_too_large" }, 400);
  const ext = (file.name.split(".").pop() || "bin").toLowerCase().slice(0, 10);
  const key = `${ctx.tenant.id}/${product.id}/${crypto.randomUUID()}.${ext}`;
  await env.BUCKET.put(key, file.stream(), {
    httpMetadata: { contentType: file.type },
    customMetadata: { originalName: file.name }
  });
  const fileUrl = `/api/files/${key}`;
  const docId = newId();
  await env.DB.prepare(
    "INSERT INTO product_documents (id, product_id, tenant_id, name, file_key, file_type, file_size) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).bind(docId, product.id, ctx.tenant.id, file.name, key, file.type, file.size || 0).run();
  let docs = [];
  try {
    docs = JSON.parse(product.compliance_documents_json || "[]");
  } catch {
  }
  docs = docs.map((d) => typeof d === "string" ? { name: d, url: "" } : d);
  docs.push({ id: docId, name: file.name, url: fileUrl });
  await env.DB.prepare(
    "UPDATE products SET compliance_documents_json = ?, version = version + 1, updated_at = datetime('now') WHERE public_slug = ? AND tenant_id = ?"
  ).bind(JSON.stringify(docs), slug, ctx.tenant.id).run();
  await env.DB.prepare(
    "INSERT INTO product_events (id, product_id, event_type, event_data_json, actor_type) VALUES (?, ?, 'document_uploaded', ?, 'tenant')"
  ).bind(newId(), product.id, JSON.stringify({ key, name: file.name, by: ctx.userId })).run();
  return json({ id: docId, url: fileUrl, name: file.name }, 201);
}
__name(handleUploadDocument, "handleUploadDocument");
async function handleRegenerateShareLink(request, env, slug) {
  const ctx = await requireTenant(request, env);
  if (ctx.error) return json({ error: ctx.error }, ctx.status);
  const product = await env.DB.prepare(
    "SELECT id FROM products WHERE public_slug = ? AND tenant_id = ?"
  ).bind(slug, ctx.tenant.id).first();
  if (!product) return json({ error: "not_found" }, 404);
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
__name(handleRegenerateShareLink, "handleRegenerateShareLink");
async function handleClaimProduct(request, env, token) {
  const ctx = await requireTenant(request, env);
  if (ctx.error) return json({ error: ctx.error }, ctx.status);
  const product = await env.DB.prepare(
    "SELECT id, public_slug, tenant_id FROM products WHERE owner_token = ?"
  ).bind(token).first();
  if (!product) return json({ error: "not_found" }, 404);
  if (product.tenant_id) return json({ error: "already_claimed", tenant_id: product.tenant_id }, 409);
  await env.DB.prepare(
    "UPDATE products SET tenant_id = ?, updated_at = datetime('now') WHERE owner_token = ?"
  ).bind(ctx.tenant.id, token).run();
  await env.DB.prepare(
    "INSERT INTO product_events (id, product_id, event_type, event_data_json, actor_type) VALUES (?, ?, 'claimed', ?, 'tenant')"
  ).bind(newId(), product.id, JSON.stringify({ tenant_id: ctx.tenant.id, by: ctx.userId })).run();
  return json({ ok: true, slug: product.public_slug, tenant_id: ctx.tenant.id });
}
__name(handleClaimProduct, "handleClaimProduct");

// src/routes/webhooks.js
function clerkRoleToLocal(orgRole) {
  if (orgRole === "org:admin") return "admin";
  return "member";
}
__name(clerkRoleToLocal, "clerkRoleToLocal");
async function handleClerkWebhook(request, env) {
  const secret = env.CLERK_WEBHOOK_SECRET;
  if (!secret) return json({ error: "webhook_not_configured" }, 503);
  const event = await verifyWebhook(request, secret);
  if (!event) return json({ error: "invalid_signature" }, 401);
  const { type, data } = event;
  try {
    switch (type) {
      case "organization.created":
        await handleOrgCreated(env, data);
        break;
      case "organization.updated":
        await handleOrgUpdated(env, data);
        break;
      case "organization.deleted":
        await handleOrgDeleted(env, data);
        break;
      case "organizationMembership.created":
        await handleMembershipCreated(env, data);
        break;
      case "organizationMembership.updated":
        await handleMembershipUpdated(env, data);
        break;
      case "organizationMembership.deleted":
        await handleMembershipDeleted(env, data);
        break;
      default:
        break;
    }
  } catch (err) {
    console.error("Webhook handler error:", type, err);
    return json({ error: "handler_error" }, 500);
  }
  return json({ ok: true });
}
__name(handleClerkWebhook, "handleClerkWebhook");
async function handleOrgCreated(env, data) {
  const existing = await env.DB.prepare(
    "SELECT id FROM tenants WHERE clerk_org_id = ?"
  ).bind(data.id).first();
  if (existing) return;
  await env.DB.prepare(
    `INSERT INTO tenants (id, clerk_org_id, name, slug, status, plan, product_limit)
     VALUES (?, ?, ?, ?, 'trial', 'free', 25)`
  ).bind(newId(), data.id, data.name, data.slug || null).run();
}
__name(handleOrgCreated, "handleOrgCreated");
async function handleOrgUpdated(env, data) {
  await env.DB.prepare(
    "UPDATE tenants SET name = ?, slug = ?, updated_at = datetime('now') WHERE clerk_org_id = ?"
  ).bind(data.name, data.slug || null, data.id).run();
}
__name(handleOrgUpdated, "handleOrgUpdated");
async function handleOrgDeleted(env, data) {
  await env.DB.prepare(
    "UPDATE tenants SET status = 'inactive', deleted_at = datetime('now'), updated_at = datetime('now') WHERE clerk_org_id = ?"
  ).bind(data.id).run();
}
__name(handleOrgDeleted, "handleOrgDeleted");
async function handleMembershipCreated(env, data) {
  const clerkOrgId = data.organization?.id;
  const clerkUserId = data.public_user_data?.user_id;
  if (!clerkOrgId || !clerkUserId) return;
  const tenant = await env.DB.prepare(
    "SELECT id FROM tenants WHERE clerk_org_id = ?"
  ).bind(clerkOrgId).first();
  if (!tenant) return;
  const role = clerkRoleToLocal(data.role);
  await env.DB.prepare(
    `INSERT INTO tenant_users (id, tenant_id, clerk_user_id, role)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(tenant_id, clerk_user_id) DO UPDATE SET role = excluded.role`
  ).bind(newId(), tenant.id, clerkUserId, role).run();
}
__name(handleMembershipCreated, "handleMembershipCreated");
async function handleMembershipUpdated(env, data) {
  const clerkOrgId = data.organization?.id;
  const clerkUserId = data.public_user_data?.user_id;
  if (!clerkOrgId || !clerkUserId) return;
  const tenant = await env.DB.prepare(
    "SELECT id FROM tenants WHERE clerk_org_id = ?"
  ).bind(clerkOrgId).first();
  if (!tenant) return;
  const role = clerkRoleToLocal(data.role);
  await env.DB.prepare(
    "UPDATE tenant_users SET role = ? WHERE tenant_id = ? AND clerk_user_id = ?"
  ).bind(role, tenant.id, clerkUserId).run();
}
__name(handleMembershipUpdated, "handleMembershipUpdated");
async function handleMembershipDeleted(env, data) {
  const clerkOrgId = data.organization?.id;
  const clerkUserId = data.public_user_data?.user_id;
  if (!clerkOrgId || !clerkUserId) return;
  const tenant = await env.DB.prepare(
    "SELECT id FROM tenants WHERE clerk_org_id = ?"
  ).bind(clerkOrgId).first();
  if (!tenant) return;
  await env.DB.prepare(
    "DELETE FROM tenant_users WHERE tenant_id = ? AND clerk_user_id = ?"
  ).bind(tenant.id, clerkUserId).run();
}
__name(handleMembershipDeleted, "handleMembershipDeleted");

// src/routes/compliance.js
function parseCondition(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return { always: true };
  }
}
__name(parseCondition, "parseCondition");
function conditionApplies(condition, categoryCode) {
  if (condition.always) return true;
  if (condition.category_codes) {
    return Boolean(categoryCode) && condition.category_codes.includes(categoryCode);
  }
  return false;
}
__name(conditionApplies, "conditionApplies");
function evaluateRule(rule, product, categoryCode, documents) {
  const condition = parseCondition(rule.condition_json);
  if (!conditionApplies(condition, categoryCode)) return { applies: false, pass: false };
  switch (rule.rule_type) {
    case "required_field": {
      const val = product[rule.field_path];
      return { applies: true, pass: val != null && String(val).trim() !== "" };
    }
    case "required_array_min": {
      const min = condition.min ?? 1;
      let arr = [];
      try {
        arr = JSON.parse(product[rule.field_path] || "[]");
      } catch {
      }
      return { applies: true, pass: Array.isArray(arr) && arr.length >= min };
    }
    case "required_document": {
      const pat = condition.doc_name_pattern;
      if (!pat) return { applies: true, pass: documents.length > 0 };
      let re;
      try {
        re = new RegExp(pat, "i");
      } catch {
        return { applies: true, pass: false };
      }
      return { applies: true, pass: documents.some((d) => re.test(d.name || "")) };
    }
    default:
      return { applies: false, pass: false };
  }
}
__name(evaluateRule, "evaluateRule");
function computeScore(ruleResults) {
  let total = 0, passing = 0;
  for (const { severity, pass } of ruleResults) {
    const w = severity === "error" ? 2 : severity === "warning" ? 1 : 0;
    total += w;
    if (pass) passing += w;
  }
  return total === 0 ? 100 : Math.round(passing / total * 100);
}
__name(computeScore, "computeScore");
async function handleCompliance(env, productUid) {
  if (!productUid) return json({ error: "not_found" }, 404);
  const product = await env.DB.prepare(
    "SELECT * FROM products WHERE product_uid = ?"
  ).bind(productUid).first();
  if (!product || product.status === "archived") return json({ error: "not_found" }, 404);
  const cached = await env.DB.prepare(
    "SELECT product_version, result_json FROM compliance_results WHERE product_id = ?"
  ).bind(product.id).first();
  if (cached && cached.product_version === product.version) {
    try {
      return json({ ...JSON.parse(cached.result_json), cached: true });
    } catch {
    }
  }
  let categoryCode = null;
  if (product.category_id) {
    const cat = await env.DB.prepare(
      "SELECT code FROM product_categories WHERE id = ?"
    ).bind(product.category_id).first();
    categoryCode = cat?.code ?? null;
  }
  let targetMarkets = ["EU"];
  try {
    targetMarkets = JSON.parse(product.target_markets_json || '["EU"]');
  } catch {
  }
  const activeRegIds = /* @__PURE__ */ new Set();
  if (product.category_id) {
    const marketPh = targetMarkets.map(() => "?").join(", ");
    const { results: mandatory } = await env.DB.prepare(`
      SELECT cr.regulation_id FROM category_regulations cr
      JOIN regulations r ON r.id = cr.regulation_id
      WHERE cr.category_id = ? AND cr.mandatory = 1 AND r.status = 'active'
        AND cr.market IN ('*', ${marketPh})
    `).bind(product.category_id, ...targetMarkets).all();
    for (const row of mandatory) activeRegIds.add(row.regulation_id);
  }
  const { results: globalRegs } = await env.DB.prepare(`
    SELECT DISTINCT rr.regulation_id
    FROM regulation_rules rr
    JOIN regulations r ON r.id = rr.regulation_id
    WHERE rr.condition_json LIKE '%"always":true%'
      AND r.status = 'active'
  `).all();
  for (const row of globalRegs) activeRegIds.add(row.regulation_id);
  if (product.tenant_id) {
    const { results: overrides } = await env.DB.prepare(
      "SELECT regulation_id, enabled FROM tenant_regulations WHERE tenant_id = ?"
    ).bind(product.tenant_id).all();
    for (const row of overrides) {
      if (row.enabled === 1) activeRegIds.add(row.regulation_id);
      else activeRegIds.delete(row.regulation_id);
    }
  }
  let rules = [];
  if (activeRegIds.size > 0) {
    const ph = Array.from(activeRegIds).map(() => "?").join(", ");
    const { results } = await env.DB.prepare(`
      SELECT rr.*, r.code AS reg_code, r.name AS reg_name,
             r.version AS reg_version, r.status AS reg_status
      FROM regulation_rules rr
      JOIN regulations r ON r.id = rr.regulation_id
      WHERE rr.regulation_id IN (${ph})
    `).bind(...Array.from(activeRegIds)).all();
    rules = results;
  }
  const { results: dbDocs } = await env.DB.prepare(
    "SELECT name FROM product_documents WHERE product_id = ?"
  ).bind(product.id).all();
  let blobDocs = [];
  try {
    blobDocs = JSON.parse(product.compliance_documents_json || "[]");
  } catch {
  }
  const allDocuments = [...dbDocs, ...blobDocs];
  const missing = [], warnings = [], info = [], passed = [];
  const ruleResults = [], appliedCodes = [];
  let hasErrorFail = false;
  for (const rule of rules) {
    const { applies, pass } = evaluateRule(rule, product, categoryCode, allDocuments);
    if (!applies) continue;
    appliedCodes.push(rule.rule_code);
    ruleResults.push({ severity: rule.severity, pass });
    const entry = {
      rule_code: rule.rule_code,
      regulation: rule.reg_code,
      severity: rule.severity,
      field: rule.field_path ?? null,
      message_en: rule.message_en,
      message_fi: rule.message_fi
    };
    if (pass) {
      passed.push({ rule_code: rule.rule_code, regulation: rule.reg_code });
    } else {
      if (rule.severity === "error") {
        missing.push(entry);
        hasErrorFail = true;
      } else if (rule.severity === "warning") warnings.push(entry);
      else info.push(entry);
    }
  }
  const score = ruleResults.length === 0 ? 0 : computeScore(ruleResults);
  const status = hasErrorFail || ruleResults.length === 0 ? "incomplete" : "complete";
  const regMap = /* @__PURE__ */ new Map();
  for (const r of rules) {
    if (!regMap.has(r.reg_code)) {
      regMap.set(r.reg_code, {
        code: r.reg_code,
        name: r.reg_name,
        version: r.reg_version,
        status: r.reg_status
      });
    }
  }
  const result = {
    product_uid: product.product_uid,
    computed_at: (/* @__PURE__ */ new Date()).toISOString(),
    product_version: product.version,
    cached: false,
    status,
    score,
    // verification_suggested = true signals that a human/admin may promote compliance_status
    // to 'verified'. The engine never sets compliance_status = 'verified' automatically.
    verification_suggested: status === "complete" && score >= 95,
    category: categoryCode,
    target_markets: targetMarkets,
    missing,
    warnings,
    info,
    passed,
    rules_applied: appliedCodes,
    regulations_applied: Array.from(regMap.values())
  };
  const cacheId = crypto.randomUUID().replace(/-/g, "");
  await env.DB.prepare(`
    INSERT INTO compliance_results (id, product_id, computed_at, product_version, status, score, result_json)
    VALUES (?, ?, datetime('now'), ?, ?, ?, ?)
    ON CONFLICT(product_id) DO UPDATE SET
      computed_at       = excluded.computed_at,
      product_version   = excluded.product_version,
      status            = excluded.status,
      score             = excluded.score,
      result_json       = excluded.result_json
  `).bind(cacheId, product.id, product.version, status, score, JSON.stringify(result)).run();
  return json(result);
}
__name(handleCompliance, "handleCompliance");

// src/worker.js
function serveAsset(request, env, pathname) {
  const target = new URL(request.url);
  target.pathname = pathname;
  return env.ASSETS.fetch(new Request(target, request));
}
__name(serveAsset, "serveAsset");
function withCors(response, request, env) {
  const origin = env.CORS_ORIGIN || request.headers.get("Origin") || "*";
  const r = new Response(response.body, response);
  r.headers.set("Access-Control-Allow-Origin", origin);
  r.headers.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  r.headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  r.headers.set("Access-Control-Allow-Credentials", "true");
  r.headers.set("Access-Control-Max-Age", "86400");
  return r;
}
__name(withCors, "withCors");
var worker_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;
    if (pathname.startsWith("/p/")) return serveAsset(request, env, "/product");
    if (pathname.startsWith("/owner/")) return serveAsset(request, env, "/owner");
    if (method === "OPTIONS" && pathname.startsWith("/api/")) {
      return withCors(new Response(null, { status: 204 }), request, env);
    }
    let response;
    if (pathname.startsWith("/api/public/product/") && method === "GET") {
      const slug = decodeURIComponent(pathname.slice("/api/public/product/".length));
      response = await handlePublicProduct(env, slug);
    } else if (pathname.startsWith("/api/passport/") && method === "GET") {
      const uid = decodeURIComponent(pathname.slice("/api/passport/".length));
      response = await handlePassport(env, uid);
    } else if (pathname.startsWith("/api/v1/passport/") && pathname.endsWith("/compliance") && method === "GET") {
      const rest = pathname.slice("/api/v1/passport/".length);
      const uid = decodeURIComponent(rest.slice(0, -"/compliance".length));
      response = await handleCompliance(env, uid);
    } else if (pathname.startsWith("/api/v1/passport/") && method === "GET") {
      const uid = decodeURIComponent(pathname.slice("/api/v1/passport/".length));
      response = await handlePassport(env, uid);
    } else if (pathname.startsWith("/api/owner/product/")) {
      const rest = pathname.slice("/api/owner/product/".length);
      if (rest.endsWith("/document") && method === "POST") {
        const token = decodeURIComponent(rest.slice(0, -"/document".length));
        response = await handleOwnerUploadDocument(request, env, token);
      } else {
        const token = decodeURIComponent(rest);
        if (method === "GET") response = await handleGetOwnerProduct(env, token);
        if (method === "POST") response = await handleUpdateOwnerProduct(request, env, token);
      }
    } else if (pathname.startsWith("/api/files/") && method === "GET") {
      response = await handleServeFile(env, pathname.slice("/api/files/".length));
    } else if (pathname === "/api/webhooks/clerk" && method === "POST") {
      response = await handleClerkWebhook(request, env);
    } else if (pathname.startsWith("/api/tenant/")) {
      const rest = pathname.slice("/api/tenant/".length);
      if (rest === "products" && method === "GET") {
        response = await handleListProducts(request, env);
      } else if (rest === "product" && method === "POST") {
        response = await handleCreateProduct2(request, env);
      } else if (rest.startsWith("claim/") && method === "POST") {
        const token = decodeURIComponent(rest.slice("claim/".length));
        response = await handleClaimProduct(request, env, token);
      } else if (rest.startsWith("product/")) {
        const productRest = rest.slice("product/".length);
        if (productRest.endsWith("/document") && method === "POST") {
          const slug = decodeURIComponent(productRest.slice(0, -"/document".length));
          response = await handleUploadDocument(request, env, slug);
        } else if (productRest.endsWith("/share-link") && method === "POST") {
          const slug = decodeURIComponent(productRest.slice(0, -"/share-link".length));
          response = await handleRegenerateShareLink(request, env, slug);
        } else {
          const slug = decodeURIComponent(productRest);
          if (method === "GET") response = await handleGetProduct(request, env, slug);
          if (method === "POST") response = await handleUpdateProduct(request, env, slug);
          if (method === "DELETE") response = await handleDeleteProduct(request, env, slug);
        }
      }
    } else if (pathname.startsWith("/api/admin/")) {
      const rest = pathname.slice("/api/admin/".length);
      if (rest === "tenants" && method === "GET") {
        response = await handleListTenants(request, env);
      } else if (rest === "products/unclaimed" && method === "GET") {
        response = await handleListUnclaimedProducts(request, env);
      } else if (rest.startsWith("tenant/")) {
        const tenantRest = rest.slice("tenant/".length);
        const tenantSlashIdx = tenantRest.indexOf("/");
        if (tenantSlashIdx === -1) {
          if (method === "GET") response = await handleGetTenant(request, env, tenantRest);
          if (method === "POST") response = await handleUpdateTenant(request, env, tenantRest);
        } else {
          const tenantId = tenantRest.slice(0, tenantSlashIdx);
          const afterTenant = tenantRest.slice(tenantSlashIdx + 1);
          if (afterTenant === "product" && method === "POST") {
            response = await handleAdminCreateProductForTenant(request, env, tenantId);
          } else if (afterTenant.startsWith("product/") && afterTenant.endsWith("/claim") && method === "POST") {
            const slug = decodeURIComponent(afterTenant.slice("product/".length, -"/claim".length));
            response = await handleAdminClaimProduct(request, env, tenantId, slug);
          }
        }
      } else if (rest === "product/create" && method === "POST") {
        response = await handleCreateProduct(request, env);
      } else if (rest.startsWith("product/") && rest.endsWith("/carrier") && method === "POST") {
        const slug = decodeURIComponent(rest.slice("product/".length, -"/carrier".length));
        response = await handleUpdateCarrier(request, env, slug);
      } else if (rest.startsWith("product/") && method === "GET") {
        const slug = decodeURIComponent(rest.slice("product/".length));
        response = await handleGetAdminProduct(request, env, slug);
      }
    }
    if (pathname.startsWith("/api/") && !response) {
      response = json({ error: "not_found" }, 404);
    }
    if (!response) return env.ASSETS.fetch(request);
    return withCors(response, request, env);
  }
};
export {
  worker_default as default
};
//# sourceMappingURL=worker.js.map
