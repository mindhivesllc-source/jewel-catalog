import { data, type LoaderFunctionArgs, type ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import type { Prisma } from "@prisma/client";
import prisma from "../db.server";
import { decryptSecret, encryptSecret } from "../services/crypto.server";
import { validateImageTemplate } from "../services/images.server";

function maskApiKey(stored: string): string {
  const key = decryptSecret(stored);
  if (!key) return "";
  if (key.length <= 8) return "••••";
  return key.slice(0, 4) + "••••" + key.slice(-4);
}

type AdminGraphql = {
  graphql: (query: string) => Promise<Response>;
};

/** Best-effort list of the shop's locations for the inventory picker. */
async function loadLocations(
  admin: AdminGraphql,
): Promise<Array<{ id: string; name: string }>> {
  try {
    const response = await admin.graphql(
      `#graphql
        query SettingsLocations {
          locations(first: 50) {
            nodes { id name }
          }
        }
      `,
    );
    const json = await response.json();
    return json.data?.locations?.nodes ?? [];
  } catch {
    return [];
  }
}

async function loadShopName(admin: AdminGraphql): Promise<string> {
  try {
    const response = await admin.graphql(
      `#graphql
        query SettingsShopName {
          shop { name }
        }
      `,
    );
    const json = await response.json();
    return String(json.data?.shop?.name ?? "").trim();
  } catch {
    return "";
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  try {
    let settings = await prisma.shopSettings.findUnique({ where: { shop } });

    if (!settings) {
      // New shop: shoppers see the vendor, so default to the store's own name
      // rather than the supplier's.
      const shopName = await loadShopName(admin);
      settings = await prisma.shopSettings.create({
        data: { shop, ...(shopName ? { vendor: shopName } : {}) },
      });
    }

    return data({
      apiKey: maskApiKey(settings.supplierApiKey),
      vendor: settings.vendor,
      compareAtRule: settings.compareAtPriceRule,
      compareAtMultiplier: settings.compareAtMultiplier,
      compareAtFixed: settings.compareAtFixed,
      defaultLocationId: settings.defaultLocationId,
      locations: await loadLocations(admin),
      titleTemplate: settings.titleTemplate,
      customImageTemplate: settings.customImageTemplate,
      customImageCount: settings.customImageCount,
      includeSupplierImages: settings.includeSupplierImages,
      autoSyncEnabled: settings.autoSyncEnabled,
      lastSyncAt: settings.lastSyncAt,
      lastSyncMessage: settings.lastSyncMessage,
      lastFetchTimestamp: settings.lastFetchAt,
    });
  } catch (err) {
    return data(
      { error: (err instanceof Error && err.message) || "Failed to get settings" },
      { status: 500 },
    );
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  const contentType = request.headers.get("content-type") || "";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loose form/JSON input, validated field by field below
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
  const updateData: Partial<
    Omit<Prisma.ShopSettingsUncheckedCreateInput, "shop" | "id">
  > = {};

  if ("apiKey" in body || "supplierApiKey" in body) {
    const rawKey = body.apiKey || body.supplierApiKey;
    // Only update if the key doesn't contain masked characters
    if (typeof rawKey === "string" && rawKey.trim() && !rawKey.includes("••••")) {
      updateData.supplierApiKey = encryptSecret(rawKey.trim());
      // The supplier's 15-minute limit is per API key: a new key starts with
      // a fresh window, so it can be fetched/tested right away.
      const current = await prisma.shopSettings.findUnique({
        where: { shop },
        select: { supplierApiKey: true },
      });
      if (decryptSecret(current?.supplierApiKey) !== rawKey.trim()) {
        updateData.lastFetchAt = null;
      }
    }
  }

  if ("vendor" in body) {
    const vendor = String(body.vendor ?? "").trim();
    if (vendor) updateData.vendor = vendor;
  }

  if ("compareAtRule" in body || "compareAtPriceRule" in body) {
    const rule = String(body.compareAtRule || body.compareAtPriceRule || "");
    if (["none", "multiply", "fixed"].includes(rule)) {
      updateData.compareAtPriceRule = rule;
    }
  }

  if ("compareAtMultiplier" in body) {
    const val = parseFloat(body.compareAtMultiplier);
    if (!isNaN(val) && val < 1) {
      return data(
        { error: "Compare-at multiplier must be 1 or higher, otherwise the 'was' price would be below the sale price." },
        { status: 400 },
      );
    }
    if (!isNaN(val)) {
      updateData.compareAtMultiplier = val;
    }
  }

  if ("compareAtFixed" in body) {
    const val = parseFloat(body.compareAtFixed);
    if (!isNaN(val) && val < 0) {
      return data(
        { error: "Compare-at amount cannot be negative." },
        { status: 400 },
      );
    }
    if (!isNaN(val)) {
      updateData.compareAtFixed = val;
    }
  }

  if ("defaultLocationId" in body) {
    updateData.defaultLocationId = String(body.defaultLocationId ?? "").trim();
  }

  if ("autoSyncEnabled" in body) {
    const v = body.autoSyncEnabled;
    updateData.autoSyncEnabled = v === true || v === "true" || v === "on" || v === "1";
  } else if (request.headers.get("content-type")?.includes("form") && "settingsForm" in body) {
    // Unchecked checkboxes are absent from form posts; the form marks itself.
    updateData.autoSyncEnabled = false;
  }

  if ("customImageTemplate" in body) {
    const t = String(body.customImageTemplate ?? "").trim();
    const problem = validateImageTemplate(t);
    if (problem) return data({ error: problem }, { status: 400 });
    updateData.customImageTemplate = t;
  }

  if ("customImageCount" in body) {
    const n = parseInt(String(body.customImageCount), 10);
    if (Number.isFinite(n) && n >= 1 && n <= 12) updateData.customImageCount = n;
  }

  if ("includeSupplierImages" in body) {
    const v = body.includeSupplierImages;
    updateData.includeSupplierImages = v === true || v === "true" || v === "on" || v === "1";
  } else if (request.headers.get("content-type")?.includes("form") && "settingsForm" in body) {
    updateData.includeSupplierImages = false;
  }

  if ("titleTemplate" in body) {
    const t = String(body.titleTemplate ?? "").trim();
    if (t) updateData.titleTemplate = t;
  }

  try {
    const settings = await prisma.shopSettings.upsert({
      where: { shop },
      create: { shop, ...updateData },
      update: updateData,
    });

    return data({
      apiKey: maskApiKey(settings.supplierApiKey),
      vendor: settings.vendor,
      compareAtRule: settings.compareAtPriceRule,
      compareAtMultiplier: settings.compareAtMultiplier,
      compareAtFixed: settings.compareAtFixed,
      defaultLocationId: settings.defaultLocationId,
      locations: await loadLocations(admin),
      titleTemplate: settings.titleTemplate,
      customImageTemplate: settings.customImageTemplate,
      customImageCount: settings.customImageCount,
      includeSupplierImages: settings.includeSupplierImages,
      autoSyncEnabled: settings.autoSyncEnabled,
      lastSyncAt: settings.lastSyncAt,
      lastSyncMessage: settings.lastSyncMessage,
      lastFetchTimestamp: settings.lastFetchAt,
    });
  } catch (err) {
    return data(
      { error: (err instanceof Error && err.message) || "Failed to save settings" },
      { status: 500 },
    );
  }
};
