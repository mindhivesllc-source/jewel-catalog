import { useEffect, useState } from "react";
import type {
  HeadersFunction,
} from "react-router";
import { useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

export default function SettingsPage() {
  const fetcher = useFetcher();
  const testFetcher = useFetcher();
  const shopify = useAppBridge();

  const isLoading =
    ["loading", "submitting"].includes(fetcher.state) &&
    fetcher.formMethod === "POST";
  const isTesting =
    ["loading", "submitting"].includes(testFetcher.state);

  const data = fetcher.data as {
    apiKey?: string;
    vendor?: string;
    compareAtRule?: string;
    compareAtMultiplier?: number;
    compareAtFixed?: number;
    defaultLocationId?: string;
    lastFetchTimestamp?: string;
    error?: string;
  } | null;

  const [compareAtRule, setCompareAtRule] = useState(data?.compareAtRule || "none");

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data == null) {
      fetcher.load("/api/settings");
    }
  }, [fetcher]);

  useEffect(() => {
    if (fetcher.data && !fetcher.data.error && fetcher.formMethod === "POST") {
      shopify.toast.show("Settings saved");
    }
    if (fetcher.data?.error) {
      shopify.toast.show(fetcher.data.error, { isError: true });
    }
  }, [fetcher.data, shopify]);

  useEffect(() => {
    if (data?.compareAtRule) {
      setCompareAtRule(data.compareAtRule);
    }
  }, [data?.compareAtRule]);

  useEffect(() => {
    if (testFetcher.data) {
      const result = testFetcher.data as { success?: boolean; error?: string };
      if (result.success) {
        shopify.toast.show("Connection successful");
      } else if (result.error) {
        shopify.toast.show(result.error, { isError: true });
      }
    }
  }, [testFetcher.data, shopify]);

  const testConnection = () => {
    testFetcher.load("/api/supplier/test");
  };

  return (
    <s-page heading="Settings">
      <s-section heading="Supplier Connection">
        <fetcher.Form method="post" action="/api/settings">
          <s-stack direction="block" gap="base">
            <s-password-field
              label="API Key"
              name="apiKey"
              value={data?.apiKey || ""}
              placeholder="Enter supplier API key"
            />

            <s-text-field
              label="Vendor Name"
              name="vendor"
              value={data?.vendor || ""}
              placeholder="e.g. StarGems"
            />
          </s-stack>

          <s-section heading="Pricing Rules">
            <s-stack direction="block" gap="base">
              <s-select
                label="Compare-at Price Rule"
                name="compareAtRule"
                value={compareAtRule}
                onChange={(e: Event) => {
                  const target = e.target as HTMLSelectElement;
                  setCompareAtRule(target.value);
                }}
              >
                <s-option value="none" selected={compareAtRule === "none"}>
                  None
                </s-option>
                <s-option value="multiply" selected={compareAtRule === "multiply"}>
                  Multiply
                </s-option>
                <s-option value="fixed" selected={compareAtRule === "fixed"}>
                  Fixed Markup
                </s-option>
              </s-select>

              {compareAtRule === "multiply" && (
                <s-number-field
                  label="Multiplier"
                  name="compareAtMultiplier"
                  value={data?.compareAtMultiplier?.toString() || "2.0"}
                  step="0.01"
                  min="1"
                />
              )}

              {compareAtRule === "fixed" && (
                <s-number-field
                  label="Fixed Markup Amount ($)"
                  name="compareAtFixed"
                  value={data?.compareAtFixed?.toString() || "100"}
                  step="0.01"
                  min="0"
                />
              )}
            </s-stack>
          </s-section>

          <s-section heading="Store Settings">
            <s-text-field
              label="Default Location ID"
              name="defaultLocationId"
              value={data?.defaultLocationId || ""}
              placeholder="Shopify location ID for inventory"
            />
          </s-section>

          {data?.lastFetchTimestamp && (
            <s-text color="subdued">
              Last supplier fetch:{" "}
              {new Date(data.lastFetchTimestamp).toLocaleString()}
            </s-text>
          )}

          {data?.error && (
            <s-banner tone="critical">
              <s-text>{data.error}</s-text>
            </s-banner>
          )}

          <s-stack direction="inline" gap="base">
            <s-button
              type="submit"
              tone="neutral"
              {...(isLoading ? { loading: true } : {})}
            >
              Save
            </s-button>
            <s-button
              type="button"
              variant="tertiary"
              onClick={testConnection}
              {...(isTesting ? { loading: true } : {})}
            >
              Test Connection
            </s-button>
          </s-stack>
        </fetcher.Form>
      </s-section>
    </s-page>
  );
}
