import { data, type ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { pushSelectedProducts } from "../services/push.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  console.log(`[push] Starting push for shop: ${shop}`);

  try {
    const result = await pushSelectedProducts(shop, admin);

    console.log(
      `[push] Done — jobId=${result.jobId} pushed=${result.pushedCount} failed=${result.failedCount}`,
    );
    for (const r of result.results) {
      if (r.error) {
        console.error(
          `[push] FAILED ${r.stockNo}: ${r.error}`,
        );
      } else {
        console.log(
          `[push] ${r.action} ${r.stockNo} → ${r.shopifyProductTitle || r.shopifyProductId || "?"}`,
        );
      }
    }

    return data({
      jobId: result.jobId,
      pushedCount: result.pushedCount,
      failedCount: result.failedCount,
      results: result.results,
    });
  } catch (err: any) {
    console.error(`[push] ERROR: ${err.message}`, err.stack);
    return data(
      {
        error: err.message || "Failed to push products to Shopify",
        jobId: null,
        pushedCount: 0,
        failedCount: 0,
      },
      { status: 500 },
    );
  }
};
