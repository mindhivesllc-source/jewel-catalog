import { data, type ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { setProductSelected } from "../services/catalog.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  let stockNo: string | undefined;
  let selected: boolean;

  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const body: any = await request.json();
    stockNo = body.stockNo;
    selected = body.selected === true || body.selected === "true";
  } else {
    const formData = await request.formData();
    stockNo = formData.get("stockNo")?.toString();
    const selectedRaw = formData.get("selected")?.toString();
    selected = selectedRaw === "true";
  }

  if (!stockNo) {
    return data(
      { error: "stockNo is required" },
      { status: 400 },
    );
  }

  try {
    await setProductSelected(shop, stockNo, selected);
    return data({ ok: true, stockNo, selected });
  } catch (err: any) {
    return data(
      { error: err.message || "Failed to update selection" },
      { status: 500 },
    );
  }
};
