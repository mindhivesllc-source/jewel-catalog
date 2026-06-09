/**
 * Mapper: transforms LGD USA SupplierItem rows into Prisma-ready DB rows and
 * Shopify GraphQL product inputs.
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

export function mapCategory(raw: string | undefined | null): string {
  if (!raw) return "Other";
  const key = raw.trim().toUpperCase();
  return CATEGORY_MAP[key] ?? "Other";
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
  if (!raw) return "Other";
  const key = raw.trim().toUpperCase();
  return JEWELRY_TYPE_MAP[key] ?? "Other";
}

// ── Sync hash ────────────────────────────────────────────────────────────────

/**
 * Compute an MD5 hash of the fields that, when changed, should trigger a
 * Shopify product update.
 */
export function computeSyncHash(item: SupplierItem): string {
  const fields = [
    item.Stock_No,
    item.Subitem,
    item.Category,
    item.Jewelry_Type,
    item.Metal_Type,
    item.Casting_Wt,
    item.Shape,
    item.Color,
    item.Clarity,
    item.Dia_Pcs,
    item.Dia_Wt,
    item.Gross_Wt,
    item.Growth_Type,
    item.Size,
    item.Certificate,
    item.Inhand_Pcs,
    item.Memo_Out,
    item.Price,
    item.Remarks,
    item.Image_1,
    item.Image_2,
    item.Video_1,
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

/**
 * Convert a supplier API item into a plain object suitable for Prisma
 * `create` / `upsert` on the SupplierProduct model.
 */
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
    metalType: item.Metal_Type ?? "",
    shape: item.Shape ?? "",
    color: item.Color ?? "",
    clarity: item.Clarity ?? "",
    diaPcs: item.Dia_Pcs ?? "",
    diaWt: item.Dia_Wt ?? "",
    grossWt: item.Gross_Wt ?? "",
    growthType: item.Growth_Type ?? "",
    size: item.Size ?? "",
    certificate: item.Certificate ?? "",
    inhandPcs: item.Inhand_Pcs ?? "",
    memoOut: item.Memo_Out ?? "",
    price: parseFloat(item.Price) || 0,
    castingWt: item.Casting_Wt ?? "",
    remarks: item.Remarks ?? "",
    image1: item.Image_1 ?? "",
    image2: item.Image_2 ?? "",
    video: item.Video_1 ?? "",
    syncHash: computeSyncHash(item),
  };
}

// ── Shopify product input ────────────────────────────────────────────────────

type CompareAtRule = "none" | "multiply" | "fixed";

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

export interface ShopifyProductInput {
  title: string;
  bodyHtml: string;
  vendor: string;
  productType: string;
  tags: string[];
  variants: ShopifyVariantInput[];
  images: ShopifyImageInput[];
  metafields: ShopifyMetafieldInput[];
}

interface ShopifyVariantInput {
  price: string;
  compareAtPrice?: string | null;
  sku: string;
  optionValues: { name: string; optionName: string }[];
}

interface ShopifyImageInput {
  src: string;
  altText?: string;
}

interface ShopifyMetafieldInput {
  namespace: string;
  key: string;
  value: string;
  type: string;
}

/**
 * Build the GraphQL product-create / product-update input for a single supplier
 * item.
 */
export function buildShopifyProductInput(
  item: SupplierItem,
  vendor: string,
  compareAtRule: CompareAtRule = "none",
  compareAtMultiplier = 1.5,
  compareAtFixed = 0,
): ShopifyProductInput {
  const category = mapCategory(item.Category);
  const jewelryType = mapJewelryType(item.Jewelry_Type);
  const metalType = item.Metal_Type ?? "";
  const shape = item.Shape ?? "";
  const growthType = item.Growth_Type ?? "";
  const stockNo = item.Stock_No;
  const price = parseFloat(item.Price) || 0;

  const title = `${metalType} ${shape} ${jewelryType} ${category} #${stockNo}`;

  // Body HTML — concise key-value layout
  const bodyLines = [
    `<p><strong>Stock No:</strong> ${stockNo}</p>`,
    item.Subitem ? `<p><strong>Subitem:</strong> ${item.Subitem}</p>` : "",
    `<p><strong>Category:</strong> ${category}</p>`,
    `<p><strong>Jewelry Type:</strong> ${jewelryType}</p>`,
    `<p><strong>Metal:</strong> ${metalType}</p>`,
    `<p><strong>Shape:</strong> ${shape}</p>`,
    item.Color ? `<p><strong>Color:</strong> ${item.Color}</p>` : "",
    item.Clarity ? `<p><strong>Clarity:</strong> ${item.Clarity}</p>` : "",
    item.Dia_Pcs ? `<p><strong>Dia Pcs:</strong> ${item.Dia_Pcs}</p>` : "",
    item.Dia_Wt ? `<p><strong>Dia Wt:</strong> ${item.Dia_Wt}</p>` : "",
    item.Gross_Wt ? `<p><strong>Gross Wt:</strong> ${item.Gross_Wt}</p>` : "",
    item.Casting_Wt ? `<p><strong>Casting Wt:</strong> ${item.Casting_Wt}</p>` : "",
    `<p><strong>Growth Type:</strong> ${growthType}</p>`,
    item.Size ? `<p><strong>Size:</strong> ${item.Size}</p>` : "",
    item.Certificate
      ? `<p><strong>Certificate:</strong> ${item.Certificate}</p>`
      : "",
    item.Inhand_Pcs
      ? `<p><strong>In Hand:</strong> ${item.Inhand_Pcs}</p>`
      : "",
    item.Memo_Out ? `<p><strong>Memo Out:</strong> ${item.Memo_Out}</p>` : "",
    item.Remarks ? `<p><strong>Remarks:</strong> ${item.Remarks}</p>` : "",
  ];

  const bodyHtml = bodyLines.filter(Boolean).join("\n");

  // Tags
  const tags: string[] = [
    jewelryType,
    metalType,
    shape,
    growthType,
  ].filter((t) => t && t !== "");

  // Variant — single variant per item
  const compareAt = computeCompareAt(
    price,
    compareAtRule,
    compareAtMultiplier,
    compareAtFixed,
  );

  const variant: ShopifyVariantInput = {
    price: price.toFixed(2),
    sku: stockNo,
    optionValues: [],
  };

  if (compareAt !== null) {
    variant.compareAtPrice = compareAt.toFixed(2);
  }

  // Images
  const images: ShopifyImageInput[] = [];
  if (item.Image_1) images.push({ src: item.Image_1 });
  if (item.Image_2) images.push({ src: item.Image_2 });

  // Metafields
  const now = new Date().toISOString();
  const metafields: ShopifyMetafieldInput[] = [
    {
      namespace: "lgd_supplier",
      key: "supplier_id",
      value: stockNo,
      type: "single_line_text_field",
    },
    {
      namespace: "lgd_supplier",
      key: "supplier_sku",
      value: item.Subitem ?? stockNo,
      type: "single_line_text_field",
    },
    {
      namespace: "lgd_supplier",
      key: "supplier_source",
      value: "lgdusallc",
      type: "single_line_text_field",
    },
    {
      namespace: "lgd_supplier",
      key: "raw_category",
      value: item.Category ?? "",
      type: "single_line_text_field",
    },
    {
      namespace: "lgd_supplier",
      key: "raw_jewelry_type",
      value: item.Jewelry_Type ?? "",
      type: "single_line_text_field",
    },
    {
      namespace: "lgd_supplier",
      key: "sync_hash",
      value: computeSyncHash(item),
      type: "single_line_text_field",
    },
    {
      namespace: "lgd_supplier",
      key: "last_synced_at",
      value: now,
      type: "single_line_text_field",
    },
  ];

  return {
    title,
    bodyHtml,
    vendor,
    productType: jewelryType,
    tags,
    variants: [variant],
    images,
    metafields,
  };
}
