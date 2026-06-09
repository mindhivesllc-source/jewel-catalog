import { data, type LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  try {
    const jobs = await prisma.pushJob.findMany({
      where: { shop },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    return data({ jobs });
  } catch (err: any) {
    return data(
      { error: err.message || "Failed to get push history" },
      { status: 500 },
    );
  }
};
