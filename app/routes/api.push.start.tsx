import { data, type ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { startPushJob } from "../services/push.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  try {
    const result = await startPushJob(shop, admin);

    if (result.jobId === 0) {
      return data({
        jobId: null,
        totalSelected: 0,
        started: false,
        message: "No selected products to push",
      });
    }

    console.log(
      `[push] Started job ${result.jobId} for shop ${shop} (${result.totalSelected} products)`,
    );

    return data({
      jobId: result.jobId,
      totalSelected: result.totalSelected,
      started: true,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    console.error(`[push] ERROR: ${message}`, err instanceof Error ? err.stack : err);
    const alreadyRunning = /already running/i.test(message);
    return data(
      {
        error: message || "Failed to start push",
        jobId: null,
        started: false,
      },
      { status: alreadyRunning ? 409 : 500 },
    );
  }
};
