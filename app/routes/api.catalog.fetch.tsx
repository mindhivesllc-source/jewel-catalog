import { data, type ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { SupplierUnreachableError } from "../services/supplier.server";
import { decryptSecret } from "../services/crypto.server";
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

  const apiKey = decryptSecret(settings?.supplierApiKey);
  if (!settings || !apiKey) {
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
    const result = await fetchAndStoreCatalog(shop, apiKey);
    return data({
      success: true,
      total: result.total,
      warning: result.warning,
      removed: result.removed,
      delisted: result.delisted,
    });
  } catch (err) {
    console.error(
      `[fetch] ${shop}: ${err instanceof Error ? err.message : String(err)}`,
    );
    // The supplier was never reached, so its rate-limit window was not used.
    if (err instanceof SupplierUnreachableError) {
      await prisma.shopSettings
        .update({ where: { shop }, data: { lastFetchAt: settings.lastFetchAt } })
        .catch((e) => console.error(`[fetch] ${shop}: could not restore lastFetchAt: ${e}`));
    }
    return data(
      { success: false, error: (err instanceof Error && err.message) || "Failed to fetch catalog" },
      { status: 500 },
    );
  }
};
