# Catalog enhancements design — 2026-09-11

Approved by Peter on 2026-09-11. Four features, built and deployed in this order:
push preview, per-category markup, storefront quality, auto-sync.

## Context

The app fetches the LGD USA catalog into Postgres and pushes selected products
to Shopify. After the 2026-09-11 audit the push path is reliable, but the
merchant still has to fetch, re-select and re-push by hand to keep stock and
price current, sells at supplier cost, cannot see what a push will do before
it runs, and gets ugly titles with no videos, filters or collections.

## 1. Push preview

- Endpoint `POST /api/push/preview`: for every `selected` row, run
  `buildProductCreateOrUpdateInput` (push.server.ts) without calling Shopify.
  Look up `ShopifyProductMapping` to decide `create` vs `update`.
- Response rows: stockNo, title, price, compareAtPrice, quantity, imageCount,
  hasVideo, action, warnings[] where warnings ∈ {`zero_price`, `no_images`,
  `zero_stock`}.
- UI: modal opened by the Push button on the Catalog page. Table of rows,
  warning rows highlighted, checkbox to drop a row from the push (calls the
  existing `/api/catalog/select` with selected=false). "Push N products"
  button inside the modal calls the existing `/api/push/start`.
- No schema change.

## 2. Per-category markup

- New model `CategoryPricingRule { id, shop, category, markupType
  ("percent" | "fixed"), markupValue Float, roundTo ("none" | "0.99" |
  "whole") } @@unique([shop, category])`. Row with `category = "*"` is the
  default; missing rule = no markup.
- `buildShopifyProductInput` gains a `pricing` argument (rule for the row's
  category, else default). Sell price = supplier price + markup, then rounded.
  Compare-at rules (already there) apply on top of the sell price.
- `runPushJob` loads all rules for the shop once per job.
- Settings page: section "Pricing" listing default + one row per category
  (`getCategories`), fields type/value/rounding. Saved through `/api/settings`
  as `pricingRules: [...]`.
- Migration: `prisma/migrations/<ts>_category_pricing_rule`.

## 3. Storefront quality

- Title template: `ShopSettings.titleTemplate` (default
  `{diaWt}ct {shape} Lab Grown Diamond {jewelryType} {category} in {metal}`).
  Tokens: diaWt, shape, jewelryType, category, metal, color, clarity,
  growthType, size, stockNo. Empty tokens and double spaces collapse.
  Stock number stays on SKU and metafields only.
- Video: mapper emits `{ mediaContentType: "VIDEO", originalSource: Video_1 }`
  when Video_1 is an http(s) URL. Shopify accepts external URLs for VIDEO in
  `CreateMediaInput` (docs 2026-07). `normalizeMedia` widened to allow VIDEO.
- Metafield definitions (once per shop, idempotent, run at start of the
  first push job): namespace `lgd`, keys metal, shape, clarity
  (single_line_text_field), diamond_weight (number_decimal); capabilities
  adminFilterable + smartCollectionCondition. Values written with the product
  metafields already sent in `normalizeMetafields`.
- Collections: smart collection per category, rule
  `product_type equals <category>`, created on first push, ids cached in
  new model `ShopCollection { shop, category, shopifyCollectionId }`.
- All new GraphQL validated with shopify-dev-mcp (admin, 2026-07).

## 4. Auto-sync

- Interval: 15 minutes (merchant's choice). This equals the supplier rate
  limit, so a tick is skipped when `ShopSettings.lastFetchAt` is younger than
  15 minutes (manual fetch / test connection consumed the window). Settings
  shows last sync and next sync time.
- Scheduler: `app/scheduler.server.ts`, started once from
  `entry.server.tsx` (module singleton guard). `setInterval(60s)`; each tick
  loads shops with `autoSyncEnabled = true` and `syncLockedUntil < now`, sets
  the lock, runs sync, clears the lock.
- Sync per shop: `fetchAndStoreCatalog` (updates syncHash). Then:
  - changed: `pushed = true AND syncHash != lastPushedHash` → mark selected.
  - delisted: `pushed = true` rows absent from the fetched set → set
    `inhandPcs = "0"`, `delistedAt = now`, mark selected.
  - if any selected: `startPushJob(shop, admin)` with
    `admin = (await unauthenticated.admin(shop)).admin`; PushJob gets
    `trigger = "auto"`.
- Push loop sets `lastPushedHash = syncHash` on success.
- Schema: `SupplierProduct.lastPushedHash String?`, `SupplierProduct.delistedAt
  DateTime?`, `ShopSettings.autoSyncEnabled Boolean @default(false)`,
  `ShopSettings.syncLockedUntil DateTime?`, `PushJob.trigger String
  @default("manual")`.
- History page shows the trigger column; Catalog shows a "Delisted" badge.

## Testing

- Vitest added (`npm test`). Unit tests: title template, markup + rounding,
  video media mapping, preview warnings, scheduler skip rule (lastFetchAt
  younger than 15 min), delisted detection.
- Each feature: `npm run typecheck && npm run build`, commit, push to main,
  verify Railway SUCCESS + HTTP 200, then a real push of 3 products on the
  test store and inspect via Admin GraphQL.

## Out of scope

Multi-supplier, multi-currency, AI descriptions, per-product price override.
