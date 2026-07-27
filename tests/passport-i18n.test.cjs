// Focused tests for the public passport localisation helpers (public/passport-i18n.js).
// Run: node --test tests/passport-i18n.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const I18n = require('../public/passport-i18n.js');

const ORIGINAL = {
  product_name: 'Merinovillaneule',
  brand_name: 'Aava',
  product_type: 'Neule',
};
// translations_json shape as stored by the backend.
const translations = {
  en: { product_name: 'Merino Wool Jumper', materials: ['80% wool'], repair_instructions: '   ' },
  de: {}, // present but empty record
  el: { product_name: 'Πουλόβερ' }, // Greek unicode
};

test('1. no lang -> original (fi)', () => {
  assert.equal(I18n.resolveLang(null, translations), 'fi');
  assert.equal(I18n.resolveLang('', translations), 'fi');
  assert.equal(I18n.resolveLang('fi', translations), 'fi');
});

test('2. valid available language -> that language', () => {
  assert.equal(I18n.resolveLang('en', translations), 'en');
  assert.equal(I18n.resolveLang('en-GB', translations), 'en'); // region stripped
});

test('3. field-by-field fallback: translated field overlays, others stay original', () => {
  const tr = translations.en;
  assert.equal(I18n.tval(ORIGINAL, tr, 'product_name'), 'Merino Wool Jumper'); // translated
  assert.equal(I18n.tval(ORIGINAL, tr, 'brand_name'), 'Aava'); // not translated -> original
});

test('4. unknown/invalid language -> original', () => {
  assert.equal(I18n.resolveLang('xx', translations), 'fi');
  assert.equal(I18n.resolveLang('zz-ZZ', translations), 'fi');
});

test('5. supported but unavailable language -> original (no record)', () => {
  // de record is empty -> treated as unavailable
  assert.equal(I18n.resolveLang('de', translations), 'fi');
  // fr has no record at all
  assert.equal(I18n.resolveLang('fr', translations), 'fi');
});

test('6. blank/whitespace translation field falls back to original', () => {
  const tr = translations.en;
  // repair_instructions is '   ' (whitespace) -> must fall back
  assert.deepEqual(I18n.tlist(['Alkuperäinen korjaus'], tr, 'repair_instructions'), ['Alkuperäinen korjaus']);
  // materials is a real translated list -> used
  assert.deepEqual(I18n.tlist(['80% villa'], tr, 'materials'), ['80% wool']);
});

test('7. language selector lists original + only languages with content', () => {
  const langs = I18n.availableLanguages(translations);
  const codes = langs.map(l => l.code);
  assert.deepEqual(codes[0], 'fi'); // original first
  assert.ok(codes.includes('en')); // has content
  assert.ok(codes.includes('el')); // has content (Greek)
  assert.ok(!codes.includes('de')); // empty record excluded
  assert.ok(!codes.includes('fr')); // no record
});

test('8. Unicode names and content are preserved', () => {
  assert.equal(I18n.EU_LANG_NAMES.el, 'Ελληνικά');
  assert.equal(I18n.EU_LANG_NAMES.bg, 'Български');
  assert.equal(I18n.EU_LANG_NAMES.fi, 'Suomi');
  assert.equal(I18n.tval(ORIGINAL, translations.el, 'product_name'), 'Πουλόβερ');
});

test('9. UI dictionary localises chrome and falls back en->fi for unknown locale', () => {
  assert.equal(I18n.ui('en', 'manufacturer'), 'Manufacturer');
  assert.equal(I18n.ui('fi', 'operator'), 'Vastuullinen toimija (EU)'); // terminology fix
  assert.equal(I18n.ui('sv', 'materials'), 'Material');
  // unknown UI locale -> English fallback
  assert.equal(I18n.ui('ga', 'manufacturer'), 'Manufacturer');
});

test('10. empty translations -> only original in selector (no confusing selector)', () => {
  assert.deepEqual(I18n.availableLanguages({}).map(l => l.code), ['fi']);
});
