import { json } from './utils.js';
import { handlePublicProduct, handlePassport, handleListCategories } from './routes/public.js';
import { handleGetOwnerProduct, handleUpdateOwnerProduct, handleOwnerUploadDocument, handleOwnerDeleteDocument } from './routes/owner.js';
import { handleServeFile } from './routes/files.js';
import {
  handleGetAdminProduct, handleCreateProduct, handleUpdateCarrier,
  handleListTenants, handleGetTenant, handleListUnclaimedProducts,
  handleAdminClaimProduct, handleUpdateTenant, handleAdminCreateProductForTenant,
  handleAdminStats, handleListBilling, handleUpdateBilling, handleDeleteTenant,
} from './routes/admin.js';
import {
  handleGetTenantSelf,
  handleListProducts, handleCreateProduct as handleTenantCreateProduct,
  handleGetProduct, handleUpdateProduct, handleDeleteProduct,
  handleUploadDocument, handleRegenerateShareLink, handleClaimProduct,
} from './routes/tenant.js';
import { handleClerkWebhook } from './routes/webhooks.js';
import { handleCompliance } from './routes/compliance.js';

async function serveAsset(request, env, pathname) {
  const target = new URL(request.url);
  target.pathname = pathname;
  const r = await env.ASSETS.fetch(new Request(target, request));
  return withSecurityHeaders(r);
}

function withSecurityHeaders(response) {
  const r = new Response(response.body, response);
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "connect-src 'self'",
    "img-src 'self' data: blob:",
    "frame-ancestors 'none'",
  ].join('; ');
  r.headers.set('Content-Security-Policy', csp);
  r.headers.set('X-Content-Type-Options', 'nosniff');
  r.headers.set('X-Frame-Options', 'DENY');
  r.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  return r;
}

function withCors(response, request, env) {
  const origin = env.CORS_ORIGIN || request.headers.get('Origin') || '*';
  const r = new Response(response.body, response);
  r.headers.set('Access-Control-Allow-Origin', origin);
  r.headers.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  r.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Organization-Id');
  r.headers.set('Access-Control-Allow-Credentials', 'true');
  r.headers.set('Access-Control-Max-Age', '86400');
  return r;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;

    // ── Static pages ─────────────────────────────────────────────────────────
    if (pathname.startsWith('/p/'))     return serveAsset(request, env, '/product');
    if (pathname.startsWith('/owner/')) return serveAsset(request, env, '/owner');
    if (pathname === '/tietosuoja' || pathname === '/tietosuoja/')   return serveAsset(request, env, '/tietosuoja');
    if (pathname === '/kayttoehdot' || pathname === '/kayttoehdot/') return serveAsset(request, env, '/kayttoehdot');
    if (pathname === '/pricing' || pathname === '/pricing/')         return serveAsset(request, env, '/pricing');

    // ── CORS preflight ───────────────────────────────────────────────────────
    if (method === 'OPTIONS' && pathname.startsWith('/api/')) {
      return withCors(new Response(null, { status: 204 }), request, env);
    }

    let response;

    try {

    // ── Public API (no auth) ─────────────────────────────────────────────────
    if (pathname.startsWith('/api/public/product/') && method === 'GET') {
      const slug = decodeURIComponent(pathname.slice('/api/public/product/'.length));
      response = await handlePublicProduct(env, slug);
    }

    // ── Product categories (no auth) ─────────────────────────────────────────
    else if (pathname === '/api/public/categories' && method === 'GET') {
      response = await handleListCategories(env);
    }

    // ── Machine-readable passport (no auth) ──────────────────────────────────
    else if (pathname.startsWith('/api/passport/') && method === 'GET') {
      const uid = decodeURIComponent(pathname.slice('/api/passport/'.length));
      response = await handlePassport(env, uid);
    }

    // ── Versioned compliance check ────────────────────────────────────────────
    else if (pathname.startsWith('/api/v1/passport/') && pathname.endsWith('/compliance') && method === 'GET') {
      const rest = pathname.slice('/api/v1/passport/'.length);
      const uid = decodeURIComponent(rest.slice(0, -'/compliance'.length));
      response = await handleCompliance(env, uid);
    }

    // ── Versioned passport alias — stable for EU regulatory integrations ───────
    else if (pathname.startsWith('/api/v1/passport/') && method === 'GET') {
      const uid = decodeURIComponent(pathname.slice('/api/v1/passport/'.length));
      response = await handlePassport(env, uid);
    }

    // ── Owner (capability-URL, no Clerk) ─────────────────────────────────────
    else if (pathname.startsWith('/api/owner/product/')) {
      const rest = pathname.slice('/api/owner/product/'.length);
      if (rest.endsWith('/document') && method === 'POST') {
        const token = decodeURIComponent(rest.slice(0, -'/document'.length));
        response = await handleOwnerUploadDocument(request, env, token);
      } else if (rest.includes('/document/') && method === 'DELETE') {
        const parts = rest.split('/document/');
        const token = decodeURIComponent(parts[0]);
        const docId = decodeURIComponent(parts[1] || '');
        response = await handleOwnerDeleteDocument(env, token, docId);
      } else {
        const token = decodeURIComponent(rest);
        if (method === 'GET')  response = await handleGetOwnerProduct(env, token);
        if (method === 'POST') response = await handleUpdateOwnerProduct(request, env, token);
      }
    }

    // ── File serving ──────────────────────────────────────────────────────────
    else if (pathname.startsWith('/api/files/') && method === 'GET') {
      response = await handleServeFile(env, pathname.slice('/api/files/'.length));
    }

    // ── Clerk webhook ─────────────────────────────────────────────────────────
    else if (pathname === '/api/webhooks/clerk' && method === 'POST') {
      response = await handleClerkWebhook(request, env);
    }

    // ── Tenant API (Clerk JWT auth) ───────────────────────────────────────────
    else if (pathname.startsWith('/api/tenant/')) {
      const rest = pathname.slice('/api/tenant/'.length);

      if (rest === 'self' && method === 'GET') {
        response = await handleGetTenantSelf(request, env);
      }
      else if (rest === 'products' && method === 'GET') {
        response = await handleListProducts(request, env);
      }
      else if (rest === 'product' && method === 'POST') {
        response = await handleTenantCreateProduct(request, env);
      }
      else if (rest.startsWith('claim/') && method === 'POST') {
        const token = decodeURIComponent(rest.slice('claim/'.length));
        response = await handleClaimProduct(request, env, token);
      }
      else if (rest.startsWith('product/')) {
        const productRest = rest.slice('product/'.length);
        if (productRest.endsWith('/document') && method === 'POST') {
          const slug = decodeURIComponent(productRest.slice(0, -'/document'.length));
          response = await handleUploadDocument(request, env, slug);
        }
        else if (productRest.endsWith('/share-link') && method === 'POST') {
          const slug = decodeURIComponent(productRest.slice(0, -'/share-link'.length));
          response = await handleRegenerateShareLink(request, env, slug);
        }
        else {
          const slug = decodeURIComponent(productRest);
          if (method === 'GET')    response = await handleGetProduct(request, env, slug);
          if (method === 'POST')   response = await handleUpdateProduct(request, env, slug);
          if (method === 'DELETE') response = await handleDeleteProduct(request, env, slug);
        }
      }
    }

    // ── Platform admin API (Clerk JWT + platform_users) ───────────────────────
    else if (pathname.startsWith('/api/admin/')) {
      const rest = pathname.slice('/api/admin/'.length);

      // Platform admin routes (Clerk auth)
      if (rest === 'stats' && method === 'GET') {
        response = await handleAdminStats(request, env);
      }
      else if (rest === 'billing' && method === 'GET') {
        response = await handleListBilling(request, env);
      }
      else if (rest === 'tenants' && method === 'GET') {
        response = await handleListTenants(request, env);
      }
      else if (rest === 'products/unclaimed' && method === 'GET') {
        response = await handleListUnclaimedProducts(request, env);
      }
      else if (rest.startsWith('tenant/')) {
        const tenantRest = rest.slice('tenant/'.length);
        const tenantSlashIdx = tenantRest.indexOf('/');

        if (tenantSlashIdx === -1) {
          // /api/admin/tenant/:id
          if (method === 'GET')    response = await handleGetTenant(request, env, tenantRest);
          if (method === 'POST')   response = await handleUpdateTenant(request, env, tenantRest);
          if (method === 'DELETE') response = await handleDeleteTenant(request, env, tenantRest);
        } else {
          const tenantId = tenantRest.slice(0, tenantSlashIdx);
          const afterTenant = tenantRest.slice(tenantSlashIdx + 1);
          if (afterTenant === 'billing' && method === 'POST') {
            response = await handleUpdateBilling(request, env, tenantId);
          }
          else if (afterTenant === 'product' && method === 'POST') {
            response = await handleAdminCreateProductForTenant(request, env, tenantId);
          }
          else if (afterTenant.startsWith('product/') && afterTenant.endsWith('/claim') && method === 'POST') {
            const slug = decodeURIComponent(afterTenant.slice('product/'.length, -'/claim'.length));
            response = await handleAdminClaimProduct(request, env, tenantId, slug);
          }
        }
      }

      // Legacy admin routes (ADMIN_SECRET auth)
      else if (rest === 'product/create' && method === 'POST') {
        response = await handleCreateProduct(request, env);
      }
      else if (rest.startsWith('product/') && rest.endsWith('/carrier') && method === 'POST') {
        const slug = decodeURIComponent(rest.slice('product/'.length, -'/carrier'.length));
        response = await handleUpdateCarrier(request, env, slug);
      }
      else if (rest.startsWith('product/') && method === 'GET') {
        const slug = decodeURIComponent(rest.slice('product/'.length));
        response = await handleGetAdminProduct(request, env, slug);
      }
    }

    } catch (err) {
      console.error(JSON.stringify({
        level: 'error',
        event: 'unhandled_exception',
        method,
        pathname,
        message: err?.message ?? String(err),
        stack: err?.stack?.split('\n').slice(0, 5).join(' | ') ?? null,
      }));
      response = json({ error: 'internal_error' }, 500);
    }

    // ── Unmatched API route ───────────────────────────────────────────────────
    if (pathname.startsWith('/api/') && !response) {
      response = json({ error: 'not_found' }, 404);
    }

    // ── Static assets fallthrough ─────────────────────────────────────────────
    if (pathname === '/admin.html') return json({ error: 'not_found' }, 404);
    if (!response) {
      const r = await env.ASSETS.fetch(request);
      if (r.status === 404) {
        const page = await serveAsset(request, env, '/404');
        return new Response(page.body, { status: 404, headers: page.headers });
      }
      return withSecurityHeaders(r);
    }

    return withCors(response, request, env);
  },
};
