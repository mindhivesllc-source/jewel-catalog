/**
 * Shopify Admin API helpers.
 *
 * Self-contained — does not import from other application services.
 * The `Admin` type is the object returned by `shopify.authenticate.admin(request)`.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface Admin {
  graphql: (
    query: string,
    opts?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
}

interface UserError {
  field?: string[];
  message: string;
}

interface MutationResult<T> {
  userErrors: UserError[];
  product?: T;
}

// ── Product CRUD ─────────────────────────────────────────────────────────────

interface ProductPayload {
  id: string;
  title: string;
}

/**
 * Create a new Shopify product via GraphQL.
 */
export async function createProduct(
  admin: Admin,
  input: Record<string, unknown>,
): Promise<{ id: string; title: string }> {
  const query = `#graphql
    mutation productCreate($input: ProductInput!) {
      productCreate(input: $input) {
        userErrors {
          field
          message
        }
        product {
          id
          title
        }
      }
    }
  `;

  const res = await admin.graphql(query, { variables: { input } });
  const body = (await res.json()) as {
    data?: { productCreate: MutationResult<ProductPayload> };
    errors?: unknown;
  };

  if (body.errors) {
    throw new Error(
      `GraphQL errors creating product: ${JSON.stringify(body.errors)}`,
    );
  }

  const result = body.data?.productCreate;
  if (!result) {
    throw new Error("No data returned from productCreate mutation");
  }

  if (result.userErrors && result.userErrors.length > 0) {
    throw new Error(
      `User errors creating product: ${JSON.stringify(result.userErrors)}`,
    );
  }

  if (!result.product) {
    throw new Error("productCreate mutation returned no product");
  }

  return { id: result.product.id, title: result.product.title };
}

/**
 * Update an existing Shopify product via GraphQL.
 */
export async function updateProduct(
  admin: Admin,
  productId: string,
  input: Record<string, unknown>,
): Promise<{ id: string; title: string }> {
  const query = `#graphql
    mutation productUpdate($productId: ID!, $input: ProductInput!) {
      productUpdate(input: $input, id: $productId) {
        userErrors {
          field
          message
        }
        product {
          id
          title
        }
      }
    }
  `;

  const res = await admin.graphql(query, {
    variables: { productId, input },
  });
  const body = (await res.json()) as {
    data?: { productUpdate: MutationResult<ProductPayload> };
    errors?: unknown;
  };

  if (body.errors) {
    throw new Error(
      `GraphQL errors updating product: ${JSON.stringify(body.errors)}`,
    );
  }

  const result = body.data?.productUpdate;
  if (!result) {
    throw new Error("No data returned from productUpdate mutation");
  }

  if (result.userErrors && result.userErrors.length > 0) {
    throw new Error(
      `User errors updating product: ${JSON.stringify(result.userErrors)}`,
    );
  }

  if (!result.product) {
    throw new Error("productUpdate mutation returned no product");
  }

  return { id: result.product.id, title: result.product.title };
}

// ── Product lookup by supplier metafields ────────────────────────────────────

interface MetafieldEdge {
  node: {
    id: string;
    namespace: string;
    key: string;
    value: string;
  };
}

/**
 * Find a Shopify product by its LGD supplier metafields.
 * Returns `null` when no matching product exists.
 */
export async function findProductBySupplierId(
  admin: Admin,
  supplierId: string,
  supplierSku: string,
): Promise<{ id: string; title: string } | null> {
  const query = `#graphql
    query findProductBySupplier($query: String!) {
      products(first: 5, query: $query) {
        edges {
          node {
            id
            title
            metafields(first: 10, namespace: "lgd_supplier") {
              edges {
                node {
                  id
                  namespace
                  key
                  value
                }
              }
            }
          }
        }
      }
    }
  `;

  // Search using Shopify's product query syntax on the supplier_id metafield
  const searchQuery = `lgd_supplier:supplier_id:${supplierId}`;

  const res = await admin.graphql(query, {
    variables: { query: searchQuery },
  });
  const body = (await res.json()) as {
    data?: {
      products?: {
        edges?: {
          node: {
            id: string;
            title: string;
            metafields?: { edges?: MetafieldEdge[] };
          };
        }[];
      };
    };
    errors?: unknown;
  };

  if (body.errors) {
    throw new Error(
      `GraphQL errors searching product: ${JSON.stringify(body.errors)}`,
    );
  }

  const edges = body.data?.products?.edges ?? [];

  for (const edge of edges) {
    const metafieldEdges = edge.node.metafields?.edges ?? [];
    const hasSupplierId = metafieldEdges.some(
      (mf) =>
        mf.node.namespace === "lgd_supplier" &&
        mf.node.key === "supplier_id" &&
        mf.node.value === supplierId,
    );
    const hasSupplierSku = metafieldEdges.some(
      (mf) =>
        mf.node.namespace === "lgd_supplier" &&
        mf.node.key === "supplier_sku" &&
        mf.node.value === supplierSku,
    );

    if (hasSupplierId && hasSupplierSku) {
      return { id: edge.node.id, title: edge.node.title };
    }
  }

  return null;
}
