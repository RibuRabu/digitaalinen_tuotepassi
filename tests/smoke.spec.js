import { test, expect } from '@playwright/test';

// ── Public API ────────────────────────────────────────────────────────────────

test('GET /api/public/product/:slug → 404 for non-existent product', async ({ request }) => {
  const res = await request.get('/api/public/product/nonexistent-slug-000');
  expect(res.status()).toBe(404);
  const body = await res.json();
  expect(body.error).toBe('not_found');
});

test('GET /api/passport/:uid → 404 for non-existent UID', async ({ request }) => {
  const res = await request.get('/api/passport/00000000-0000-0000-0000-000000000000');
  expect(res.status()).toBe(404);
  const body = await res.json();
  expect(body.error).toBe('not_found');
});

test('GET /api/v1/passport/:uid → 404 for non-existent UID', async ({ request }) => {
  const res = await request.get('/api/v1/passport/00000000-0000-0000-0000-000000000000');
  expect(res.status()).toBe(404);
});

test('GET /api/v1/passport/:uid/compliance → 404 for non-existent UID', async ({ request }) => {
  const res = await request.get('/api/v1/passport/00000000-0000-0000-0000-000000000000/compliance');
  expect(res.status()).toBe(404);
});

// ── Unknown API route → 404, not 500 ─────────────────────────────────────────

test('GET /api/nonexistent → 404 not_found', async ({ request }) => {
  const res = await request.get('/api/nonexistent');
  expect(res.status()).toBe(404);
  const body = await res.json();
  expect(body.error).toBe('not_found');
});

// ── Auth-required endpoints return 401 without Bearer token ──────────────────

test('GET /api/tenant/self → 401 without auth', async ({ request }) => {
  const res = await request.get('/api/tenant/self');
  expect(res.status()).toBe(401);
});

test('GET /api/tenant/products → 401 without auth', async ({ request }) => {
  const res = await request.get('/api/tenant/products');
  expect(res.status()).toBe(401);
});

test('GET /api/admin/tenants → 401 without auth', async ({ request }) => {
  const res = await request.get('/api/admin/tenants');
  expect(res.status()).toBe(401);
});

test('GET /api/admin/billing → 401 without auth', async ({ request }) => {
  const res = await request.get('/api/admin/billing');
  expect(res.status()).toBe(401);
});

test('GET /api/admin/stats → 401 without auth', async ({ request }) => {
  const res = await request.get('/api/admin/stats');
  expect(res.status()).toBe(401);
});

// ── CORS ──────────────────────────────────────────────────────────────────────

test('OPTIONS preflight → 204 with CORS headers', async ({ request }) => {
  const res = await request.fetch('/api/public/product/test', {
    method: 'OPTIONS',
    headers: {
      'Origin': 'https://dashboard.tulkintatila.fi',
      'Access-Control-Request-Method': 'GET',
    },
  });
  expect(res.status()).toBe(204);
  expect(res.headers()['access-control-allow-origin']).toBeTruthy();
  expect(res.headers()['access-control-allow-methods']).toContain('GET');
});

test('GET /api/public/product/:slug response has CORS header', async ({ request }) => {
  const res = await request.get('/api/public/product/nonexistent-slug-000', {
    headers: { 'Origin': 'https://dashboard.tulkintatila.fi' },
  });
  expect(res.headers()['access-control-allow-origin']).toBeTruthy();
});
