// Shared remote-D1 query helper. Same mechanism proven by backfill-memberships.mjs:
// `wrangler d1 execute dpp --remote --json --command "<one statement>"`.
// One statement per call — no giant UNION queries, no --file (which returns only
// metadata on some wrangler versions). Returns the SELECT result rows as an array.
import { execFileSync } from 'node:child_process';
import { wranglerInvocation } from './wrangler-invocation.mjs';

export const DB = 'dpp'; // actual D1 database name (Worker binding is 'DB')

export function d1(sql) {
  const { command, argv } = wranglerInvocation(
    ['wrangler', 'd1', 'execute', DB, '--remote', '--json', '--command', sql]
  );

  let out;
  try {
    out = execFileSync(command, argv, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (e) {
    const detail = (e.stderr || e.stdout || e.message || '').toString().trim();
    throw new Error(`wrangler d1 execute failed for SQL:\n  ${sql}\n${detail}`);
  }

  // Defensive parse: wrangler may emit a banner/warning before the JSON payload.
  const start = out.search(/[[{]/);
  if (start === -1) throw new Error(`No JSON in wrangler output:\n${out}`);

  let parsed;
  try {
    parsed = JSON.parse(out.slice(start));
  } catch (e) {
    throw new Error(`Could not parse wrangler JSON (${e.message}). Raw output:\n${out}`);
  }

  const block = Array.isArray(parsed) ? parsed[0] : parsed;
  if (block && block.error) throw new Error(`D1 error: ${JSON.stringify(block.error)}`);
  return (block && block.results) || [];
}

// Convenience: run a `SELECT COUNT(*) AS n …` and return the integer.
export function d1count(sql) {
  const rows = d1(sql);
  return rows[0]?.n ?? 0;
}
