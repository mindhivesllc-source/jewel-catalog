import { data, type LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { exportToCsv } from "../services/catalog.server";

function parseBoolParam(value: string | null): boolean | undefined {
  if (value === null) return undefined;
  return value === "true" || value === "1";
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
    search: url.searchParams.get("search") || undefined,
    selected: parseBoolParam(url.searchParams.get("selected")),
    pushed: parseBoolParam(url.searchParams.get("pushed")),
  };

  try {
    const csv = await exportToCsv(shop, filters);

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="catalog-export.csv"`,
      },
    });
  } catch (err: any) {
    return data(
      { error: err.message || "Failed to export CSV" },
      { status: 500 },
    );
  }
};
