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
  graphql: (query: string, opts?: { variables?: Record<string, unknown> }) => Promise<Response>;
}

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
  const res = await admin.graphql(query, { variables: { product: input } });
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
  const res = await admin.graphql(query, { variables: { product: body_input } });
  const body = (await res.json()) as { data?: { productUpdate: { userErrors?: UserError[]; product?: { id: string; title: string } } }; errors?: unknown };

  if (body.errors) throw new Error(`productUpdate errors: ${JSON.stringify(body.errors)}`);
  const r = body.data?.productUpdate;
  if (!r) throw new Error("No productUpdate data");
  if (r.userErrors?.length) throw new Error(`productUpdate userErrors: ${JSON.stringify(r.userErrors)}`);
  if (!r.product) throw new Error("No product returned");
  return r.product;
}

// ── Set product (can update base fields + variant pricing in one call) ──────

export async function setProductWithPricing(
  admin: Admin,
  productId: string,
  _productFields: Record<string, unknown>,
  variantPrice: { price: string; compareAtPrice?: string | null },
): Promise<void> {
  // First get the variant ID
  const getQuery = `#graphql
    query gv($id: ID!) { product(id: $id) { variants(first:1) { edges { node { id } } } } }
  `;
  const getRes = await admin.graphql(getQuery, { variables: { id: productId } });
  const getBody = (await getRes.json()) as {
    data?: { product?: { variants?: { edges?: { node: { id: string } }[] } } };
  };

  const variantId = getBody.data?.product?.variants?.edges?.[0]?.node?.id;
  if (!variantId) {
    console.warn("[push] No variant ID for pricing — skipping");
    return;
  }

  // productVariantsBulkUpdate accepts: id, price, compareAtPrice
  // Does NOT accept: sku, optionValues, inventoryQuantities
  const variantInput: Record<string, unknown> = {
    id: variantId,
    price: variantPrice.price,
  };
  if (variantPrice.compareAtPrice) {
    variantInput.compareAtPrice = variantPrice.compareAtPrice;
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
  });
  const body = (await res.json()) as {
    data?: { productVariantsBulkUpdate?: { userErrors?: UserError[] } };
    errors?: unknown;
  };

  if (body.errors) throw new Error(`productVariantsBulkUpdate errors: ${JSON.stringify(body.errors)}`);
  if (body.data?.productVariantsBulkUpdate?.userErrors?.length) {
    throw new Error(`productVariantsBulkUpdate userErrors: ${JSON.stringify(body.data.productVariantsBulkUpdate.userErrors)}`);
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
  const res = await admin.graphql(query, { variables: { productId, media } });
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
  const res = await admin.graphql(query, { variables: { metafields: inputs } });
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
