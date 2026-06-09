import { data, type ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { selectAllInView, deselectAll } from "../services/catalog.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const contentType = request.headers.get("content-type") || "";
  let body: any = {};

  if (contentType.includes("application/json")) {
    body = await request.json();
  } else {
    const formData = await request.formData();
    const actionType = formData.get("action")?.toString();
    body = { action: actionType };
  }

  const actionType = body.action;

  try {
    if (actionType === "selectAll") {
      const filters = body.filters || {};
      const result = await selectAllInView(shop, filters);
      return data({ selectedCount: result.count });
    } else if (actionType === "deselectAll") {
      const result = await deselectAll(shop);
      return data({ deselectedCount: result.count });
    } else {
      return data(
        { error: "Invalid action. Use 'selectAll' or 'deselectAll'." },
        { status: 400 },
      );
    }
  } catch (err: any) {
    return data(
      { error: err.message || "Failed to process select-all action" },
      { status: 500 },
    );
  }
};
