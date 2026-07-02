# digitaalinen_tuotepassi

Minimalistinen Digital Product Passport -MVP pienyrityksille. Cloudflare Workers + D1, ei frameworkeja.

## Rakenne

- `schema.sql` — D1-tietokannan skeema (`products`, `product_events`)
- `src/worker.js` — kaikki reitit ja API-logiikka
- `public/` — staattiset HTML/CSS-sivut (`product.html`, `owner.html`, `styles.css`)
- `wrangler.toml` — Cloudflare-projektin asetukset ja D1-binding

## Reitit

| Method | Path | Kuvaus |
|--------|------|--------|
| `GET` | `/p/{slug}` | Julkinen tuotepassisivu |
| `GET` | `/owner/{token}` | Omistajan muokkaussivu |
| `GET` | `/api/public/product/{slug}` | Julkinen tuotedata JSON-muodossa (näkyvyyssuodatettu) |
| `GET` | `/api/owner/product/{token}` | Omistajan tuotedata JSON-muodossa |
| `POST` | `/api/owner/product/{token}` | Päivitä tuote, kasvattaa `version`-numeroa, kirjaa tapahtuman |
| `POST` | `/api/admin/product/create` | Luo uusi tuote + UID:t (vaatii `Authorization: Bearer <ADMIN_SECRET>`) |
| `GET` | `/api/admin/product/{slug}` | Täysi tuotedata admin-käyttöön (vaatii admin-secret) |
| `POST` | `/api/admin/product/{slug}/carrier` | Luo/vaihda data carrier (QR/NFC/RFID/viivakoodi, vaatii admin-secret) |
| `GET` | `/api/passport/{product_uid}` | Kanoninen koneellisesti luettava passi, pysyvällä tuotetunnisteella |

### EU DPP -käsitteet tietomallissa

- `product_uid` / `passport_uid` — pysyvät tunnisteet, riippumattomia URL-sluggista
- `data_carrier_type` / `data_carrier_url` — mallinnettu erillisenä kerroksena, vaihdettavissa ilman tuotetiedon muokkausta
- `identifier_level` — model/batch/item
- `visibility_json.consumer` — mitkä kentät näytetään julkisella `/p/{slug}`- ja `/api/passport/{product_uid}`-sivulla; muu data (esim. `substances_json`, `compliance_documents_json`, eränumerot) piilossa kuluttajalta oletuksena
- `version` + `product_events.actor_type` — muutoshistoria ja kuka muutoksen teki (`owner`/`admin`/`system`)

Viranomais- ja talouden toimija -tason pääsynhallinta (eri näkyvyys kuin kuluttajalla) vaatii tulevaisuudessa erillisen autentikoinnin — tässä versiossa `authority`/`operator`-roolit on varattu skeemaan mutta API palvelee toistaiseksi vain kuluttajanäkymää.

## Kehitys

```bash
npm install
cp .dev.vars.example .dev.vars   # aseta ADMIN_SECRET paikallista kehitystä varten
npm run db:create                # luo D1-tietokanta, päivitä database_id wrangler.toml:iin
npm run db:init                  # aja schema.sql paikalliseen D1:iin
npm run dev                      # käynnistä paikallinen kehityspalvelin
```

## Julkaisu

```bash
npm run db:init:remote           # aja schema.sql tuotanto-D1:iin
wrangler secret put ADMIN_SECRET # aseta admin-salasana tuotantoon
npm run deploy
```

## Uuden tuotteen luonti

```bash
curl -X POST https://<worker-url>/api/admin/product/create \
  -H "Authorization: Bearer <ADMIN_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"product_name": "Esimerkkituote"}'
```

Vastaus sisältää `slug`, `token`, `product_uid` ja `passport_uid` -arvot. Julkinen sivu löytyy `/p/{slug}`-osoitteesta, omistajan muokkaussivu `/owner/{token}`-osoitteesta ja koneellisesti luettava passi `/api/passport/{product_uid}`-osoitteesta.

## Roadmap

### Sign-up / sign-in (Reitti A: vanity URL → Clerk redirect)

MVP-vaiheessa markkinointisivujen CTA:t osoittavat samalle domainille
(`https://digitaalinentuotepassi.tulkintatila.fi/sign-up`), joka tuntuu
kuluttajasta luontevalta ilman domain-hyppyä. Koska tämä Worker omistaa
hostin, se **ohjaa** `/sign-up`- ja `/sign-in`-polut Clerkin hosted-osoitteisiin
302-redirectillä (`src/worker.js`, ennen ASSETS-fallthroughia). Näin vanity-URL
ei palauta custom 404:ää.

Redirect-kohteet luetaan env-muuttujista — aseta ne ennen deployta:

```bash
wrangler secret put SIGNUP_REDIRECT_URL   # Clerkin hosted sign-up URL
wrangler secret put SIGNIN_REDIRECT_URL   # Clerkin hosted sign-in URL
```

Esim. Clerkin custom domainilla `https://accounts.tulkintatila.fi/sign-up`
ja `.../sign-in`, tai hosted `https://<slug>.accounts.dev/sign-up`. Jos
muuttuja puuttuu, polku palauttaa selkeän `500 auth_redirect_not_configured`
-virheen (ei 404), jotta väärä konfiguraatio huomataan heti.

### UX consolidation (Reitti C) — myöhempi vaihe

Myöhemmässä vaiheessa, kun konversiovolyymi perustelee lisäkompleksisuuden,
harkitaan **polkupohjaista routingia (Reitti C)**: dashboard-sovellus
(`/sign-up`, `/sign-in`, `/dashboard/*`) tarjoillaan samalta hostilta kuin
markkinointisivut, jolloin kuluttaja pysyy yhdellä domainilla ilman hyppyä.

Toteutus vaatii:
- Cloudflare-routen, joka ohjaa auth-/dashboard-polut erilliseen deploymentiin.
- Carve-outin tähän Workeriin, jotta catch-all fallthrough + custom 404
  (`src/worker.js`) **ei nappaa** noita polkuja ennen dashboardia.

Kunnes tämä on tehty, `/sign-up`- ja `/sign-in`-polut hoidetaan yllä kuvatulla
Reitti A -redirectillä.
