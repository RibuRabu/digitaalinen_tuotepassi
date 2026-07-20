#!/usr/bin/env node
// One-time membership backfill: populate tenant_users from Clerk's authoritative
// organization-membership data. Safe by design — dry-run unless --apply is given.
//
// WHY: production tenant_users is empty, so the new membership check in
// getTenantContext would lock out every legitimate user. This backfill must run
// (and be validated) BEFORE the enforcing Worker is deployed.
//
// REQUIREMENTS (run from a machine/CI that has both):
//   - env CLERK_SECRET_KEY   (Clerk Backend API key, sk_live_… — NOT stored in the repo)
//   - wrangler authenticated for the D1 database (same as `npm run db:*`)
//   - network access to https://api.clerk.com
//
// USAGE:
//   node scripts/backfill-memberships.mjs            # dry-run: report only, writes no data
//   node scripts/backfill-memberships.mjs --apply    # apply upserts to remote D1
//
// GUARANTEES:
//   - Never invents memberships: only rows Clerk returns for orgs that map to a tenant.
//   - Upsert semantics (INSERT … ON CONFLICT DO UPDATE role) — safe to re-run.
//   - Never deletes anything.
//   - Only touches orgs whose clerk_org_id matches an existing, non-deleted tenant.

import { execFileSync } from 'node:child_process';
import { wranglerInvocation } from './wrangler-invocation.mjs';

const APPLY = process.argv.includes('--apply');
const CLERK = 'https://api.clerk.com/v1';
const KEY = process.env.CLERK_SECRET_KEY;
const DB = 'dpp'; // actual D1 database name (the Worker binding is 'DB'; the config's name field is cosmetic)

if (!KEY) { console.error('FATAL: CLERK_SECRET_KEY is not set.'); process.exit(1); }

async function clerk(path) {
  const res = await fetch(`${CLERK}${path}`, { headers: { Authorization: `Bearer ${KEY}` } });
  if (!res.ok) throw new Error(`Clerk ${path} → ${res.status} ${await res.text()}`);
  return res.json();
}

function d1(sql) {
  const { command, argv } = wranglerInvocation(
    ['wrangler', 'd1', 'execute', DB, '--remote', '--json', '--command', sql]
  );
  const out = execFileSync(command, argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return JSON.parse(out)[0].results;
}
const esc = s => String(s).replace(/'/g, "''");
const roleOf = r => (r === 'org:admin' ? 'admin' : 'member');
const newId = () => (globalThis.crypto?.randomUUID?.() ?? require('node:crypto').randomUUID()).replace(/-/g, '');

// 1. Local tenant map: clerk_org_id → tenant.id (non-deleted only)
const tenants = d1('SELECT id, clerk_org_id, name FROM tenants WHERE deleted_at IS NULL');
const byOrg = new Map(tenants.map(t => [t.clerk_org_id, t]));
console.log(`Tenants (non-deleted) in D1: ${tenants.length}`);

// 2. Existing memberships (to classify insert vs update, and to avoid dupes)
const existing = new Set(
  d1('SELECT tenant_id, clerk_user_id FROM tenant_users').map(r => `${r.tenant_id}::${r.clerk_user_id}`)
);

// 3. Pull authoritative memberships from Clerk, per tenant org
const toUpsert = [];   // { tenantId, userId, role, kind: 'insert'|'update' }
const unresolvedOrgs = [];
let membershipsFound = 0;

for (const [orgId, tenant] of byOrg) {
  let offset = 0, total = Infinity;
  try {
    while (offset < total) {
      const page = await clerk(`/organizations/${orgId}/memberships?limit=100&offset=${offset}`);
      total = page.total_count ?? (page.data?.length ?? 0);
      for (const m of (page.data ?? [])) {
        const userId = m.public_user_data?.user_id;
        if (!userId) continue;
        membershipsFound++;
        const kind = existing.has(`${tenant.id}::${userId}`) ? 'update' : 'insert';
        toUpsert.push({ tenantId: tenant.id, userId, role: roleOf(m.role), kind });
      }
      offset += 100;
      if (!page.data || page.data.length === 0) break;
    }
  } catch (e) {
    unresolvedOrgs.push({ orgId, tenant: tenant.name, error: e.message });
  }
}

// 4. Report
const inserts = toUpsert.filter(x => x.kind === 'insert');
const updates = toUpsert.filter(x => x.kind === 'update');
console.log('\n── DRY-RUN REPORT ─────────────────────────────');
console.log(`Organizations examined : ${byOrg.size}`);
console.log(`Memberships found       : ${membershipsFound}`);
console.log(`Rows to INSERT          : ${inserts.length}`);
console.log(`Rows to UPDATE (role)   : ${updates.length}`);
console.log(`Unresolved orgs/errors  : ${unresolvedOrgs.length}`);
if (unresolvedOrgs.length) console.log(JSON.stringify(unresolvedOrgs, null, 2));
console.log('Sample (first 10):');
for (const r of toUpsert.slice(0, 10)) console.log(`  ${r.kind}  tenant=${r.tenantId}  user=${r.userId}  role=${r.role}`);

if (!APPLY) {
  console.log('\nDRY-RUN only. Re-run with --apply to write these upserts. No data was modified.');
  process.exit(0);
}

// 5. Apply (idempotent upserts, batched)
console.log('\n── APPLYING ───────────────────────────────────');
let applied = 0;
for (const r of toUpsert) {
  // Single line: newlines in a --command value are truncated by Windows cmd.exe,
  // which yielded SQLITE_ERROR 7500 "incomplete input". Keep the whole statement on one line.
  const sql = `INSERT INTO tenant_users (id, tenant_id, clerk_user_id, role) VALUES ('${newId()}', '${esc(r.tenantId)}', '${esc(r.userId)}', '${esc(r.role)}') ON CONFLICT(tenant_id, clerk_user_id) DO UPDATE SET role = excluded.role;`;
  d1(sql);
  applied++;
}
console.log(`Applied ${applied} upserts.`);

// 6. Validation
const count = d1('SELECT COUNT(*) AS n FROM tenant_users')[0].n;
console.log(`tenant_users now contains ${count} rows.`);
