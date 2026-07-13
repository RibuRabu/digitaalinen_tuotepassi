// Regression tests for tenant authorization (getTenantContext membership enforcement).
// Run: node --test tests/tenant-auth.test.mjs
// Uses an in-memory mock of env.DB — no network, no real Clerk, synthetic tenants/users only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getTenantContext } from '../src/auth/clerk.js';

// ── Synthetic fixtures ───────────────────────────────────────────────────────
// Two tenants (A, B) and one suspended tenant. Membership: userA ∈ A only.
const TENANTS = [
  { id: 'tenant_A', clerk_org_id: 'org_A', name: 'Tenant A', status: 'trial',  deleted_at: null },
  { id: 'tenant_B', clerk_org_id: 'org_B', name: 'Tenant B', status: 'active', deleted_at: null },
  { id: 'tenant_S', clerk_org_id: 'org_S', name: 'Suspended', status: 'suspended', deleted_at: null },
  { id: 'tenant_D', clerk_org_id: 'org_D', name: 'Deleted',  status: 'trial', deleted_at: '2026-01-01' },
];
const MEMBERSHIPS = [
  { tenant_id: 'tenant_A', clerk_user_id: 'user_A', role: 'admin' },
  { tenant_id: 'tenant_B', clerk_user_id: 'user_B', role: 'member' },
  { tenant_id: 'tenant_S', clerk_user_id: 'user_S', role: 'admin' },
];

// Minimal env.DB mock implementing the exact queries getTenantContext runs.
function mockEnv({ memberships = MEMBERSHIPS } = {}) {
  return { DB: {
    prepare(sql) {
      return {
        _b: [],
        bind(...a) { this._b = a; return this; },
        async first() {
          if (sql.includes('FROM tenants')) {
            const [orgId] = this._b;
            return TENANTS.find(t => t.clerk_org_id === orgId && t.deleted_at === null) ?? null;
          }
          if (sql.includes('FROM tenant_users')) {
            const [tenantId, userId] = this._b;
            const m = memberships.find(x => x.tenant_id === tenantId && x.clerk_user_id === userId);
            return m ? { ok: 1 } : null;
          }
          throw new Error('unexpected query: ' + sql);
        },
      };
    },
  }};
}

// 1. Valid user + valid membership + signed org_id → allowed
test('member with signed org_id is allowed', async () => {
  const ctx = await getTenantContext({ sub: 'user_A', org_id: 'org_A', org_role: 'org:admin' }, mockEnv());
  assert.equal(ctx.tenant.id, 'tenant_A');
  assert.equal(ctx.userId, 'user_A');
});

// 2. Valid user + membership + header-selected org (org_id came from header hint) → allowed
test('member via header-selected org is allowed', async () => {
  // requireTenant sets payload.org_id from the header; here org_id resolves to a tenant the user belongs to.
  const ctx = await getTenantContext({ sub: 'user_B', org_id: 'org_B' }, mockEnv());
  assert.equal(ctx.tenant.id, 'tenant_B');
});

// 3. Valid user + no membership → 403 tenant_membership_required
test('authenticated non-member is rejected', async () => {
  const ctx = await getTenantContext({ sub: 'user_STRANGER', org_id: 'org_A' }, mockEnv());
  assert.deepEqual(ctx, { error: 'tenant_membership_required', status: 403 });
});

// 4. User belonging to tenant A + header/org for tenant B → 403 (the core IDOR fix)
test('cross-tenant access (member of A targeting B) is rejected', async () => {
  const ctx = await getTenantContext({ sub: 'user_A', org_id: 'org_B' }, mockEnv());
  assert.deepEqual(ctx, { error: 'tenant_membership_required', status: 403 });
});

// 5. Deleted membership → 403 (membership row removed)
test('deleted membership is rejected', async () => {
  const env = mockEnv({ memberships: MEMBERSHIPS.filter(m => m.clerk_user_id !== 'user_A') });
  const ctx = await getTenantContext({ sub: 'user_A', org_id: 'org_A' }, env);
  assert.deepEqual(ctx, { error: 'tenant_membership_required', status: 403 });
});

// 6. Inactive/suspended tenant → tenant status error (precedes membership check)
test('suspended tenant returns status error for its own member', async () => {
  const ctx = await getTenantContext({ sub: 'user_S', org_id: 'org_S' }, mockEnv());
  assert.deepEqual(ctx, { error: 'tenant_suspended', status: 403 });
});

// 7. Missing org_id → null (requireTenant maps upstream to no_active_organization)
test('missing org_id returns null', async () => {
  const ctx = await getTenantContext({ sub: 'user_A' }, mockEnv());
  assert.equal(ctx, null);
});

// 7b. Missing sub → null (cannot verify membership without an identity)
test('missing sub returns null', async () => {
  const ctx = await getTenantContext({ org_id: 'org_A' }, mockEnv());
  assert.equal(ctx, null);
});

// 8. Unknown / deleted tenant → null (requireTenant maps to tenant_not_found)
test('unknown org returns null', async () => {
  const ctx = await getTenantContext({ sub: 'user_A', org_id: 'org_UNKNOWN' }, mockEnv());
  assert.equal(ctx, null);
});
test('soft-deleted tenant returns null', async () => {
  const ctx = await getTenantContext({ sub: 'user_D', org_id: 'org_D' }, mockEnv());
  assert.equal(ctx, null);
});
