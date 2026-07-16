// Unit tests for the platform-specific wrangler/npx invocation construction.
// Run: node --test tests/wrangler-invocation.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wranglerInvocation } from '../scripts/wrangler-invocation.mjs';

const ARGS = ['wrangler', 'd1', 'execute', 'digitaalinen_tuotepassi', '--remote', '--json', '--command', "SELECT 1"];

test('windows wraps npx in cmd.exe /d /s /c', () => {
  const { command, argv } = wranglerInvocation(ARGS, 'win32');
  assert.equal(command, 'cmd.exe');
  assert.deepEqual(argv, ['/d', '/s', '/c', 'npx', ...ARGS]);
});

test('windows preserves argument order and content after npx', () => {
  const { argv } = wranglerInvocation(ARGS, 'win32');
  assert.deepEqual(argv.slice(0, 4), ['/d', '/s', '/c', 'npx']);
  assert.deepEqual(argv.slice(4), ARGS);
  // the SQL command argument survives untouched as a single argv entry
  assert.equal(argv[argv.length - 1], 'SELECT 1');
});

test('non-windows execs npx directly', () => {
  for (const platform of ['linux', 'darwin']) {
    const { command, argv } = wranglerInvocation(ARGS, platform);
    assert.equal(command, 'npx');
    assert.deepEqual(argv, ARGS);
  }
});

test('does not mutate the input args array', () => {
  const input = [...ARGS];
  wranglerInvocation(input, 'win32');
  assert.deepEqual(input, ARGS);
});
