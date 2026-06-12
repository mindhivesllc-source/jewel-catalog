import { useEffect, useState, useCallback, useRef } from "react";
import type {
  HeadersFunction,
} from "react-router";
import { useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

/* ── Types ─────────────────────────────────────────────────── */

interface Product {
  stockNo: string;
  jewelryType: string;
  category: string;
  metalType: string;
  shape: string;
  clarity: string;
  size: string;
  image1: string;
  diaWt: string;
  grossWt: string;
  subitem: string;
  price: number;
  selected: boolean;
  pushed: boolean;
}

interface CountsData {
  total: number;
  selected: number;
  pushed: number;
  notPushed: number;
  categories: string[];
  shapes: string[];
  metals: string[];
  styles: string[];
  sizes: string[];
  clarities: string[];
}

interface ProductsData {
  products: Product[];
  total: number;
  page: number;
  totalPages: number;
}

/* ── Constants ─────────────────────────────────────────────── */

const WEIGHT_RANGES = [
  { value: "", label: "All Weights", min: undefined as number | undefined, max: undefined as number | undefined },
  { value: "0-2", label: "0-2 Ct.", min: 0, max: 2 },
  { value: "2-4", label: "2-4 Ct.", min: 2, max: 4 },
  { value: "4-6", label: "4-6 Ct.", min: 4, max: 6 },
  { value: "6-8", label: "6-8 Ct.", min: 6, max: 8 },
  { value: "8-10", label: "8-10 Ct.", min: 8, max: 10 },
  { value: "10-15", label: "10-15 Ct.", min: 10, max: 15 },
  { value: "15-20", label: "15-20 Ct.", min: 15, max: 20 },
  { value: "20-25", label: "20-25 Ct.", min: 20, max: 25 },
  { value: "25+", label: "25+ Ct.", min: 25, max: undefined },
];

const SORT_OPTIONS = [
  { value: "newest", label: "Newest" },
  { value: "price_asc", label: "Price Low\u2192High" },
  { value: "price_desc", label: "Price High\u2192Low" },
  { value: "sku", label: "SKU" },
];

const PAGE_SIZE = 24;

/* ── Helpers ───────────────────────────────────────────────── */

function fmtPrice(n: number): string {
  if (n == null || isNaN(n)) return "0.00";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtNum(n: number, dec?: number): string {
  if (isNaN(n)) return "0.00";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: dec ?? 2,
    maximumFractionDigits: dec ?? 2,
  });
}

function countActiveFilters(filters: Record<string, string>): number {
  let n = 0;
  for (const key of Object.keys(filters)) {
    const v = filters[key];
    if (v && v !== "") n++;
  }
  return n;
}

function parseWeightRange(range: string): { min?: number; max?: number } | null {
  if (!range) return null;
  const found = WEIGHT_RANGES.find((w) => w.value === range);
  if (!found || found.value === "") return null;
  return { min: found.min, max: found.max };
}

/** Human-readable label for a filter key+value pair */
function filterLabel(key: string, value: string): string {
  const keyLabels: Record<string, string> = {
    shape: "Shape",
    metalType: "Metal",
    jewelryType: "Style",
    weightRange: "Weight",
    size: "Size",
    clarity: "Clarity",
  };
  const label = keyLabels[key] || key;
  if (key === "weightRange") {
    const found = WEIGHT_RANGES.find((w) => w.value === value);
    return found ? `Weight: ${found.label}` : `Weight: ${value}`;
  }
  return `${label}: ${value}`;
}

/* ── Inline Styles ─────────────────────────────────────────── */

const STYLES = {
  statsBar: {
    display: "flex",
    gap: "16px",
    alignItems: "center",
    flexWrap: "wrap",
    padding: "12px 0",
  } as React.CSSProperties,
  categoryTabs: {
    display: "flex",
    gap: "4px",
    borderBottom: "1px solid var(--p-border, #e1e3e5)",
    paddingBottom: "8px",
    marginBottom: "12px",
    overflowX: "auto",
  } as React.CSSProperties,
  categoryTab: (active: boolean): React.CSSProperties => ({
    padding: "8px 16px",
    borderRadius: "4px 4px 0 0",
    cursor: "pointer",
    fontWeight: active ? 600 : 400,
    color: active ? "var(--p-interactive, #2c6ecb)" : "var(--p-text, #202223)",
    borderBottom: active ? "2px solid var(--p-interactive, #2c6ecb)" : "2px solid transparent",
    background: active ? "var(--p-surface-hovered, #f1f1f1)" : "transparent",
    whiteSpace: "nowrap",
    transition: "all 0.15s",
  }),
  filterBar: {
    display: "flex",
    gap: "8px",
    alignItems: "center",
    flexWrap: "wrap",
    padding: "8px 0",
  } as React.CSSProperties,
  filterChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    padding: "2px 8px",
    borderRadius: "16px",
    background: "var(--p-surface-hovered, #f1f1f1)",
    fontSize: "12px",
    cursor: "pointer",
    border: "1px solid var(--p-border, #e1e3e5)",
  } as React.CSSProperties,
  productGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
    gap: "16px",
    padding: "12px 0",
  } as React.CSSProperties,
  productCard: {
    border: "1px solid var(--p-border, #e1e3e5)",
    borderRadius: "8px",
    overflow: "hidden",
    background: "var(--p-surface, #fff)",
    transition: "box-shadow 0.15s",
  } as React.CSSProperties,
  productImage: {
    width: "100%",
    height: "200px",
    objectFit: "cover",
    background: "var(--p-surface-subdued, #f6f6f7)",
  } as React.CSSProperties,
  productBody: {
    padding: "12px",
  } as React.CSSProperties,
  badgeRow: {
    display: "flex",
    gap: "4px",
    flexWrap: "wrap",
    marginTop: "4px",
  } as React.CSSProperties,
  pagination: {
    display: "flex",
    gap: "8px",
    alignItems: "center",
    justifyContent: "center",
    padding: "16px 0",
  } as React.CSSProperties,
};

/* ── Page Component ────────────────────────────────────────── */

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

export default function CatalogPage() {
  const shopify = useAppBridge();

  /* Fetchers */
  const countsFetcher = useFetcher<CountsData>();
  const productsFetcher = useFetcher<ProductsData>();
  const selectFetcher = useFetcher();
  const pushFetcher = useFetcher();
  const pushStatusFetcher = useFetcher();
  const fetchFetcher = useFetcher();

  /* ── State ──────────────────────────────────────────────── */
  const [view, setView] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("jewel-catalog-view") || "grid";
    }
    return "grid";
  });
  const [activeCategory, setActiveCategory] = useState("");
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [sort, setSort] = useState("newest");
  const [page, setPage] = useState(1);

  /* Pending filters (batch apply) — no inHand/onMemo */
  const [filters, setFilters] = useState({
    shape: "",
    metalType: "",
    jewelryType: "",
    weightRange: "",
    size: "",
    clarity: "",
  });

  /* Applied filters (what's actually sent to API) */
  const [appliedFilters, setAppliedFilters] = useState({ ...filters });

  /* Selections — Set of stockNos */
  const [selections, setSelections] = useState<Set<string>>(new Set());

  /* Did we ever fetch? */
  const [hasFetched, setHasFetched] = useState(false);

  /* Background push job being polled (null = no push running) */
  const [activePushJobId, setActivePushJobId] = useState<number | null>(null);
  const [pushProgress, setPushProgress] = useState<{
    pushed: number;
    failed: number;
    total: number;
  } | null>(null);

  /* ── Derived ────────────────────────────────────────────── */
  const counts: CountsData = countsFetcher.data || {
    total: 0,
    selected: 0,
    pushed: 0,
    notPushed: 0,
    categories: [],
    shapes: [],
    metals: [],
    styles: [],
    sizes: [],
    clarities: [],
  };
  const rawData = productsFetcher.data as ProductsData | null;
  const products: Product[] = Array.isArray(rawData?.products)
    ? rawData.products
    : [];
  const totalProducts = rawData?.total ?? 0;
  const totalPages = rawData?.totalPages ?? 1;

  const productsLoading =
    ["loading", "submitting"].includes(productsFetcher.state);
  const countsLoading =
    ["loading", "submitting"].includes(countsFetcher.state);
  const pushLoading =
    ["loading", "submitting"].includes(pushFetcher.state) ||
    activePushJobId !== null;
  const fetchLoading =
    ["loading", "submitting"].includes(fetchFetcher.state);
  const isAnyLoading = productsLoading || pushLoading || fetchLoading;

  const activeFilterCount = countActiveFilters(appliedFilters);

  /* ── Build query string for products ────────────────────── */
  const buildProductsUrl = useCallback(
    (override?: { cat?: string; searchStr?: string; p?: number }) => {
      const cat = override?.cat !== undefined ? override.cat : activeCategory;
      const s = override?.searchStr !== undefined ? override.searchStr : appliedSearch;
      const pg = override?.p ?? page;

      const params = new URLSearchParams();
      if (cat) params.set("category", cat);

      for (const [k, v] of Object.entries(appliedFilters)) {
        const vs = String(v);
        if (vs && vs !== "") {
          // Convert weightRange to diaWtMin/diaWtMax
          if (k === "weightRange") {
            const parsed = parseWeightRange(vs);
            if (parsed) {
              if (parsed.min !== undefined) params.set("diaWtMin", String(parsed.min));
              if (parsed.max !== undefined) params.set("diaWtMax", String(parsed.max));
            }
          } else {
            params.set(k, vs);
          }
        }
      }

      if (s) params.set("search", s);
      if (sort && sort !== "newest") params.set("sort", sort);
      params.set("page", String(pg));
      params.set("limit", String(PAGE_SIZE));
      return `/api/catalog/products?${params.toString()}`;
    },
    [activeCategory, appliedFilters, appliedSearch, sort, page]
  );

  /* ── Fetch on mount and when deps change ────────────────── */
  const prevBuildRef = useRef("");
  useEffect(() => {
    const url = buildProductsUrl();
    if (url !== prevBuildRef.current) {
      prevBuildRef.current = url;
      productsFetcher.load(url);
    }
  }, [buildProductsUrl]);

  useEffect(() => {
    if (countsFetcher.state === "idle" && countsFetcher.data == null) {
      countsFetcher.load("/api/catalog/counts");
    }
  }, [countsFetcher]);

  /* On mount, check whether a push is already running (e.g. page reload
     mid-push) and resume polling it */
  useEffect(() => {
    if (pushStatusFetcher.state === "idle" && pushStatusFetcher.data == null) {
      pushStatusFetcher.load("/api/push/status");
    }
  }, [pushStatusFetcher]);

  /* Adopt a running job reported by the status endpoint */
  useEffect(() => {
    if (activePushJobId !== null) return;
    const status = pushStatusFetcher.data as
      | {
          active?: {
            id: number;
            pushedCount: number;
            failedCount: number;
            totalSelected: number;
          } | null;
        }
      | undefined;
    if (status?.active) {
      setActivePushJobId(status.active.id);
      setPushProgress({
        pushed: status.active.pushedCount,
        failed: status.active.failedCount,
        total: status.active.totalSelected,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pushStatusFetcher.data]);

  /* Push now starts a background job — kick off polling when it begins */
  useEffect(() => {
    if (pushFetcher.data && pushFetcher.state === "idle") {
      const result = pushFetcher.data as {
        jobId?: number | null;
        totalSelected?: number;
        started?: boolean;
        message?: string;
        error?: string;
      };
      if (result.error) {
        shopify.toast.show(result.error, { isError: true });
      } else if (result.started && result.jobId) {
        setActivePushJobId(result.jobId);
        setPushProgress({
          pushed: 0,
          failed: 0,
          total: result.totalSelected || 0,
        });
        shopify.toast.show(
          `Pushing ${result.totalSelected} products to Shopify…`,
        );
      } else if (result.message) {
        shopify.toast.show(result.message);
      }
    }
  }, [pushFetcher.data, pushFetcher.state]);

  /* Poll job status while a push is running */
  useEffect(() => {
    if (activePushJobId === null) return;
    const interval = setInterval(() => {
      if (pushStatusFetcher.state === "idle") {
        pushStatusFetcher.load("/api/push/status");
      }
    }, 3000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePushJobId]);

  /* Handle poll results: update progress, detect completion */
  useEffect(() => {
    if (activePushJobId === null || !pushStatusFetcher.data) return;
    const status = pushStatusFetcher.data as {
      active?: {
        id: number;
        pushedCount: number;
        failedCount: number;
        totalSelected: number;
      } | null;
      recent?: {
        id: number;
        status: string;
        pushedCount: number;
        failedCount: number;
        totalSelected: number;
        errorMessage?: string | null;
      } | null;
    };

    if (status.active && status.active.id === activePushJobId) {
      setPushProgress({
        pushed: status.active.pushedCount,
        failed: status.active.failedCount,
        total: status.active.totalSelected,
      });
      return;
    }

    // Only conclude when the poll actually reports our job as the most
    // recent one — otherwise this is stale data from before the job started.
    const done =
      status.recent && status.recent.id === activePushJobId
        ? status.recent
        : null;
    if (!done) return;

    setActivePushJobId(null);
    setPushProgress(null);

    if (done.status === "FAILED" || done.failedCount > 0) {
      shopify.toast.show(
        `Pushed ${done.pushedCount} of ${done.totalSelected} products. ${done.failedCount} failed.` +
          (done.errorMessage ? ` ${done.errorMessage}` : ""),
        { isError: true },
      );
    } else {
      shopify.toast.show(`Pushed ${done.pushedCount} products to Shopify`);
    }

    // Clear selections and reload everything
    setSelections(new Set());
    countsFetcher.load("/api/catalog/counts");
    productsFetcher.load(buildProductsUrl());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pushStatusFetcher.data, activePushJobId]);

  /* Refresh products after fetch triggers */
  useEffect(() => {
    if (fetchFetcher.data && fetchFetcher.state === "idle") {
      const result = fetchFetcher.data as { success?: boolean; error?: string };
      if (result.success) {
        shopify.toast.show("Fetch completed");
        countsFetcher.load("/api/catalog/counts");
        productsFetcher.load(buildProductsUrl());
      } else if (result.error) {
        shopify.toast.show(result.error, { isError: true });
      }
    }
  }, [fetchFetcher.data, fetchFetcher.state]);

  /* Mark hasFetched */
  useEffect(() => {
    if (rawData && !hasFetched) setHasFetched(true);
  }, [rawData]);

  /* Sync selections from product data */
  useEffect(() => {
    if (products.length > 0) {
      setSelections((prev) => {
        const next = new Set(prev);
        for (const p of products) {
          if (p.selected) next.add(p.stockNo);
        }
        return next;
      });
    }
  }, [products]);

  /* ── Actions ────────────────────────────────────────────── */

  const handleFetchProducts = () => {
    fetchFetcher.submit(null, { method: "POST", action: "/api/catalog/fetch" });
  };

  const handleToggleSelect = (stockNo: string) => {
    const isSelected = !selections.has(stockNo);
    setSelections((prev) => {
      const next = new Set(prev);
      if (isSelected) next.add(stockNo);
      else next.delete(stockNo);
      return next;
    });
    const form = new FormData();
    form.set("stockNo", stockNo);
    form.set("selected", String(isSelected));
    selectFetcher.submit(form, {
      method: "POST",
      action: "/api/catalog/select",
    });
  };

  const handleSelectAll = () => {
    const stockNos = products.map((p) => p.stockNo);
    setSelections(new Set(stockNos));
    selectFetcher.submit(
      JSON.stringify({
        action: "selectAll",
        filters: { ...appliedFilters, category: activeCategory, search: appliedSearch, sort, page },
      }),
      {
        method: "POST",
        action: "/api/catalog/select-all",
        encType: "application/json",
      }
    );
  };

  const handleDeselectAll = () => {
    setSelections(new Set());
    selectFetcher.submit(
      JSON.stringify({ action: "deselectAll" }),
      {
        method: "POST",
        action: "/api/catalog/select-all",
        encType: "application/json",
      }
    );
  };

  const handlePush = () => {
    if (selections.size === 0) {
      shopify.toast.show("No products selected", { isError: true });
      return;
    }
    pushFetcher.submit(null, {
      method: "POST",
      action: "/api/push/start",
    });
  };

  const handleApplyFilters = () => {
    setAppliedFilters({ ...filters });
    setPage(1);
  };

  const handleClearFilters = () => {
    const empty = {
      shape: "",
      metalType: "",
      jewelryType: "",
      weightRange: "",
      size: "",
      clarity: "",
    };
    setFilters(empty);
    setAppliedFilters(empty);
    setActiveCategory("");
    setAppliedSearch("");
    setSearch("");
    setPage(1);
  };

  /** Remove a single applied filter chip */
  const handleRemoveFilter = (key: string) => {
    const next = { ...appliedFilters, [key]: "" };
    setFilters((prev) => ({ ...prev, [key]: "" }));
    setAppliedFilters(next);
    setPage(1);
  };

  const handleCategoryClick = (cat: string) => {
    const newCat = activeCategory === cat ? "" : cat;
    setActiveCategory(newCat);
    setPage(1);
  };

  /** s-search-field fires onChange with debounced value */
  const handleSearchChange = (e: Event) => {
    const value = (e.target as HTMLInputElement).value;
    setAppliedSearch(value);
    setSearch(value);
    setPage(1);
  };

  /** s-select uses onInput for selection changes */
  const handleFilterChange = (key: string) => (e: Event) => {
    const value = (e.target as HTMLSelectElement).value;
    setFilters((f) => ({ ...f, [key]: value }));
  };

  const handleSortChange = (e: Event) => {
    setSort((e.target as HTMLSelectElement).value);
    setPage(1);
  };

  const handleExport = () => {
    window.open("/api/catalog/export", "_blank");
  };

  const toggleView = (v: string) => {
    setView(v);
    if (typeof window !== "undefined") {
      localStorage.setItem("jewel-catalog-view", v);
    }
  };

  const setPageSafe = (p: number) => {
    if (p >= 1 && p <= totalPages) setPage(p);
  };

  /* ── Render helpers ─────────────────────────────────────── */

  const renderStatsBar = () => (
    <div style={STYLES.statsBar}>
      <s-text>
        Total: <s-text type="strong">{counts.total}</s-text>
      </s-text>
      <s-text>
        Available: <s-text type="strong">{counts.notPushed}</s-text>
      </s-text>
      <s-text>
        Selected: <s-text type="strong">{counts.selected}</s-text>
      </s-text>
      <s-text>
        Pushed: <s-text type="strong">{counts.pushed}</s-text>
      </s-text>
      <s-stack direction="inline" gap="base" style={{ marginLeft: "auto" }}>
        <s-button
          onClick={handleFetchProducts}
          {...(fetchLoading ? { loading: true } : { disabled: fetchLoading })}
        >
          Fetch
        </s-button>
        <s-button
          tone="neutral"
          onClick={handlePush}
          {...(pushLoading ? { loading: true } : { disabled: selections.size === 0 || pushLoading })}
        >
          {pushProgress
            ? `Pushing ${pushProgress.pushed + pushProgress.failed}/${pushProgress.total}…`
            : `Push${selections.size > 0 ? ` (${selections.size})` : ""} ▶`}
        </s-button>
      </s-stack>
    </div>
  );

  const renderCategoryTabs = () => {
    const cats = Array.isArray(counts.categories) ? counts.categories : [];
    if (cats.length === 0) return null;
    return (
      <div style={STYLES.categoryTabs}>
        <div
          style={STYLES.categoryTab(activeCategory === "")}
          onClick={() => handleCategoryClick("")}
        >
          All
        </div>
        {cats.map((cat) => (
          <div
            key={cat}
            style={STYLES.categoryTab(activeCategory === cat)}
            onClick={() => handleCategoryClick(cat)}
          >
            {cat}
          </div>
        ))}
      </div>
    );
  };

  const renderFilterBar = () => {
    const shapes = Array.isArray(counts.shapes) ? counts.shapes : [];
    const metals = Array.isArray(counts.metals) ? counts.metals : [];
    const styles = Array.isArray(counts.styles) ? counts.styles : [];
    const sizes = Array.isArray(counts.sizes) ? counts.sizes : [];
    const clarities = Array.isArray(counts.clarities) ? counts.clarities : [];

    return (
      <div style={STYLES.filterBar}>
        {/* Shape */}
        <s-select
          label="Shape"
          name="shape"
          value={filters.shape}
          onInput={handleFilterChange("shape")}
        >
          <s-option value="">All Shapes</s-option>
          {shapes.map((s) => (
            <s-option key={s} value={s}>{s}</s-option>
          ))}
        </s-select>

        {/* Metal */}
        <s-select
          label="Metal"
          name="metalType"
          value={filters.metalType}
          onInput={handleFilterChange("metalType")}
        >
          <s-option value="">All Metals</s-option>
          {metals.map((m) => (
            <s-option key={m} value={m}>{m}</s-option>
          ))}
        </s-select>

        {/* Style (jewelryType) */}
        <s-select
          label="Style"
          name="jewelryType"
          value={filters.jewelryType}
          onInput={handleFilterChange("jewelryType")}
        >
          <s-option value="">All Styles</s-option>
          {styles.map((s) => (
            <s-option key={s} value={s}>{s}</s-option>
          ))}
        </s-select>

        {/* Weight (static buckets) */}
        <s-select
          label="Weight"
          name="weightRange"
          value={filters.weightRange}
          onInput={handleFilterChange("weightRange")}
        >
          {WEIGHT_RANGES.map((w) => (
            <s-option key={w.value} value={w.value}>
              {w.label}
            </s-option>
          ))}
        </s-select>

        {/* Clarity */}
        <s-select
          label="Clarity"
          name="clarity"
          value={filters.clarity}
          onInput={handleFilterChange("clarity")}
        >
          <s-option value="">All Clarities</s-option>
          {clarities.map((c) => (
            <s-option key={c} value={c}>{c}</s-option>
          ))}
        </s-select>

        {/* Size */}
        <s-select
          label="Size"
          name="size"
          value={filters.size}
          onInput={handleFilterChange("size")}
        >
          <s-option value="">All Sizes</s-option>
          {sizes.map((s) => (
            <s-option key={s} value={s}>{s}</s-option>
          ))}
        </s-select>

        {/* Search */}
        <s-search-field
          label="Search"
          name="search"
          value={search}
          placeholder="Search by SKU or name..."
          onInput={(e: Event) => setSearch((e.target as HTMLInputElement).value)}
          onChange={handleSearchChange}
        />
      </div>
    );
  };

  const renderActiveFilterChips = () => {
    const active = Object.entries(appliedFilters).filter(
      ([, v]) => v && v !== ""
    );
    if (active.length === 0) return null;

    return (
      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", padding: "4px 0 8px 0" }}>
        <s-text color="subdued" style={{ fontSize: "12px", lineHeight: "24px" }}>
          Active filters:
        </s-text>
        {active.map(([key, value]) => (
          <div
            key={key}
            style={STYLES.filterChip}
            onClick={() => handleRemoveFilter(key)}
            title={`Remove ${filterLabel(key, value)}`}
          >
            <span>{filterLabel(key, value)}</span>
            <span style={{ fontWeight: 700, fontSize: "14px" }}>&times;</span>
          </div>
        ))}
        <div
          style={{ ...STYLES.filterChip, fontWeight: 600 }}
          onClick={handleClearFilters}
          title="Clear all filters"
        >
          Clear All
        </div>
      </div>
    );
  };

  const renderActionBar = () => (
    <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", padding: "8px 0" }}>
      <s-text color="subdued">{totalProducts.toLocaleString()} items</s-text>
      <s-button
        variant="tertiary"
        onClick={handleClearFilters}
        disabled={activeFilterCount === 0 && !activeCategory && !appliedSearch}
      >
        Clear
      </s-button>
      <s-button onClick={handleApplyFilters}>
        Apply{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
      </s-button>
      <s-select
        label="Sort"
        name="sort"
        value={sort}
        onInput={handleSortChange}
        style={{ marginLeft: "auto", width: "200px" }}
      >
        {SORT_OPTIONS.map((o) => (
          <s-option key={o.value} value={o.value}>
            {o.label}
          </s-option>
        ))}
      </s-select>
      <s-button-group>
        <s-button
          variant={view === "grid" ? "primary" : "tertiary"}
          onClick={() => toggleView("grid")}
        >
          &#9776; Grid
        </s-button>
        <s-button
          variant={view === "list" ? "primary" : "tertiary"}
          onClick={() => toggleView("list")}
        >
          &#9777; List
        </s-button>
      </s-button-group>
    </div>
  );

  const renderBulkActions = () => (
    <div style={{ display: "flex", gap: "8px", alignItems: "center", padding: "8px 0", flexWrap: "wrap" }}>
      <s-button variant="tertiary" onClick={handleSelectAll} disabled={isAnyLoading}>
        Select All
      </s-button>
      <s-button variant="tertiary" onClick={handleDeselectAll} disabled={isAnyLoading}>
        Deselect
      </s-button>
      <s-button
        tone="neutral"
        onClick={handlePush}
        disabled={selections.size === 0 || pushLoading}
        {...(pushLoading ? { loading: true } : {})}
      >
        {pushProgress
          ? `Pushing ${pushProgress.pushed + pushProgress.failed}/${pushProgress.total}…`
          : `Push (${selections.size}) ▶`}
      </s-button>
      <s-button variant="tertiary" onClick={handleExport} disabled={isAnyLoading}>
        Export CSV
      </s-button>
    </div>
  );

  const renderProductCard = (product: Product) => {
    const isSel = selections.has(product.stockNo);
    const nameParts = [product.jewelryType, product.category, product.metalType, product.shape]
      .filter(Boolean);
    return (
      <div key={product.stockNo} style={STYLES.productCard}>
        <div style={{ position: "relative" }}>
          <img
            src={product.image1 || ""}
            alt={"Product"}
            style={STYLES.productImage}
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
          <div style={{ position: "absolute", top: "8px", left: "8px", display: "flex", gap: "4px" }}>
            <label style={{ display: "flex", alignItems: "center", cursor: "pointer" }}>
              <s-checkbox
                name={`select-${product.stockNo}`}
                checked={isSel}
                onChange={() => handleToggleSelect(product.stockNo)}
              />
            </label>
          </div>
          <div style={{ position: "absolute", top: "8px", right: "8px", display: "flex", gap: "4px" }}>
            {product.pushed && (
              <s-badge tone="success">PUSHED</s-badge>
            )}
            {!product.pushed && product.selected && (
              <s-badge tone="caution">SELECTED</s-badge>
            )}
          </div>
        </div>
        <div style={STYLES.productBody}>
          <s-text type="strong" style={{ display: "block", marginBottom: "4px" }}>
            {nameParts.join(" ")}
          </s-text>
          <div style={STYLES.badgeRow}>
            {product.metalType && <s-badge tone="info">{product.metalType}</s-badge>}
            {product.shape && <s-badge tone="info">{product.shape}</s-badge>}
            {product.clarity && <s-badge tone="info">{product.clarity}</s-badge>}
          </div>
          <div style={{ marginTop: "8px" }}>
            {parseFloat(product.diaWt) > 0 && (
              <s-text color="subdued" style={{ display: "block" }}>
                DIA {fmtNum(parseFloat(product.diaWt))} CTS
              </s-text>
            )}
            <s-text color="subdued" style={{ display: "block" }}>
              Gross Weight {fmtNum(parseFloat(product.grossWt))}
            </s-text>
            <s-text
              fontVariantNumeric="tabular-nums"
              color="subdued"
              style={{ display: "block", fontFamily: "monospace", fontSize: "12px" }}
            >
              SKU: {product.subitem || product.stockNo}
            </s-text>
          </div>
          <div style={{ marginTop: "8px" }}>
            <s-text tone="success" type="strong">
              ${fmtPrice(product.price)}
            </s-text>
          </div>
        </div>
      </div>
    );
  };

  const renderListView = () => (
    <s-table>
      <s-table-header-row slot="head">
        <s-table-cell><s-text type="strong">Select</s-text></s-table-cell>
        <s-table-cell><s-text type="strong">Image</s-text></s-table-cell>
        <s-table-cell><s-text type="strong">SKU</s-text></s-table-cell>
        <s-table-cell><s-text type="strong">Name</s-text></s-table-cell>
        <s-table-cell><s-text type="strong">Category</s-text></s-table-cell>
        <s-table-cell><s-text type="strong">Metal</s-text></s-table-cell>
        <s-table-cell><s-text type="strong">Weight</s-text></s-table-cell>
        <s-table-cell><s-text type="strong">Size</s-text></s-table-cell>
        <s-table-cell><s-text type="strong">Price</s-text></s-table-cell>
        <s-table-cell><s-text type="strong">Status</s-text></s-table-cell>
      </s-table-header-row>
      {products.map((product) => {
        const isSel = selections.has(product.stockNo);
        return (
          <s-table-row key={product.stockNo}>
            <s-table-cell>
              <s-checkbox
                name={`sel-${product.stockNo}`}
                checked={isSel}
                onChange={() => handleToggleSelect(product.stockNo)}
              />
            </s-table-cell>
            <s-table-cell>
              <s-thumbnail
                src={product.image1 || ""}
                alt={"Product"}
                size="small-200"
              />
            </s-table-cell>
            <s-table-cell>
              <s-text fontVariantNumeric="tabular-nums" style={{ fontFamily: "monospace", fontSize: "12px" }}>
                {product.subitem || product.stockNo}
              </s-text>
            </s-table-cell>
            <s-table-cell>{[product.jewelryType, product.category, product.metalType, product.shape].filter(Boolean).join(" ")}</s-table-cell>
            <s-table-cell>{product.category}</s-table-cell>
            <s-table-cell>{product.metalType}</s-table-cell>
            <s-table-cell>{fmtNum(parseFloat(product.grossWt))}</s-table-cell>
            <s-table-cell>{product.size}</s-table-cell>
            <s-table-cell>
              <s-text tone="success" type="strong">${fmtPrice(product.price)}</s-text>
            </s-table-cell>
            <s-table-cell>
              {product.pushed ? (
                <s-badge tone="success">PUSHED</s-badge>
              ) : product.selected ? (
                <s-badge tone="caution">SELECTED</s-badge>
              ) : (
                <s-text color="subdued">\u2014</s-text>
              )}
            </s-table-cell>
          </s-table-row>
        );
      })}
    </s-table>
  );

  const renderPagination = () => (
    <div style={STYLES.pagination}>
      <s-button
        variant="tertiary"
        disabled={page <= 1 || isAnyLoading}
        onClick={() => setPageSafe(page - 1)}
      >
        &#9664; Previous
      </s-button>
      <s-text>
        Page {page} of {totalPages}
      </s-text>
      <s-button
        variant="tertiary"
        disabled={page >= totalPages || isAnyLoading}
        onClick={() => setPageSafe(page + 1)}
      >
        Next &#9654;
      </s-button>
    </div>
  );

  /* ── Main render ────────────────────────────────────────── */

  return (
    <s-page heading="Catalog">
      {/* Stats bar */}
      {renderStatsBar()}

      {/* Category tabs */}
      {renderCategoryTabs()}

      {/* Filter bar */}
      {renderFilterBar()}

      {/* Active filter chips */}
      {renderActiveFilterChips()}

      {/* Action bar */}
      {renderActionBar()}

      {/* Bulk actions */}
      {renderBulkActions()}

      {/* Push error */}
      {pushFetcher.data && (pushFetcher.data as { error?: string }).error && (
        <s-banner tone="critical" style={{ marginTop: "8px" }}>
          <s-text>{(pushFetcher.data as { error: string }).error}</s-text>
        </s-banner>
      )}

      {/* Product display area */}
      {productsLoading && (
        <s-section>
          <s-stack direction="block" gap="base">
            <s-spinner size="large" />
            <s-text color="subdued">Loading products...</s-text>
          </s-stack>
        </s-section>
      )}

      {!productsLoading && !hasFetched && (
        <s-section>
          <s-stack direction="block" gap="base">
            <s-text type="strong">Welcome to Jewel Catalog</s-text>
            <s-text color="subdued">
              Go to{" "}
              <a
                href="/app/settings"
                style={{
                  color: "var(--p-interactive, #2c6ecb)",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
                onClick={(e) => {
                  e.preventDefault();
                  window.location.href = "/app/settings";
                }}
              >
                Settings
              </a>{" "}
              to configure your supplier API key, then come back and click{" "}
              <s-text type="strong">Fetch</s-text> to load your catalog.
            </s-text>
          </s-stack>
        </s-section>
      )}

      {!productsLoading && hasFetched && products.length === 0 && (
        <s-section>
          <s-stack direction="block" gap="base">
            <s-text type="strong">No products match your filters</s-text>
            <s-text color="subdued">
              Try adjusting your filter criteria or clearing filters.
            </s-text>
          </s-stack>
        </s-section>
      )}

      {!productsLoading && products.length > 0 && view === "grid" && (
        <div style={STYLES.productGrid}>
          {products.map(renderProductCard)}
        </div>
      )}

      {!productsLoading && products.length > 0 && view === "list" && (
        renderListView()
      )}

      {/* Pagination */}
      {totalPages > 1 && renderPagination()}
    </s-page>
  );
}
