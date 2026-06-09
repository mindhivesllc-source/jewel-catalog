import { data, type LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getProductCounts, getCategories, getFilterFacets } from "../services/catalog.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  try {
    const [countsResult, categories, facets] = await Promise.all([
      getProductCounts(shop),
      getCategories(shop),
      getFilterFacets(shop),
    ]);

    return data({
      ...countsResult,
      categories,
      ...facets,
    });
  } catch (err: any) {
    return data(
      { error: err.message || "Failed to get counts" },
      { status: 500 },
    );
  }
};
