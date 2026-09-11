/**
 * Push service — selected SupplierProduct rows -> Shopify products.
 *
 * This version avoids the common 2026-07 Shopify GraphQL failures:
 * - productCreate/productUpdate use the new `product:` argument, not deprecated `input:`
 * - product variants are updated through productVariantsBulkUpdate
 * - inventorySetQuantities uses `ignoreCompareQuantity: true` and @idempotent
 * - every Admin call retries throttled responses (tries: 3); the admin client is
 *   re-acquired every 10 min so expiring offline tokens never die mid-job
 * - media, inventory and publication failures are logged as warnings instead of making
 *   the whole product fail after it has already been created.
 */

import { randomUUID } from "node:crypto";
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import type { SupplierItem } from "./supplier.server";
import {
  buildShopifyProductInput,
  mapCategory,
  DEFAULT_TITLE_TEMPLATE,
} from "./mapper.server";
import type { PricingRule } from "./mapper.server";

/* ── Types ─────────────────────────────────────────────────────────────────── */

export type Admin = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown>; tries?: number },
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
  mediaCount?: number;
};

type GqlUserError = {
  field?: string[] | string | null;
  message: string;
};

/* ── Constants ──────────────────────────────────────────────────────────────── */

// A RUNNING job whose last progress write (PushLog) is older than this was
// interrupted (server restart / crash). Measured from the last log line, not
// from startedAt, so a long but healthy push is never marked failed.
const STALE_JOB_MS = 10 * 60 * 1000;
const APP_NAME_FOR_INVENTORY_URI = "jewel-catalog";
// Retry throttled / 5xx Shopify responses. The client honors Retry-After, so
// this self-paces the loop under the cost-based rate limit.
const GRAPHQL_TRIES = 3;
// Offline access tokens expire after 60 minutes (expiringOfflineAccessTokens).
// The admin client captured at request time is NOT refreshed mid-job, so we
// re-acquire it from session storage periodically; the library refreshes the
// token when it is within 5 minutes of expiry.
const ADMIN_REFRESH_EVERY_MS = 10 * 60 * 1000;

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

function isProductMissingError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /does not exist|not found|could not find/i.test(message);
}

async function shopifyGraphql<T>(
  admin: Admin,
  operation: string,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const response = await admin.graphql(query, {
    variables,
    tries: GRAPHQL_TRIES,
  });
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

export function dbRowToSupplierItem(row: Record<string, unknown>): SupplierItem {
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
  const diaWt = toStringValue(supplierItem.Dia_Wt);
  if (/^\d+(\.\d+)?$/.test(diaWt)) {
    add("custom", "diamond_weight", diaWt, "number_decimal");
  }

  return [...byKey.values()];
}

function normalizeMedia(
  rawMedia: unknown,
): Array<{
  originalSource: string;
  mediaContentType: "IMAGE" | "VIDEO" | "EXTERNAL_VIDEO";
  alt?: string;
}> {
  const media: Array<{
    originalSource: string;
    mediaContentType: "IMAGE" | "VIDEO" | "EXTERNAL_VIDEO";
    alt?: string;
  }> = [];

  const seen = new Set<string>();

  const add = (source: unknown, type: unknown, alt?: unknown) => {
    const originalSource = toStringValue(source);
    if (!/^https?:\/\//i.test(originalSource)) return;
    if (seen.has(originalSource)) return;

    seen.add(originalSource);

    const upper = toStringValue(type).toUpperCase();
    const mediaContentType =
      upper === "EXTERNAL_VIDEO" ? "EXTERNAL_VIDEO" : upper === "VIDEO" ? "VIDEO" : "IMAGE";

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

/** Per-category markup rules for a shop, keyed by mapped category ("*" = default). */
export async function loadPricingRules(
  shop: string,
): Promise<Map<string, PricingRule>> {
  const rows = await prisma.categoryPricingRule.findMany({ where: { shop } });
  const map = new Map<string, PricingRule>();
  for (const r of rows) {
    map.set(r.category, {
      markupType: r.markupType === "fixed" ? "fixed" : "percent",
      markupValue: r.markupValue,
      roundTo: r.roundTo === "0.99" || r.roundTo === "whole" ? r.roundTo : "none",
    });
  }
  return map;
}

export function pricingRuleFor(
  rules: Map<string, PricingRule> | undefined,
  rawCategory: string,
): PricingRule | null {
  if (!rules) return null;
  return rules.get(mapCategory(rawCategory)) ?? rules.get("*") ?? null;
}

export function buildProductCreateOrUpdateInput(
  supplierItem: SupplierItem,
  settings: ShopSettingsRow,
  rules?: Map<string, PricingRule>,
  productId?: string,
): {
  product: Record<string, unknown>;
  media: Array<{
    originalSource: string;
    mediaContentType: "IMAGE" | "VIDEO" | "EXTERNAL_VIDEO";
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
    pricingRuleFor(rules, supplierItem.Category),
    settings.titleTemplate || DEFAULT_TITLE_TEMPLATE,
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
        mediaCount?: { count: number } | null;
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
            mediaCount { count }
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
    mediaCount: updated.mediaCount?.count,
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
    mediaContentType: "IMAGE" | "VIDEO" | "EXTERNAL_VIDEO";
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
        // The supplier feed is the source of truth for stock, so skip the
        // compare-and-set check. Without this Shopify rejects every entry
        // with COMPARE_QUANTITY_REQUIRED and stock silently stays at 0.
        ignoreCompareQuantity: true,
        quantities: [
          {
            inventoryItemId: params.inventoryItemId,
            locationId: params.locationId,
            quantity: params.quantity,
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

/* ── Storefront setup: metafield definitions + smart collections ──────────── */

// Definitions for the metafields written by normalizeMetafields. Filterable in
// admin and usable in smart-collection rules. Created once per shop.
const PRODUCT_METAFIELD_DEFINITIONS = [
  { key: "metal_type", name: "Metal", type: "single_line_text_field" },
  { key: "shape", name: "Diamond shape", type: "single_line_text_field" },
  { key: "clarity", name: "Clarity", type: "single_line_text_field" },
  { key: "jewelry_type", name: "Jewelry style", type: "single_line_text_field" },
  { key: "diamond_weight", name: "Diamond weight (ct)", type: "number_decimal" },
] as const;

async function ensureMetafieldDefinitions(
  admin: Admin,
  shop: string,
  jobId: number,
): Promise<void> {
  const existing = await shopifyGraphql<{
    metafieldDefinitions: { nodes: Array<{ key: string; type: { name: string } }> };
  }>(
    admin,
    "metafieldDefinitions",
    `#graphql
      query ExistingDefs($namespace: String!) {
        metafieldDefinitions(first: 50, ownerType: PRODUCT, namespace: $namespace) {
          nodes { key type { name } }
        }
      }
    `,
    { namespace: "custom" },
  );
  const have = new Set(existing.metafieldDefinitions.nodes.map((n) => n.key));

  for (const def of PRODUCT_METAFIELD_DEFINITIONS) {
    if (have.has(def.key)) continue;
    const data = await shopifyGraphql<{
      metafieldDefinitionCreate: {
        createdDefinition: { id: string } | null;
        userErrors: Array<GqlUserError & { code?: string }>;
      };
    }>(
      admin,
      "metafieldDefinitionCreate",
      `#graphql
        mutation CreateDef($definition: MetafieldDefinitionInput!) {
          metafieldDefinitionCreate(definition: $definition) {
            createdDefinition { id }
            userErrors { field message code }
          }
        }
      `,
      {
        definition: {
          name: def.name,
          namespace: "custom",
          key: def.key,
          type: def.type,
          ownerType: "PRODUCT",
          capabilities: {
            adminFilterable: { enabled: true },
            smartCollectionCondition: { enabled: true },
          },
        },
      },
    );
    const errs = data.metafieldDefinitionCreate.userErrors;
    if (errs.length && !errs.some((e) => e.code === "TAKEN")) {
      await warnLog(
        shop,
        jobId,
        null,
        `Metafield definition custom.${def.key} not created: ${userErrorText(errs)}`,
      );
    }
  }
}

async function ensureCategoryCollections(
  admin: Admin,
  shop: string,
  jobId: number,
  categories: string[],
  publicationIds: string[],
): Promise<void> {
  const cached = await prisma.shopCollection.findMany({ where: { shop } });
  const have = new Set(cached.map((c) => c.category));

  for (const category of categories) {
    if (!category || category === "Other" || have.has(category)) continue;

    // Reuse a collection with this title if the merchant already made one.
    const found = await shopifyGraphql<{
      collections: { nodes: Array<{ id: string; title: string }> };
    }>(
      admin,
      "findCollection",
      `#graphql
        query FindCollection($query: String!) {
          collections(first: 1, query: $query) { nodes { id title } }
        }
      `,
      { query: `title:"${category.replace(/"/g, '\\"')}"` },
    );
    let collectionId = found.collections.nodes.find((c) => c.title === category)?.id;

    if (!collectionId) {
      const created = await shopifyGraphql<{
        collectionCreate: {
          collection: { id: string } | null;
          userErrors: GqlUserError[];
        };
      }>(
        admin,
        "collectionCreate",
        `#graphql
          mutation CreateSmartCollection($input: CollectionInput!) {
            collectionCreate(input: $input) {
              collection { id title }
              userErrors { field message }
            }
          }
        `,
        // `input`/`ruleSet` is marked deprecated in 2026-07 in favour of
        // `collection.sources`, but it validates and works; the sources API
        // shape is not documented well enough to ship blind.
        {
          input: {
            title: category,
            ruleSet: {
              appliedDisjunctively: false,
              rules: [{ column: "TYPE", relation: "EQUALS", condition: category }],
            },
          },
        },
      );
      if (created.collectionCreate.userErrors.length || !created.collectionCreate.collection) {
        await warnLog(
          shop,
          jobId,
          null,
          `Collection "${category}" not created: ${userErrorText(created.collectionCreate.userErrors) || "no collection returned"}`,
        );
        continue;
      }
      collectionId = created.collectionCreate.collection.id;
      if (publicationIds.length > 0) {
        try {
          await publishProduct(admin, collectionId, publicationIds);
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error";
          await warnLog(shop, jobId, null, `Collection "${category}" created but not published: ${message}`);
        }
      }
    }

    await prisma.shopCollection.upsert({
      where: { shop_category: { shop, category } },
      create: { shop, category, shopifyCollectionId: collectionId },
      update: { shopifyCollectionId: collectionId },
    });
  }
}

/**
 * One-time-per-shop storefront setup, run at the start of every push job.
 * Idempotent and best-effort: failures become warn rows, never abort the push.
 */
async function ensureStorefrontSetup(
  admin: Admin,
  shop: string,
  jobId: number,
  settings: ShopSettingsRow,
  categories: string[],
  publicationIds: string[],
): Promise<void> {
  if (!settings.metafieldDefinitionsAt) {
    try {
      await ensureMetafieldDefinitions(admin, shop, jobId);
      await prisma.shopSettings.update({
        where: { shop },
        data: { metafieldDefinitionsAt: new Date() },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      await warnLog(shop, jobId, null, `Metafield definitions setup failed (will retry next push): ${message}`);
    }
  }
  try {
    await ensureCategoryCollections(admin, shop, jobId, categories, publicationIds);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    await warnLog(shop, jobId, null, `Collection setup failed (will retry next push): ${message}`);
  }
}

/* ── Stale job detection ──────────────────────────────────────────────────── */

/**
 * Mark RUNNING jobs as FAILED when they have shown no progress for
 * STALE_JOB_MS. Progress = the newest PushLog line for the job (every product
 * writes one), falling back to startedAt for a job that never logged.
 * Exported so the status endpoint can clear a dead job without a new push.
 */
export async function failStaleJobs(shop: string): Promise<void> {
  const running = await prisma.pushJob.findMany({
    where: { shop, status: "RUNNING" },
  });
  const cutoff = Date.now() - STALE_JOB_MS;

  for (const job of running) {
    const lastLog = await prisma.pushLog.findFirst({
      where: { jobId: job.id },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    const lastActivity = lastLog?.createdAt ?? job.startedAt ?? job.createdAt;
    if (lastActivity.getTime() >= cutoff) continue;

    await prisma.pushJob.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        errorMessage:
          job.errorMessage ||
          "Interrupted: no progress for 10 minutes (server restarted during push). Selected products were kept; push again to resume.",
      },
    });
  }
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

  await failStaleJobs(shop);

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
  initialAdmin: Admin,
  jobId: number,
  products: SupplierProductRow[],
  settings: ShopSettingsRow,
): Promise<PushResults> {
  const results: PushResultRow[] = [];
  let pushedCount = 0;
  let failedCount = 0;
  let firstFailure: string | null = null;

  let admin: Admin = initialAdmin;
  let adminAcquiredAt = Date.now();
  const refreshAdminIfNeeded = async () => {
    if (Date.now() - adminAcquiredAt < ADMIN_REFRESH_EVERY_MS) return;
    try {
      const ctx = await unauthenticated.admin(shop);
      admin = ctx.admin as unknown as Admin;
      adminAcquiredAt = Date.now();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      await warnLog(
        shop,
        jobId,
        null,
        `Could not refresh Shopify access token; continuing with current token. ${message}`,
      );
      adminAcquiredAt = Date.now();
    }
  };

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

  const pricingRules = await loadPricingRules(shop);

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

  await ensureStorefrontSetup(
    admin,
    shop,
    jobId,
    settings,
    [...new Set(products.map((p) => p.category))],
    publicationIds,
  );

  for (const product of products) {
    try {
      await refreshAdminIfNeeded();

      const supplierItem = dbRowToSupplierItem(
        product as unknown as Record<string, unknown>,
      );

      const built = buildProductCreateOrUpdateInput(supplierItem, settings, pricingRules);
      const sku = built.variant.sku || product.stockNo;

      if (built.variant.price === "0.00") {
        await warnLog(
          shop,
          jobId,
          product.stockNo,
          `Supplier price is 0 — product will be listed at $0.00. Check the supplier feed for this item.`,
        );
      }

      let existingMapping = await prisma.shopifyProductMapping.findFirst({
        where: { shop, supplierStockNo: product.stockNo },
      });

      let shopifyProduct: ShopifyProductResult | null = null;
      let action: "created" | "updated" = "created";

      if (existingMapping) {
        const updateInput = {
          ...built.product,
          id: existingMapping.shopifyProductId,
        };

        try {
          shopifyProduct = await updateProduct(admin, updateInput);
        } catch (err) {
          // The merchant deleted the product in Shopify admin. Drop the stale
          // mapping and fall through to the create path instead of failing
          // this product on every future push.
          if (!isProductMissingError(err)) throw err;
          await warnLog(
            shop,
            jobId,
            product.stockNo,
            `Mapped Shopify product ${existingMapping.shopifyProductId} no longer exists — recreating it.`,
          );
          await prisma.shopifyProductMapping.delete({
            where: { id: existingMapping.id },
          });
          existingMapping = null;
        }
      }

      if (existingMapping && shopifyProduct) {
        action = "updated";

        await prisma.shopifyProductMapping.update({
          where: { id: existingMapping.id },
          data: {
            shopifyProductId: shopifyProduct.id,
            shopifyProductTitle: shopifyProduct.title,
            pushedAt: new Date(),
          },
        });

        if (shopifyProduct.mediaCount === 0 && built.media.length > 0) {
          try {
            await appendMediaToProduct(admin, shopifyProduct.id, built.media);
          } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
            await warnLog(
              shop,
              jobId,
              product.stockNo,
              `Product updated, but media upload failed: ${message}`,
            );
          }
        }
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

      if (!shopifyProduct) {
        throw new Error("Shopify product was neither created nor updated.");
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
