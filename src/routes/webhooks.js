import { json, newId } from '../utils.js';
import { verifyWebhook } from '../auth/clerk.js';

function clerkRoleToLocal(orgRole) {
  if (orgRole === 'org:admin') return 'admin';
  return 'member';
}

export async function handleClerkWebhook(request, env) {
  const secret = env.CLERK_WEBHOOK_SECRET;
  if (!secret) return json({ error: 'webhook_not_configured' }, 503);

  const event = await verifyWebhook(request, secret);
  if (!event) return json({ error: 'invalid_signature' }, 401);

  const { type, data } = event;

  try {
    switch (type) {
      case 'organization.created':
        await handleOrgCreated(env, data);
        break;

      case 'organization.updated':
        await handleOrgUpdated(env, data);
        break;

      case 'organization.deleted':
        await handleOrgDeleted(env, data);
        break;

      case 'organizationMembership.created':
        await handleMembershipCreated(env, data);
        break;

      case 'organizationMembership.updated':
        await handleMembershipUpdated(env, data);
        break;

      case 'organizationMembership.deleted':
        await handleMembershipDeleted(env, data);
        break;

      default:
        // Unhandled events are OK — just acknowledge
        break;
    }
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', event: 'webhook_handler_error', type, message: err?.message ?? String(err) }));
    return json({ error: 'handler_error' }, 500);
  }

  return json({ ok: true });
}

async function handleOrgCreated(env, data) {
  const existing = await env.DB.prepare(
    'SELECT id FROM tenants WHERE clerk_org_id = ?'
  ).bind(data.id).first();
  if (existing) return; // Idempotent

  await env.DB.prepare(
    `INSERT INTO tenants (id, clerk_org_id, name, slug, status, plan, product_limit)
     VALUES (?, ?, ?, ?, 'trial', 'free', 25)`
  ).bind(newId(), data.id, data.name, data.slug || null).run();
}

async function handleOrgUpdated(env, data) {
  await env.DB.prepare(
    "UPDATE tenants SET name = ?, slug = ?, updated_at = datetime('now') WHERE clerk_org_id = ?"
  ).bind(data.name, data.slug || null, data.id).run();
}

async function handleOrgDeleted(env, data) {
  await env.DB.prepare(
    "UPDATE tenants SET status = 'inactive', deleted_at = datetime('now'), updated_at = datetime('now') WHERE clerk_org_id = ?"
  ).bind(data.id).run();
}

async function handleMembershipCreated(env, data) {
  const clerkOrgId = data.organization?.id;
  const clerkUserId = data.public_user_data?.user_id;
  if (!clerkOrgId || !clerkUserId) return;

  const tenant = await env.DB.prepare(
    'SELECT id FROM tenants WHERE clerk_org_id = ?'
  ).bind(clerkOrgId).first();
  if (!tenant) return; // Org not yet registered — webhook ordering issue

  const role = clerkRoleToLocal(data.role);

  await env.DB.prepare(
    `INSERT INTO tenant_users (id, tenant_id, clerk_user_id, role)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(tenant_id, clerk_user_id) DO UPDATE SET role = excluded.role`
  ).bind(newId(), tenant.id, clerkUserId, role).run();
}

async function handleMembershipUpdated(env, data) {
  const clerkOrgId = data.organization?.id;
  const clerkUserId = data.public_user_data?.user_id;
  if (!clerkOrgId || !clerkUserId) return;

  const tenant = await env.DB.prepare(
    'SELECT id FROM tenants WHERE clerk_org_id = ?'
  ).bind(clerkOrgId).first();
  if (!tenant) return;

  const role = clerkRoleToLocal(data.role);
  await env.DB.prepare(
    'UPDATE tenant_users SET role = ? WHERE tenant_id = ? AND clerk_user_id = ?'
  ).bind(role, tenant.id, clerkUserId).run();
}

async function handleMembershipDeleted(env, data) {
  const clerkOrgId = data.organization?.id;
  const clerkUserId = data.public_user_data?.user_id;
  if (!clerkOrgId || !clerkUserId) return;

  const tenant = await env.DB.prepare(
    'SELECT id FROM tenants WHERE clerk_org_id = ?'
  ).bind(clerkOrgId).first();
  if (!tenant) return;

  await env.DB.prepare(
    'DELETE FROM tenant_users WHERE tenant_id = ? AND clerk_user_id = ?'
  ).bind(tenant.id, clerkUserId).run();
}
