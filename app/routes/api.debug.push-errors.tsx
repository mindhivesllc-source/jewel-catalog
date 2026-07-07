import { data, type LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const jobs = await prisma.pushJob.findMany({
    where: { shop },
    orderBy: { id: "desc" },
    take: 10,
  });

  const jobIds = jobs.map((job) => job.id);

  const logs = await prisma.pushLog.findMany({
    where: {
      shop,
      jobId: { in: jobIds },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return data({
    latestJobs: jobs.map((job) => ({
      id: job.id,
      status: job.status,
      totalSelected: job.totalSelected,
      pushedCount: job.pushedCount,
      failedCount: job.failedCount,
      errorMessage: job.errorMessage,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
    })),
    logs: logs.map((log) => ({
      id: log.id,
      jobId: log.jobId,
      level: log.level,
      stockNo: log.stockNo,
      message: log.message,
      createdAt: log.createdAt,
    })),
  });
};