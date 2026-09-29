# Per-Category Markup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sell price = supplier price + a markup rule chosen per product category (with a `*` default), rounded, before compare-at rules apply.

**Architecture:** Pure `applyMarkup(price, rule)` in mapper (unit-tested). `CategoryPricingRule` table loaded once per push/preview and passed into `buildShopifyProductInput` as `pricing`. Separate JSON route `/api/pricing-rules` (GET/POST) and a Settings section that edits one row per category.

**Tech Stack:** Prisma migration (generated with `prisma migrate diff`, no DB needed), Vitest, Polaris web components.

**Spec:** `docs/superpowers/specs/2026-09-11-catalog-enhancements-design.md` §2

## Global Constraints
- markupType ∈ `percent | fixed`; roundTo ∈ `none | 0.99 | whole`.
- Category `*` = default rule. No rule = no markup.
- Compare-at (existing) computed from the marked-up price.
- Migration via `prisma/migrations/<ts>_category_pricing_rule/migration.sql`, never `db push`.

### Task 1: Schema + migration
- Modify `prisma/schema.prisma`: model `CategoryPricingRule { id Int @id @default(autoincrement()); shop String; category String; markupType String @default("percent"); markupValue Float @default(0); roundTo String @default("none"); updatedAt DateTime @updatedAt; @@unique([shop, category]) }`
- Generate SQL: `npx prisma migrate diff --from-schema-datamodel <git HEAD schema> --to-schema-datamodel prisma/schema.prisma --script`
- `npx prisma generate`; typecheck; commit.

### Task 2: `applyMarkup` + tests (mapper.server.ts / mapper.server.test.ts)
```ts
export interface PricingRule { markupType: "percent" | "fixed"; markupValue: number; roundTo: "none" | "0.99" | "whole" }
export function applyMarkup(price: number, rule?: PricingRule | null): number
```
Tests: percent 20 on 100 → 120; fixed 15 on 100 → 115; roundTo 0.99 on 123.4 → 123.99; whole on 123.4 → 124; undefined rule → unchanged; negative result clamps to 0.
`buildShopifyProductInput(item, vendor, compareAtRule, compareAtMultiplier, compareAtFixed, pricing?: PricingRule | null)`; sell price = applyMarkup(supplier price); compareAt from sell price.

### Task 3: Push + preview wiring (push.server.ts, preview.server.ts)
- `export async function loadPricingRules(shop): Promise<Map<string, PricingRule>>` in push.server.ts.
- `buildProductCreateOrUpdateInput(item, settings, rules?: Map<string, PricingRule>)` picks `rules.get(mappedCategory) ?? rules.get("*")`.
- runPushJob + buildPushPreview load rules once.

### Task 4: `/api/pricing-rules` route
- GET → `{ success, categories: string[], rules: Rule[] }` (categories from `getCategories`, plus `*` first).
- POST JSON `{ rules: [{category, markupType, markupValue, roundTo}] }` → validate, upsert each, delete rules not in payload; returns same as GET.

### Task 5: Settings UI section "Markup by category"
- Table rows: Category | Type select | Value number | Rounding select. Default row `*` labelled "All other categories". Save button posts JSON to `/api/pricing-rules`. Toast on success.

### Task 6: typecheck, build, test, commit, push, verify deploy (SUCCESS + HTTP 200 + GET /api/pricing-rules → 410).
