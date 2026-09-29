import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

// Mandatory privacy webhooks. The app stores no customer data, so the
// customer topics only need acknowledging; shop/redact erases the shop.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  if (topic === "SHOP_REDACT") {
    await db.$transaction([
      db.pushLog.deleteMany({ where: { shop } }),
      db.pushJob.deleteMany({ where: { shop } }),
      db.shopifyProductMapping.deleteMany({ where: { shop } }),
      db.shopCollection.deleteMany({ where: { shop } }),
      db.categoryPricingRule.deleteMany({ where: { shop } }),
      db.supplierProduct.deleteMany({ where: { shop } }),
      db.shopSettings.deleteMany({ where: { shop } }),
      db.session.deleteMany({ where: { shop } }),
    ]);
  }

  return new Response();
};
