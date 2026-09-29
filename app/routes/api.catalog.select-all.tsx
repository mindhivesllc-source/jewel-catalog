import { data, type ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { selectAllInView, deselectAll } from "../services/catalog.server";
import type { CatalogFilters } from "../services/catalog.server";

/**
 * The UI posts its raw filter state ({ weightRange: "6-8", sort, page, ... }).
 * Translate it into CatalogFilters so "select all in view" selects exactly the
 * rows the grid shows — previously weightRange was silently dropped and
 * select-all grabbed the whole category.
 */
function toCatalogFilters(raw: Record<string, unknown>): CatalogFilters {
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const filters: CatalogFilters = {
    category: str(raw.category),
    shape: str(raw.shape),
    metalType: str(raw.metalType),
    jewelryType: str(raw.jewelryType),
    size: str(raw.size),
    clarity: str(raw.clarity),
    search: str(raw.search),
  };
  const weight = str(raw.weightRange);
  if (weight) {
    const plus = /^(\d+(?:\.\d+)?)\+$/.exec(weight);
    const range = /^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/.exec(weight);
    if (plus) filters.diaWtMin = parseFloat(plus[1]);
    else if (range) {
      filters.diaWtMin = parseFloat(range[1]);
      filters.diaWtMax = parseFloat(range[2]);
    }
  }
  if (typeof raw.diaWtMin === "number") filters.diaWtMin = raw.diaWtMin;
  if (typeof raw.diaWtMax === "number") filters.diaWtMax = raw.diaWtMax;
  return filters;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const contentType = request.headers.get("content-type") || "";
  let body: any = {};

  if (contentType.includes("application/json")) {
    body = await request.json();
  } else {
    const formData = await request.formData();
    const actionType = formData.get("action")?.toString();
    body = { action: actionType };
  }

  const actionType = body.action;

  try {
    if (actionType === "selectAll") {
      const filters = toCatalogFilters(body.filters || {});
      const result = await selectAllInView(shop, filters);
      return data({ selectedCount: result.count });
    } else if (actionType === "deselectAll") {
      const result = await deselectAll(shop);
      return data({ deselectedCount: result.count });
    } else {
      return data(
        { error: "Invalid action. Use 'selectAll' or 'deselectAll'." },
        { status: 400 },
      );
    }
  } catch (err: any) {
    return data(
      { error: err.message || "Failed to process select-all action" },
      { status: 500 },
    );
  }
};
