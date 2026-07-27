/* Public product passport — localisation helpers.
 * Pure, dependency-free, and unit-testable in Node (module.exports) while also
 * attaching to window for the browser (product.html loads it via <script src>).
 *
 * IMPORTANT: this is presentation only. The original product fields remain
 * authoritative; translations overlay them field-by-field. The original
 * language is Finnish ('fi'). The backend stores translations only for
 * SUPPORTED_LANGS — other codes cannot exist in the data.
 */
(function (root) {
  'use strict';

  var ORIGINAL_LANG = 'fi';

  // Language codes the backend can actually store (Worker SUPPORTED_LANGS) + the original.
  var SUPPORTED_LANGS = ['fi', 'en', 'sv', 'de', 'fr', 'et', 'lv', 'lt', 'pl'];

  // Native names (autonyms) for all 24 official EU languages — the architecture
  // supports any of these if a translation exists; only fi + backend-stored codes
  // can currently appear.
  var EU_LANG_NAMES = {
    bg: 'Български', cs: 'Čeština', da: 'Dansk', de: 'Deutsch', el: 'Ελληνικά',
    en: 'English', es: 'Español', et: 'Eesti', fi: 'Suomi', fr: 'Français',
    ga: 'Gaeilge', hr: 'Hrvatski', hu: 'Magyar', it: 'Italiano', lt: 'Lietuvių',
    lv: 'Latviešu', mt: 'Malti', nl: 'Nederlands', pl: 'Polski', pt: 'Português',
    ro: 'Română', sk: 'Slovenčina', sl: 'Slovenščina', sv: 'Svenska',
  };

  // UI-chrome dictionary (system interface language) — NOT product content.
  // Falls back to English then Finnish for any missing locale.
  var UI = {
    fi: { badge: 'EU · Digitaalinen tuotepassi', euOk: '✓ EU-vaatimusten mukainen', language: 'Kieli', manufacturer: 'Valmistaja', operator: 'Vastuullinen toimija (EU)', name: 'Nimi', email: 'Sähköposti', address: 'Osoite', materials: 'Materiaalit', substances: 'Kemialliset aineet', care: 'Hoito-ohjeet', repair: 'Korjausohjeet', recycling: 'Kierrätysohjeet', safety: 'Turvallisuustiedot', published: 'Julkaistu' },
    en: { badge: 'EU · Digital Product Passport', euOk: '✓ EU compliant', language: 'Language', manufacturer: 'Manufacturer', operator: 'Responsible operator (EU)', name: 'Name', email: 'Email', address: 'Address', materials: 'Materials', substances: 'Chemical substances', care: 'Care instructions', repair: 'Repair instructions', recycling: 'Recycling instructions', safety: 'Safety information', published: 'Published' },
    sv: { badge: 'EU · Digitalt produktpass', euOk: '✓ Uppfyller EU-krav', language: 'Språk', manufacturer: 'Tillverkare', operator: 'Ansvarig aktör (EU)', name: 'Namn', email: 'E-post', address: 'Adress', materials: 'Material', substances: 'Kemiska ämnen', care: 'Skötselråd', repair: 'Reparationsanvisningar', recycling: 'Återvinningsanvisningar', safety: 'Säkerhetsinformation', published: 'Publicerad' },
    de: { badge: 'EU · Digitaler Produktpass', euOk: '✓ EU-konform', language: 'Sprache', manufacturer: 'Hersteller', operator: 'Verantwortlicher Akteur (EU)', name: 'Name', email: 'E-Mail', address: 'Adresse', materials: 'Materialien', substances: 'Chemische Stoffe', care: 'Pflegehinweise', repair: 'Reparaturhinweise', recycling: 'Recyclinghinweise', safety: 'Sicherheitshinweise', published: 'Veröffentlicht' },
    fr: { badge: 'UE · Passeport numérique de produit', euOk: '✓ Conforme à l’UE', language: 'Langue', manufacturer: 'Fabricant', operator: 'Opérateur responsable (UE)', name: 'Nom', email: 'E-mail', address: 'Adresse', materials: 'Matériaux', substances: 'Substances chimiques', care: 'Instructions d’entretien', repair: 'Instructions de réparation', recycling: 'Instructions de recyclage', safety: 'Informations de sécurité', published: 'Publié' },
    et: { badge: 'EL · Digitaalne tootepass', euOk: '✓ Vastab ELi nõuetele', language: 'Keel', manufacturer: 'Tootja', operator: 'Vastutav ettevõtja (EL)', name: 'Nimi', email: 'E-post', address: 'Aadress', materials: 'Materjalid', substances: 'Keemilised ained', care: 'Hooldusjuhised', repair: 'Parandusjuhised', recycling: 'Ringlussevõtu juhised', safety: 'Ohutusteave', published: 'Avaldatud' },
    lv: { badge: 'ES · Digitālā produkta pase', euOk: '✓ Atbilst ES prasībām', language: 'Valoda', manufacturer: 'Ražotājs', operator: 'Atbildīgais uzņēmējs (ES)', name: 'Nosaukums', email: 'E-pasts', address: 'Adrese', materials: 'Materiāli', substances: 'Ķīmiskās vielas', care: 'Kopšanas norādījumi', repair: 'Remonta norādījumi', recycling: 'Pārstrādes norādījumi', safety: 'Drošības informācija', published: 'Publicēts' },
    lt: { badge: 'ES · Skaitmeninis gaminio pasas', euOk: '✓ Atitinka ES reikalavimus', language: 'Kalba', manufacturer: 'Gamintojas', operator: 'Atsakingas ūkio subjektas (ES)', name: 'Pavadinimas', email: 'El. paštas', address: 'Adresas', materials: 'Medžiagos', substances: 'Cheminės medžiagos', care: 'Priežiūros instrukcijos', repair: 'Remonto instrukcijos', recycling: 'Perdirbimo instrukcijos', safety: 'Saugos informacija', published: 'Paskelbta' },
    pl: { badge: 'UE · Cyfrowy paszport produktu', euOk: '✓ Zgodny z UE', language: 'Język', manufacturer: 'Producent', operator: 'Podmiot odpowiedzialny (UE)', name: 'Nazwa', email: 'E-mail', address: 'Adres', materials: 'Materiały', substances: 'Substancje chemiczne', care: 'Instrukcje pielęgnacji', repair: 'Instrukcje naprawy', recycling: 'Instrukcje recyklingu', safety: 'Informacje dotyczące bezpieczeństwa', published: 'Opublikowano' },
  };

  function isNonEmpty(v) {
    if (v == null) return false;
    if (Array.isArray(v)) return v.some(function (x) { return isNonEmpty(x); });
    return String(v).trim() !== '';
  }

  // Does a translation record carry any usable content?
  function hasContent(record) {
    if (!record || typeof record !== 'object') return false;
    return Object.keys(record).some(function (k) { return isNonEmpty(record[k]); });
  }

  // Parse translations_json defensively into an object of { lang: {fields} }.
  function parseTranslations(translationsJson) {
    try {
      var t = JSON.parse(translationsJson || '{}');
      return t && typeof t === 'object' ? t : {};
    } catch (e) { return {}; }
  }

  // Languages offered in the selector: the original first, then every language
  // that has a non-empty translation record. Never invents availability.
  function availableLanguages(translations) {
    var out = [{ code: ORIGINAL_LANG, name: EU_LANG_NAMES[ORIGINAL_LANG] }];
    Object.keys(translations || {}).forEach(function (code) {
      var c = String(code).toLowerCase();
      if (c === ORIGINAL_LANG) return;
      if (!hasContent(translations[code])) return;
      out.push({ code: c, name: EU_LANG_NAMES[c] || c.toUpperCase() });
    });
    return out;
  }

  // Resolve which language to render. Rules:
  //  - no/blank requested -> original
  //  - requested === original -> original
  //  - requested has a non-empty translation record -> requested
  //  - otherwise (unknown/unavailable/blank) -> original (safe fallback)
  function resolveLang(requested, translations) {
    var r = (requested || '').split('-')[0].toLowerCase();
    if (!r || r === ORIGINAL_LANG) return ORIGINAL_LANG;
    if (translations && hasContent(translations[r])) return r;
    return ORIGINAL_LANG;
  }

  // Field-by-field text value: non-empty translation overlays the original.
  function tval(original, trans, key) {
    var v = trans ? trans[key] : undefined;
    if (isNonEmpty(v)) return v;
    return original && original[key] != null ? original[key] : '';
  }

  // Field-by-field list value: non-empty translated array overlays the original array.
  function tlist(originalArr, trans, transKey) {
    var v = trans ? trans[transKey] : undefined;
    if (Array.isArray(v) && v.some(isNonEmpty)) return v.filter(isNonEmpty);
    return Array.isArray(originalArr) ? originalArr : [];
  }

  // UI label for a locale, falling back en -> fi.
  function ui(lang, key) {
    var dict = UI[lang] || UI.en || UI.fi;
    return (dict && dict[key] != null) ? dict[key] : (UI.fi[key] != null ? UI.fi[key] : key);
  }

  var api = {
    ORIGINAL_LANG: ORIGINAL_LANG,
    SUPPORTED_LANGS: SUPPORTED_LANGS,
    EU_LANG_NAMES: EU_LANG_NAMES,
    UI: UI,
    isNonEmpty: isNonEmpty,
    hasContent: hasContent,
    parseTranslations: parseTranslations,
    availableLanguages: availableLanguages,
    resolveLang: resolveLang,
    tval: tval,
    tlist: tlist,
    ui: ui,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PassportI18n = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
