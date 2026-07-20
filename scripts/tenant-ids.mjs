// Canonical tenant identifiers for the cleanup + remediation tooling.
// Single source of truth so verify and post-verify scripts cannot drift.

// The ONLY production tenant. Never a deletion target.
export const LIMINALL_ID = '834acc0db4ec56fe34c1db6c4f59925f';

// Obsolete test tenants confirmed absent from Clerk (backfill dry-run: 404).
export const TARGET_TENANTS = [
  { id: '57f42579be56473cb02242881995e338', name: "Riikka's Organization" },
  { id: 'f8a5cb5ce5d34379911b984a951d5b86', name: 'Acme Corp' },
];

export const TARGET_IDS = TARGET_TENANTS.map(t => t.id);

// SQL IN-list of single-quoted target ids, e.g. "'57f…','f8a…'".
export const TARGET_IN_LIST = TARGET_IDS.map(id => `'${id}'`).join(',');
