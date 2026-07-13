# Tenant authorization remediation — runbook

Fixes the tenant-isolation defect: `/api/tenant/*` granted tenant context based on
`X-Organization-Id` without verifying the caller's membership. Enforcement now
requires a `tenant_users` row for `payload.sub` in the resolved tenant.

**Deployment order is safety-critical: backfill BEFORE deploying the Worker.**
The enforcement check rejects users with no membership row, and production
`tenant_users` is currently empty — deploying first would lock out every real user.

## Root cause of empty `tenant_users`
- Orgs exist in `tenants` (4 rows) with webhook-default values → `organization.created`
  webhooks (or an equivalent path) worked, so the endpoint + `CLERK_WEBHOOK_SECRET` are functional.
- Yet `tenant_users` = 0 across all orgs → `organizationMembership.*` events never inserted.
- **Most probable cause:** the Clerk webhook endpoint is not subscribed to
  `organizationMembership.created/updated/deleted`. Confirm in Clerk Dashboard →
  Webhooks → (endpoint) → Subscribed events. *(Not verifiable from the build
  environment — Clerk API is network-blocked here.)*
- **Contributing latent bug (now fixed):** membership handlers silently `return`ed
  when the tenant row was missing (webhook ordering), losing the event with no trace.
  Handlers now log `membership_event_dropped` and `updated` self-heals via upsert.

## Step 1 — Ensure membership events are subscribed (Clerk Dashboard)
Subscribe the webhook endpoint to `organizationMembership.created`, `.updated`, `.deleted`.
Without this, new joins/leaves won't sync even after backfill.

## Step 2 — Dry-run backfill
Run from a machine with `CLERK_SECRET_KEY` set and `wrangler` authenticated:
```bash
CLERK_SECRET_KEY=sk_live_… node scripts/backfill-memberships.mjs
```
Review the report: organizations examined, memberships found, rows to insert/update,
unresolved orgs. No data is written.

## Step 3 — Apply backfill
```bash
CLERK_SECRET_KEY=sk_live_… node scripts/backfill-memberships.mjs --apply
```

## Step 4 — Validate membership data (must pass before deploy)
```bash
# tenant_users no longer empty:
wrangler d1 execute digitaalinen_tuotepassi --remote --command \
  "SELECT COUNT(*) AS rows FROM tenant_users"
# every non-deleted trial/active tenant that has products has ≥1 member:
wrangler d1 execute digitaalinen_tuotepassi --remote --command \
  "SELECT t.name, COUNT(tu.id) AS members FROM tenants t \
   LEFT JOIN tenant_users tu ON tu.tenant_id=t.id \
   WHERE t.deleted_at IS NULL AND t.status IN ('trial','active') GROUP BY t.id"
# no duplicate memberships (UNIQUE constraint guarantees this; verify):
wrangler d1 execute digitaalinen_tuotepassi --remote --command \
  "SELECT tenant_id, clerk_user_id, COUNT(*) c FROM tenant_users \
   GROUP BY tenant_id, clerk_user_id HAVING c>1"
```
Specifically confirm the Liminall tenant (`834acc0db4ec56fe34c1db6c4f59925f`) has a member row.
**If any active tenant with real users has zero members → STOP. Do not deploy.**

## Step 5 — Deploy the Worker
```bash
npm run deploy
```

## Step 6 — Post-deploy validation (authorized test accounts only)
- Own-tenant: list/create/edit products, upload document → succeed.
- Cross-tenant: authenticated test user sets `X-Organization-Id` to another test
  tenant's clerk_org_id → **403 `tenant_membership_required`**.
- Draft public product → `/api/public/product/<draft-slug>` returns **404**
  (this ships in the same branch: `public.js` uses `status !== 'active'`).
- Review logs for unexpected `tenant_membership_required` on legitimate users
  (would indicate an incomplete backfill).

## Rollback
Previous production version (deployed 2026-07-02): **`26ec2679`** (deployment `c13c2323`).
```bash
# roll back to the pre-remediation version:
wrangler rollback 26ec2679
# or redeploy the previous commit.
```
Backfill is additive (upserts only, no deletes) and needs no rollback. If legitimate
users are locked out post-deploy, roll back the Worker immediately, then fix the backfill gap.

## Note on platform admins
Platform admin authorization (`getPlatformContext` → `platform_users`) is separate and
unchanged. Admin status is NOT treated as tenant membership.
