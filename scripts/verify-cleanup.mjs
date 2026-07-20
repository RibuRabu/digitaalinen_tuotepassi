#!/usr/bin/env node
// Pre-cleanup verification for migration 0009 (remove obsolete test tenants).
// READ-ONLY. Prints exactly what 0009 would delete, one query per table, and
// asserts Liminall is never in the deletion set.
//
// Exit code: 0 = safe to run 0009; non-zero = verification FAILED, do not run 0009.
//
// Usage: node scripts/verify-cleanup.mjs
import { d1, d1count } from './d1.mjs';
import { TARGET_TENANTS, TARGET_IDS, TARGET_IN_LIST, LIMINALL_ID } from './tenant-ids.mjs';

let failed = false;
const fail = (m) => { failed = true; console.error(`  ✗ FAIL: ${m}`); };
const pass = (m) => console.log(`  ✓ ${m}`);
const section = (label, rows) => {
  console.log(`\n== ${label} (${rows.length} row${rows.length === 1 ? '' : 's'}) ==`);
  if (rows.length) console.table(rows);
};

function main() {
  console.log('PRE-CLEANUP VERIFICATION — migration 0009');
  console.log('Targets:', TARGET_TENANTS.map(t => `${t.name} (${t.id})`).join('  |  '));
  console.log('Protected (Liminall):', LIMINALL_ID);

  // 0. Static guard — Liminall must not be in the compiled target list.
  console.log('\n-- static guards --');
  if (TARGET_IDS.includes(LIMINALL_ID)) fail(`Liminall id is present in TARGET_IDS!`);
  else pass('Liminall id is NOT in the static target list.');

  // 1. Target tenants — confirm identity: each resolves to an expected name, none is Liminall.
  const targets = d1(`SELECT id, name, clerk_org_id, status, deleted_at FROM tenants WHERE id IN (${TARGET_IN_LIST})`);
  section('Target tenants', targets);
  const expected = new Map(TARGET_TENANTS.map(t => [t.id, t.name]));
  for (const t of targets) {
    if (t.id === LIMINALL_ID) fail(`A target row resolves to Liminall (${t.id})`);
    else if (expected.get(t.id) !== t.name) {
      fail(`Target ${t.id} name is "${t.name}", expected "${expected.get(t.id)}"`);
    }
  }
  if (targets.length === 0) console.log('  (no target tenants present — already cleaned; 0009 is idempotent.)');
  else pass('All target rows match expected obsolete tenants.');

  // 2. Products owned by targets (deleted at step 9 of 0009).
  const products = d1(`SELECT id, public_slug, product_name, status FROM products WHERE tenant_id IN (${TARGET_IN_LIST})`);
  section('products (would delete)', products);

  // 3. Direct tenant-owned tables (one query each).
  section('tenant_users (would delete)',
    d1(`SELECT id, tenant_id, clerk_user_id, role FROM tenant_users WHERE tenant_id IN (${TARGET_IN_LIST})`));
  section('tenant_billing (would delete)',
    d1(`SELECT tenant_id, billing_period, price_eur, next_invoice_date FROM tenant_billing WHERE tenant_id IN (${TARGET_IN_LIST})`));
  section('tenant_regulations (would delete)',
    d1(`SELECT id, tenant_id, regulation_id FROM tenant_regulations WHERE tenant_id IN (${TARGET_IN_LIST})`));

  // 4. Product-child tables (one query each; scoped via the targets' product ids).
  const childScope = `product_id IN (SELECT id FROM products WHERE tenant_id IN (${TARGET_IN_LIST}))`;
  section('product_documents (would delete)',
    d1(`SELECT id, product_id, tenant_id, name, file_key FROM product_documents WHERE ${childScope}`));
  console.log(`\n== product_events (would delete): ${d1count(`SELECT COUNT(*) AS n FROM product_events WHERE ${childScope}`)} rows ==`);
  console.log(`== product_translations (would delete): ${d1count(`SELECT COUNT(*) AS n FROM product_translations WHERE ${childScope}`)} rows ==`);
  const transfers = d1count(
    `SELECT COUNT(*) AS n FROM product_transfers WHERE ${childScope} OR from_tenant_id IN (${TARGET_IN_LIST}) OR to_tenant_id IN (${TARGET_IN_LIST})`);
  console.log(`== product_transfers (would delete): ${transfers} rows ==`);

  // 5. Liminall safety confirmed against live data.
  console.log('\n-- Liminall safety (live data) --');
  const liminallInTargets = d1count(`SELECT COUNT(*) AS n FROM tenants WHERE id='${LIMINALL_ID}' AND id IN (${TARGET_IN_LIST})`);
  if (liminallInTargets !== 0) fail(`Liminall appears in the target set (${liminallInTargets})`);
  else pass('DB confirms Liminall is NOT in the target set.');
  const liminallProducts = d1count(`SELECT COUNT(*) AS n FROM products WHERE tenant_id='${LIMINALL_ID}'`);
  console.log(`  Liminall products that MUST remain after cleanup: ${liminallProducts}`);
  if (liminallProducts === 0) fail('Liminall has 0 products — unexpected; investigate before proceeding.');

  console.log('\n' + (failed
    ? 'RESULT: ✗ VERIFICATION FAILED — do NOT run migration 0009.'
    : 'RESULT: ✓ SAFE — migration 0009 targets only the obsolete tenants; Liminall untouched.'));
  process.exit(failed ? 1 : 0);
}

try {
  main();
} catch (e) {
  console.error('\nEXECUTION ERROR:', e.message);
  process.exit(2);
}
