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
| `GET` | `/api/public/product/{slug}` | Julkinen tuotedata JSON-muodossa |
| `GET` | `/api/owner/product/{token}` | Omistajan tuotedata JSON-muodossa |
| `POST` | `/api/owner/product/{token}` | Päivitä tuote |
| `POST` | `/api/admin/product/create` | Luo uusi tuote (vaatii `Authorization: Bearer <ADMIN_SECRET>`) |

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
  -d '{"name": "Esimerkkituote"}'
```

Vastaus sisältää `slug`- ja `token`-arvot, joilla julkinen sivu (`/p/{slug}`) ja omistajan muokkaussivu (`/owner/{token}`) löytyvät.
