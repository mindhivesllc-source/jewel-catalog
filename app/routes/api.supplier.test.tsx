import { data, type LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { testSupplierConnection } from "../services/supplier.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  try {
    const settings = await prisma.shopSettings.findUnique({ where: { shop } });

    if (!settings?.supplierApiKey) {
      return data(
        { error: "Supplier API key not configured. Please set it in Settings first." },
        { status: 400 },
      );
    }

    const result = await testSupplierConnection(settings.supplierApiKey);
    return data(result);
  } catch (err: any) {
    return data(
      { error: err.message || "Failed to test supplier connection" },
      { status: 500 },
    );
  }
};
