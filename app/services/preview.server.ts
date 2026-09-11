/**
 * Push preview — what a push WOULD send to Shopify, without calling Shopify.
 * Pure `previewRow` is unit-tested; `buildPushPreview` wires it to the DB.
 */

import prisma from "../db.server";
import {
  buildProductCreateOrUpdateInput,
  dbRowToSupplierItem,
} from "./push.server";

export type PreviewWarning = "zero_price" | "no_images" | "zero_stock";

export interface PreviewRow {
  stockNo: string;
  title: string;
  price: string;
  compareAtPrice?: string;
  quantity: number;
  imageCount: number;
  hasVideo: boolean;
  action: "create" | "update";
  warnings: PreviewWarning[];
}

interface BuiltLike {
  product: { title?: unknown };
  media: { mediaContentType: string }[];
  variant: { price: string; compareAtPrice?: string; quantity: number };
}

export function previewRow(
  built: BuiltLike,
  stockNo: string,
  hasMapping: boolean,
): PreviewRow {
  const imageCount = built.media.filter((m) => m.mediaContentType === "IMAGE").length;
  const hasVideo = built.media.some(
    (m) => m.mediaContentType === "VIDEO" || m.mediaContentType === "EXTERNAL_VIDEO",
  );
  const warnings: PreviewWarning[] = [];
  if (Number(built.variant.price) <= 0) warnings.push("zero_price");
  if (imageCount === 0) warnings.push("no_images");
  if (built.variant.quantity <= 0) warnings.push("zero_stock");

  return {
    stockNo,
    title: String(built.product.title ?? ""),
    price: built.variant.price,
    compareAtPrice: built.variant.compareAtPrice,
    quantity: built.variant.quantity,
    imageCount,
    hasVideo,
    action: hasMapping ? "update" : "create",
    warnings,
  };
}

export async function buildPushPreview(shop: string): Promise<PreviewRow[]> {
  const settings = await prisma.shopSettings.findUnique({ where: { shop } });
  if (!settings) return [];

  const [products, mappings] = await Promise.all([
    prisma.supplierProduct.findMany({
      where: { shop, selected: true },
      orderBy: { stockNo: "asc" },
    }),
    prisma.shopifyProductMapping.findMany({
      where: { shop },
      select: { supplierStockNo: true },
    }),
  ]);
  const mapped = new Set(mappings.map((m) => m.supplierStockNo));

  return products.map((row) => {
    const item = dbRowToSupplierItem(row as unknown as Record<string, unknown>);
    const built = buildProductCreateOrUpdateInput(item, settings);
    return previewRow(built, row.stockNo, mapped.has(row.stockNo));
  });
}
