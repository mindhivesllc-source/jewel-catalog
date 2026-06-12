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
  Concurrent pushes per shop are blocked; RUNNING jobs >30min are auto-failed.
- `app/services/shopify-api.server.ts` — all Shopify Admin GraphQL calls.
  Every call passes `tries: 3` (retries throttled requests, honors Retry-After).
- `app/services/mapper.server.ts` — supplier item → DB row / Shopify input.
- `prisma/schema.prisma` — Postgres. Key models: Session, ShopSettings,
  SupplierProduct, ShopifyProductMapping (dedup), PushJob, PushLog.

## What a push does (per product)

1. Dedup: ShopifyProductMapping by stockNo → else metafield lookup → else create.
2. `productCreate`/`productUpdate` (title/description/vendor/type/tags ONLY —
   the 2025-10 input takes no variants/media/metafields).
3. Media + metafields (create path; best-effort, logged not thrown).
4. `productVariantsBulkUpdate`: price, compareAtPrice, and
   `inventoryItem: { tracked: true, sku }`. **SKU lives on inventoryItem, NOT
   on the variant input** (past bug, commit b5d22ca).
5. `inventorySetQuantities` (name "available", `ignoreCompareQuantity: true`)
   with quantity = supplier `Inhand_Pcs` at the shop's fulfillment location.
6. `publishablePublish` to all publications — **without this, products never
   appear on the storefront** even when Active (past bug).
7. Mark row pushed+deselected, write PushLog, bump PushJob counters.

Re-pushing an already-pushed product is allowed and updates it in place.

## Shopify API rules

- API version: 2025-10 (`ApiVersion.October25` in `app/shopify.server.ts`).
- Scopes (must match in THREE places: `shopify.app.toml`, Railway `SCOPES`
  var, and the released app config on Shopify):
  `read_locations,write_inventory,write_metaobject_definitions,write_metaobjects,write_products,write_publications`
- Changing scopes/config: edit `shopify.app.toml`, then
  `npx shopify app deploy --allow-updates --no-build -m "why"`, then the
  merchant must re-open the app in admin to accept.
- ALWAYS validate new/changed GraphQL with the shopify-dev-mcp
  `validate_graphql_codeblocks` tool (api: admin, version: 2025-10).
- `findProductBySupplierId` must never throw — it is a best-effort fallback;
  query syntax is `metafields.lgd_supplier.supplier_id:<value>`.

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

- Supplier API: 1 request/15min. A failed fetch wastes the window.
- Railway service variables must include `DATABASE_URL = ${{Postgres.DATABASE_URL}}`.
- Do not add a `RAILWAY_RUN_CMD` variable or volumes to the app service.
- Postgres `contains` is case-sensitive — catalog search uses
  `mode: "insensitive"`; keep it on any new string filters.
- DB writes for the ~1900-row catalog are batched (50/transaction) — keep it
  that way; sequential upserts are slow.
- Pre-existing data lives in PushJob/PushLog/SupplierProduct — schema changes
  need real Prisma migrations (`prisma/migrations/`), never `db push`.
