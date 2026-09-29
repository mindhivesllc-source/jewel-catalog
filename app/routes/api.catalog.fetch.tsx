import { data, type ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  fetchAndStoreCatalog,
  minutesUntilNextSupplierRequest,
} from "../services/catalog.server";

// POST only: a fetch spends the supplier's one-request-per-15-minutes window,
// so it must never be triggered by a plain GET / prefetch.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const settings = await prisma.shopSettings.findUnique({ where: { shop } });

  if (!settings?.supplierApiKey) {
    return data(
      { success: false, error: "Supplier API key not configured. Please set it in Settings first." },
      { status: 400 },
    );
  }

  const wait = minutesUntilNextSupplierRequest(settings.lastFetchAt);
  if (wait > 0) {
    return data(
      {
        success: false,
        error: `The supplier allows one catalog request every 15 minutes. Try again in ${wait} minute${wait === 1 ? "" : "s"}.`,
      },
      { status: 429 },
    );
  }

  try {
    const result = await fetchAndStoreCatalog(shop, settings.supplierApiKey);
    return data({ success: true, total: result.total, warning: result.warning });
  } catch (err: any) {
    return data(
      { success: false, error: err.message || "Failed to fetch catalog" },
      { status: 500 },
    );
  }
};
