import { json } from '../utils.js';

// ── Rule evaluation helpers ───────────────────────────────────────────────────

function parseCondition(raw) {
  try { return JSON.parse(raw); } catch { return { always: true }; }
}

function conditionApplies(condition, categoryCode) {
  if (condition.always) return true;
  if (condition.category_codes) {
    return Boolean(categoryCode) && condition.category_codes.includes(categoryCode);
  }
  // Unknown condition type: do not apply — prevents future rules from silently
  // matching everything if their condition key is not yet handled here.
  return false;
}

function evaluateRule(rule, product, categoryCode, documents) {
  const condition = parseCondition(rule.condition_json);
  if (!conditionApplies(condition, categoryCode)) return { applies: false, pass: false };

  switch (rule.rule_type) {
    case 'required_field': {
      const val = product[rule.field_path];
      return { applies: true, pass: val != null && String(val).trim() !== '' };
    }
    case 'required_array_min': {
      const min = condition.min ?? 1;
      let arr = [];
      try { arr = JSON.parse(product[rule.field_path] || '[]'); } catch {}
      return { applies: true, pass: Array.isArray(arr) && arr.length >= min };
    }
    case 'required_document': {
      const pat = condition.doc_name_pattern;
      if (!pat) return { applies: true, pass: documents.length > 0 };
      let re;
      try { re = new RegExp(pat, 'i'); } catch { return { applies: true, pass: false }; }
      return { applies: true, pass: documents.some(d => re.test(d.name || '')) };
    }
    default:
      return { applies: false, pass: false };
  }
}

// error rules weight 2, warning rules weight 1, info rules not counted
function computeScore(ruleResults) {
  let total = 0, passing = 0;
  for (const { severity, pass } of ruleResults) {
    const w = severity === 'error' ? 2 : severity === 'warning' ? 1 : 0;
    total += w;
    if (pass) passing += w;
  }
  return total === 0 ? 100 : Math.round((passing / total) * 100);
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function handleCompliance(env, productUid) {
  if (!productUid) return json({ error: 'not_found' }, 404);

  const product = await env.DB.prepare(
    'SELECT * FROM products WHERE product_uid = ?'
  ).bind(productUid).first();
  if (!product || product.status === 'archived') return json({ error: 'not_found' }, 404);

  // Return cached result if product version matches
  const cached = await env.DB.prepare(
    'SELECT product_version, result_json FROM compliance_results WHERE product_id = ?'
  ).bind(product.id).first();
  if (cached && cached.product_version === product.version) {
    try { return json({ ...JSON.parse(cached.result_json), cached: true }); } catch {}
  }

  // Resolve category code from category_id
  let categoryCode = null;
  if (product.category_id) {
    const cat = await env.DB.prepare(
      'SELECT code FROM product_categories WHERE id = ?'
    ).bind(product.category_id).first();
    categoryCode = cat?.code ?? null;
  }

  let targetMarkets = ['EU'];
  try { targetMarkets = JSON.parse(product.target_markets_json || '["EU"]'); } catch {}

  // ── Active regulations ────────────────────────────────────────────────────
  // Default: mandatory category_regulations for active regulations
  // Override layer: tenant_regulations (enabled=1 adds, enabled=0 removes)
  const activeRegIds = new Set();

  if (product.category_id) {
    const marketPh = targetMarkets.map(() => '?').join(', ');
    const { results: mandatory } = await env.DB.prepare(`
      SELECT cr.regulation_id FROM category_regulations cr
      JOIN regulations r ON r.id = cr.regulation_id
      WHERE cr.category_id = ? AND cr.mandatory = 1 AND r.status = 'active'
        AND cr.market IN ('*', ${marketPh})
    `).bind(product.category_id, ...targetMarkets).all();
    for (const row of mandatory) activeRegIds.add(row.regulation_id);
  }

  // Activate regulations that have globally-applicable rules (always:true)
  // regardless of category assignment. Required so GPSR fires on every product.
  const { results: globalRegs } = await env.DB.prepare(`
    SELECT DISTINCT rr.regulation_id
    FROM regulation_rules rr
    JOIN regulations r ON r.id = rr.regulation_id
    WHERE rr.condition_json LIKE '%"always":true%'
      AND r.status = 'active'
  `).all();
  for (const row of globalRegs) activeRegIds.add(row.regulation_id);

  if (product.tenant_id) {
    const { results: overrides } = await env.DB.prepare(
      'SELECT regulation_id, enabled FROM tenant_regulations WHERE tenant_id = ?'
    ).bind(product.tenant_id).all();
    for (const row of overrides) {
      if (row.enabled === 1) activeRegIds.add(row.regulation_id);
      else activeRegIds.delete(row.regulation_id);
    }
  }

  // ── Fetch applicable rules ────────────────────────────────────────────────
  let rules = [];
  if (activeRegIds.size > 0) {
    const ph = Array.from(activeRegIds).map(() => '?').join(', ');
    const { results } = await env.DB.prepare(`
      SELECT rr.*, r.code AS reg_code, r.name AS reg_name,
             r.version AS reg_version, r.status AS reg_status
      FROM regulation_rules rr
      JOIN regulations r ON r.id = rr.regulation_id
      WHERE rr.regulation_id IN (${ph})
    `).bind(...Array.from(activeRegIds)).all();
    rules = results;
  }

  // Documents: primary table + legacy JSON blob for backward compat
  const { results: dbDocs } = await env.DB.prepare(
    'SELECT name FROM product_documents WHERE product_id = ?'
  ).bind(product.id).all();
  let blobDocs = [];
  try { blobDocs = JSON.parse(product.compliance_documents_json || '[]'); } catch {}
  const allDocuments = [...dbDocs, ...blobDocs];

  // ── Evaluate rules ────────────────────────────────────────────────────────
  const missing = [], warnings = [], info = [], passed = [];
  const ruleResults = [], appliedCodes = [];
  let hasErrorFail = false;

  for (const rule of rules) {
    const { applies, pass } = evaluateRule(rule, product, categoryCode, allDocuments);
    if (!applies) continue;

    appliedCodes.push(rule.rule_code);
    ruleResults.push({ severity: rule.severity, pass });

    const entry = {
      rule_code: rule.rule_code,
      regulation: rule.reg_code,
      severity: rule.severity,
      field: rule.field_path ?? null,
      message_en: rule.message_en,
      message_fi: rule.message_fi,
    };

    if (pass) {
      passed.push({ rule_code: rule.rule_code, regulation: rule.reg_code });
    } else {
      if (rule.severity === 'error')        { missing.push(entry); hasErrorFail = true; }
      else if (rule.severity === 'warning') warnings.push(entry);
      else                                  info.push(entry);
    }
  }

  // A product with no applicable rules cannot be complete — score 0, not 100.
  const score = ruleResults.length === 0 ? 0 : computeScore(ruleResults);
  const status = hasErrorFail || ruleResults.length === 0 ? 'incomplete' : 'complete';

  // Deduplicated regulation metadata
  const regMap = new Map();
  for (const r of rules) {
    if (!regMap.has(r.reg_code)) {
      regMap.set(r.reg_code, {
        code: r.reg_code, name: r.reg_name,
        version: r.reg_version, status: r.reg_status,
      });
    }
  }

  const result = {
    product_uid: product.product_uid,
    computed_at: new Date().toISOString(),
    product_version: product.version,
    cached: false,
    status,
    score,
    // verification_suggested = true signals that a human/admin may promote compliance_status
    // to 'verified'. The engine never sets compliance_status = 'verified' automatically.
    verification_suggested: status === 'complete' && score >= 95,
    category: categoryCode,
    target_markets: targetMarkets,
    missing,
    warnings,
    info,
    passed,
    rules_applied: appliedCodes,
    regulations_applied: Array.from(regMap.values()),
  };

  // Cache result; invalidated next time product.version increments
  const cacheId = crypto.randomUUID().replace(/-/g, '');
  await env.DB.prepare(`
    INSERT INTO compliance_results (id, product_id, computed_at, product_version, status, score, result_json)
    VALUES (?, ?, datetime('now'), ?, ?, ?, ?)
    ON CONFLICT(product_id) DO UPDATE SET
      computed_at       = excluded.computed_at,
      product_version   = excluded.product_version,
      status            = excluded.status,
      score             = excluded.score,
      result_json       = excluded.result_json
  `).bind(cacheId, product.id, product.version, status, score, JSON.stringify(result)).run();

  return json(result);
}
