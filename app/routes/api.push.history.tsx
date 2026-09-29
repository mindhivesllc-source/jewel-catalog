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

    // Warnings (drafted products, skipped photos/stock) and errors, so the
    // merchant sees exactly which products need attention.
    const issues = await prisma.pushLog.findMany({
      where: {
        shop,
        jobId: { in: jobs.map((j) => j.id) },
        level: { in: ["warn", "error"] },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        jobId: true,
        level: true,
        stockNo: true,
        message: true,
        createdAt: true,
      },
    });

    return data({ success: true, jobs, issues });
  } catch (err) {
    return data(
      {
        success: false,
        error: err instanceof Error ? err.message : "Failed to get push history",
      },
      { status: 500 },
    );
  }
};
