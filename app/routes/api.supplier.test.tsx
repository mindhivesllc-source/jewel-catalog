import { data, type LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { decryptSecret } from "../services/crypto.server";
import { testSupplierConnection } from "../services/supplier.server";
import {
  markSupplierRequest,
  minutesUntilNextSupplierRequest,
} from "../services/catalog.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  try {
    const settings = await prisma.shopSettings.findUnique({ where: { shop } });

    const apiKey = decryptSecret(settings?.supplierApiKey);
    if (!settings || !apiKey) {
      return data(
        { success: false, error: "Supplier API key not configured. Save it in Settings first." },
        { status: 400 },
      );
    }

    const wait = minutesUntilNextSupplierRequest(settings.lastFetchAt);
    if (wait > 0) {
      return data(
        {
          success: false,
          error: `The supplier allows one request every 15 minutes. Try again in ${wait} minute${wait === 1 ? "" : "s"}.`,
        },
        { status: 429 },
      );
    }

    await markSupplierRequest(shop);
    const result = await testSupplierConnection(apiKey);
    if (!result.ok) {
      return data({ success: false, error: result.error }, { status: 502 });
    }
    return data({ success: true, items: result.items });
  } catch (err) {
    return data(
      { success: false, error: (err instanceof Error && err.message) || "Failed to test supplier connection" },
      { status: 500 },
    );
  }
};
