import { data, type LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  customImageUrls,
  imageExists,
  validateImageTemplate,
} from "../services/images.server";

/** GET ?stockNo=X[&template=...&count=8] — which custom photo URLs exist. */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);

  const settings = await prisma.shopSettings.findUnique({ where: { shop } });
  const template = (url.searchParams.get("template") ?? settings?.customImageTemplate ?? "").trim();
  const count = Number(url.searchParams.get("count") ?? settings?.customImageCount ?? 8) || 8;
  let stockNo = (url.searchParams.get("stockNo") ?? "").trim();

  const problem = validateImageTemplate(template);
  if (problem) return data({ success: false, error: problem }, { status: 400 });
  if (!template) {
    return data({ success: false, error: "Enter the image URL pattern first." }, { status: 400 });
  }

  if (!stockNo) {
    const any = await prisma.supplierProduct.findFirst({
      where: { shop },
      orderBy: { stockNo: "asc" },
      select: { stockNo: true },
    });
    stockNo = any?.stockNo ?? "";
  }
  if (!stockNo) {
    return data({ success: false, error: "Fetch the catalog first, or enter a stock number." }, { status: 400 });
  }

  const urls = customImageUrls(template, count, stockNo);
  const found = await Promise.all(urls.map((u) => imageExists(u)));
  const results = urls.map((u, i) => ({ url: u, found: found[i] }));
  return data({
    success: true,
    stockNo,
    found: results.filter((r) => r.found).length,
    total: results.length,
    results,
  });
};
