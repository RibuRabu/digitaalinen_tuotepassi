-- 0009_cleanup_obsolete_test_tenants.sql
-- Removes two obsolete test tenants that no longer exist in Clerk (dry-run 404):
--   Riikka's Organization  id=57f42579be56473cb02242881995e338  org_3FLZXM6UUjCK50mn79zQLAys08R
--   Acme Corp              id=f8a5cb5ce5d34379911b984a951d5b86  org_2g7np7Hrk0SN6kj5EDMLDaKNL0S
--
-- Liminall (id=834acc0db4ec56fe34c1db6c4f59925f) is the only production tenant and is
-- NEVER referenced here. The target id list is fixed and does not contain Liminall.
--
-- Safety properties:
--   * Child rows deleted before parents (no FK dangling).
--   * Every statement is idempotent — re-running deletes nothing further.
--   * Product-child rows are scoped via a subselect on products of the target tenants,
--     so only the targets' products' children are touched.
--   * Run atomically: D1 executes a --file request as a single batch.

-- 1. compliance_results (product_id -> products)
DELETE FROM compliance_results
 WHERE product_id IN (SELECT id FROM products
   WHERE tenant_id IN ('57f42579be56473cb02242881995e338','f8a5cb5ce5d34379911b984a951d5b86'));

-- 2. product_translations (product_id -> products)
DELETE FROM product_translations
 WHERE product_id IN (SELECT id FROM products
   WHERE tenant_id IN ('57f42579be56473cb02242881995e338','f8a5cb5ce5d34379911b984a951d5b86'));

-- 3. product_documents (product_id -> products)
DELETE FROM product_documents
 WHERE product_id IN (SELECT id FROM products
   WHERE tenant_id IN ('57f42579be56473cb02242881995e338','f8a5cb5ce5d34379911b984a951d5b86'));

-- 4. product_events (product_id -> products)
DELETE FROM product_events
 WHERE product_id IN (SELECT id FROM products
   WHERE tenant_id IN ('57f42579be56473cb02242881995e338','f8a5cb5ce5d34379911b984a951d5b86'));

-- 5. product_transfers (product_id -> products, and from/to_tenant_id -> tenants)
DELETE FROM product_transfers
 WHERE product_id IN (SELECT id FROM products
   WHERE tenant_id IN ('57f42579be56473cb02242881995e338','f8a5cb5ce5d34379911b984a951d5b86'))
    OR from_tenant_id IN ('57f42579be56473cb02242881995e338','f8a5cb5ce5d34379911b984a951d5b86')
    OR to_tenant_id   IN ('57f42579be56473cb02242881995e338','f8a5cb5ce5d34379911b984a951d5b86');

-- 6. tenant_regulations (tenant_id -> tenants)
DELETE FROM tenant_regulations
 WHERE tenant_id IN ('57f42579be56473cb02242881995e338','f8a5cb5ce5d34379911b984a951d5b86');

-- 7. tenant_billing (tenant_id -> tenants)
DELETE FROM tenant_billing
 WHERE tenant_id IN ('57f42579be56473cb02242881995e338','f8a5cb5ce5d34379911b984a951d5b86');

-- 8. tenant_users (tenant_id -> tenants)
DELETE FROM tenant_users
 WHERE tenant_id IN ('57f42579be56473cb02242881995e338','f8a5cb5ce5d34379911b984a951d5b86');

-- 9. products (tenant_id -> tenants)
DELETE FROM products
 WHERE tenant_id IN ('57f42579be56473cb02242881995e338','f8a5cb5ce5d34379911b984a951d5b86');

-- 10. tenants (parent last). Explicit Liminall guard: only the two target ids, never Liminall.
DELETE FROM tenants
 WHERE id IN ('57f42579be56473cb02242881995e338','f8a5cb5ce5d34379911b984a951d5b86')
   AND id <> '834acc0db4ec56fe34c1db6c4f59925f';
