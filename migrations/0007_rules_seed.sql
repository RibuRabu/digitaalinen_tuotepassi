-- ─────────────────────────────────────────────────────────────────────────────
-- 0007_rules_seed.sql
--
-- Seeds 32 audited regulation rules for 5 product categories.
-- Source: data/rules/jewelry.json, textiles.json, electronics.json,
--         batteries.json, furniture.json  —  audited 2026-06-16.
--
-- Summary:
--   Categories inserted (INSERT OR IGNORE): 1  (cat_jewelry)
--   Regulations inserted (INSERT OR IGNORE): 8
--   Category→regulation mappings (INSERT OR IGNORE): 14
--   Rules inserted: 32  (JEWELRY 5, TEXTILES 5, ELECTRONICS 7, BATTERIES 7, FURNITURE 8)
--
-- Design constraints honoured:
--   - Engine code (src/routes/compliance.js) is NOT modified.
--   - compliance_status = 'verified' is never set automatically.
--   - All rules with requires_human_review = 1 are severity 'warning' or 'info'.
--   - All rules with requirement_scope = 'draft' are severity 'info'.
--   - Draft regulations (status='draft') never auto-activate: the engine
--     filters r.status = 'active' in its mandatory-regulation query. Rules
--     under reg_espr_electronics and reg_espr_furniture only fire when a
--     tenant explicitly opts in via tenant_regulations.
--
-- Deferred design decisions (require human sign-off before changing):
--   - cr_eudr_fur mandatory=1: fires for all FURNITURE because no wood_content
--     field exists to discriminate wooden from non-wooden furniture.
--     Rule FURN_EUDR_TIMBER_DOC is severity='warning' (not error) to limit
--     blast radius until sub-category tagging is available.
--   - BAT_REG_CARBON_FOOTPRINT requirement_scope='mandatory_EU': technically
--     overstated for portable batteries (not in scope of Art. 38). Severity
--     is 'info' and requires_human_review=1 to prevent false blocking.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Section 1: New product category ──────────────────────────────────────────

INSERT OR IGNORE INTO product_categories (id, code, name_fi, name_en) VALUES
  ('cat_jewelry', 'JEWELRY', 'Korut ja asusteet', 'Jewelry and accessories');

-- ── Section 2: New regulations ────────────────────────────────────────────────
-- reg_gpsr and reg_espr_textiles already exist (seeded in 0004). Not repeated.
-- reg_reach and reg_weee appear in multiple category JSON files; INSERT OR IGNORE
-- guarantees exactly one row regardless of processing order.

INSERT OR IGNORE INTO regulations
  (id, code, name, description, version, effective_date, status)
VALUES
  (
    'reg_reach', 'REACH',
    'Registration, Evaluation, Authorisation and Restriction of Chemicals',
    'Regulation (EC) No 1907/2006. Governs chemical substance restrictions including SVHC communication obligations and restrictions in articles.',
    '1907/2006', '2007-06-01', 'active'
  ),
  (
    'reg_textile_labeling', 'TEXTILE_LABELING',
    'Textile Fibre Composition Labelling Regulation',
    'Regulation (EU) No 1007/2011 on textile fibre names and related labelling and marking requirements.',
    '1007/2011', '2012-11-08', 'active'
  ),
  (
    'reg_rohs', 'ROHS',
    'Restriction of Hazardous Substances in Electrical and Electronic Equipment',
    'Directive 2011/65/EU (recast). Restricts use of lead, mercury, cadmium, hexavalent chromium, PBB, PBDE, and four phthalates in EEE. Requires EU Declaration of Conformity.',
    '2011/65/EU', '2011-07-21', 'active'
  ),
  (
    'reg_weee', 'WEEE',
    'Waste Electrical and Electronic Equipment Directive',
    'Directive 2012/19/EU. Requires separate collection labelling, end-of-life information for users, and producer registration with national take-back schemes.',
    '2012/19/EU', '2014-02-14', 'active'
  ),
  (
    'reg_battery_reg', 'BATTERY_REG',
    'EU Battery Regulation',
    'Regulation (EU) 2023/1542. Comprehensive lifecycle requirements for batteries: labelling, safety, EPR, carbon footprint, battery passport. Replaces Directive 2006/66/EC from 18 August 2025.',
    '2023/1542', '2023-08-17', 'active'
  ),
  (
    'reg_espr_electronics', 'ESPR_ELECTRONICS',
    'Ecodesign for Sustainable Products — Electronics (Working Plan)',
    'Delegated acts under ESPR (EU) 2024/1781 for electronics product groups. Repairability, spare parts availability, and energy efficiency requirements under development as of 2025. Specific delegated acts not yet adopted.',
    '2024/draft', NULL, 'draft'
  ),
  (
    'reg_eudr', 'EUDR',
    'EU Deforestation Regulation',
    'Regulation (EU) 2023/1115 on making available on the Union market of certain commodities and products associated with deforestation and forest degradation. Wood products in Annex I scope include wooden furniture. Application delayed: large operators Dec 30 2025; SMEs Jun 30 2026.',
    '2023/1115', '2024-12-30', 'active'
  ),
  (
    'reg_espr_furniture', 'ESPR_FURNITURE',
    'Ecodesign for Sustainable Products — Furniture (Working Plan)',
    'Delegated act under ESPR (EU) 2024/1781 for furniture. Material composition, recyclability, durability and circular economy requirements under development. Delegated act not yet adopted as of 2026.',
    '2024/draft', NULL, 'draft'
  );

-- ── Section 3: Category → regulation mappings ─────────────────────────────────
-- INSERT OR IGNORE is safe because category_regulations has
-- UNIQUE(category_id, regulation_id, market). Re-running produces no change.

INSERT OR IGNORE INTO category_regulations
  (id, category_id, regulation_id, market, mandatory)
VALUES
  -- JEWELRY (new category — needs GPSR and REACH)
  ('cr_gpsr_jew',          'cat_jewelry',    'reg_gpsr',            '*',  1),
  ('cr_reach_jew',         'cat_jewelry',    'reg_reach',           'EU', 1),
  -- TEXTILES (adding mandatory REACH and TEXTILE_LABELING)
  ('cr_reach_tex',         'cat_textiles',   'reg_reach',           'EU', 1),
  ('cr_textile_label_tex', 'cat_textiles',   'reg_textile_labeling','EU', 1),
  -- ELECTRONICS (adding ROHS, WEEE, REACH mandatory; ESPR opt-in)
  ('cr_rohs_ele',          'cat_electronics','reg_rohs',            'EU', 1),
  ('cr_weee_ele',          'cat_electronics','reg_weee',            'EU', 1),
  ('cr_reach_ele',         'cat_electronics','reg_reach',           'EU', 1),
  ('cr_espr_ele',          'cat_electronics','reg_espr_electronics','*',  0),
  -- BATTERIES (adding BATTERY_REG, REACH, WEEE mandatory)
  ('cr_battery_bat',       'cat_batteries',  'reg_battery_reg',     'EU', 1),
  ('cr_reach_bat',         'cat_batteries',  'reg_reach',           'EU', 1),
  ('cr_weee_bat',          'cat_batteries',  'reg_weee',            'EU', 1),
  -- FURNITURE (adding REACH, EUDR mandatory; ESPR opt-in)
  ('cr_reach_fur',         'cat_furniture',  'reg_reach',           'EU', 1),
  ('cr_eudr_fur',          'cat_furniture',  'reg_eudr',            'EU', 1),
  ('cr_espr_fur',          'cat_furniture',  'reg_espr_furniture',  '*',  0);

-- ── Section 4: Regulation rules ───────────────────────────────────────────────
-- Columns: id, regulation_id, rule_code, rule_version, rule_type, field_path,
--          condition_json, severity, message_en, message_fi,
--          legal_reference, confidence_level, requires_human_review, requirement_scope
--
-- Notes:
--   field_path is NULL for all required_document rules (engine reads
--   condition_json.doc_name_pattern against product_documents.name instead).
--   requires_human_review: 1 = review needed before treating as authoritative.
--   Engine does not read legal_reference, confidence_level, requires_human_review,
--   or requirement_scope — these are metadata for tooling and human reviewers only.

-- ── 4a. JEWELRY — 5 rules (REACH ×4, GPSR ×1) ───────────────────────────────

INSERT INTO regulation_rules
  (id, regulation_id, rule_code, rule_version, rule_type,
   field_path, condition_json, severity, message_en, message_fi,
   legal_reference, confidence_level, requires_human_review, requirement_scope)
VALUES
  (
    'rule_jewel_reach_01', 'reg_reach', 'JEWEL_REACH_SUBSTANCES', 1,
    'required_array_min', 'substances_json',
    '{"category_codes":["JEWELRY"],"min":1}',
    'error',
    'Chemical substance declarations are required for jewelry. At minimum, declare nickel content or confirmed absence; cadmium and any SVHC present above 0.1% w/w must also be disclosed.',
    'Kemikaaleja koskevat aineilmoitukset vaaditaan koruille. Ilmoita vähintään nikkelipitoisuus tai sen vahvistettu puuttuminen; myös kadmium ja yli 0,1 % (p/p) pitoisuudella esiintyvät SVHC-aineet on ilmoitettava.',
    'REACH Annex XVII Entry 27 (Nickel — skin-contact articles); Entry 23 (Cadmium); Art. 33 (SVHC communication to consumers); (EC) No 1907/2006',
    95, 0, 'mandatory_EU'
  ),
  (
    'rule_jewel_reach_02', 'reg_reach', 'JEWEL_REACH_NICKEL_DOC', 1,
    'required_document', NULL,
    '{"category_codes":["JEWELRY"],"doc_name_pattern":"nickel|EN.?1811|migration.*test|skin.*contact.*test|substance.*migration"}',
    'warning',
    'A nickel release test report per EN 1811:2023 is required to demonstrate compliance with REACH Annex XVII Entry 27 for jewelry in prolonged skin contact. Upload the test report from an accredited laboratory.',
    'Standardin EN 1811:2023 mukainen nikkelipäästötestiraportti vaaditaan osoittamaan vaatimustenmukaisuus REACH-asetuksen liitteen XVII kohdan 27 kanssa ihokosketuksessa oleville koruille. Lataa akkreditoidun laboratorion testiraportti.',
    'REACH Annex XVII Entry 27, para. 1 and 2; EN 1811:2023 (harmonised test method for nickel migration); (EC) No 1907/2006',
    93, 0, 'mandatory_EU'
  ),
  (
    'rule_jewel_reach_03', 'reg_reach', 'JEWEL_REACH_CADMIUM_DOC', 1,
    'required_document', NULL,
    '{"category_codes":["JEWELRY"],"doc_name_pattern":"cadmium|Cd.*content|REACH.*23|supplier.*declar|chemical.*analysis|XRF.*test|metal.*content"}',
    'warning',
    'Documentation confirming cadmium content below 0.01% w/w in metal parts of jewelry is required by REACH Annex XVII Entry 23. Acceptable evidence: supplier declaration, XRF screening result, or laboratory analysis.',
    'REACH-asetuksen liitteen XVII kohta 23 edellyttää asiakirjaa, joka vahvistaa kadmiumpitoisuuden olevan alle 0,01 % (p/p) korujen metalliosissa. Hyväksyttävä näyttö: toimittajan vakuutus, XRF-seulontatulos tai laboratorioanalyysi.',
    'REACH Annex XVII Entry 23 (Cadmium and its compounds), para. 3 — jewelry and fashion accessories; (EC) No 1907/2006',
    88, 1, 'mandatory_EU'
  ),
  (
    'rule_jewel_gpsr_01', 'reg_gpsr', 'JEWEL_GPSR_ALLERGEN_WARNING', 1,
    'required_array_min', 'safety_notes_json',
    '{"category_codes":["JEWELRY"],"min":1}',
    'warning',
    'Jewelry must include safety information about potential allergens in contact materials (e.g. nickel, chromium VI, certain dyes used in artificial stones or leather). Disclose known sensitisers to enable informed consumer choice.',
    'Korujen on sisällettävä turvallisuustietoja kosketusmateriaalien mahdollisista allergeeneista (esim. nikkeli, kromi VI, keinokivissä tai nahassa käytetyt väriaineet). Ilmoita tunnetut herkistäjät, jotta kuluttajat voivat tehdä tietoisen valinnan.',
    'GPSR Art. 9(5) — safety information on risks and means to avoid them; Art. 11(1)(c) — product safety information for vulnerable consumers; (EU) 2023/988',
    91, 0, 'mandatory_EU'
  ),
  (
    'rule_jewel_reach_04', 'reg_reach', 'JEWEL_MATERIALS_DECLARATION', 1,
    'required_array_min', 'materials_json',
    '{"category_codes":["JEWELRY"],"min":1}',
    'warning',
    'Declaring the material composition of jewelry (metal alloys, gemstones, plating, coatings) supports REACH substance traceability and allows downstream actors to verify SVHC obligations under Art. 33.',
    'Korujen materiaalipohjan ilmoittaminen (metallilejeeringit, jalokivet, galvanoinnit, pinnoitteet) tukee REACH-aineiden jäljitettävyyttä ja mahdollistaa toimitusketjun toimijoiden SVHC-velvoitteiden (Art. 33) tarkistamisen.',
    'REACH Art. 33 (communication on SVHC in articles); GPSR Art. 8(9) — technical documentation for safety assessment; (EC) No 1907/2006',
    86, 1, 'best_practice'
  );

-- ── 4b. TEXTILES — 5 rules (TEXTILE_LABELING ×2, REACH ×2, ESPR_TEXTILES ×1) ──

INSERT INTO regulation_rules
  (id, regulation_id, rule_code, rule_version, rule_type,
   field_path, condition_json, severity, message_en, message_fi,
   legal_reference, confidence_level, requires_human_review, requirement_scope)
VALUES
  (
    'rule_tex_label_01', 'reg_textile_labeling', 'TEXT_LABEL_FIBER_COMP', 1,
    'required_array_min', 'materials_json',
    '{"category_codes":["TEXTILES"],"min":1}',
    'error',
    'Textile fiber composition must be declared by fiber name and percentage of total weight. All component fibers must be listed (EU 1007/2011 Art. 11). Decorative parts <7% and hidden processing fibers are exempt.',
    'Tekstiilituotteen kuitukoostumus on ilmoitettava kuitunimellä ja prosenttiosuudella kokonaispainosta. Kaikki komponenttikuidut on lueteltava (asetus (EU) 1007/2011, Art. 11). Alle 7 %:n koristeosat ja piilotetut prosessointikuidut on vapautettu.',
    'Regulation (EU) No 1007/2011, Art. 11 — mandatory indication of textile fibre composition; Art. 12 — labelling of fibre names and compositions; Annex I — approved fibre names',
    99, 0, 'mandatory_EU'
  ),
  (
    'rule_tex_label_02', 'reg_textile_labeling', 'TEXT_LABEL_CARE', 1,
    'required_array_min', 'care_instructions_json',
    '{"category_codes":["TEXTILES"],"min":1}',
    'warning',
    'Care instructions (washing, drying, ironing, bleaching, dry-cleaning) must be provided on textile products. ISO 3758:2012 symbols are the established standard across EU member states. Required in practice for market access in most MS.',
    'Tekstiilituotteiden hoito-ohjeet (pesu, kuivaus, silitys, valkaisu, kemiallinen pesu) on annettava. ISO 3758:2012 -symbolit ovat vakiintuneet EU:n jäsenvaltioissa. Vaatimus on käytännössä edellytys markkinoille pääsylle useimmissa jäsenvaltioissa.',
    'Regulation (EU) No 1007/2011, Art. 15 — voluntary care labelling widely transposed as mandatory; ISO 3758:2012 (care labelling code using symbols); note that care labelling is mandatory under national law in several MS (e.g. FR, IT)',
    89, 1, 'country_specific'
  ),
  (
    'rule_tex_reach_01', 'reg_reach', 'TEXT_REACH_SUBSTANCES', 1,
    'required_array_min', 'substances_json',
    '{"category_codes":["TEXTILES"],"min":1}',
    'warning',
    'Textile products must be assessed for REACH restricted substances. Declare or confirm absence of: azo colorants releasing carcinogenic amines (Annex XVII Entry 43, limit 30 mg/kg), SVHC candidates present above 0.1% w/w (Art. 33), and formaldehyde where applicable.',
    'Tekstiilituotteet on arvioitava REACH-rajoitettujen aineiden osalta. Ilmoita tai vahvista seuraavien aineiden puuttuminen: syöpää aiheuttavia aromaattisia amiineja vapauttavat atsovärit (liite XVII, kohta 43, raja-arvo 30 mg/kg), SVHC-ehdokkaat yli 0,1 % (p/p) pitoisuudella (Art. 33) sekä formaldehydi tapauksen mukaan.',
    'REACH Annex XVII Entry 43 (Azo Dyes — carcinogenic amines from azo colorants); Art. 33 (communication on substances of very high concern in articles); (EC) No 1907/2006',
    93, 0, 'mandatory_EU'
  ),
  (
    'rule_tex_reach_02', 'reg_reach', 'TEXT_REACH_AZO_DOC', 1,
    'required_document', NULL,
    '{"category_codes":["TEXTILES"],"doc_name_pattern":"azo|EN.*14362|ISO.*14362|chemical.*test|dye.*test|substance.*test|REACH.*43|supplier.*chemical|restricted.*substance"}',
    'warning',
    'Test documentation for azo dye compliance (EN ISO 14362-1:2017 / EN ISO 14362-3:2017) or a supplier chemical declaration covering REACH Annex XVII Entry 43 is recommended for textile products sold on the EU market.',
    'Atsovärien vaatimustenmukaisuuden testausdokumentti (EN ISO 14362-1:2017 / EN ISO 14362-3:2017) tai toimittajan kemikaalivakuutus REACH-asetuksen liitteen XVII kohdan 43 osalta on suositeltava EU:n markkinoille saatettaville tekstiilituotteille.',
    'REACH Annex XVII Entry 43; EN ISO 14362-1:2017 (azo dyes — detection of carcinogenic amines); EN ISO 14362-3:2017 (detection of 4-aminoazobenzene); (EC) No 1907/2006',
    92, 0, 'mandatory_EU'
  ),
  (
    'rule_tex_espr_01', 'reg_espr_textiles', 'TEXT_ESPR_RECYCLED_CONTENT', 1,
    'required_array_min', 'materials_json',
    '{"category_codes":["TEXTILES"],"min":1}',
    'info',
    '(Draft — not yet in force) The forthcoming ESPR delegated act for textiles is expected to require labelling of recycled fibre content by percentage. Begin declaring recycled material percentages within material declarations to prepare for this requirement.',
    '(Luonnos — ei vielä voimassa) Tekstiilien tulevan ESPR-delegoidun asetuksen odotetaan edellyttävän kierrätettyjen kuitujen prosenttiosuuden merkitsemistä. Aloita kierrätysmateriaaliprosentin ilmoittaminen materiaalitiedoissa tätä vaatimusta varten valmistautuaksesi.',
    'ESPR Regulation (EU) 2024/1781, Art. 4 — ecodesign requirements; ESPR Working Plan 2022–2024 (textiles); European Commission SWD(2023)166 (textiles delegated act preparatory study — recycled content as candidate requirement)',
    70, 1, 'draft'
  );

-- ── 4c. ELECTRONICS — 7 rules (ROHS ×3, WEEE ×2, REACH ×1, ESPR_ELECTRONICS ×1) ──

INSERT INTO regulation_rules
  (id, regulation_id, rule_code, rule_version, rule_type,
   field_path, condition_json, severity, message_en, message_fi,
   legal_reference, confidence_level, requires_human_review, requirement_scope)
VALUES
  (
    'rule_elec_rohs_01', 'reg_rohs', 'ELEC_ROHS_SUBSTANCES', 1,
    'required_array_min', 'substances_json',
    '{"category_codes":["ELECTRONICS"],"min":1}',
    'error',
    'RoHS-restricted substance declarations are required for EEE. Declare compliance with or exemption from restrictions on: Pb, Hg, Cd, Cr6+, PBB, PBDE, DEHP, BBP, DBP, DIBP (Directive 2011/65/EU Annex II). Maximum concentration values apply unless an Annex III/IV exemption is claimed.',
    'RoHS-rajoitettujen aineiden ilmoitukset vaaditaan EEE-tuotteille. Ilmoita vaatimustenmukaisuus tai poikkeus seuraavien rajoitusten osalta: Pb, Hg, Cd, Cr6+, PBB, PBDE, DEHP, BBP, DBP, DIBP (direktiivi 2011/65/EU, liite II). Enimmäispitoisuusarvot pätevät, ellei liitteen III/IV vapautusta vaadita.',
    'Directive 2011/65/EU (RoHS recast), Art. 4(1) — restriction on hazardous substances; Annex II — restricted substances and maximum concentration values; Directive 2015/863/EU (phthalates amendment)',
    98, 0, 'mandatory_EU'
  ),
  (
    'rule_elec_rohs_02', 'reg_rohs', 'ELEC_ROHS_EU_DOC', 1,
    'required_document', NULL,
    '{"category_codes":["ELECTRONICS"],"doc_name_pattern":"RoHS|hazardous.*substance|restricted.*substance|DoC.*RoHS|EU.*declaration|conformity.*2011"}',
    'error',
    'An EU Declaration of Conformity confirming RoHS compliance (Directive 2011/65/EU Art. 13-15) is mandatory for EEE placed on the EU market. The DoC must identify the product, manufacturer, applicable legislation, and be signed by an authorised representative.',
    'EU-vaatimustenmukaisuusvakuutus, joka vahvistaa RoHS-vaatimustenmukaisuuden (direktiivi 2011/65/EU, Art. 13–15), on pakollinen EU:n markkinoille saatettaville EEE-tuotteille. Vakuutuksessa on mainittava tuote, valmistaja, sovellettava lainsäädäntö, ja valtuutetun edustajan on allekirjoitettava se.',
    'Directive 2011/65/EU (RoHS), Art. 13 (EU declaration of conformity); Art. 14 (CE marking); Art. 15 (content of EU DoC); Annex VI — template for EU DoC',
    98, 0, 'mandatory_EU'
  ),
  (
    'rule_elec_gpsr_01', 'reg_rohs', 'ELEC_CE_EU_DOC', 1,
    'required_document', NULL,
    '{"category_codes":["ELECTRONICS"],"doc_name_pattern":"CE.*mark|declaration.*conformity|EU.*DoC|EU.*declaration|conformity.*declar|LVD.*declar|RED.*declar|EMC.*declar|NLF.*declar"}',
    'error',
    'CE marking and an EU Declaration of Conformity are required for EEE subject to New Legislative Framework directives (LVD 2014/35/EU, EMC 2014/30/EU, RED 2014/53/EU, as applicable). Upload the EU DoC identifying all applicable directives, standards applied, and the signatory.',
    'CE-merkintä ja EU-vaatimustenmukaisuusvakuutus vaaditaan EEE-tuotteille, joihin sovelletaan uuden lainsäädäntökehyksen direktiivejä (LVD 2014/35/EU, EMC 2014/30/EU, RED 2014/53/EU, tapauksen mukaan). Lataa EU-vakuutus, jossa yksilöidään kaikki sovellettavat direktiivit, sovelletut standardit ja allekirjoittaja.',
    'Decision No 768/2008/EC (NLF CE marking framework); Directive 2014/35/EU (LVD), Art. 13-15; Directive 2014/30/EU (EMC), Art. 14-16; Directive 2014/53/EU (RED), Art. 19-21; (EU) 2023/988 (GPSR) does not itself require CE marking but operates alongside applicable harmonisation legislation',
    97, 0, 'mandatory_EU'
  ),
  (
    'rule_elec_weee_01', 'reg_weee', 'ELEC_WEEE_RECYCLING', 1,
    'required_array_min', 'recycling_instructions_json',
    '{"category_codes":["ELECTRONICS"],"min":1}',
    'error',
    'End-of-life recycling information is mandatory for EEE under WEEE Directive. Users must be informed that the product must NOT be disposed of as unsorted municipal waste and should be returned to a designated collection point (crossed-out wheeled bin symbol). Include instructions on where and how to return the product.',
    'Elinkaaren lopun kierrätysohjeet ovat pakollisia EEE-tuotteille WEEE-direktiivin nojalla. Käyttäjiä on informoitava, ettei tuotetta saa hävittää lajittelemattoman yhdyskuntajätteen mukana, vaan se on palautettava asianmukaiseen keräyspisteeseen (yliviivattu roskakori -symboli). Sisällytä ohjeet siitä, minne ja miten tuote palautetaan.',
    'Directive 2012/19/EU (WEEE), Art. 12(1) — information for users of private households; Art. 14(1) — marking requirements (crossed-out wheeled bin); Annex VIII — information for users',
    97, 0, 'mandatory_EU'
  ),
  (
    'rule_elec_reach_01', 'reg_reach', 'ELEC_REACH_SVHC', 1,
    'required_array_min', 'substances_json',
    '{"category_codes":["ELECTRONICS"],"min":1}',
    'warning',
    'Any substance of very high concern (SVHC) present in the product above 0.1% w/w must be communicated to customers and — upon request — to consumers and waste authorities (REACH Art. 33). Declare all SVHC candidates or confirm their absence.',
    'Kaikki tuotteessa yli 0,1 % (p/p) pitoisuudella esiintyvät erittäin suurta huolta aiheuttavat aineet (SVHC) on ilmoitettava asiakkaille ja — pyydettäessä — kuluttajille ja jäteviranomaisille (REACH Art. 33). Ilmoita kaikki SVHC-ehdokkaat tai vahvista niiden puuttuminen.',
    'REACH Art. 33 — duty to communicate information on substances in articles; ECHA SVHC Candidate List (updated regularly); (EC) No 1907/2006',
    96, 0, 'mandatory_EU'
  ),
  (
    'rule_elec_weee_02', 'reg_weee', 'ELEC_WEEE_SYMBOL_DOC', 1,
    'required_document', NULL,
    '{"category_codes":["ELECTRONICS"],"doc_name_pattern":"WEEE|crossed.*bin|wheeled.*bin|producer.*register|take.*back|separate.*collection"}',
    'info',
    '(Informational) Evidence of WEEE producer registration with a national take-back scheme (e.g. Piretti, Sims, national register certificate) can be uploaded here for audit traceability. The registration itself is a business-level obligation, not a per-product passport requirement.',
    '(Tiedoksi) Todistus WEEE-tuottajarekisteröinnistä kansallisessa palautusjärjestelmässä (esim. Piretti, kansallinen rekisteriote) voidaan ladata tähän tarkastettavuuden tueksi. Rekisteröinti on yritystason velvoite eikä tuotekohtainen tuotepassivaatimus.',
    'Directive 2012/19/EU (WEEE), Art. 16 — registration of producers with national registers; Art. 17 — reporting; national implementing legislation varies by member state',
    84, 1, 'best_practice'
  ),
  (
    'rule_elec_espr_01', 'reg_espr_electronics', 'ELEC_ESPR_REPAIR_INFO', 1,
    'required_array_min', 'repair_instructions_json',
    '{"category_codes":["ELECTRONICS"],"min":1}',
    'info',
    '(Draft — not yet in force) ESPR delegated acts for electronics product groups are expected to include repairability requirements: spare parts availability periods, disassembly instructions, and a repairability score. Begin documenting repair/disassembly instructions now to prepare.',
    '(Luonnos — ei vielä voimassa) Elektroniikan ESPR-delegoitujen asetusten odotetaan sisältävän korjattavuusvaatimuksia: varaosien saatavuusajat, purkuohjeet ja korjattavuusindeksi. Aloita korjaus- ja purkuohjeiden dokumentointi nyt valmistautuaksesi.',
    'ESPR Regulation (EU) 2024/1781, Art. 5 — ecodesign requirements; ESPR Working Plan 2022–2024 — smartphones and tablets (COM/2022/31); Regulation (EU) 2023/1670 (smartphones ecodesign — repair information, spare parts); note: 2023/1670 is already in force for smartphones as of 2025',
    78, 1, 'draft'
  );

-- ── 4d. BATTERIES — 7 rules (BATTERY_REG ×6, REACH ×1) ─────────────────────

INSERT INTO regulation_rules
  (id, regulation_id, rule_code, rule_version, rule_type,
   field_path, condition_json, severity, message_en, message_fi,
   legal_reference, confidence_level, requires_human_review, requirement_scope)
VALUES
  (
    'rule_bat_reg_01', 'reg_battery_reg', 'BAT_REG_CHEMISTRY', 1,
    'required_array_min', 'materials_json',
    '{"category_codes":["BATTERIES"],"min":1}',
    'error',
    'Battery chemistry must be declared (e.g. Li-ion, NiMH, LFP, lead-acid, alkaline). Required on the label and in accompanying information per Battery Regulation Art. 13(2)(b). This information must be accessible via QR code from August 2025.',
    'Akkukemia on ilmoitettava (esim. Li-ion, NiMH, LFP, lyijyhappo, alkali). Vaaditaan etiketissä ja mukana toimitetuissa tiedoissa akkuasetuksen Art. 13(2)(b) mukaisesti. Nämä tiedot on oltava QR-koodin kautta saatavissa elokuusta 2025 alkaen.',
    'Regulation (EU) 2023/1542, Art. 13(2)(b) — labelling of battery chemistry; Art. 13(6) — QR code access to data; Annex VI — labelling requirements',
    97, 0, 'mandatory_EU'
  ),
  (
    'rule_bat_reg_02', 'reg_battery_reg', 'BAT_REG_SUBSTANCES', 1,
    'required_array_min', 'substances_json',
    '{"category_codes":["BATTERIES"],"min":1}',
    'error',
    'Hazardous substance content must be declared for batteries. Minimum: declare presence/absence and concentration of: cadmium (>0.002%), lead (>0.004%), mercury (>0.0005%). Also declare cobalt, lithium, and nickel content to support supply chain due diligence (Battery Regulation Art. 10, 13(5)(e)).',
    'Akkujen vaarallisten aineiden pitoisuus on ilmoitettava. Vähintään: ilmoita kadmiumin (>0,002 %), lyijyn (>0,004 %) ja elohopean (>0,0005 %) esiintyminen/puuttuminen ja pitoisuus. Ilmoita myös koboltti-, litium- ja nikkelipitoisuus toimitusketjun huolellisuuden tueksi (akkuasetus Art. 10, 13(5)(e)).',
    'Regulation (EU) 2023/1542, Art. 6 — restrictions on hazardous substances (Hg, Cd thresholds); Art. 10 — substances of concern (Co, Pb, Li, Ni); Art. 13(5)(e) — labelling of hazardous substance content; Annex XIII — substances of concern',
    96, 0, 'mandatory_EU'
  ),
  (
    'rule_bat_reg_03', 'reg_battery_reg', 'BAT_REG_SAFETY_WARNINGS', 1,
    'required_array_min', 'safety_notes_json',
    '{"category_codes":["BATTERIES"],"min":1}',
    'error',
    'Safety warnings are mandatory on battery labels and in accompanying information: disposal and recycling symbol (crossed-out wheeled bin), chemical hazard symbols where applicable (GHS pictograms), and instructions that the battery should be kept away from heat sources. State capacity and rated voltage.',
    'Turvallisuusvaroitukset ovat pakollisia akkuetiketeissä ja mukana toimitetuissa tiedoissa: hävittämis- ja kierrätyssymboli (yliviivattu roskakori), kemiallisten vaarojen symbolit tapauksen mukaan (GHS-kuvakkeet) sekä ohjeet siitä, ettei akkua saa altistaa lämmölle. Ilmoita kapasiteetti ja nimellisjännite.',
    'Regulation (EU) 2023/1542, Art. 11 — general safety requirements; Art. 13(2) — labelling content; Annex VI — label content including crossed-out bin symbol; (EC) No 1272/2008 (CLP) — GHS hazard symbols for chemical content',
    97, 0, 'mandatory_EU'
  ),
  (
    'rule_bat_reg_04', 'reg_battery_reg', 'BAT_REG_RECYCLING_INFO', 1,
    'required_array_min', 'recycling_instructions_json',
    '{"category_codes":["BATTERIES"],"min":1}',
    'error',
    'End-of-life collection and recycling instructions are mandatory under the Battery Regulation EPR scheme (Art. 67-70). Inform users: (a) the battery must be separately collected, (b) free take-back is available, (c) where to return the battery (collection points, retailers, producers). Include the crossed-out wheeled bin symbol reference.',
    'Elinkaaren lopun keräys- ja kierrätysohjeet ovat pakollisia akkuasetuksen laajennetun tuottajavastuun järjestelmässä (Art. 67–70). Tiedota käyttäjiä: (a) akku on kerättävä erikseen, (b) ilmainen palautus on saatavilla, (c) mihin akku palautetaan (keräyspisteet, vähittäiskauppiaat, tuottajat). Sisällytä viittaus yliviivattu roskakori -symboliin.',
    'Regulation (EU) 2023/1542, Art. 67-70 (EPR obligations); Art. 74(2) — duty to inform end-users about separate collection; Art. 13(2)(a) — crossed-out wheeled bin labelling',
    98, 0, 'mandatory_EU'
  ),
  (
    'rule_bat_reg_05', 'reg_battery_reg', 'BAT_REG_EU_DOC', 1,
    'required_document', NULL,
    '{"category_codes":["BATTERIES"],"doc_name_pattern":"EU.*declaration|declaration.*conformity|battery.*declar|conformity.*2023|CE.*mark|technical.*file"}',
    'error',
    'An EU Declaration of Conformity is required for batteries placed on the EU market under the Battery Regulation (Art. 18) and any co-applicable directive (e.g. LVD for battery packs with integrated electronics). The DoC must reference Regulation (EU) 2023/1542 and confirm conformity with all applicable requirements.',
    'EU-vaatimustenmukaisuusvakuutus vaaditaan EU:n markkinoille saatettaville akuille akkuasetuksen (Art. 18) ja kaikkien muiden sovellettavien direktiivien (esim. LVD integroitua elektroniikkaa sisältäville akkupaketeille) nojalla. Vakuutuksen on viitattava asetukseen (EU) 2023/1542 ja vahvistettava vaatimustenmukaisuus kaikkien sovellettavien vaatimusten osalta.',
    'Regulation (EU) 2023/1542, Art. 18 — EU declaration of conformity; Art. 19 — CE marking (where applicable); Annex VIII — EU DoC template',
    94, 0, 'mandatory_EU'
  ),
  (
    'rule_bat_reach_01', 'reg_reach', 'BAT_REACH_SVHC', 1,
    'required_array_min', 'substances_json',
    '{"category_codes":["BATTERIES"],"min":1}',
    'warning',
    'Batteries may contain SVHC candidates: cobalt compounds (cobalt(II) sulphate is on the Candidate List), nickel sulphate, and lithium compounds are under REACH scrutiny. Declare any SVHC present above 0.1% w/w to enable downstream communication obligations under REACH Art. 33.',
    'Akut saattavat sisältää SVHC-ehdokkaita: koboltinyhdisteet (koboltti(II)sulfaatti on ehdokaslistalla), nikkeli(II)sulfaatti ja litiumyhdisteet ovat REACH-tarkastelun kohteena. Ilmoita kaikki SVHC-aineet, joita esiintyy yli 0,1 % (p/p) pitoisuudella, REACH Art. 33 -mukaisten toimitusketjun viestintävelvoitteiden mahdollistamiseksi.',
    'REACH Art. 33 (SVHC communication in articles); ECHA SVHC Candidate List — cobalt(II) sulphate (EC 233-334-2), nickel sulphate (EC 232-104-9); (EC) No 1907/2006',
    93, 0, 'mandatory_EU'
  ),
  (
    'rule_bat_reg_06', 'reg_battery_reg', 'BAT_REG_CARBON_FOOTPRINT', 1,
    'required_document', NULL,
    '{"category_codes":["BATTERIES"],"doc_name_pattern":"carbon.*footprint|CO2|GHG|greenhouse.*gas|climate|LCA|life.*cycle.*assess|footprint.*declar"}',
    'info',
    '(Phased requirement — verify applicability) Carbon footprint declarations are required under Battery Regulation Art. 38 for EV batteries (from August 2025), LMT batteries (from August 2025), and industrial batteries >=2kWh (from August 2025). Portable batteries are NOT currently subject to this requirement. Upload the carbon footprint declaration if your battery type is in scope.',
    '(Vaiheistettu vaatimus — tarkista sovellettavuus) Hiilijalanjälki-ilmoitukset ovat pakollisia akkuasetuksen Art. 38:n nojalla sähköajoneuvojen akuille (elokuusta 2025), LMT-akuille (elokuusta 2025) ja teollisuusakuille >=2kWh (elokuusta 2025). Kannettaville akuille ei tällä hetkellä ole tätä vaatimusta. Lataa hiilijalanjälki-ilmoitus, jos akkutyyppisi kuuluu soveltamisalaan.',
    'Regulation (EU) 2023/1542, Art. 38 — carbon footprint declarations; Art. 39 — carbon footprint performance classes; Commission Delegated Regulation (EU) 2024/1682 (carbon footprint calculation method)',
    82, 1, 'mandatory_EU'
  );

-- ── 4e. FURNITURE — 8 rules (GPSR ×3, REACH ×2, EUDR ×1, ESPR_FURNITURE ×2) ──

INSERT INTO regulation_rules
  (id, regulation_id, rule_code, rule_version, rule_type,
   field_path, condition_json, severity, message_en, message_fi,
   legal_reference, confidence_level, requires_human_review, requirement_scope)
VALUES
  (
    'rule_furn_gpsr_01', 'reg_gpsr', 'FURN_MATERIALS_DECLARATION', 1,
    'required_array_min', 'materials_json',
    '{"category_codes":["FURNITURE"],"min":1}',
    'error',
    'Material composition of furniture must be declared to enable a GPSR conformity assessment (Art. 8) and to identify applicable REACH restrictions. Declare primary materials (wood species/engineered wood type, metal alloys, upholstery fabrics, foam, surface coatings, adhesives).',
    'Huonekalun materiaalipohja on ilmoitettava GPSR-vaatimustenmukaisuuden arvioinnin (Art. 8) ja sovellettavien REACH-rajoitusten tunnistamisen mahdollistamiseksi. Ilmoita päämateriaalit (puulaji / insinööripuutyyppi, metalliseokset, verhoilumateriaalit, vaahto, pintakäsittelyt, liimat).',
    'GPSR Art. 8(9) — technical documentation for safety assessment must identify materials; REACH Art. 33 (SVHC in articles); (EU) 2023/988',
    95, 0, 'mandatory_EU'
  ),
  (
    'rule_furn_gpsr_02', 'reg_gpsr', 'FURN_GPSR_SAFETY_INFO', 1,
    'required_array_min', 'safety_notes_json',
    '{"category_codes":["FURNITURE"],"min":1}',
    'error',
    'Safety information is mandatory for furniture. Include as applicable: maximum load capacity, assembly warnings, tip-over risk and wall-anchoring instructions (particularly for tall storage furniture), age restrictions for children''s furniture, and surface treatment warnings (VOC off-gassing).',
    'Turvallisuustiedot ovat pakollisia huonekaluille. Sisällytä tapauksen mukaan: enimmäiskuormakapasiteetti, kokoonpano-ohjeet, kaatumisriski ja seinäankurointiohjeet (erityisesti korkeille säilytyshuonekaluille), ikärajoitukset lastenhuonekaluille sekä pintakäsittelyvaroitukset (VOC-päästöt).',
    'GPSR Art. 9(5) — safety information including risks and how to avoid them; Art. 11(1) — product safety information; GPSR Recital 30 — tip-over risk explicitly cited; EN 14749:2016 (storage furniture stability) as reference standard under GPSR Art. 7; (EU) 2023/988',
    94, 0, 'mandatory_EU'
  ),
  (
    'rule_furn_reach_01', 'reg_reach', 'FURN_REACH_SUBSTANCES', 1,
    'required_array_min', 'substances_json',
    '{"category_codes":["FURNITURE"],"min":1}',
    'warning',
    'Furniture must be assessed for REACH-restricted substances. Declare or confirm absence of: SVHC in surface coatings, adhesives, or upholstery fabrics (Art. 33, >0.1% w/w); halogenated flame retardants in foam (several on SVHC list); formaldehyde-releasing resins in wood-based panels (Annex XVII Entry 72).',
    'Huonekalut on arvioitava REACH-rajoitettujen aineiden osalta. Ilmoita tai vahvista seuraavien aineiden puuttuminen: SVHC pintakäsittelyissä, liimoissa tai verhoilukankaissa (Art. 33, >0,1 % p/p); halogenoidut palonsuoja-aineet vaahtomuovissa (useita SVHC-listalla); formaldehydiä vapauttavat hartsit puupohjaisissa levyissä (liite XVII, kohta 72).',
    'REACH Art. 33 (SVHC in articles); Annex XVII Entry 72 (formaldehyde in wood-based products); ECHA SVHC Candidate List — relevant entries include HBCDD (flame retardant in EPS), DecaBDE, chlorinated paraffins; (EC) No 1907/2006',
    93, 0, 'mandatory_EU'
  ),
  (
    'rule_furn_reach_02', 'reg_reach', 'FURN_REACH_FORMALDEHYDE_DOC', 1,
    'required_document', NULL,
    '{"category_codes":["FURNITURE"],"doc_name_pattern":"formaldehyde|HCHO|E1.*class|EN.*717|EN.*120|emission.*test|panel.*test|wood.*emission|CARB|composite.*wood"}',
    'error',
    'Furniture containing wood-based panels (MDF, particleboard, plywood, OSB) must demonstrate formaldehyde emission compliance (E1 class: <=0.124 mg/m3 by EN 717-1 or <=8 mg/100g dry board by EN 120). Upload a test report from an accredited laboratory or a valid manufacturer''s declaration citing the test standard.',
    'Puupohjaisia levyjä (MDF, lastulevy, vaneri, OSB) sisältävien huonekalujen on osoitettava formaldehydipäästöjen vaatimustenmukaisuus (E1-luokka: <=0,124 mg/m3 standardin EN 717-1 mukaisesti tai <=8 mg/100 g kuivaa levyä standardin EN 120 mukaisesti). Lataa akkreditoidun laboratorion testiraportti tai valmistajan pätevä vakuutus, jossa mainitaan testausstandardi.',
    'REACH Annex XVII Entry 72 (formaldehyde release from wood-based products — E1 class limit); EN 717-1:2004 (chamber method); EN 120:1992 (perforator method); Commission Regulation (EU) 2023/1464 (updated formaldehyde limits — verify entry into force date)',
    91, 0, 'mandatory_EU'
  ),
  (
    'rule_furn_eudr_01', 'reg_eudr', 'FURN_EUDR_TIMBER_DOC', 1,
    'required_document', NULL,
    '{"category_codes":["FURNITURE"],"doc_name_pattern":"EUDR|deforestation|timber.*source|wood.*origin|due.*diligence|supply.*chain.*timber|FSC|PEFC|geo.*location|harvest.*area"}',
    'warning',
    'Furniture containing wood must comply with the EU Deforestation Regulation (EUDR) due diligence requirements. Operators must collect: geo-location of forest harvest area, country and region of production, evidence of legal harvest, and confirm the product has not contributed to deforestation after 31 December 2020. Upload due diligence statement or supply chain traceability documentation.',
    'Puuta sisältävien huonekalujen on täytettävä EU:n metsäkatoasetuksen (EUDR) asianmukaisen huolellisuuden vaatimukset. Toimijoiden on kerättävä: metsän hakkuualueen maantieteellinen sijainti, tuotantomaa ja -alue, näyttö laillisesta hakkuusta sekä vahvistus siitä, ettei tuote ole edistänyt metsäkatoa 31. joulukuuta 2020 jälkeen. Lataa asianmukaisen huolellisuuden lausunto tai toimitusketjun jäljitettävyysdokumentaatio.',
    'Regulation (EU) 2023/1115 (EUDR), Art. 3 — products must be deforestation-free and legally harvested; Art. 4 — due diligence obligations on operators; Art. 9 — information to be collected; Annex I — wood products in scope',
    85, 1, 'mandatory_EU'
  ),
  (
    'rule_furn_gpsr_03', 'reg_gpsr', 'FURN_FIRE_SAFETY_DOC', 1,
    'required_document', NULL,
    '{"category_codes":["FURNITURE"],"doc_name_pattern":"fire.*safe|flammab|BS.*5852|NF.*D60|FR.*standard|ignitab|combustion|cigarette.*test|match.*test|flame.*resist"}',
    'info',
    '(Country-specific — informational) Fire safety requirements for upholstered furniture vary significantly by EU member state. UK (BS 5852:2006 — post-Brexit), France (NF D60-013), and Ireland have national fire safety requirements for domestic upholstered furniture. No EU-harmonised standard applies to all furniture types. Upload fire safety test documentation where required by the target market''s national rules.',
    '(Maakohtainen — tiedoksi) Pehmustettuja huonekaluja koskevat palovalvontavaatimukset vaihtelevat merkittävästi EU:n jäsenvaltioiden välillä. Isolla-Britannialla (BS 5852:2006 — Brexitin jälkeen), Ranskalla (NF D60-013) ja Irlannilla on kansalliset palovalvontavaatimukset kodinpehmustetuille huonekaluille. Kaikki huonekalutyypit kattavaa EU-yhdenmukaistettua standardia ei ole olemassa. Lataa palovalvontatestausdokumentaatio, jos kohdemarkkina sitä kansallisessa lainsäädännössään edellyttää.',
    'GPSR Art. 7 — national harmonised standards as conformity presumption; no EU-wide harmonised fire safety standard for domestic upholstered furniture as of 2026; national standards: UK BS 5852:2006 (not applicable for EU market post-Brexit); France arrete du 15 mai 1980 + NF D60-013; Ireland S.I. No. 316/1995',
    74, 1, 'country_specific'
  ),
  (
    'rule_furn_espr_01', 'reg_espr_furniture', 'FURN_ESPR_MATERIALS', 1,
    'required_array_min', 'materials_json',
    '{"category_codes":["FURNITURE"],"min":1}',
    'info',
    '(Draft — not yet in force) ESPR furniture delegated act is expected to require material composition disclosure including: recycled content percentage, material mass by type, and recyclability at end of life. Begin declaring these material properties in material declarations to prepare.',
    '(Luonnos — ei vielä voimassa) ESPR:n huonekaludelegoidun asetuksen odotetaan edellyttävän materiaalipohjan ilmoittamista, mukaan lukien: kierrätetyn sisällön prosenttiosuus, materiaalin massa tyypeittäin ja kierrätettävyys elinkaaren lopussa. Aloita näiden ominaisuuksien ilmoittaminen materiaalitiedoissa valmistautuaksesi.',
    'ESPR Regulation (EU) 2024/1781, Art. 4 — ecodesign requirements; ESPR Working Plan 2022–2024 — furniture included; Joint Research Centre Preparatory Study on Ecodesign/Labelling for Furniture (JRC Technical Reports, 2021)',
    68, 1, 'draft'
  ),
  (
    'rule_furn_espr_02', 'reg_espr_furniture', 'FURN_ESPR_REPAIR_INFO', 1,
    'required_array_min', 'repair_instructions_json',
    '{"category_codes":["FURNITURE"],"min":1}',
    'info',
    '(Draft — not yet in force) ESPR for furniture is expected to include requirements for repair and maintenance information: spare part availability, disassembly instructions, and durability claims. Begin documenting these to prepare for future mandatory compliance.',
    '(Luonnos — ei vielä voimassa) ESPR:n huonekaludelegoidun asetuksen odotetaan sisältävän vaatimuksia korjaus- ja huoltotiedoista: varaosien saatavuus, purkuohjeet ja kestoikäväitteet. Aloita näiden dokumentointi tulevan pakollisen vaatimustenmukaisuuden valmistelua varten.',
    'ESPR Regulation (EU) 2024/1781, Art. 5(1)(e) — repairability as ecodesign parameter; ESPR Working Plan 2022–2024 — furniture; JRC preparatory study 2021',
    67, 1, 'draft'
  );
