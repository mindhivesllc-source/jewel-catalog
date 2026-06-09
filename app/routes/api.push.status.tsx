import { data, type LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  try {
    const [active, recent] = await Promise.all([
      prisma.pushJob.findFirst({
        where: { shop, status: "RUNNING" },
        orderBy: { startedAt: "desc" },
      }),
      prisma.pushJob.findFirst({
        where: { shop },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    return data({
      active,
      recent: active?.id === recent?.id ? null : recent,
    });
  } catch (err: any) {
    return data(
      { error: err.message || "Failed to get push status" },
      { status: 500 },
    );
  }
};
