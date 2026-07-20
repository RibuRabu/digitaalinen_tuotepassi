#!/usr/bin/env node
// Post-cleanup + post-backfill verification. READ-ONLY. One query per check.
// Run AFTER migration 0009 and AFTER `node scripts/backfill-memberships.mjs --apply`.
//
// Verifies: orphan tenants removed · only Liminall remains live · no broken FK
// references · tenant_users integrity · authorization assumptions for the P0 fix.
//
// Exit code: 0 = all checks pass; non-zero = a check failed.
//
// Usage: node scripts/post-cleanup-verify.mjs
import { d1, d1count } from './d1.mjs';
import { TARGET_IN_LIST, LIMINALL_ID } from './tenant-ids.mjs';

let failed = false;
const fail = (m) => { failed = true; console.error(`  ✗ FAIL: ${m}`); };
const pass = (m) => console.log(`  ✓ ${m}`);

function main() {
  console.log('POST-CLEANUP VERIFICATION');

  // 1. Orphan tenants removed.
  console.log('\n-- 1. orphan tenants removed --');
  const remaining = d1count(`SELECT COUNT(*) AS n FROM tenants WHERE id IN (${TARGET_IN_LIST})`);
  remaining === 0 ? pass('0 target tenants remain.') : fail(`${remaining} target tenant(s) still present.`);

  // 2. Only the production tenant remains (non-deleted).
  console.log('\n-- 2. only production tenant remains (non-deleted) --');
  const live = d1(`SELECT id, name, status FROM tenants WHERE deleted_at IS NULL`);
  console.table(live);
  if (live.length === 1 && live[0].id === LIMINALL_ID) pass('Only Liminall is a live (non-deleted) tenant.');
  else fail(`Expected only Liminall live; got: ${live.map(t => `${t.name}(${t.id})`).join(', ')}`);

  // 3. No broken FK references — each orphan count must be 0 (one query per relation).
  console.log('\n-- 3. FK integrity (each must be 0) --');
  const fkChecks = [
    ['products.tenant_id → tenants',          `SELECT COUNT(*) AS n FROM products WHERE tenant_id IS NOT NULL AND tenant_id NOT IN (SELECT id FROM tenants)`],
    ['tenant_users.tenant_id → tenants',      `SELECT COUNT(*) AS n FROM tenant_users WHERE tenant_id NOT IN (SELECT id FROM tenants)`],
    ['tenant_billing.tenant_id → tenants',    `SELECT COUNT(*) AS n FROM tenant_billing WHERE tenant_id NOT IN (SELECT id FROM tenants)`],
    ['tenant_regulations.tenant_id → tenants',`SELECT COUNT(*) AS n FROM tenant_regulations WHERE tenant_id NOT IN (SELECT id FROM tenants)`],
    ['product_documents.product_id → products',`SELECT COUNT(*) AS n FROM product_documents WHERE product_id NOT IN (SELECT id FROM products)`],
    ['product_events.product_id → products',  `SELECT COUNT(*) AS n FROM product_events WHERE product_id NOT IN (SELECT id FROM products)`],
    ['product_translations.product_id → products',`SELECT COUNT(*) AS n FROM product_translations WHERE product_id NOT IN (SELECT id FROM products)`],
    ['product_transfers.product_id → products',`SELECT COUNT(*) AS n FROM product_transfers WHERE product_id NOT IN (SELECT id FROM products)`],
    ['product_transfers.from_tenant_id → tenants',`SELECT COUNT(*) AS n FROM product_transfers WHERE from_tenant_id NOT IN (SELECT id FROM tenants)`],
    ['product_transfers.to_tenant_id → tenants',`SELECT COUNT(*) AS n FROM product_transfers WHERE to_tenant_id NOT IN (SELECT id FROM tenants)`],
  ];
  for (const [label, sql] of fkChecks) {
    const n = d1count(sql);
    n === 0 ? pass(`${label}: 0 orphans`) : fail(`${label}: ${n} orphan row(s)`);
  }

  // 4. tenant_users integrity + authorization assumptions.
  console.log('\n-- 4. tenant_users integrity + authorization assumptions --');
  const tu = d1(`SELECT tenant_id, clerk_user_id, role FROM tenant_users`);
  console.table(tu);
  const liminallMembers = d1count(`SELECT COUNT(*) AS n FROM tenant_users WHERE tenant_id='${LIMINALL_ID}'`);
  liminallMembers > 0
    ? pass(`Liminall has ${liminallMembers} membership row(s) — the production user will not be locked out by enforcement.`)
    : fail('Liminall has NO membership rows — deploying enforcement would lock out the production user. Run the backfill --apply first.');

  const strayMembers = d1count(`SELECT COUNT(*) AS n FROM tenant_users WHERE tenant_id NOT IN (SELECT id FROM tenants WHERE deleted_at IS NULL)`);
  strayMembers === 0 ? pass('All tenant_users rows reference a live tenant.') : fail(`${strayMembers} tenant_users row(s) reference a deleted/absent tenant.`);

  const dupMembers = d1count(`SELECT COUNT(*) AS n FROM (SELECT tenant_id, clerk_user_id FROM tenant_users GROUP BY tenant_id, clerk_user_id HAVING COUNT(*) > 1)`);
  dupMembers === 0 ? pass('No duplicate (tenant_id, clerk_user_id) membership rows.') : fail(`${dupMembers} duplicate membership pair(s).`);

  console.log('\n' + (failed
    ? 'RESULT: ✗ POST-CLEANUP VERIFICATION FAILED — resolve before deploying.'
    : 'RESULT: ✓ Cleanup + membership state verified — authorization prerequisites satisfied.'));
  process.exit(failed ? 1 : 0);
}

try {
  main();
} catch (e) {
  console.error('\nEXECUTION ERROR:', e.message);
  process.exit(2);
}
