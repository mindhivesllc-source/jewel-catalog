# Storefront Quality Implementation Plan (executed inline 2026-09-11)

**Spec:** `docs/superpowers/specs/2026-09-11-catalog-enhancements-design.md` §3

- [x] Schema: `ShopSettings.titleTemplate`, `ShopSettings.metafieldDefinitionsAt`, `ShopCollection` — migration `*_storefront_quality`.
- [x] Mapper: `renderTitle(template, item, mapped)` + `DEFAULT_TITLE_TEMPLATE`; `Video_1` http URL → `{ mediaContentType: "VIDEO" }`. Tests in `mapper.server.test.ts`.
- [x] Push: `normalizeMedia` accepts VIDEO; `custom.diamond_weight` emitted as `number_decimal` only when numeric; `ensureStorefrontSetup` (metafield definitions once per shop with adminFilterable + smartCollectionCondition; smart collection per category via `collectionCreate(input: { ruleSet })`, published, cached in `ShopCollection`).
- [x] Settings: "Storefront" section with title template field; `/api/settings` reads/writes `titleTemplate`.
- [ ] Deploy + verify: migration applied, push 3 products on test store, confirm title, video media status, `custom.*` definitions and category collections in admin.
