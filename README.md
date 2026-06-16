# Digitaalinen tuotepassi

Cloudflare Workers + D1 -pohjainen digitaalisen tuotepassin MVP.

## Käyttöönotto

```bash
npm install
npx wrangler login
npm run db:create
```

Kun `db:create` tulostaa tietokannan tunnisteen, päivitä se `wrangler.toml`-tiedoston `database_id`-kenttään.

## Tuotantoon vienti

```bash
npm run db:init:remote
npx wrangler secret put ADMIN_SECRET
npm run deploy
```

`ADMIN_SECRET` suojaa tuotteiden luontia.

## Kehitys

```bash
npm run db:init:local
npm run dev
```

## Rajapinnat

- `GET /health` palauttaa palvelun tilan.
- `GET /api/products` listaa viimeisimmät tuotteet.
- `POST /api/admin/product/create` luo tuotteen. Tämä vaatii admin-salaisuuden.

Esimerkki tuotteen luonnista:

```bash
curl -X POST https://<worker-url>/api/admin/product/create \
  -H "Authorization: Bearer <ADMIN_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"product_name": "Esimerkkituote"}'
```
