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
  name: string;
  jewelryType: string;
  category: string;
  metalType: string;
  shape: string;
  clarity: string;
  size: string;
  image1: string;
  diaCts: number;
  grossWeight: number;
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
}

interface ProductsData {
  products: Product[];
  total: number;
  page: number;
  totalPages: number;
}

/* ── Constants ─────────────────────────────────────────────── */

const WEIGHT_RANGES = [
  { value: "", label: "All Weights" },
  { value: "0-2", label: "0-2 Ct." },
  { value: "2-4", label: "2-4 Ct." },
  { value: "4-6", label: "4-6 Ct." },
  { value: "6-8", label: "6-8 Ct." },
  { value: "8-10", label: "8-10 Ct." },
  { value: "10-15", label: "10-15 Ct." },
  { value: "15-20", label: "15-20 Ct." },
  { value: "20-25", label: "20-25 Ct." },
  { value: "25+", label: "25+ Ct." },
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
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtNum(n: number, dec?: number): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: dec ?? 2,
    maximumFractionDigits: dec ?? 2,
  });
}

function countActiveFilters(filters: Record<string, string | boolean>): number {
  let n = 0;
  for (const key of Object.keys(filters)) {
    const v = filters[key];
    const sv = String(v);
    if (sv && sv !== "" && sv !== "false") n++;
  }
  return n;
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

  /* Pending filters (batch apply) */
  const [filters, setFilters] = useState({
    shape: "",
    metalType: "",
    jewelryType: "",
    weightRange: "",
    size: "",
    clarity: "",
    inHand: false,
    onMemo: false,
  });

  /* Applied filters (what's actually sent to API) */
  const [appliedFilters, setAppliedFilters] = useState({ ...filters });

  /* Selections — Set of stockNos */
  const [selections, setSelections] = useState<Set<string>>(new Set());

  /* Did we ever fetch? */
  const [hasFetched, setHasFetched] = useState(false);

  /* ── Derived ────────────────────────────────────────────── */
  const counts: CountsData = countsFetcher.data || {
    total: 0,
    selected: 0,
    pushed: 0,
    notPushed: 0,
    categories: [],
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
    ["loading", "submitting"].includes(pushFetcher.state);
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
        if (vs && vs !== "" && vs !== "false") params.set(k, vs);
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

  /* Refresh counts after push */
  useEffect(() => {
    if (pushFetcher.data && pushFetcher.state === "idle") {
      const result = pushFetcher.data as { success?: boolean; error?: string };
      if (result.success) {
        shopify.toast.show("Push started successfully");
        countsFetcher.load("/api/catalog/counts");
      } else if (result.error) {
        shopify.toast.show(result.error, { isError: true });
      }
    }
  }, [pushFetcher.data, pushFetcher.state]);

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
      inHand: false,
      onMemo: false,
    };
    setFilters(empty);
    setAppliedFilters(empty);
    setActiveCategory("");
    setAppliedSearch("");
    setSearch("");
    setPage(1);
  };

  const handleCategoryClick = (cat: string) => {
    const newCat = activeCategory === cat ? "" : cat;
    setActiveCategory(newCat);
    setPage(1);
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(e.target.value);
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      setAppliedSearch(search);
      setPage(1);
    }
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
          Fetch Products
        </s-button>
        <s-button
          tone="neutral"
          onClick={handlePush}
          {...(pushLoading ? { loading: true } : { disabled: selections.size === 0 || pushLoading })}
        >
          Push {selections.size > 0 ? selections.size : ""} to Store
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

  const renderFilterBar = () => (
    <div>
      <div style={STYLES.filterBar}>
        <s-select
          label="Shape"
          name="shape"
          value={filters.shape}
          onChange={(e: Event) =>
            setFilters((f) => ({
              ...f,
              shape: (e.target as HTMLSelectElement).value,
            }))
          }
        >
          <s-option value="">All Shapes</s-option>
          {["Round", "Oval", "Pear", "Marquise", "Emerald", "Princess", "Cushion", "Radiant", "Heart"].map((s) => (
            <s-option key={s} value={s} selected={filters.shape === s}>{s}</s-option>
          ))}
        </s-select>

        <s-select
          label="Metal"
          name="metalType"
          value={filters.metalType}
          onChange={(e: Event) =>
            setFilters((f) => ({
              ...f,
              metalType: (e.target as HTMLSelectElement).value,
            }))
          }
        >
          <s-option value="">All Metals</s-option>
          {["White Gold", "Yellow Gold", "Rose Gold", "Platinum", "Silver"].map((m) => (
            <s-option key={m} value={m} selected={filters.metalType === m}>{m}</s-option>
          ))}
        </s-select>

        <s-select
          label="Style"
          name="jewelryType"
          value={filters.jewelryType}
          onChange={(e: Event) =>
            setFilters((f) => ({
              ...f,
              jewelryType: (e.target as HTMLSelectElement).value,
            }))
          }
        >
          <s-option value="">All Styles</s-option>
          {["Ring", "Earring", "Pendant", "Bracelet", "Necklace"].map((j) => (
            <s-option key={j} value={j} selected={filters.jewelryType === j}>{j}</s-option>
          ))}
        </s-select>

        <s-select
          label="Weight"
          name="weightRange"
          value={filters.weightRange}
          onChange={(e: Event) =>
            setFilters((f) => ({
              ...f,
              weightRange: (e.target as HTMLSelectElement).value,
            }))
          }
        >
          {WEIGHT_RANGES.map((w) => (
            <s-option
              key={w.value}
              value={w.value}
              selected={filters.weightRange === w.value}
            >
              {w.label}
            </s-option>
          ))}
        </s-select>

        <s-select
          label="Clarity"
          name="clarity"
          value={filters.clarity}
          onChange={(e: Event) =>
            setFilters((f) => ({
              ...f,
              clarity: (e.target as HTMLSelectElement).value,
            }))
          }
        >
          <s-option value="">All Clarities</s-option>
          {["IF", "VVS1", "VVS2", "VS1", "VS2", "SI1", "SI2", "I1"].map((c) => (
            <s-option key={c} value={c} selected={filters.clarity === c}>{c}</s-option>
          ))}
        </s-select>
      </div>

      <div style={STYLES.filterBar}>
        <s-select
          label="Size"
          name="size"
          value={filters.size}
          onChange={(e: Event) =>
            setFilters((f) => ({
              ...f,
              size: (e.target as HTMLSelectElement).value,
            }))
          }
        >
          <s-option value="">All Sizes</s-option>
          {["4", "4.5", "5", "5.5", "6", "6.5", "7", "7.5", "8", "8.5", "9", "9.5", "10"].map((s) => (
            <s-option key={s} value={s} selected={filters.size === s}>{s}</s-option>
          ))}
        </s-select>

        <label style={{ display: "flex", alignItems: "center", gap: "4px", cursor: "pointer" }}>
          <s-checkbox
            name="inHand"
            checked={filters.inHand}
            onChange={(e: Event) =>
              setFilters((f) => ({
                ...f,
                inHand: (e.target as HTMLInputElement).checked,
              }))
            }
          />
          <s-text>In Hand</s-text>
        </label>

        <label style={{ display: "flex", alignItems: "center", gap: "4px", cursor: "pointer" }}>
          <s-checkbox
            name="onMemo"
            checked={filters.onMemo}
            onChange={(e: Event) =>
              setFilters((f) => ({
                ...f,
                onMemo: (e.target as HTMLInputElement).checked,
              }))
            }
          />
          <s-text>On Memo</s-text>
        </label>

        <s-search-field
          label="Search"
          name="search"
          value={search}
          placeholder="Search by SKU or name..."
          onInput={(e: Event) =>
            setSearch((e.target as HTMLInputElement).value)
          }
          onChange={(e: Event) => {
            setSearch((e.target as HTMLInputElement).value);
          }}
          onKeyDown={handleSearchKeyDown}
        />
      </div>
    </div>
  );

  const renderActionBar = () => (
    <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", padding: "8px 0" }}>
      <s-text color="subdued">{totalProducts} items</s-text>
      <s-button
        variant="tertiary"
        onClick={handleClearFilters}
        disabled={activeFilterCount === 0 && !activeCategory && !appliedSearch}
      >
        Clear Filter
      </s-button>
      <s-button onClick={handleApplyFilters}>
        Apply Filter
        {activeFilterCount > 0 && (
          <> ({activeFilterCount})</>
        )}
      </s-button>
      <s-select
        label="Sort"
        name="sort"
        value={sort}
        onChange={handleSortChange}
        style={{ marginLeft: "auto", width: "200px" }}
      >
        {SORT_OPTIONS.map((o) => (
          <s-option key={o.value} value={o.value} selected={sort === o.value}>
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
        Select All Visible
      </s-button>
      <s-button variant="tertiary" onClick={handleDeselectAll} disabled={isAnyLoading}>
        Deselect All
      </s-button>
      <s-button
        tone="neutral"
        onClick={handlePush}
        disabled={selections.size === 0 || pushLoading}
        {...(pushLoading ? { loading: true } : {})}
      >
        Push Selected ({selections.size}) &#9654;
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
            alt={product.name || "Product"}
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
            {product.diaCts > 0 && (
              <s-text color="subdued" style={{ display: "block" }}>
                DIA {fmtNum(product.diaCts)} CTS
              </s-text>
            )}
            <s-text color="subdued" style={{ display: "block" }}>
              Gross Weight {fmtNum(product.grossWeight)}
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
                alt={product.name || "Product"}
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
            <s-table-cell>{fmtNum(product.grossWeight)}</s-table-cell>
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
        Previous
      </s-button>
      <s-text>
        Page {page} of {totalPages}
      </s-text>
      <s-button
        variant="tertiary"
        disabled={page >= totalPages || isAnyLoading}
        onClick={() => setPageSafe(page + 1)}
      >
        Next
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
              Click <s-text type="strong">Fetch Products</s-text> to load your
              supplier inventory.
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
