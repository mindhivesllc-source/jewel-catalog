# jewel-catalog — project guide for AI agents

Shopify embedded app (React Router 7, Prisma, Postgres). Fetches ~1900 jewelry
products from the LGD USA supplier API into a local catalog; the merchant
selects products and pushes them to Shopify as Products.

## Architecture map

- `app/routes/app._index.tsx` — main UI (catalog grid, filters, select, push).
  Push runs as a background job; this page polls `/api/push/status` every 3s.
- `app/routes/api.*.tsx` — JSON endpoints (catalog query/fetch/select, push
  start/status/history, settings, supplier test).
- `app/services/supplier.server.ts` — LGD USA API client.
  **Rate limit: 1 request per 15 minutes.** Never call it casually in tests.
- `app/services/catalog.server.ts` — DB queries/upserts for SupplierProduct.
- `app/services/push.server.ts` — `startPushJob` creates a PushJob row and
  returns immediately; `runPushJob` loops detached from the HTTP request.
  It also contains ALL Shopify Admin GraphQL calls (helpers `createProduct`,
  `updateProduct`, `updateVariantPricingAndSku`, `setInventoryQuantity`,
  `publishProduct`, ...). Every call goes through `shopifyGraphql()` which
  passes `tries: 3` (retries throttled requests, honors Retry-After).
  Concurrent pushes per shop are blocked. A RUNNING job with no PushLog line
  for 10 min is auto-failed (`failStaleJobs`, also called by the status
  endpoint). The admin client is re-acquired via `unauthenticated.admin(shop)`
  every 10 min because offline tokens expire after 60 min.
- `app/services/mapper.server.ts` — supplier item → DB row / Shopify input.
  Title from `ShopSettings.titleTemplate` (`renderTitle`), per-category
  markup (`applyMarkup`, table CategoryPricingRule), Video_1 → VIDEO media.
- `app/services/preview.server.ts` — dry run for `/api/push/preview`
  (Catalog page shows it before every push).
- `app/services/sync.server.ts` + `app/scheduler.server.ts` — auto-sync
  every 15 min per shop with `autoSyncEnabled` (skips ticks inside the
  supplier's 15-min window; delisted items get stock 0; PushJob.trigger =
  "auto"). `DISABLE_AUTO_SYNC=1` turns the scheduler off.
- Unit tests: `npm test` (vitest, `app/services/*.test.ts` only —
  `app/routes/api.supplier.test.tsx` is a ROUTE, not a test).
- `prisma/schema.prisma` — Postgres. Key models: Session, ShopSettings,
  SupplierProduct, ShopifyProductMapping (dedup), PushJob, PushLog.

## What a push does (per product)

1. Dedup: ShopifyProductMapping by (shop, stockNo) → else variant SKU lookup
   → else create. If the mapped product was deleted in Shopify admin, the
   mapping is dropped and the product is recreated.
2. `productCreate`/`productUpdate` with title/description/vendor/type/tags/
   status ACTIVE/metafields (2026-07 `product:` argument, NOT `input:`).
3. Media: `productUpdate(product:{id}, media:[CreateMediaInput])` on create,
   and on update when the product has `mediaCount == 0`. Best-effort → warn.
   Job start also runs `ensureStorefrontSetup`: `custom.*` metafield
   definitions (adminFilterable + smartCollectionCondition) once per shop and
   one smart collection per category via the legacy-but-valid
   `collectionCreate(input:{ruleSet})`.
4. `productVariantsBulkUpdate`: price, compareAtPrice, and
   `inventoryItem: { tracked: true, sku }`. **SKU lives on inventoryItem, NOT
   on the variant input** (past bug, commit b5d22ca).
5. `inventorySetQuantities` (name "available", `ignoreCompareQuantity: true`,
   `@idempotent(key:)` directive — required since 2026-04) with quantity =
   supplier `Inhand_Pcs`. **Without `ignoreCompareQuantity: true` Shopify
   returns COMPARE_QUANTITY_REQUIRED for every item and stock silently stays
   0** (bug shipped in commit 4a3f132, fixed after).
6. `publishablePublish` to all publications — **without this, products never
   appear on the storefront** even when Active (past bug).
7. Mark row pushed+deselected, write PushLog, bump PushJob counters.
   Inventory/publish/media failures are `warn` PushLog rows, not failures —
   check History / `/api/debug/push-errors` after a push.

Re-pushing an already-pushed product is allowed and updates it in place.

## Shopify API rules

- API version: 2026-07 (`ApiVersion.July26` in `app/shopify.server.ts`;
  webhooks `api_version = "2026-07"` in `shopify.app.toml`). Shopify supports
  a version for 12 months — bump both every quarter.
- Scopes (must match in THREE places: `shopify.app.toml`, Railway `SCOPES`
  var, and the released app config on Shopify):
  `read_inventory,read_locations,read_products,read_publications,write_inventory,write_metaobject_definitions,write_metaobjects,write_products,write_publications`
- Changing scopes/config: edit `shopify.app.toml`, then
  `npx shopify app deploy --allow-updates --no-build -m "why"`, then the
  merchant must re-open the app in admin to accept.
- ALWAYS validate new/changed GraphQL with the shopify-dev-mcp
  `validate_graphql_codeblocks` tool (api: admin, version: 2026-07).
- `findProductBySku` must never throw — it is a best-effort fallback
  (`productVariants(query: "sku:\"<stockNo>\"")`).
- Offline access tokens expire (`expiringOfflineAccessTokens: true`, 60 min).
  Any long-running loop must re-acquire `admin` via `unauthenticated.admin`.

## Build, run, deploy

- Verify changes: `npm run typecheck` then `npm run build`. Both must pass
  before any commit.
- Local dev: `npm run dev` (Shopify CLI); needs `DATABASE_URL` pointing at a
  Postgres instance — there is no SQLite anymore.
- Deploy: push to GitHub `main` → Railway auto-builds (Dockerfile builder,
  `railway.json`). Runtime runs `prisma migrate deploy` then serves.
- Railway: project `honest-heart`, service `honest-heart`, plus a `Postgres`
  service whose volume holds real data — **never delete it**.
  - Status: `railway status`, `railway deployment list --service honest-heart`
  - Logs: `railway logs --service honest-heart`
  - Manual deploy from local: `railway up --service honest-heart --detach`
  - `railway deployment redeploy` FAILS if the latest deployment is REMOVED —
    use `railway up` instead.
- After every deploy, verify: deployment list shows SUCCESS AND
  `curl -s -o /dev/null -w "%{http_code}" https://honest-heart-production-55ec.up.railway.app/`
  returns 200.
- Shopify dev store: `for-thoe-and-thiea.myshopify.com`.

## Gotchas that have already burned time

- Supplier API: 1 request/15min. A failed fetch wastes the window. "Test
  connection" in Settings ALSO consumes the window. Multi-page catalogs are
  stored partially and the fetch returns a `warning` string.
- API routes must return `{ success: true, ... }` — the UI toasts key off
  `result.success` / `result.error` (past silent bug: fetch/test never toasted).
- `diaWt` is a string column; numeric range filtering goes through
  `applyDiaWtRange` (raw Postgres cast) so counts/select-all/export agree.
- Railway service variables must include `DATABASE_URL = ${{Postgres.DATABASE_URL}}`.
- Do not add a `RAILWAY_RUN_CMD` variable or volumes to the app service.
- Postgres `contains` is case-sensitive — catalog search uses
  `mode: "insensitive"`; keep it on any new string filters.
- DB writes for the ~1900-row catalog are batched (50/transaction) — keep it
  that way; sequential upserts are slow.
- Pre-existing data lives in PushJob/PushLog/SupplierProduct — schema changes
  need real Prisma migrations (`prisma/migrations/`), never `db push`.
