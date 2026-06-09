import { data, type LoaderFunctionArgs, type ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

function maskApiKey(key: string): string {
  if (!key || key.length <= 8) return key;
  return key.slice(0, 4) + "••••" + key.slice(-4);
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  try {
    let settings = await prisma.shopSettings.findUnique({ where: { shop } });

    if (!settings) {
      settings = await prisma.shopSettings.create({
        data: { shop },
      });
    }

    return data({
      ...settings,
      supplierApiKey: maskApiKey(settings.supplierApiKey),
    });
  } catch (err: any) {
    return data(
      { error: err.message || "Failed to get settings" },
      { status: 500 },
    );
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const contentType = request.headers.get("content-type") || "";
  let body: Record<string, any> = {};

  if (contentType.includes("application/json")) {
    body = await request.json();
  } else {
    const formData = await request.formData();
    for (const [key, value] of formData.entries()) {
      body[key] = value;
    }
  }

  // Map form field names to Prisma field names
  const updateData: Record<string, any> = {};

  if ("apiKey" in body || "supplierApiKey" in body) {
    const rawKey = body.apiKey || body.supplierApiKey;
    // Only update if the key doesn't contain masked characters
    if (rawKey && !rawKey.includes("••••")) {
      updateData.supplierApiKey = rawKey;
    }
  }

  if ("vendor" in body) {
    updateData.vendor = body.vendor;
  }

  if ("compareAtRule" in body || "compareAtPriceRule" in body) {
    updateData.compareAtPriceRule = body.compareAtRule || body.compareAtPriceRule;
  }

  if ("compareAtMultiplier" in body) {
    const val = parseFloat(body.compareAtMultiplier);
    if (!isNaN(val)) {
      updateData.compareAtMultiplier = val;
    }
  }

  if ("compareAtFixed" in body) {
    const val = parseFloat(body.compareAtFixed);
    if (!isNaN(val)) {
      updateData.compareAtFixed = val;
    }
  }

  if ("defaultLocationId" in body) {
    updateData.defaultLocationId = body.defaultLocationId;
  }

  try {
    const settings = await prisma.shopSettings.upsert({
      where: { shop },
      create: { shop, ...updateData },
      update: updateData,
    });

    return data({
      ...settings,
      supplierApiKey: maskApiKey(settings.supplierApiKey),
    });
  } catch (err: any) {
    return data(
      { error: err.message || "Failed to save settings" },
      { status: 500 },
    );
  }
};
