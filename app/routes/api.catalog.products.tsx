import { data, type LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { queryProducts } from "../services/catalog.server";

function parseBoolParam(value: string | null): boolean | undefined {
  if (value === null) return undefined;
  return value === "true" || value === "1";
}

function parseNumParam(value: string | null): number | undefined {
  if (value === null) return undefined;
  const num = parseFloat(value);
  return isNaN(num) ? undefined : num;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const url = new URL(request.url);
  const filters = {
    category: url.searchParams.get("category") || undefined,
    shape: url.searchParams.get("shape") || undefined,
    metalType: url.searchParams.get("metalType") || undefined,
    jewelryType: url.searchParams.get("jewelryType") || undefined,
    size: url.searchParams.get("size") || undefined,
    clarity: url.searchParams.get("clarity") || undefined,
    inHand: parseBoolParam(url.searchParams.get("inHand")),
    onMemo: parseBoolParam(url.searchParams.get("onMemo")),
    diaWtMin: parseNumParam(url.searchParams.get("diaWtMin")),
    diaWtMax: parseNumParam(url.searchParams.get("diaWtMax")),
    search: url.searchParams.get("search") || undefined,
    selected: parseBoolParam(url.searchParams.get("selected")),
    pushed: parseBoolParam(url.searchParams.get("pushed")),
    page: parseInt(url.searchParams.get("page") || "1", 10) || 1,
    limit: parseInt(url.searchParams.get("limit") || "50", 10) || 50,
  };

  try {
    const result = await queryProducts(shop, filters);
    return data(result);
  } catch (err: any) {
    return data(
      { error: err.message || "Failed to query products" },
      { status: 500 },
    );
  }
};
