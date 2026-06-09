import { data, type ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { pushSelectedProducts } from "../services/push.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  try {
    const result = await pushSelectedProducts(shop, admin);

    return data({
      jobId: result.jobId,
      pushedCount: result.pushedCount,
      failedCount: result.failedCount,
      results: result.results,
    });
  } catch (err: any) {
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
