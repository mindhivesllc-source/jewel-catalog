# Push Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Before a push runs, show the merchant exactly what will be sent to Shopify (title, price, stock, images, create/update) and flag risky rows.

**Architecture:** A pure builder (`previewRow`) turns a SupplierProduct row + mapping into a preview row with warnings; a server function loads selected rows and mappings and maps them through it; one JSON route exposes it; the Catalog page swaps the grid for a preview panel until the merchant confirms.

**Tech Stack:** React Router 7 routes, Prisma, Polaris web components (`s-*`), Vitest (new).

**Spec:** `docs/superpowers/specs/2026-09-11-catalog-enhancements-design.md` §1

## Global Constraints

- No Shopify API calls in preview.
- API routes return `{ success: true, ... }` or `{ error }` (CLAUDE.md).
- `npm run typecheck && npm run build` must pass before every commit.
- Warnings enum: `zero_price | no_images | zero_stock`.

---

### Task 1: Vitest + pure preview builder

**Files:**
- Modify: `package.json` (add `vitest` devDependency, `"test": "vitest run"`)
- Create: `app/services/preview.server.ts`
- Create: `app/services/preview.server.test.ts`
- Modify: `app/services/push.server.ts` (export `buildProductCreateOrUpdateInput`, `dbRowToSupplierItem`)

**Interfaces:**
- Produces:
  ```ts
  export type PreviewWarning = "zero_price" | "no_images" | "zero_stock";
  export interface PreviewRow { stockNo: string; title: string; price: string; compareAtPrice?: string; quantity: number; imageCount: number; hasVideo: boolean; action: "create" | "update"; warnings: PreviewWarning[] }
  export function previewRow(built: { product: { title?: unknown }, media: { mediaContentType: string }[], variant: { price: string; compareAtPrice?: string; quantity: number } }, stockNo: string, hasMapping: boolean): PreviewRow
  export async function buildPushPreview(shop: string): Promise<PreviewRow[]>
  ```

- [ ] Step 1: `npm i -D vitest@^3` ; add script `"test": "vitest run"`.
- [ ] Step 2: write failing test `app/services/preview.server.test.ts`:
  ```ts
  import { describe, it, expect } from "vitest";
  import { previewRow } from "./preview.server";
  const built = (o: Partial<{ price: string; quantity: number; media: { mediaContentType: string }[] }>) => ({
    product: { title: "T" },
    media: o.media ?? [{ mediaContentType: "IMAGE" }],
    variant: { price: o.price ?? "10.00", quantity: o.quantity ?? 1 },
  });
  describe("previewRow", () => {
    it("no warnings for a healthy row", () => {
      expect(previewRow(built({}), "S1", false).warnings).toEqual([]);
    });
    it("flags zero price, no images, zero stock", () => {
      const r = previewRow(built({ price: "0.00", quantity: 0, media: [] }), "S1", true);
      expect(r.warnings).toEqual(["zero_price", "no_images", "zero_stock"]);
      expect(r.action).toBe("update");
      expect(r.imageCount).toBe(0);
    });
    it("counts images and detects video", () => {
      const r = previewRow(built({ media: [{ mediaContentType: "IMAGE" }, { mediaContentType: "VIDEO" }] }), "S1", false);
      expect(r.imageCount).toBe(1); expect(r.hasVideo).toBe(true); expect(r.action).toBe("create");
    });
  });
  ```
- [ ] Step 3: run `npx vitest run` → FAIL (module missing).
- [ ] Step 4: implement `preview.server.ts` (previewRow + buildPushPreview using prisma, exported push builders).
- [ ] Step 5: `npx vitest run` → PASS. `npm run typecheck`.
- [ ] Step 6: commit `feat: push preview builder + vitest`.

### Task 2: Route `/api/push/preview`

**Files:** Create `app/routes/api.push.preview.tsx`

- [ ] Step 1: loader: `authenticate.admin`, `buildPushPreview(shop)`, return `data({ success: true, rows, warningCount })`; catch → `{ error }` 500.
- [ ] Step 2: typecheck + build; commit `feat: preview endpoint`.

### Task 3: Catalog page preview panel

**Files:** Modify `app/routes/app._index.tsx` (handlePush, new `previewFetcher`, `renderPreview`)

- [ ] Step 1: `handlePush` → if no selections toast; else `previewFetcher.load("/api/push/preview")`, `setPreviewOpen(true)`.
- [ ] Step 2: `renderPreview()`: `<s-section heading="Push preview">` with summary line (N products, W warnings), `<s-table>` columns Action, SKU, Title, Price, Stock, Images, Warnings, Remove. Remove → `selectFetcher.submit({stockNo, selected:false})` JSON to `/api/catalog/select`, drop row locally, update `selections`.
- [ ] Step 3: buttons: "Cancel" (close), "Push N products" → `pushFetcher.submit(null,{method:"POST",action:"/api/push/start"})`, close panel.
- [ ] Step 4: when `previewOpen`, render panel instead of grid.
- [ ] Step 5: typecheck + build; commit `feat: push preview panel`.

### Task 4: Deploy + verify

- [ ] push to main, wait Railway SUCCESS, curl 200.
- [ ] In test store: select 3 products, click Push, confirm panel shows rows/warnings, remove one, push 2, History shows 2 pushed.
