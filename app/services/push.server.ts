/**
 * Push service — selected SupplierProduct rows -> Shopify products.
 *
 * This version avoids the common 2026-07 Shopify GraphQL failures:
 * - productCreate/productUpdate use the new `product:` argument, not deprecated `input:`
 * - product variants are updated through productVariantsBulkUpdate
 * - inventorySetQuantities uses `changeFromQuantity: null` and @idempotent
 * - media, inventory and publication failures are logged as warnings instead of making
 *   the whole product fail after it has already been created.
 */

import { randomUUID } from "node:crypto";
import prisma from "../db.server";
import type { SupplierItem } from "./supplier.server";
import { buildShopifyProductInput } from "./mapper.server";

/* ── Types ─────────────────────────────────────────────────────────────────── */

export type Admin = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

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

export interface PushStart {
  jobId: number;
  totalSelected: number;
}

type SupplierProductRow = Awaited<
  ReturnType<typeof prisma.supplierProduct.findMany>
>[number];

type ShopSettingsRow = NonNullable<
  Awaited<ReturnType<typeof prisma.shopSettings.findUnique>>
>;

type ShopifyProductResult = {
  id: string;
  title: string;
  variantId?: string;
  inventoryItemId?: string;
};

type GqlUserError = {
  field?: string[] | string | null;
  message: string;
};

/* ── Constants ──────────────────────────────────────────────────────────────── */

const STALE_JOB_MS = 30 * 60 * 1000;
const APP_NAME_FOR_INVENTORY_URI = "jewel-catalog";

/* ── Generic helpers ───────────────────────────────────────────────────────── */

function toStringValue(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function toMoney(value: unknown): string | undefined {
  if (value == null || value === "") return undefined;
  const n = Number(String(value).replace(/,/g, "").trim());
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n.toFixed(2);
}

function toInt(value: unknown): number {
  const n = Number.parseInt(String(value ?? "0").replace(/,/g, ""), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function toTags(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((tag) => toStringValue(tag))
      .filter(Boolean)
      .slice(0, 250);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean)
      .slice(0, 250);
  }

  return [];
}

function cleanObject<T extends Record<string, unknown>>(object: T): T {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(object)) {
    if (value === undefined) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    cleaned[key] = value;
  }
  return cleaned as T;
}

function userErrorText(errors: GqlUserError[] | undefined | null): string {
  if (!errors || errors.length === 0) return "";

  return errors
    .map((error) => {
      const field = Array.isArray(error.field)
        ? error.field.join(".")
        : error.field || "";
      return field ? `${field}: ${error.message}` : error.message;
    })
    .join(" | ");
}

function assertNoUserErrors(
  operation: string,
  errors: GqlUserError[] | undefined | null,
): void {
  const message = userErrorText(errors);
  if (message) {
    throw new Error(`${operation}: ${message}`);
  }
}

async function shopifyGraphql<T>(
  admin: Admin,
  operation: string,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const response = await admin.graphql(query, { variables });
  const json = await response.json();

  if (json.errors?.length) {
    const message = json.errors
      .map((error: any) => error.message || JSON.stringify(error))
      .join(" | ");

    console.error(`[shopify:${operation}] GraphQL errors`, JSON.stringify(json));
    throw new Error(`${operation}: ${message}`);
  }

  return json.data as T;
}

async function warnLog(
  shop: string,
  jobId: number,
  stockNo: string | null,
  message: string,
): Promise<void> {
  console.warn(`[push] ${message}`);
  await prisma.pushLog
    .create({
      data: {
        shop,
        jobId,
        stockNo,
        level: "warn",
        message,
      },
    })
    .catch(() => {});
}

/* ── Supplier row conversion ───────────────────────────────────────────────── */

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

/* ── Shopify input builders ───────────────────────────────────────────────── */

function normalizeMetafields(
  rawMetafields: unknown,
  supplierItem: SupplierItem,
): Array<{
  namespace: string;
  key: string;
  type: string;
  value: string;
}> {
  const byKey = new Map<
    string,
    { namespace: string; key: string; type: string; value: string }
  >();

  const add = (
    namespace: string,
    key: string,
    value: unknown,
    type = "single_line_text_field",
  ) => {
    const ns = toStringValue(namespace) || "custom";
    const k = toStringValue(key);
    const v = toStringValue(value);
    const t = toStringValue(type) || "single_line_text_field";
    if (!k || !v) return;
    byKey.set(`${ns}.${k}`, { namespace: ns, key: k, type: t, value: v });
  };

  if (Array.isArray(rawMetafields)) {
    for (const item of rawMetafields as any[]) {
      add(item.namespace, item.key, item.value, item.type);
    }
  }

  add("custom", "supplier_stock_no", supplierItem.Stock_No);
  add("custom", "supplier_subitem", supplierItem.Subitem);
  add("custom", "jewelry_type", supplierItem.Jewelry_Type);
  add("custom", "metal_type", supplierItem.Metal_Type);
  add("custom", "shape", supplierItem.Shape);
  add("custom", "clarity", supplierItem.Clarity);
  add("custom", "diamond_weight", supplierItem.Dia_Wt);

  return [...byKey.values()];
}

function normalizeMedia(
  rawMedia: unknown,
): Array<{
  originalSource: string;
  mediaContentType: "IMAGE" | "EXTERNAL_VIDEO";
  alt?: string;
}> {
  const media: Array<{
    originalSource: string;
    mediaContentType: "IMAGE" | "EXTERNAL_VIDEO";
    alt?: string;
  }> = [];

  const seen = new Set<string>();

  const add = (source: unknown, type: unknown, alt?: unknown) => {
    const originalSource = toStringValue(source);
    if (!/^https?:\/\//i.test(originalSource)) return;
    if (seen.has(originalSource)) return;

    seen.add(originalSource);

    const mediaContentType =
      toStringValue(type).toUpperCase() === "EXTERNAL_VIDEO"
        ? "EXTERNAL_VIDEO"
        : "IMAGE";

    media.push(
      cleanObject({
        originalSource,
        mediaContentType,
        alt: toStringValue(alt) || undefined,
      }),
    );
  };

  if (Array.isArray(rawMedia)) {
    for (const item of rawMedia as any[]) {
      add(item.originalSource || item.src || item.url, item.mediaContentType, item.alt);
    }
  }

  return media.slice(0, 10);
}

function buildProductCreateOrUpdateInput(
  supplierItem: SupplierItem,
  settings: ShopSettingsRow,
  productId?: string,
): {
  product: Record<string, unknown>;
  media: Array<{
    originalSource: string;
    mediaContentType: "IMAGE" | "EXTERNAL_VIDEO";
    alt?: string;
  }>;
  variant: {
    sku: string;
    price: string;
    compareAtPrice?: string;
    quantity: number;
  };
} {
  const vendor = settings.vendor || "LGD USA";
  const compareAtRule = (settings.compareAtPriceRule || "none") as
    | "none"
    | "multiply"
    | "fixed";
  const compareAtMultiplier = settings.compareAtMultiplier || 1.5;
  const compareAtFixed = settings.compareAtFixed || 0;

  const mapped = buildShopifyProductInput(
    supplierItem,
    vendor,
    compareAtRule,
    compareAtMultiplier,
    compareAtFixed,
  ) as any;

  const title =
    toStringValue(mapped.title) ||
    toStringValue(supplierItem.Subitem) ||
    `Jewelry ${supplierItem.Stock_No}`;

  const product = cleanObject({
    id: productId,
    title,
    descriptionHtml: toStringValue(mapped.descriptionHtml),
    vendor: toStringValue(mapped.vendor) || vendor,
    productType:
      toStringValue(mapped.productType) ||
      toStringValue(supplierItem.Jewelry_Type) ||
      toStringValue(supplierItem.Category),
    tags: toTags(mapped.tags),
    status: "ACTIVE",
    metafields: normalizeMetafields(mapped.metafields, supplierItem),
  });

  const sku =
    toStringValue(mapped.variant?.sku) ||
    toStringValue(supplierItem.Stock_No) ||
    toStringValue(supplierItem.Subitem);

  const price =
    toMoney(mapped.variant?.price) ||
    toMoney(supplierItem.Price) ||
    "0.00";

  const compareAtPrice = toMoney(mapped.variant?.compareAtPrice);

  return {
    product,
    media: normalizeMedia(mapped.media),
    variant: cleanObject({
      sku,
      price,
      compareAtPrice,
      quantity: toInt(supplierItem.Inhand_Pcs),
    }),
  };
}

/* ── Shopify API functions ────────────────────────────────────────────────── */

async function createProduct(
  admin: Admin,
  product: Record<string, unknown>,
): Promise<ShopifyProductResult> {
  const data = await shopifyGraphql<{
    productCreate: {
      product: null | {
        id: string;
        title: string;
        variants: {
          nodes: Array<{
            id: string;
            inventoryItem?: { id: string } | null;
          }>;
        };
      };
      userErrors: GqlUserError[];
    };
  }>(
    admin,
    "productCreate",
    `#graphql
      mutation CreateProduct($product: ProductCreateInput!) {
        productCreate(product: $product) {
          product {
            id
            title
            variants(first: 1) {
              nodes {
                id
                inventoryItem {
                  id
                }
              }
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `,
    { product },
  );

  assertNoUserErrors("productCreate", data.productCreate.userErrors);

  const created = data.productCreate.product;
  if (!created) throw new Error("productCreate: Shopify returned no product");

  const variant = created.variants.nodes[0];

  return {
    id: created.id,
    title: created.title,
    variantId: variant?.id,
    inventoryItemId: variant?.inventoryItem?.id,
  };
}

async function updateProduct(
  admin: Admin,
  product: Record<string, unknown>,
): Promise<ShopifyProductResult> {
  const data = await shopifyGraphql<{
    productUpdate: {
      product: null | {
        id: string;
        title: string;
        variants: {
          nodes: Array<{
            id: string;
            inventoryItem?: { id: string } | null;
          }>;
        };
      };
      userErrors: GqlUserError[];
    };
  }>(
    admin,
    "productUpdate",
    `#graphql
      mutation UpdateProduct($product: ProductUpdateInput!) {
        productUpdate(product: $product) {
          product {
            id
            title
            variants(first: 1) {
              nodes {
                id
                inventoryItem {
                  id
                }
              }
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `,
    { product },
  );

  assertNoUserErrors("productUpdate", data.productUpdate.userErrors);

  const updated = data.productUpdate.product;
  if (!updated) throw new Error("productUpdate: Shopify returned no product");

  const variant = updated.variants.nodes[0];

  return {
    id: updated.id,
    title: updated.title,
    variantId: variant?.id,
    inventoryItemId: variant?.inventoryItem?.id,
  };
}

async function getFirstVariant(
  admin: Admin,
  productId: string,
): Promise<{ variantId: string; inventoryItemId?: string } | null> {
  const data = await shopifyGraphql<{
    product: null | {
      variants: {
        nodes: Array<{
          id: string;
          inventoryItem?: { id: string } | null;
        }>;
      };
    };
  }>(
    admin,
    "getFirstVariant",
    `#graphql
      query GetFirstVariant($id: ID!) {
        product(id: $id) {
          variants(first: 1) {
            nodes {
              id
              inventoryItem {
                id
              }
            }
          }
        }
      }
    `,
    { id: productId },
  );

  const variant = data.product?.variants.nodes[0];
  if (!variant) return null;

  return {
    variantId: variant.id,
    inventoryItemId: variant.inventoryItem?.id,
  };
}

async function updateVariantPricingAndSku(
  admin: Admin,
  productId: string,
  variantId: string,
  variantInput: {
    sku: string;
    price: string;
    compareAtPrice?: string;
  },
): Promise<{ inventoryItemId?: string }> {
  const variant = cleanObject({
    id: variantId,
    price: variantInput.price,
    compareAtPrice: variantInput.compareAtPrice,
    inventoryItem: {
      sku: variantInput.sku,
      tracked: true,
    },
  });

  const data = await shopifyGraphql<{
    productVariantsBulkUpdate: {
      productVariants: Array<{
        id: string;
        inventoryItem?: { id: string } | null;
      }>;
      userErrors: GqlUserError[];
    };
  }>(
    admin,
    "productVariantsBulkUpdate",
    `#graphql
      mutation UpdateVariant($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkUpdate(
          productId: $productId
          variants: $variants
          allowPartialUpdates: false
        ) {
          productVariants {
            id
            inventoryItem {
              id
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `,
    { productId, variants: [variant] },
  );

  assertNoUserErrors(
    "productVariantsBulkUpdate",
    data.productVariantsBulkUpdate.userErrors,
  );

  return {
    inventoryItemId:
      data.productVariantsBulkUpdate.productVariants[0]?.inventoryItem?.id,
  };
}

async function appendMediaToProduct(
  admin: Admin,
  productId: string,
  media: Array<{
    originalSource: string;
    mediaContentType: "IMAGE" | "EXTERNAL_VIDEO";
    alt?: string;
  }>,
): Promise<void> {
  if (media.length === 0) return;

  const data = await shopifyGraphql<{
    productUpdate: {
      userErrors: GqlUserError[];
    };
  }>(
    admin,
    "productUpdateMedia",
    `#graphql
      mutation AddProductMedia($product: ProductUpdateInput!, $media: [CreateMediaInput!]) {
        productUpdate(product: $product, media: $media) {
          product {
            id
          }
          userErrors {
            field
            message
          }
        }
      }
    `,
    { product: { id: productId }, media },
  );

  assertNoUserErrors("productUpdateMedia", data.productUpdate.userErrors);
}

async function findProductBySku(
  admin: Admin,
  sku: string,
): Promise<{ id: string; title: string } | null> {
  if (!sku) return null;

  try {
    const safeSku = sku.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const data = await shopifyGraphql<{
      productVariants: {
        nodes: Array<{
          product: {
            id: string;
            title: string;
          };
        }>;
      };
    }>(
      admin,
      "findProductBySku",
      `#graphql
        query FindProductBySku($query: String!) {
          productVariants(first: 1, query: $query) {
            nodes {
              product {
                id
                title
              }
            }
          }
        }
      `,
      { query: `sku:"${safeSku}"` },
    );

    return data.productVariants.nodes[0]?.product ?? null;
  } catch (err) {
    return null;
  }
}

async function getDefaultLocationId(
  admin: Admin,
): Promise<string | null> {
  const data = await shopifyGraphql<{
    locations: {
      nodes: Array<{ id: string; name: string }>;
    };
  }>(
    admin,
    "locations",
    `#graphql
      query GetLocations {
        locations(first: 1) {
          nodes {
            id
            name
          }
        }
      }
    `,
  );

  return data.locations.nodes[0]?.id ?? null;
}

async function getPublicationIds(
  admin: Admin,
): Promise<string[]> {
  const data = await shopifyGraphql<{
    publications: {
      nodes: Array<{ id: string; name: string }>;
    };
  }>(
    admin,
    "publications",
    `#graphql
      query GetPublications {
        publications(first: 20) {
          nodes {
            id
            name
          }
        }
      }
    `,
  );

  return data.publications.nodes.map((node) => node.id);
}

async function setInventoryQuantity(
  admin: Admin,
  params: {
    inventoryItemId: string;
    locationId: string;
    quantity: number;
    jobId: number;
    stockNo: string;
  },
): Promise<void> {
  const idempotencyKey = randomUUID();

  const data = await shopifyGraphql<{
    inventorySetQuantities: {
      userErrors: GqlUserError[];
    };
  }>(
    admin,
    "inventorySetQuantities",
    `#graphql
      mutation SetInventory(
        $input: InventorySetQuantitiesInput!,
        $idempotencyKey: String!
      ) {
        inventorySetQuantities(input: $input) @idempotent(key: $idempotencyKey) {
          inventoryAdjustmentGroup {
            createdAt
            reason
            referenceDocumentUri
          }
          userErrors {
            field
            message
            code
          }
        }
      }
    `,
    {
      input: {
        name: "available",
        reason: "correction",
        referenceDocumentUri: `gid://${APP_NAME_FOR_INVENTORY_URI}/PushJob/${params.jobId}-${params.stockNo}`,
      quantities: [
  {
    inventoryItemId: params.inventoryItemId,
    locationId: params.locationId,
    quantity: params.quantity,
    changeFromQuantity: null,
  },
],
      },
      idempotencyKey,
    },
  );

  assertNoUserErrors(
    "inventorySetQuantities",
    data.inventorySetQuantities.userErrors,
  );
}

async function publishProduct(
  admin: Admin,
  productId: string,
  publicationIds: string[],
): Promise<void> {
  if (publicationIds.length === 0) return;

  const input = publicationIds.map((publicationId) => ({ publicationId }));

  const data = await shopifyGraphql<{
    publishablePublish: {
      userErrors: GqlUserError[];
    };
  }>(
    admin,
    "publishablePublish",
    `#graphql
      mutation PublishProduct($id: ID!, $input: [PublicationInput!]!) {
        publishablePublish(id: $id, input: $input) {
          publishable {
            availablePublicationsCount {
              count
            }
            resourcePublicationsCount {
              count
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `,
    { id: productId, input },
  );

  assertNoUserErrors("publishablePublish", data.publishablePublish.userErrors);
}

/* ── Public push entrypoint ────────────────────────────────────────────────── */

export async function startPushJob(
  shop: string,
  admin: Admin,
): Promise<PushStart> {
  const settings = await prisma.shopSettings.findUnique({
    where: { shop },
  });

  if (!settings || !settings.supplierApiKey) {
    throw new Error(
      "Shop settings not found or missing supplier API key. Please configure settings first.",
    );
  }

  await prisma.pushJob.updateMany({
    where: {
      shop,
      status: "RUNNING",
      startedAt: { lt: new Date(Date.now() - STALE_JOB_MS) },
    },
    data: {
      status: "FAILED",
      completedAt: new Date(),
      errorMessage: "Interrupted: server restarted during push.",
    },
  });

  const running = await prisma.pushJob.findFirst({
    where: { shop, status: "RUNNING" },
  });

  if (running) {
    throw new Error(
      "A push is already running for this shop. Wait for it to finish before starting another.",
    );
  }

  const products = await prisma.supplierProduct.findMany({
    where: { shop, selected: true },
    orderBy: { stockNo: "asc" },
  });

  if (products.length === 0) {
    return { jobId: 0, totalSelected: 0 };
  }

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

  void runPushJob(shop, admin, job.id, products, settings).catch(async (err) => {
    const message = err instanceof Error ? err.message : "Unknown push error";
    console.error(`[push] Job ${job.id} crashed: ${message}`);

    await prisma.pushJob
      .update({
        where: { id: job.id },
        data: {
          status: "FAILED",
          completedAt: new Date(),
          errorMessage: message,
        },
      })
      .catch(() => {});
  });

  return {
    jobId: job.id,
    totalSelected: products.length,
  };
}

/* ── Main push loop ────────────────────────────────────────────────────────── */

async function runPushJob(
  shop: string,
  admin: Admin,
  jobId: number,
  products: SupplierProductRow[],
  settings: ShopSettingsRow,
): Promise<PushResults> {
  const results: PushResultRow[] = [];
  let pushedCount = 0;
  let failedCount = 0;
  let firstFailure: string | null = null;

  let locationId = settings.defaultLocationId || null;
  if (!locationId) {
    try {
      locationId = await getDefaultLocationId(admin);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      await warnLog(
        shop,
        jobId,
        null,
        `Could not fetch Shopify location. Inventory quantity will be skipped. ${message}`,
      );
    }
  }

  let publicationIds: string[] = [];
  try {
    publicationIds = await getPublicationIds(admin);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    await warnLog(
      shop,
      jobId,
      null,
      `Could not fetch publications. Product publishing will be skipped. Add read_publications scope and re-install the app. ${message}`,
    );
  }

  for (const product of products) {
    try {
      const supplierItem = dbRowToSupplierItem(
        product as unknown as Record<string, unknown>,
      );

      const built = buildProductCreateOrUpdateInput(supplierItem, settings);
      const sku = built.variant.sku || product.stockNo;

      const existingMapping = await prisma.shopifyProductMapping.findFirst({
        where: { shop, supplierStockNo: product.stockNo },
      });

      let shopifyProduct: ShopifyProductResult;
      let action: "created" | "updated" = "created";

      if (existingMapping) {
        const updateInput = {
          ...built.product,
          id: existingMapping.shopifyProductId,
        };

        shopifyProduct = await updateProduct(admin, updateInput);
        action = "updated";

        await prisma.shopifyProductMapping.update({
          where: { id: existingMapping.id },
          data: {
            shopifyProductId: shopifyProduct.id,
            shopifyProductTitle: shopifyProduct.title,
            pushedAt: new Date(),
          },
        });
      } else {
        const foundBySku = await findProductBySku(admin, sku);

        if (foundBySku) {
          const updateInput = {
            ...built.product,
            id: foundBySku.id,
          };

          shopifyProduct = await updateProduct(admin, updateInput);
          action = "updated";

          await prisma.shopifyProductMapping.create({
            data: {
              shop,
              supplierStockNo: product.stockNo,
              shopifyProductId: shopifyProduct.id,
              shopifyProductTitle: shopifyProduct.title,
            },
          });
        } else {
          shopifyProduct = await createProduct(admin, built.product);
          action = "created";

          await prisma.shopifyProductMapping.create({
            data: {
              shop,
              supplierStockNo: product.stockNo,
              shopifyProductId: shopifyProduct.id,
              shopifyProductTitle: shopifyProduct.title,
            },
          });

          try {
            await appendMediaToProduct(admin, shopifyProduct.id, built.media);
          } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
            await warnLog(
              shop,
              jobId,
              product.stockNo,
              `Product created, but media upload failed: ${message}`,
            );
          }
        }
      }

      let variantId = shopifyProduct.variantId;
      let inventoryItemId = shopifyProduct.inventoryItemId;

      if (!variantId || !inventoryItemId) {
        const firstVariant = await getFirstVariant(admin, shopifyProduct.id);
        variantId = variantId || firstVariant?.variantId;
        inventoryItemId = inventoryItemId || firstVariant?.inventoryItemId;
      }

      if (!variantId) {
        throw new Error("Shopify product has no variant to update.");
      }

      const variantUpdate = await updateVariantPricingAndSku(
        admin,
        shopifyProduct.id,
        variantId,
        {
          sku,
          price: built.variant.price,
          compareAtPrice: built.variant.compareAtPrice,
        },
      );

      inventoryItemId = variantUpdate.inventoryItemId || inventoryItemId;

      if (locationId && inventoryItemId) {
        try {
          await setInventoryQuantity(admin, {
            inventoryItemId,
            locationId,
            quantity: built.variant.quantity,
            jobId,
            stockNo: product.stockNo,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error";
          await warnLog(
            shop,
            jobId,
            product.stockNo,
            `Product pushed, but inventory quantity failed: ${message}`,
          );
        }
      }

      if (publicationIds.length > 0) {
        try {
          await publishProduct(admin, shopifyProduct.id, publicationIds);
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error";
          await warnLog(
            shop,
            jobId,
            product.stockNo,
            `Product pushed, but publishing failed: ${message}`,
          );
        }
      }

      await prisma.supplierProduct.update({
        where: { id: product.id },
        data: {
          pushed: true,
          selected: false,
        },
      });

      await prisma.pushLog.create({
        data: {
          shop,
          jobId,
          stockNo: product.stockNo,
          level: "info",
          message: `${action} Shopify product: ${shopifyProduct.title}`,
        },
      });

      results.push({
        stockNo: product.stockNo,
        shopifyProductId: shopifyProduct.id,
        shopifyProductTitle: shopifyProduct.title,
        action,
      });

      pushedCount++;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      if (!firstFailure) firstFailure = `${product.stockNo}: ${errorMessage}`;

      console.error(`[push] Failed ${product.stockNo}: ${errorMessage}`);

      await prisma.pushLog.create({
        data: {
          shop,
          jobId,
          stockNo: product.stockNo,
          level: "error",
          message: `Failed to push product: ${errorMessage}`,
        },
      });

      results.push({
        stockNo: product.stockNo,
        action: "skipped",
        error: errorMessage,
      });

      failedCount++;
    }

    await prisma.pushJob.update({
      where: { id: jobId },
      data: {
        pushedCount,
        failedCount,
        errorMessage: firstFailure,
      },
    });
  }

  const finalStatus =
    failedCount > 0 && pushedCount === 0 ? "FAILED" : "COMPLETED";

  await prisma.pushJob.update({
    where: { id: jobId },
    data: {
      status: finalStatus,
      completedAt: new Date(),
      pushedCount,
      failedCount,
      errorMessage: firstFailure,
    },
  });

  return {
    jobId,
    results,
    pushedCount,
    failedCount,
  };
}
