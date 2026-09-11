import { data, type LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { buildPushPreview } from "../services/preview.server";

/** Dry run: what a push of the current selection would send. No Shopify calls. */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  try {
    const rows = await buildPushPreview(shop);
    const warningCount = rows.filter((r) => r.warnings.length > 0).length;
    return data({ success: true, rows, warningCount });
  } catch (err: any) {
    return data(
      { error: err.message || "Failed to build push preview" },
      { status: 500 },
    );
  }
};
