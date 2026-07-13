const JWKS_CACHE_KEY = 'clerk_jwks';
const JWKS_CACHE_TTL = 21600; // 6 hours

async function fetchJWKS(env) {
  const url = env.CLERK_JWKS_URL;
  if (!url) throw new Error('CLERK_JWKS_URL not configured');
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
  return res.json();
}

async function getJWKS(env) {
  if (env.KV) {
    const cached = await env.KV.get(JWKS_CACHE_KEY, 'json');
    if (cached) return cached;
  }
  const jwks = await fetchJWKS(env);
  if (env.KV) {
    await env.KV.put(JWKS_CACHE_KEY, JSON.stringify(jwks), { expirationTtl: JWKS_CACHE_TTL });
  }
  return jwks;
}

function b64urlDecode(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - str.length % 4) % 4);
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

function b64Decode(str) {
  return Uint8Array.from(atob(str), c => c.charCodeAt(0));
}

function parseB64Json(str) {
  try { return JSON.parse(new TextDecoder().decode(b64urlDecode(str))); } catch { return null; }
}

export async function verifyClerkJWT(token, env) {
  if (!token || !env.CLERK_JWKS_URL) return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const header = parseB64Json(parts[0]);
  if (!header) return null;

  let jwks;
  try {
    jwks = await getJWKS(env);
  } catch {
    // On fetch failure, clear cache and retry once
    if (env.KV) await env.KV.delete(JWKS_CACHE_KEY).catch(() => {});
    try { jwks = await fetchJWKS(env); } catch { return null; }
  }

  const jwk = (jwks.keys || []).find(k => k.kid === header.kid && k.use === 'sig');
  if (!jwk) return null;

  let key;
  try {
    key = await crypto.subtle.importKey(
      'jwk', jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false, ['verify']
    );
  } catch { return null; }

  const message = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const signature = b64urlDecode(parts[2]);

  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, message);
  if (!valid) return null;

  const payload = parseB64Json(parts[1]);
  if (!payload) return null;
  const now = Date.now() / 1000;
  if (payload.exp && now > payload.exp) return null;
  if (payload.nbf && now < payload.nbf) return null;

  return payload;
}

export function extractBearerToken(request) {
  const auth = request.headers.get('authorization') || '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : null;
}

// Resolves and authorizes tenant access for an authenticated user.
// Returns { tenant, userId, orgRole } on success, { error, status } on blocked, or null on not-found.
//
// Authorization requires ALL of:
//   1. a resolved org_id on the payload (caller supplies it; see requireTenant)
//   2. a payload.sub identifying the authenticated user
//   3. an existing, non-deleted tenant for that clerk_org_id
//   4. an allowed tenant status (trial | active)
//   5. an active membership of payload.sub in that tenant (tenant_users row)
//
// Membership (5) is what makes the X-Organization-Id selection hint safe: the
// org id is only ever honoured for a user who is actually a member of it.
export async function getTenantContext(payload, env) {
  if (!payload?.org_id) return null;
  if (!payload?.sub) return null;

  const tenant = await env.DB.prepare(
    'SELECT * FROM tenants WHERE clerk_org_id = ? AND deleted_at IS NULL'
  ).bind(payload.org_id).first();

  if (!tenant) return null;

  // trial and active are allowed; all other statuses are blocked — return specific error.
  // Checked before membership so a real member of a suspended tenant gets the precise reason.
  if (!['trial', 'active'].includes(tenant.status)) {
    return { error: `tenant_${tenant.status}`, status: 403 };
  }

  // Membership enforcement. A row in tenant_users is the authoritative proof that
  // this user belongs to this tenant. Removal (organizationMembership.deleted) hard-deletes
  // the row, so "row exists" == "active membership".
  const member = await env.DB.prepare(
    'SELECT 1 AS ok FROM tenant_users WHERE tenant_id = ? AND clerk_user_id = ?'
  ).bind(tenant.id, payload.sub).first();

  if (!member) {
    return { error: 'tenant_membership_required', status: 403 };
  }

  return { tenant, userId: payload.sub, orgRole: payload.org_role };
}

// Returns platform_users row or null
export async function getPlatformContext(payload, env) {
  if (!payload?.sub) return null;
  return env.DB.prepare(
    'SELECT * FROM platform_users WHERE clerk_user_id = ?'
  ).bind(payload.sub).first();
}

// Verify a Clerk webhook request using svix signature headers
export async function verifyWebhook(request, secret) {
  if (!secret) return null;

  const svixId = request.headers.get('svix-id');
  const svixTs = request.headers.get('svix-timestamp');
  const svixSig = request.headers.get('svix-signature');
  if (!svixId || !svixTs || !svixSig) return null;

  const ts = parseInt(svixTs, 10);
  if (isNaN(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return null;

  const body = await request.text();
  const msgBytes = new TextEncoder().encode(`${svixId}.${svixTs}.${body}`);

  const secretBase64 = secret.startsWith('whsec_') ? secret.slice(6) : secret;
  const secretBytes = b64Decode(secretBase64);

  let key;
  try {
    key = await crypto.subtle.importKey(
      'raw', secretBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    );
  } catch { return null; }

  const sigs = svixSig.split(' ').filter(s => s.startsWith('v1,'));
  for (const s of sigs) {
    const sigBytes = b64Decode(s.slice(3));
    if (await crypto.subtle.verify('HMAC', key, sigBytes, msgBytes)) {
      try { return JSON.parse(body); } catch { return null; }
    }
  }

  return null;
}
