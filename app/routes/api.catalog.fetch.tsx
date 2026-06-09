import { data, type LoaderFunctionArgs, type ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { fetchAndStoreCatalog } from "../services/catalog.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const settings = await prisma.shopSettings.findUnique({ where: { shop } });

  if (!settings?.supplierApiKey) {
    return data(
      { error: "Supplier API key not configured. Please set it in Settings first." },
      { status: 400 },
    );
  }

  try {
    const result = await fetchAndStoreCatalog(shop, settings.supplierApiKey);
    return data(result);
  } catch (err: any) {
    return data(
      { error: err.message || "Failed to fetch catalog" },
      { status: 500 },
    );
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const settings = await prisma.shopSettings.findUnique({ where: { shop } });

  if (!settings?.supplierApiKey) {
    return data(
      { error: "Supplier API key not configured. Please set it in Settings first." },
      { status: 400 },
    );
  }

  try {
    const result = await fetchAndStoreCatalog(shop, settings.supplierApiKey);
    return data(result);
  } catch (err: any) {
    return data(
      { error: err.message || "Failed to fetch catalog" },
      { status: 500 },
    );
  }
};
