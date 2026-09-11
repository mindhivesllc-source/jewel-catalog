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

interface PricingRuleRow {
  category: string;
  markupType: "percent" | "fixed";
  markupValue: number;
  roundTo: "none" | "0.99" | "whole";
}

/* ── Markup by category ─────────────────────────────────────── */

function MarkupRulesSection() {
  const rulesFetcher = useFetcher();
  const shopify = useAppBridge();
  const [rows, setRows] = useState<PricingRuleRow[]>([]);
  const [categories, setCategories] = useState<string[]>([]);

  useEffect(() => {
    if (rulesFetcher.state === "idle" && rulesFetcher.data == null) {
      rulesFetcher.load("/api/pricing-rules");
    }
  }, [rulesFetcher]);

  useEffect(() => {
    if (rulesFetcher.state !== "idle" || !rulesFetcher.data) return;
    const d = rulesFetcher.data as {
      success?: boolean;
      categories?: string[];
      rules?: PricingRuleRow[];
      error?: string;
    };
    if (d.error) {
      shopify.toast.show(d.error, { isError: true });
      return;
    }
    if (d.success) {
      setCategories(d.categories ?? []);
      // One editable row per category; missing rule = 0% markup (no change).
      const byCat = new Map((d.rules ?? []).map((r) => [r.category, r]));
      setRows(
        (d.categories ?? []).map(
          (c) =>
            byCat.get(c) ?? { category: c, markupType: "percent", markupValue: 0, roundTo: "none" },
        ),
      );
      if (rulesFetcher.formMethod === "POST") shopify.toast.show("Markup rules saved");
    }
  }, [rulesFetcher.data, rulesFetcher.state, rulesFetcher.formMethod, shopify]);

  const update = (category: string, patch: Partial<PricingRuleRow>) =>
    setRows((prev) => prev.map((r) => (r.category === category ? { ...r, ...patch } : r)));

  const save = () => {
    // Rows with 0 markup and no rounding are "no rule" — don't store them.
    const rules = rows.filter((r) => r.markupValue !== 0 || r.roundTo !== "none");
    rulesFetcher.submit(JSON.stringify({ rules }), {
      method: "POST",
      action: "/api/pricing-rules",
      encType: "application/json",
    });
  };

  const saving = rulesFetcher.state !== "idle" && rulesFetcher.formMethod === "POST";

  return (
    <s-section heading="Markup by category">
      <s-stack direction="block" gap="base">
        <s-text color="subdued">
          Sell price = supplier price + markup, then rounded. Compare-at rules apply on top of
          the sell price. "All other categories" is the default when a category has no row.
        </s-text>
        {categories.length === 0 && (
          <s-text color="subdued">Fetch the catalog first to see categories.</s-text>
        )}
        {rows.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <s-table>
              <s-table-header-row slot="head">
                <s-table-cell><s-text type="strong">Category</s-text></s-table-cell>
                <s-table-cell><s-text type="strong">Markup</s-text></s-table-cell>
                <s-table-cell><s-text type="strong">Value</s-text></s-table-cell>
                <s-table-cell><s-text type="strong">Rounding</s-text></s-table-cell>
              </s-table-header-row>
              {rows.map((r) => (
                <s-table-row key={r.category}>
                  <s-table-cell>
                    <s-text type={r.category === "*" ? "strong" : undefined}>
                      {r.category === "*" ? "All other categories" : r.category}
                    </s-text>
                  </s-table-cell>
                  <s-table-cell>
                    <s-select
                      label="Markup type"
                      labelAccessibilityVisibility="exclusive"
                      value={r.markupType}
                      onChange={(e: Event) =>
                        update(r.category, {
                          markupType: (e.target as HTMLSelectElement).value as PricingRuleRow["markupType"],
                        })
                      }
                    >
                      <s-option value="percent" selected={r.markupType === "percent"}>Percent %</s-option>
                      <s-option value="fixed" selected={r.markupType === "fixed"}>Fixed $</s-option>
                    </s-select>
                  </s-table-cell>
                  <s-table-cell>
                    <s-number-field
                      label="Markup value"
                      labelAccessibilityVisibility="exclusive"
                      value={String(r.markupValue)}
                      step="0.01"
                      onChange={(e: Event) =>
                        update(r.category, {
                          markupValue: parseFloat((e.target as HTMLInputElement).value) || 0,
                        })
                      }
                    />
                  </s-table-cell>
                  <s-table-cell>
                    <s-select
                      label="Rounding"
                      labelAccessibilityVisibility="exclusive"
                      value={r.roundTo}
                      onChange={(e: Event) =>
                        update(r.category, {
                          roundTo: (e.target as HTMLSelectElement).value as PricingRuleRow["roundTo"],
                        })
                      }
                    >
                      <s-option value="none" selected={r.roundTo === "none"}>None</s-option>
                      <s-option value="0.99" selected={r.roundTo === "0.99"}>Up to .99</s-option>
                      <s-option value="whole" selected={r.roundTo === "whole"}>Up to whole $</s-option>
                    </s-select>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table>
          </div>
        )}
        <s-stack direction="inline" gap="base">
          <s-button
            type="button"
            onClick={save}
            {...(rows.length === 0 ? { disabled: true } : {})}
            {...(saving ? { loading: true } : {})}
          >
            Save markup rules
          </s-button>
        </s-stack>
      </s-stack>
    </s-section>
  );
}

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

      <MarkupRulesSection />
    </s-page>
  );
}
