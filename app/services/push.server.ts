/**
 * Push service — takes selected supplier products and pushes them to Shopify
 * via the Admin GraphQL API.
 */

import prisma from "../db.server";
import type { SupplierItem } from "./supplier.server";
import { buildShopifyProductInput } from "./mapper.server";
import {
  createProduct,
  updateProduct,
  findProductBySupplierId,
} from "./shopify-api.server";
import type { Admin } from "./shopify-api.server";

// ── Types ────────────────────────────────────────────────────────────────────

export interface PushResultRow {
  stockNo: string;
  shopifyProductId?: string;
  shopifyProductTitle?: string;
  action: "created" | "updated" | "skipped";
  error?: string;
}

export interface PushResults {
  jobId: number;
  results: PushResultRow[];
  pushedCount: number;
  failedCount: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Reconstruct a SupplierItem from a SupplierProduct DB row.
 */
function dbRowToSupplierItem(row: Record<string, unknown>): SupplierItem {
  return {
    Stock_No: String(row.stockNo ?? ""),
    Subitem: String(row.subitem ?? ""),
    Category: String(row.category ?? ""),
    Jewelry_Type: String(row.jewelryType ?? ""),
    Metal_Type: String(row.metalType ?? ""),
    Casting_Wt: String(row.castingWt ?? ""),
    Shape: String(row.shape ?? ""),
    Color: String(row.color ?? ""),
    Clarity: String(row.clarity ?? ""),
    Dia_Pcs: String(row.diaPcs ?? ""),
    Dia_Wt: String(row.diaWt ?? ""),
    Gross_Wt: String(row.grossWt ?? ""),
    Growth_Type: String(row.growthType ?? ""),
    Size: String(row.size ?? ""),
    Certificate: String(row.certificate ?? ""),
    Inhand_Pcs: String(row.inhandPcs ?? ""),
    Memo_Out: String(row.memoOut ?? ""),
    Price: String(row.price ?? "0"),
    Remarks: String(row.remarks ?? ""),
    Image_1: String(row.image1 ?? ""),
    Image_2: String(row.image2 ?? ""),
    Video_1: String(row.video ?? ""),
  };
}

/**
 * Convert the Shopify GraphQL product input into the nested format the API
 * expects.
 */
function toGraphQLInput(
  input: ReturnType<typeof buildShopifyProductInput>,
): Record<string, unknown> {
  return {
    title: input.title,
    bodyHtml: input.bodyHtml,
    vendor: input.vendor,
    productType: input.productType,
    tags: input.tags,
    variants: input.variants.map((v) => ({
      price: v.price,
      ...(v.compareAtPrice !== undefined && v.compareAtPrice !== null
        ? { compareAtPrice: v.compareAtPrice }
        : {}),
      sku: v.sku,
      optionValues: v.optionValues,
    })),
    images: input.images.map((img) => ({
      src: img.src,
      ...(img.altText ? { altText: img.altText } : {}),
    })),
    metafields: input.metafields.map((mf) => ({
      namespace: mf.namespace,
      key: mf.key,
      value: mf.value,
      type: mf.type,
    })),
  };
}

// ── Push ─────────────────────────────────────────────────────────────────────

/**
 * Push all selected (and not-yet-pushed) products to Shopify.
 * Returns detailed per-product results.
 */
export async function pushSelectedProducts(
  shop: string,
  admin: Admin,
  signal?: AbortSignal,
): Promise<PushResults> {
  // Load shop settings
  const settings = await prisma.shopSettings.findUnique({
    where: { shop },
  });

  if (!settings || !settings.supplierApiKey) {
    throw new Error(
      "Shop settings not found or missing supplier API key. Please configure your settings first.",
    );
  }

  // Find all selected products that haven't been pushed yet
  const products = await prisma.supplierProduct.findMany({
    where: { shop, selected: true, pushed: false },
    orderBy: { stockNo: "asc" },
  });

  if (products.length === 0) {
    return {
      jobId: 0,
      results: [],
      pushedCount: 0,
      failedCount: 0,
    };
  }

  // Create push job
  const job = await prisma.pushJob.create({
    data: {
      shop,
      status: "RUNNING",
      totalSelected: products.length,
      startedAt: new Date(),
      pushedCount: 0,
      failedCount: 0,
    },
  });

  const results: PushResultRow[] = [];
  let pushedCount = 0;
  let failedCount = 0;

  const vendor = settings.vendor || "LGD USA";
  const compareAtRule = (settings.compareAtPriceRule || "none") as
    | "none"
    | "multiply"
    | "fixed";
  const compareAtMultiplier = settings.compareAtMultiplier || 1.5;
  const compareAtFixed = settings.compareAtFixed || 0;

  for (const product of products) {
    // Respect abort signal
    if (signal?.aborted) {
      await prisma.pushLog.create({
        data: {
          shop,
          jobId: job.id,
          level: "warn",
          message: "Push aborted by user",
          stockNo: product.stockNo,
        },
      });

      await prisma.pushJob.update({
        where: { id: job.id },
        data: {
          status: "FAILED",
          completedAt: new Date(),
          pushedCount,
          failedCount,
          errorMessage: "Aborted by user",
        },
      });
      break;
    }

    try {
      // Reconstruct the supplier item from the DB row
      const supplierItem = dbRowToSupplierItem(product as unknown as Record<string, unknown>);

      // Build Shopify product input
      const shopifyInput = buildShopifyProductInput(
        supplierItem,
        vendor,
        compareAtRule,
        compareAtMultiplier,
        compareAtFixed,
      );
      const graphqlInput = toGraphQLInput(shopifyInput);

      // Check if this product already has a mapping
      const existingMapping = await prisma.shopifyProductMapping.findUnique({
        where: { supplierStockNo: product.stockNo },
      });

      let shopifyProduct: { id: string; title: string };

      if (existingMapping) {
        // Update existing Shopify product
        shopifyProduct = await updateProduct(
          admin,
          existingMapping.shopifyProductId,
          graphqlInput,
        );

        // Update mapping title if changed
        await prisma.shopifyProductMapping.update({
          where: { id: existingMapping.id },
          data: { shopifyProductTitle: shopifyProduct.title },
        });

        results.push({
          stockNo: product.stockNo,
          shopifyProductId: shopifyProduct.id,
          shopifyProductTitle: shopifyProduct.title,
          action: "updated",
        });
      } else {
        // Check if Shopify product exists by metafield (cross-reference)
        const found = await findProductBySupplierId(
          admin,
          product.stockNo,
          supplierItem.Subitem ?? product.stockNo,
        );

        if (found) {
          // Product exists in Shopify but not in our mapping — update
          shopifyProduct = await updateProduct(admin, found.id, graphqlInput);

          await prisma.shopifyProductMapping.create({
            data: {
              shop,
              supplierStockNo: product.stockNo,
              shopifyProductId: shopifyProduct.id,
              shopifyProductTitle: shopifyProduct.title,
            },
          });

          results.push({
            stockNo: product.stockNo,
            shopifyProductId: shopifyProduct.id,
            shopifyProductTitle: shopifyProduct.title,
            action: "updated",
          });
        } else {
          // Create new Shopify product
          shopifyProduct = await createProduct(admin, graphqlInput);

          await prisma.shopifyProductMapping.create({
            data: {
              shop,
              supplierStockNo: product.stockNo,
              shopifyProductId: shopifyProduct.id,
              shopifyProductTitle: shopifyProduct.title,
            },
          });

          results.push({
            stockNo: product.stockNo,
            shopifyProductId: shopifyProduct.id,
            shopifyProductTitle: shopifyProduct.title,
            action: "created",
          });
        }
      }

      // Mark as pushed and unselect
      await prisma.supplierProduct.update({
        where: { id: product.id },
        data: { pushed: true, selected: false },
      });

      // Log success
      await prisma.pushLog.create({
        data: {
          shop,
          jobId: job.id,
          level: "info",
          message: `${results[results.length - 1].action} Shopify product: ${shopifyProduct.title}`,
          stockNo: product.stockNo,
        },
      });

      pushedCount++;
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Unknown error";

      // Log failure
      await prisma.pushLog.create({
        data: {
          shop,
          jobId: job.id,
          level: "error",
          message: `Failed to push product: ${errorMessage}`,
          stockNo: product.stockNo,
        },
      });

      results.push({
        stockNo: product.stockNo,
        action: "skipped",
        error: errorMessage,
      });

      failedCount++;
    }

    // Update job progress
    await prisma.pushJob.update({
      where: { id: job.id },
      data: { pushedCount, failedCount },
    });
  }

  // Complete the job
  const finalStatus =
    failedCount > 0 && pushedCount === 0 ? "FAILED" : "COMPLETED";

  await prisma.pushJob.update({
    where: { id: job.id },
    data: {
      status: finalStatus,
      completedAt: new Date(),
      pushedCount,
      failedCount,
    },
  });

  return {
    jobId: job.id,
    results,
    pushedCount,
    failedCount,
  };
}
