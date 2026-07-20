#!/usr/bin/env node
// Authorization smoke test — runs the REAL getTenantContext (src/auth/clerk.js)
// against REAL production D1, using the actual Liminall tenant + the membership row
// created by the backfill. READ-ONLY (SELECTs only; no writes).
//
// Proves the P0 fix end-to-end at the authorization-decision layer:
//   1. valid Liminall user + Liminall org           => ALLOWED
//   2. valid user + spoofed/unknown organization     => DENIED (tenant_not_found / null)
//   3. valid user + existing tenant, NO membership   => DENIED (tenant_membership_required)
//   4. missing organization context                  => DENIED (null)
//   5. unauthenticated request (no bearer token)     => DENIED (verifyClerkJWT -> null -> 401 upstream)
//
// Exit code: 0 = all pass; non-zero = a case failed (do NOT deploy).
// Usage: node scripts/auth-smoke-test.mjs
import { getTenantContext, verifyClerkJWT } from '../src/auth/clerk.js';
import { d1 } from './d1.mjs';
import { LIMINALL_ID } from './tenant-ids.mjs';

// env.DB shim: translate getTenantContext's prepare().bind().first() into single-line
// d1() SELECTs against remote D1. getTenantContext runs exactly two queries (both single
// line), so no multi-line/cmd.exe hazard.
const esc = (v) => (v === null || v === undefined) ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`;
const env = { DB: {
  prepare(sql) {
    return {
      _binds: [],
      bind(...a) { this._binds = a; return this; },
      async first() {
        let i = 0;
        const inlined = sql.replace(/\?/g, () => esc(this._binds[i++]));
        return d1(inlined)[0] ?? null;
      },
    };
  },
}};

let failed = false;
const check = (name, ok, detail) => {
  if (ok) { console.log(`  ✓ ${name}`); }
  else { failed = true; console.error(`  ✗ FAIL: ${name}\n        got: ${detail}`); }
};

async function main() {
  // Resolve real identifiers from live data.
  const tenant = d1(`SELECT id, clerk_org_id, status FROM tenants WHERE id = '${LIMINALL_ID}'`)[0];
  if (!tenant) throw new Error(`Liminall tenant ${LIMINALL_ID} not found in D1.`);
  const member = d1(`SELECT clerk_user_id, role FROM tenant_users WHERE tenant_id = '${LIMINALL_ID}' LIMIT 1`)[0];
  if (!member) throw new Error('No tenant_users row for Liminall — was the backfill --apply run?');

  const LIMINALL_ORG = tenant.clerk_org_id;
  const MEMBER = member.clerk_user_id;
  console.log('AUTHORIZATION SMOKE TEST (live Liminall data)');
  console.log(`  Liminall tenant : ${LIMINALL_ID}  status=${tenant.status}`);
  console.log(`  Liminall org    : ${LIMINALL_ORG}`);
  console.log(`  Real member sub : ${MEMBER}  role=${member.role}\n`);

  // 1. valid Liminall user + Liminall org => ALLOWED
  const c1 = await getTenantContext({ sub: MEMBER, org_id: LIMINALL_ORG, org_role: member.role }, env);
  check('1. Liminall member + Liminall org => ALLOWED',
    !!(c1 && c1.tenant && c1.tenant.id === LIMINALL_ID && !c1.error), JSON.stringify(c1));

  // 2. valid user + spoofed/unknown org => DENIED
  const c2 = await getTenantContext({ sub: MEMBER, org_id: 'org_SPOOFED000000000000000000' }, env);
  check('2. member + spoofed/unknown org => DENIED (null)', c2 === null, JSON.stringify(c2));

  // 3. valid user + existing tenant WITHOUT membership => DENIED
  //    Stranger sub against the real (live) Liminall org: tenant resolves, membership does not.
  const c3 = await getTenantContext({ sub: 'user_STRANGER_not_a_member_000', org_id: LIMINALL_ORG }, env);
  check('3. stranger + Liminall (no membership) => DENIED (tenant_membership_required 403)',
    !!(c3 && c3.error === 'tenant_membership_required' && c3.status === 403), JSON.stringify(c3));

  // 4. missing organization context => DENIED
  const c4 = await getTenantContext({ sub: MEMBER }, env);
  check('4. missing org_id => DENIED (null)', c4 === null, JSON.stringify(c4));

  // 5. unauthenticated request => DENIED. verifyClerkJWT returns null for a missing token,
  //    which requireTenant turns into 401 before getTenantContext is ever reached.
  const p5 = await verifyClerkJWT(null, env);
  check('5. no bearer token => no payload (401 upstream)', p5 === null, JSON.stringify(p5));

  console.log('\n' + (failed
    ? 'RESULT: ✗ AUTHORIZATION SMOKE TEST FAILED — do NOT deploy.'
    : 'RESULT: ✓ P0 fix verified against live Liminall data. Safe to prepare deployment.'));
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('\nEXECUTION ERROR:', e.message); process.exit(2); });
