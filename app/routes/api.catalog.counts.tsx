import { data, type LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getProductCounts, getCategories, getFilterFacets } from "../services/catalog.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  try {
    const [countsResult, categories, facets, settings] = await Promise.all([
      getProductCounts(shop),
      getCategories(shop),
      getFilterFacets(shop),
      prisma.shopSettings.findUnique({
        where: { shop },
        select: { lastFetchAt: true, autoSyncEnabled: true },
      }),
    ]);

    return data({
      ...countsResult,
      categories,
      ...facets,
      lastFetchAt: settings?.lastFetchAt ?? null,
      autoSyncEnabled: settings?.autoSyncEnabled ?? false,
    });
  } catch (err: any) {
    return data(
      { error: err.message || "Failed to get counts" },
      { status: 500 },
    );
  }
};
