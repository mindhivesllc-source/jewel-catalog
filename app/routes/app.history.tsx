import { useEffect } from "react";
import type { HeadersFunction } from "react-router";
import { useFetcher } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

interface PushJob {
  id: number;
  status: string;
  totalSelected: number;
  pushedCount: number;
  failedCount: number;
  errorMessage?: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

const STATUS_MAP: Record<string, { label: string; tone: string }> = {
  COMPLETED: { label: "Completed", tone: "success" },
  FAILED: { label: "Failed", tone: "critical" },
  RUNNING: { label: "Running", tone: "caution" },
  PENDING: { label: "Pending", tone: "info" },
};

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : "—";
}

export default function HistoryPage() {
  const fetcher = useFetcher();

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data == null) {
      fetcher.load("/api/push/history");
    }
  }, [fetcher]);

  const data = fetcher.data as { jobs?: PushJob[] } | null;
  const jobs: PushJob[] = Array.isArray(data?.jobs) ? data.jobs : [];
  const isLoading = ["loading", "submitting"].includes(fetcher.state);

  if (isLoading && jobs.length === 0) {
    return (
      <s-page heading="Push History">
        <s-section>
          <s-stack direction="block" gap="base" alignment="center">
            <s-spinner size="large" />
            <s-text color="subdued">Loading history...</s-text>
          </s-stack>
        </s-section>
      </s-page>
    );
  }

  if (!isLoading && jobs.length === 0) {
    return (
      <s-page heading="Push History">
        <s-section>
          <s-stack direction="block" gap="loose" alignment="center">
            <s-text type="strong">No pushes yet</s-text>
            <s-text color="subdued">
              Push selected products to your Shopify store to see your push
              history here.
            </s-text>
          </s-stack>
        </s-section>
      </s-page>
    );
  }

  return (
    <s-page heading="Push History">
      <s-section>
        <s-table>
          <s-table-header-row slot="head">
            <s-table-cell>
              <s-text type="strong">Job ID</s-text>
            </s-table-cell>
            <s-table-cell>
              <s-text type="strong">Status</s-text>
            </s-table-cell>
            <s-table-cell>
              <s-text type="strong">Total</s-text>
            </s-table-cell>
            <s-table-cell>
              <s-text type="strong">Pushed</s-text>
            </s-table-cell>
            <s-table-cell>
              <s-text type="strong">Failed</s-text>
            </s-table-cell>
            <s-table-cell>
              <s-text type="strong">Error</s-text>
            </s-table-cell>
            <s-table-cell>
              <s-text type="strong">Started</s-text>
            </s-table-cell>
            <s-table-cell>
              <s-text type="strong">Completed</s-text>
            </s-table-cell>
          </s-table-header-row>

          {jobs.map((job) => {
            const statusMeta = STATUS_MAP[job.status] || {
              label: job.status,
              tone: "info",
            };

            return (
              <s-table-row key={job.id}>
                <s-table-cell>
                  <s-text fontVariantNumeric="tabular-nums">{job.id}</s-text>
                </s-table-cell>
                <s-table-cell>
                  <s-badge tone={statusMeta.tone}>{statusMeta.label}</s-badge>
                </s-table-cell>
                <s-table-cell>{job.totalSelected}</s-table-cell>
                <s-table-cell>{job.pushedCount}</s-table-cell>
                <s-table-cell>{job.failedCount}</s-table-cell>
                <s-table-cell>{job.errorMessage || "—"}</s-table-cell>
                <s-table-cell>{formatDate(job.startedAt)}</s-table-cell>
                <s-table-cell>{formatDate(job.completedAt)}</s-table-cell>
              </s-table-row>
            );
          })}
        </s-table>
      </s-section>
    </s-page>
  );
}
