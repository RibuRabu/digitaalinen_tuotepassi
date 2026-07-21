// Regression test for the QR code library.
// The QR feature loaded qrcode from `cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js`,
// a path that does not exist in the package (404) — so the script silently failed to load
// and no QR was ever rendered. It is now self-hosted at public/qrcode.min.js.
//
// Run: node --test tests/qr-asset.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = fileURLToPath(new URL('..', import.meta.url));
const bundlePath = `${root}public/qrcode.min.js`;

test('self-hosted qrcode bundle exists and is non-trivial', () => {
  assert.ok(existsSync(bundlePath), 'public/qrcode.min.js is missing');
  const size = readFileSync(bundlePath).length;
  assert.ok(size > 5000, `bundle suspiciously small (${size} bytes)`);
});

test('bundle exposes a global QRCode with toCanvas + toDataURL', () => {
  const code = readFileSync(bundlePath, 'utf8');
  // The IIFE build assigns `var QRCode = (...)()` — evaluate it in a browser-ish sandbox.
  const sandbox = {};
  sandbox.self = sandbox; sandbox.window = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  assert.equal(typeof sandbox.QRCode, 'object', 'QRCode global not defined by bundle');
  assert.equal(typeof sandbox.QRCode.toCanvas, 'function', 'QRCode.toCanvas missing');
  assert.equal(typeof sandbox.QRCode.toDataURL, 'function', 'QRCode.toDataURL missing');
});

test('owner.html and admin.html load the QR lib same-origin, not the broken CDN path', () => {
  for (const page of ['public/owner.html', 'public/admin.html']) {
    const html = readFileSync(`${root}${page}`, 'utf8');
    assert.ok(html.includes("'/qrcode.min.js'"), `${page} does not load /qrcode.min.js`);
    assert.ok(!html.includes('cdn.jsdelivr.net/npm/qrcode'),
      `${page} still references the broken jsdelivr build path`);
  }
});
