/**
 * Shopify Admin API helpers — 2026-04 product model.
 *
 * productUpdate: product:{id, ...} (id inside input, NOT as separate arg)
 * Media: CreateMediaInput type
 * productVariantsBulkUpdate: variants:[{id:, price:}], no SKU directly
 * For SKU + pricing in one shot: productSet(product:{id, variants:[{id, price, sku}]})
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface Admin {
  graphql: (
    query: string,
    opts?: { variables?: Record<string, unknown>; tries?: number },
  ) => Promise<Response>;
}

// Retry throttled/5xx responses (tries = 1 initial attempt + 2 retries).
// Large pushes hit Shopify's cost-based rate limit constantly; the client
// honors Retry-After so this self-paces the push loop.
const TRIES = 3;

interface UserError {
  field?: string[];
  message: string;
}

// ── Create product ───────────────────────────────────────────────────────────

export async function createProduct(
  admin: Admin,
  input: Record<string, unknown>,
): Promise<{ id: string; title: string }> {
  const query = `#graphql
    mutation productCreate($product: ProductCreateInput!) {
      productCreate(product: $product) {
        userErrors { field message }
        product { id title }
      }
    }
  `;
  const res = await admin.graphql(query, { variables: { product: input }, tries: TRIES });
  const body = (await res.json()) as { data?: { productCreate: { userErrors?: UserError[]; product?: { id: string; title: string } } }; errors?: unknown };

  if (body.errors) throw new Error(`productCreate errors: ${JSON.stringify(body.errors)}`);
  const r = body.data?.productCreate;
  if (!r) throw new Error("No productCreate data");
  if (r.userErrors?.length) throw new Error(`productCreate userErrors: ${JSON.stringify(r.userErrors)}`);
  if (!r.product) throw new Error("No product returned");
  return r.product;
}

// ── Update product ───────────────────────────────────────────────────────────
// productUpdate argument is "product:{...}" not "id:..."! ID goes INSIDE the input.

export async function updateProduct(
  admin: Admin,
  productId: string,
  input: Record<string, unknown>,
): Promise<{ id: string; title: string }> {
  const query = `#graphql
    mutation productUpdate($product: ProductUpdateInput!) {
      productUpdate(product: $product) {
        userErrors { field message }
        product { id title }
      }
    }
  `;
  const body_input = { ...input, id: productId };
  const res = await admin.graphql(query, { variables: { product: body_input }, tries: TRIES });
  const body = (await res.json()) as { data?: { productUpdate: { userErrors?: UserError[]; product?: { id: string; title: string } } }; errors?: unknown };

  if (body.errors) throw new Error(`productUpdate errors: ${JSON.stringify(body.errors)}`);
  const r = body.data?.productUpdate;
  if (!r) throw new Error("No productUpdate data");
  if (r.userErrors?.length) throw new Error(`productUpdate userErrors: ${JSON.stringify(r.userErrors)}`);
  if (!r.product) throw new Error("No product returned");
  return r.product;
}

// ── Variant pricing + SKU + inventory ────────────────────────────────────────

export async function setVariantPricingAndInventory(
  admin: Admin,
  productId: string,
  variant: { price: string; compareAtPrice?: string | null; sku?: string },
  inventory: { quantity: number | null; locationId: string | null },
): Promise<void> {
  // First get the variant + inventory item IDs
  const getQuery = `#graphql
    query gv($id: ID!) { product(id: $id) { variants(first:1) { edges { node { id inventoryItem { id } } } } } }
  `;
  const getRes = await admin.graphql(getQuery, { variables: { id: productId }, tries: TRIES });
  const getBody = (await getRes.json()) as {
    data?: { product?: { variants?: { edges?: { node: { id: string; inventoryItem?: { id: string } } }[] } } };
  };

  const variantNode = getBody.data?.product?.variants?.edges?.[0]?.node;
  if (!variantNode?.id) {
    console.warn("[push] No variant ID for pricing — skipping");
    return;
  }

  // productVariantsBulkUpdate accepts: id, price, compareAtPrice, inventoryItem
  // SKU and tracking live on inventoryItem, NOT directly on the variant input.
  const variantInput: Record<string, unknown> = {
    id: variantNode.id,
    price: variant.price,
    inventoryItem: {
      tracked: true,
      ...(variant.sku ? { sku: variant.sku } : {}),
    },
  };
  if (variant.compareAtPrice) {
    variantInput.compareAtPrice = variant.compareAtPrice;
  }

  const query = `#graphql
    mutation pvu($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        userErrors { field message }
        product { id }
      }
    }
  `;

  const res = await admin.graphql(query, {
    variables: { productId, variants: [variantInput] },
    tries: TRIES,
  });
  const body = (await res.json()) as {
    data?: { productVariantsBulkUpdate?: { userErrors?: UserError[] } };
    errors?: unknown;
  };

  if (body.errors) throw new Error(`productVariantsBulkUpdate errors: ${JSON.stringify(body.errors)}`);
  if (body.data?.productVariantsBulkUpdate?.userErrors?.length) {
    throw new Error(`productVariantsBulkUpdate userErrors: ${JSON.stringify(body.data.productVariantsBulkUpdate.userErrors)}`);
  }

  // Set the available quantity at the location
  if (inventory.locationId && inventory.quantity !== null && variantNode.inventoryItem?.id) {
    const qtyQuery = `#graphql
      mutation setQty($input: InventorySetQuantitiesInput!) {
        inventorySetQuantities(input: $input) {
          userErrors { field message }
        }
      }
    `;
    const qtyRes = await admin.graphql(qtyQuery, {
      variables: {
        input: {
          name: "available",
          reason: "correction",
          ignoreCompareQuantity: true,
          quantities: [
            {
              inventoryItemId: variantNode.inventoryItem.id,
              locationId: inventory.locationId,
              quantity: inventory.quantity,
            },
          ],
        },
      },
      tries: TRIES,
    });
    const qtyBody = (await qtyRes.json()) as {
      data?: { inventorySetQuantities?: { userErrors?: UserError[] } };
      errors?: unknown;
    };
    if (qtyBody.errors) throw new Error(`inventorySetQuantities errors: ${JSON.stringify(qtyBody.errors)}`);
    if (qtyBody.data?.inventorySetQuantities?.userErrors?.length) {
      throw new Error(`inventorySetQuantities userErrors: ${JSON.stringify(qtyBody.data.inventorySetQuantities.userErrors)}`);
    }
  }
}

// ── Publications & locations (fetched once per push job) ────────────────────

export interface PushTargets {
  publicationIds: string[];
  locationId: string | null;
}

export async function getPushTargets(admin: Admin): Promise<PushTargets> {
  const query = `#graphql
    query getPubsAndLocation {
      publications(first: 20) { edges { node { id } } }
      locations(first: 10, includeInactive: false) { edges { node { id fulfillsOnlineOrders } } }
    }
  `;
  const res = await admin.graphql(query, { tries: TRIES });
  const body = (await res.json()) as {
    data?: {
      publications?: { edges?: { node: { id: string } }[] };
      locations?: { edges?: { node: { id: string; fulfillsOnlineOrders: boolean } }[] };
    };
    errors?: unknown;
  };
  if (body.errors) throw new Error(`getPushTargets errors: ${JSON.stringify(body.errors)}`);

  const publicationIds = (body.data?.publications?.edges ?? []).map((e) => e.node.id);
  const locations = (body.data?.locations?.edges ?? []).map((e) => e.node);
  const locationId =
    locations.find((l) => l.fulfillsOnlineOrders)?.id ?? locations[0]?.id ?? null;

  return { publicationIds, locationId };
}

/**
 * Publish a product to the given sales channels. Best-effort: a publish
 * failure is logged but must not fail the whole product push.
 */
export async function publishProduct(
  admin: Admin,
  productId: string,
  publicationIds: string[],
): Promise<void> {
  if (publicationIds.length === 0) return;
  const query = `#graphql
    mutation publishProduct($id: ID!, $input: [PublicationInput!]!) {
      publishablePublish(id: $id, input: $input) {
        userErrors { field message }
      }
    }
  `;
  const res = await admin.graphql(query, {
    variables: {
      id: productId,
      input: publicationIds.map((publicationId) => ({ publicationId })),
    },
    tries: TRIES,
  });
  const body = (await res.json()) as {
    data?: { publishablePublish?: { userErrors?: UserError[] } };
    errors?: unknown;
  };
  if (body.errors) {
    console.error(`[push] Publish error: ${JSON.stringify(body.errors)}`);
  } else if (body.data?.publishablePublish?.userErrors?.length) {
    console.error(`[push] Publish userErrors: ${JSON.stringify(body.data.publishablePublish.userErrors)}`);
  }
}

// ── Media ────────────────────────────────────────────────────────────────────

export async function appendProductMedia(
  admin: Admin,
  productId: string,
  media: { mediaContentType: string; originalSource: string; alt?: string }[],
): Promise<void> {
  if (media.length === 0) return;
  const query = `#graphql
    mutation pam($productId: ID!, $media: [CreateMediaInput!]) {
      productUpdateMedia(productId: $productId, media: $media) {
        userErrors { field message }
      }
    }
  `;
  const res = await admin.graphql(query, { variables: { productId, media }, tries: TRIES });
  const body = (await res.json()) as { data?: { productUpdateMedia?: { userErrors?: UserError[] } }; errors?: unknown };
  if (body.errors) console.error(`[push] Media error: ${JSON.stringify(body.errors)}`);
  else if (body.data?.productUpdateMedia?.userErrors?.length) {
    console.error(`[push] Media userErrors: ${JSON.stringify(body.data.productUpdateMedia.userErrors)}`);
  }
}

// ── Metafields ───────────────────────────────────────────────────────────────

export async function setProductMetafields(
  admin: Admin,
  productId: string,
  metafields: { namespace: string; key: string; value: string; type: string }[],
): Promise<void> {
  if (metafields.length === 0) return;
  const inputs = metafields.map(mf => ({ ...mf, ownerId: productId }));
  const query = `#graphql
    mutation ms($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        userErrors { field message }
      }
    }
  `;
  const res = await admin.graphql(query, { variables: { metafields: inputs }, tries: TRIES });
  const body = (await res.json()) as { data?: { metafieldsSet?: { userErrors?: UserError[] } }; errors?: unknown };
  if (body.errors) console.error(`[push] Metafield error: ${JSON.stringify(body.errors)}`);
  else if (body.data?.metafieldsSet?.userErrors?.length) {
    console.error(`[push] Metafield userErrors: ${JSON.stringify(body.data.metafieldsSet.userErrors)}`);
  }
}

// ── Lookup ───────────────────────────────────────────────────────────────────

export async function findProductBySupplierId(
  admin: Admin, supplierId: string, supplierSku: string,
): Promise<{ id: string; title: string } | null> {
  // Best-effort fallback only. The local ShopifyProductMapping table is the
  // primary dedup source; this lookup catches products that exist in Shopify
  // but are missing from our mapping (e.g. re-imported store). Searching by an
  // arbitrary metafield value requires a searchable metafield definition, which
  // we don't guarantee, so any failure here must NOT abort the push — we just
  // return null and let the caller create the product.
  const query = `#graphql
    query fps($query: String!) {
      products(first: 5, query: $query) {
        edges {
          node {
            id title
            metafields(first: 10, namespace: "lgd_supplier") {
              edges { node { namespace key value } }
            }
          }
        }
      }
    }
  `;
  try {
    // Correct search syntax: metafields.<namespace>.<key>:<value>
    const res = await admin.graphql(query, {
      variables: { query: `metafields.lgd_supplier.supplier_id:${supplierId}` },
    });
    const body = (await res.json()) as { data?: { products?: { edges?: { node: { id: string; title: string; metafields?: { edges?: { node: { namespace: string; key: string; value: string } }[] } } }[] } }; errors?: unknown };

    if (body.errors) {
      console.warn(`[push] findProduct lookup skipped (query error): ${JSON.stringify(body.errors)}`);
      return null;
    }
    for (const edge of body.data?.products?.edges ?? []) {
      const mfs = edge.node.metafields?.edges ?? [];
      if (mfs.some(m => m.node.namespace==="lgd_supplier" && m.node.key==="supplier_id" && m.node.value===supplierId) &&
          mfs.some(m => m.node.namespace==="lgd_supplier" && m.node.key==="supplier_sku" && m.node.value===supplierSku)) {
        return { id: edge.node.id, title: edge.node.title };
      }
    }
    return null;
  } catch (err: any) {
    console.warn(`[push] findProduct lookup failed, proceeding to create: ${err?.message ?? err}`);
    return null;
  }
}
