# oploy-fr fork of OpenSEO

This fork adds **Shopping Prices** to OpenSEO: it compares a shop's own
product prices with the offers Google Shopping lists for the same products.

## What the fork adds

- Page `/p/$projectId/shopping` (nav: My Site → Shopping Prices).
- Catalogue import from a CSV or spreadsheet paste (French or English column
  names, see `src/shared/shopping-import.ts`).
- One DataForSEO Google Shopping search per product (`merchant/google/products`,
  standard queue, about $0.001 each), collected by the five-minute cron.
- Offer matching on brand, sizes and title words (`src/shared/shopping.ts`),
  market median, gap per product, per brand, and the project competitors'
  prices.
- Manual, weekly or monthly checks.
- `.github/workflows/oploy-docker-image.yml` publishes
  `ghcr.io/oploy-fr/open-seo` (single-container image) on every push to main.

Fork-only files: `src/**/shopping*`, `src/db/**/shopping.schema.ts`,
`src/server/lib/dataforseo/merchant.ts`, the shopping migrations
(`drizzle/sqlite/0063_shopping_prices.sql`, `drizzle/pg/0041_shopping_prices.sql`)
and this file. Shared files touched: the schema barrels, `server.ts` (cron),
`navigation/items.ts`, the DataForSEO client and pricing, billing credit
features, `routeTree.gen.ts`.

## Syncing with upstream

Merge `every-app/open-seo` main into this fork's main. When upstream adds
migrations with the same numbers, renumber the shopping migrations after
theirs (rename the files, fix the `tag` and `idx` in `drizzle/*/meta/_journal.json`)
or regenerate them with `pnpm db:generate` after dropping ours.
