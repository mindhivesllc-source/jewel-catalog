/**
 * Mapper: transforms LGD USA SupplierItem rows into Prisma-ready DB rows and
 * Shopify GraphQL product inputs (2026+ product model).
 */

import type { SupplierItem } from "./supplier.server";
import { createHash } from "node:crypto";

// ── Category map ─────────────────────────────────────────────────────────────

const CATEGORY_MAP: Record<string, string> = {
  RINGS: "Rings",
  EARRINGS: "Earrings",
  BRACELETS: "Bracelets",
  BRACELET: "Bracelets",
  PENDANTS: "Pendants",
  PENDANT: "Pendants",
  NECKLACES: "Necklaces",
  NECKLACE: "Necklaces",
  CHAINS: "Chains",
  BANGLES: "Bangles",
  "JEWELRY SETS": "Jewelry Sets",
  JEWELRY_SETS: "Jewelry Sets",
};

/** "ANKLE_CHAINS" → "Ankle Chains", so new supplier values stay meaningful. */
function titleCase(raw: string): string {
  return raw
    .trim()
    .replace(/[_\s]+/g, " ")
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

export function mapCategory(raw: string | undefined | null): string {
  if (!raw || !raw.trim()) return "Other";
  const key = raw.trim().toUpperCase();
  return CATEGORY_MAP[key] ?? titleCase(raw);
}

// ── Jewelry-type map ─────────────────────────────────────────────────────────

const JEWELRY_TYPE_MAP: Record<string, string> = {
  FANCY: "Fancy",
  ETERNITY: "Eternity",
  JACKET: "Jacket",
  TENNIS: "Tennis",
  SOLITAIRE: "Solitaire",
  HALO: "Halo",
  STUD: "Stud",
  HOOP: "Hoop",
  DROP: "Drop",
  CLUSTER: "Cluster",
};

export function mapJewelryType(raw: string | undefined | null): string {
  if (!raw || !raw.trim()) return "Other";
  const key = raw.trim().toUpperCase();
  return JEWELRY_TYPE_MAP[key] ?? titleCase(raw);
}

// ── Sync hash ────────────────────────────────────────────────────────────────

export function computeSyncHash(item: SupplierItem): string {
  const fields = [
    item.Stock_No, item.Subitem, item.Category, item.Jewelry_Type,
    item.Metal_Type, item.Casting_Wt, item.Shape, item.Color, item.Clarity,
    item.Dia_Pcs, item.Dia_Wt, item.Gross_Wt, item.Growth_Type,
    item.Size, item.Certificate, item.Inhand_Pcs, item.Memo_Out,
    item.Price, item.Remarks, item.Image_1, item.Image_2, item.Video_1,
  ];
  return createHash("md5").update(fields.join("|")).digest("hex");
}

// ── DB row helper ────────────────────────────────────────────────────────────

export interface SupplierDbRow {
  shop: string;
  stockNo: string;
  subitem: string;
  category: string;
  jewelryType: string;
  metalType: string;
  shape: string;
  color: string;
  clarity: string;
  diaPcs: string;
  diaWt: string;
  grossWt: string;
  growthType: string;
  size: string;
  certificate: string;
  inhandPcs: string;
  memoOut: string;
  price: number;
  castingWt: string;
  remarks: string;
  image1: string;
  image2: string;
  video: string;
  syncHash: string;
}

export function supplierItemToDbRow(
  item: SupplierItem,
  shop: string,
): SupplierDbRow {
  return {
    shop,
    stockNo: item.Stock_No,
    subitem: item.Subitem ?? "",
    category: mapCategory(item.Category),
    jewelryType: mapJewelryType(item.Jewelry_Type),
    metalType: (item.Metal_Type ?? "").trim(),
    shape: (item.Shape ?? "").trim(),
    color: (item.Color ?? "").trim(),
    clarity: (item.Clarity ?? "").trim(),
    diaPcs: item.Dia_Pcs ?? "",
    diaWt: item.Dia_Wt ?? "",
    grossWt: item.Gross_Wt ?? "",
    growthType: (item.Growth_Type ?? "").trim(),
    size: (item.Size ?? "").trim(),
    certificate: (item.Certificate ?? "").trim(),
    inhandPcs: item.Inhand_Pcs ?? "",
    memoOut: item.Memo_Out ?? "",
    price: parseFloat(item.Price) || 0,
    castingWt: item.Casting_Wt ?? "",
    remarks: (item.Remarks ?? "").trim(),
    image1: item.Image_1 ?? "",
    image2: item.Image_2 ?? "",
    video: item.Video_1 ?? "",
    syncHash: computeSyncHash(item),
  };
}

// ── Shopify product input (2026+ model) ──────────────────────────────────────

type CompareAtRule = "none" | "multiply" | "fixed";

// ── Sell-price markup (per category, "*" default) ───────────────────────────

export interface PricingRule {
  markupType: "percent" | "fixed";
  markupValue: number;
  roundTo: "none" | "0.99" | "whole";
}

/**
 * Supplier price → sell price. Applied BEFORE compare-at rules so a
 * "multiply" compare-at is a multiple of what the customer actually pays.
 */
export function applyMarkup(price: number, rule?: PricingRule | null): number {
  if (!rule) return price;
  let out =
    rule.markupType === "fixed"
      ? price + rule.markupValue
      : price * (1 + rule.markupValue / 100);
  if (out < 0) out = 0;
  if (rule.roundTo === "whole") out = Math.ceil(out);
  else if (rule.roundTo === "0.99") out = Math.max(0, Math.ceil(out) - 0.01);
  return Math.round(out * 100) / 100;
}

function computeCompareAt(
  price: number,
  rule: CompareAtRule,
  multiplier: number,
  fixed: number,
): number | null {
  if (rule === "multiply") return price * multiplier;
  if (rule === "fixed") return price + fixed;
  return null;
}

/**
 * Product input for 2026+ Shopify GraphQL productCreate/productUpdate.
 *
 * Key changes from pre-2026:
 *   `bodyHtml`    → `descriptionHtml`
 *   `variants`    → handled separately via productVariantsBulkCreate
 *   `images`      → `media` array
 */
export interface ShopifyProductInput {
  title: string;
  descriptionHtml: string;
  vendor: string;
  productType: string;
  tags: string[];
  /** Variant pricing data (applied via productVariantsBulkCreate after creation) */
  variant: ShopifyVariantInput;
  media: ShopifyMediaInput[];
  metafields: ShopifyMetafieldInput[];
}

interface ShopifyVariantInput {
  price: string;
  compareAtPrice?: string | null;
  sku: string;
}

interface ShopifyMediaInput {
  mediaContentType: "IMAGE" | "VIDEO";
  originalSource: string;
  alt?: string;
}

interface ShopifyMetafieldInput {
  namespace: string;
  key: string;
  value: string;
  type: string;
}

// ── Title template ──────────────────────────────────────────────────────────

// The supplier's own one-line description, e.g.
// "BEZEL TENNIS NECKLACE 14KW EFG VS2 CVD DIA 10.77CTS".
export const DEFAULT_TITLE_TEMPLATE = "{remarks}";

// Used when the merchant's template renders empty (e.g. no Remarks).
export const DESCRIPTIVE_TITLE_TEMPLATE =
  "{diaWt}ct {shape} Lab Grown Diamond {jewelryType} {category} in {metal}";

/**
 * Resolve `{token}` placeholders. Unknown/empty tokens vanish; a "ct" glued to
 * an empty {diaWt} vanishes too; whitespace collapses. Falls back to the
 * descriptive template (which has literal text), so a title is never empty.
 */
export function renderTitle(
  template: string,
  item: SupplierItem,
  mapped: { category: string; jewelryType: string },
): string {
  const tokens: Record<string, string> = {
    diaWt: (item.Dia_Wt ?? "").trim(),
    shape: (item.Shape ?? "").trim(),
    jewelryType: mapped.jewelryType === "Other" ? "" : mapped.jewelryType,
    category: mapped.category === "Other" ? "" : mapped.category,
    metal: (item.Metal_Type ?? "").trim(),
    color: (item.Color ?? "").trim(),
    clarity: (item.Clarity ?? "").trim(),
    growthType: (item.Growth_Type ?? "").trim(),
    size: (item.Size ?? "").trim(),
    stockNo: item.Stock_No ?? "",
    remarks: (item.Remarks ?? "").trim(),
  };
  const render = (tpl: string) =>
    tpl
      .replace(/\{(\w+)\}(ct)?/g, (_m, key: string, suffix?: string) => {
        const v = tokens[key] ?? "";
        return v ? v + (suffix ?? "") : "";
      })
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\s+in$/i, "");
  return render(template || DEFAULT_TITLE_TEMPLATE) || render(DESCRIPTIVE_TITLE_TEMPLATE);
}

// The feed has no Setting field; the supplier names it in Remarks
// ("BEZEL TENNIS NECKLACE ...", "4 PRONG ...").
const SETTING_PATTERN =
  /\b(?:(?:\d+|SHARED|DOUBLE)\s+PRONG|PRONG|HALF\s+BEZEL|BEZEL|CHANNEL|MICRO\s+PAVE|PAVE|FLUSH|TENSION|BASKET|INVISIBLE)\b/i;

export function deriveSetting(remarks: string | undefined | null): string {
  const match = SETTING_PATTERN.exec(remarks ?? "");
  return match ? match[0].toUpperCase().replace(/\s+/g, " ") : "";
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildShopifyProductInput(
  item: SupplierItem,
  vendor: string,
  compareAtRule: CompareAtRule = "none",
  compareAtMultiplier = 1.5,
  compareAtFixed = 0,
  pricing?: PricingRule | null,
  titleTemplate: string = DEFAULT_TITLE_TEMPLATE,
): ShopifyProductInput {
  const category = mapCategory(item.Category);
  const jewelryType = mapJewelryType(item.Jewelry_Type);
  const metalType = (item.Metal_Type ?? "").trim();
  const shape = (item.Shape ?? "").trim();
  const growthType = (item.Growth_Type ?? "").trim();
  const stockNo = item.Stock_No;
  const supplierPrice = parseFloat(item.Price) || 0;
  const price = applyMarkup(supplierPrice, pricing);

  // Storefront title from the merchant's template
  const title = renderTitle(titleTemplate, item, { category, jewelryType });

  // Full supplier detail table (HTML-escaped). Memo Out stays internal;
  // Remarks is the default title and the opening line.
  const spec = (label: string, value: string | undefined | null) => {
    const v = (value ?? "").trim();
    if (!v || v === "0" || /^(other|na|n\/a)$/i.test(v)) return "";
    return `<tr><td><strong>${label}</strong></td><td>${escapeHtml(v)}</td></tr>`;
  };
  const specLines = [
    spec("Stock Number", stockNo),
    spec("Subitem", item.Subitem),
    spec("Category", category.toUpperCase()),
    spec("Jewelry Type", jewelryType.toUpperCase()),
    spec("Metal Type", metalType),
    spec("Shape", shape),
    spec("Color", item.Color),
    spec("Clarity", item.Clarity),
    spec("Diamond Pieces", item.Dia_Pcs),
    spec("Diamond Weight", item.Dia_Wt),
    spec("Gross Weight", item.Gross_Wt),
    spec("Casting Weight", item.Casting_Wt),
    spec("Growth Type", growthType),
    spec("Size", item.Size),
    spec("Setting", deriveSetting(item.Remarks)),
    spec("Certificate", item.Certificate),
    spec("In-hand Pieces", item.Inhand_Pcs),
  ].filter(Boolean);
  const descriptionHtml = [
    `<p>${escapeHtml(title)}</p>`,
    specLines.length ? `<table>\n<tbody>\n${specLines.join("\n")}\n</tbody>\n</table>` : "",
  ]
    .filter(Boolean)
    .join("\n");

  // Tags ("Other" is an internal fallback, not a useful storefront tag)
  const tags: string[] = [
    category, metalType, shape, jewelryType, growthType,
  ].filter((t) => t && t !== "" && t !== "Other");

  // Variant pricing
  const compareAt = computeCompareAt(price, compareAtRule, compareAtMultiplier, compareAtFixed);
  const variant: ShopifyVariantInput = {
    price: price.toFixed(2),
    sku: stockNo,
  };
  if (compareAt !== null) {
    variant.compareAtPrice = compareAt.toFixed(2);
  }

  // Media (images)
  const media: ShopifyMediaInput[] = [];
  if (item.Image_1) {
    media.push({ mediaContentType: "IMAGE", originalSource: item.Image_1, alt: title });
  }
  if (item.Image_2) {
    media.push({ mediaContentType: "IMAGE", originalSource: item.Image_2, alt: title });
  }
  // Supplier hosts direct mp4 files; Shopify accepts an external URL as the
  // originalSource of a VIDEO and transcodes it asynchronously.
  if (item.Video_1 && /^https?:\/\//i.test(item.Video_1.trim())) {
    media.push({ mediaContentType: "VIDEO", originalSource: item.Video_1.trim(), alt: title });
  }

  // Metafields
  const now = new Date().toISOString();
  const metafields: ShopifyMetafieldInput[] = [
    { namespace: "lgd_supplier", key: "supplier_id", value: stockNo, type: "single_line_text_field" },
    { namespace: "lgd_supplier", key: "supplier_sku", value: item.Subitem ?? stockNo, type: "single_line_text_field" },
    { namespace: "lgd_supplier", key: "supplier_source", value: "lgdusallc", type: "single_line_text_field" },
    { namespace: "lgd_supplier", key: "raw_category", value: item.Category ?? "", type: "single_line_text_field" },
    { namespace: "lgd_supplier", key: "raw_jewelry_type", value: item.Jewelry_Type ?? "", type: "single_line_text_field" },
    { namespace: "lgd_supplier", key: "sync_hash", value: computeSyncHash(item), type: "single_line_text_field" },
    { namespace: "lgd_supplier", key: "last_synced_at", value: now, type: "single_line_text_field" },
  ];

  return { title, descriptionHtml, vendor, productType: category, tags, variant, media, metafields };
}
