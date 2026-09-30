/**
 * LGD USA Supplier API client.
 *
 * Docs:      https://documenter.getpostman.com/view/2945489/2sA3Qs8r8b
 * Base URL:  https://api.lgdusallc.com/api/v1/inventory
 *            (override with SUPPLIER_API_BASE_URL, comma-separated list)
 * Endpoint:  GET /jewelry?type=all&page={page}&key={apiKey}
 * The old /developer-api endpoint is deprecated by the supplier.
 * Rate limit: 1 request per 15 minutes.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface SupplierItem {
  Stock_No: string;
  Subitem: string;
  Category: string;
  Jewelry_Type: string;
  Metal_Type: string;
  Casting_Wt: string;
  Shape: string;
  Color: string;
  Clarity: string;
  Dia_Pcs: string;
  Dia_Wt: string;
  Gross_Wt: string;
  Growth_Type: string;
  Size: string;
  Certificate: string;
  Inhand_Pcs: string;
  Memo_Out: string;
  Price: string;
  Remarks: string;
  Image_1: string;
  Image_2: string;
  Video_1: string;
}

export interface SupplierApiResponse {
  Stock: SupplierItem[];
  page_no: string;
  total_page: number;
  /** Total items across all pages, when the API reports it. */
  total_results?: number;
}

/** Some versions of the API nest items under "data" instead of "Stock". */
type FlexibleResponse =
  | { data: SupplierItem[]; page_no?: string; total_page?: number }
  | { Stock: SupplierItem[]; page_no?: string; total_page?: number };

// ── Constants ────────────────────────────────────────────────────────────────

// Tried in order. The next host is used only when the previous one cannot be
// reached at all (TLS/DNS/timeout) or no longer serves the API (HTTP 404) —
// cases where the supplier's rate-limit window was not consumed.
const DEFAULT_BASE_URLS = ["https://api.lgdusallc.com/api/v1/inventory"];

function baseUrls(): string[] {
  const configured = (process.env.SUPPLIER_API_BASE_URL || "")
    .split(",")
    .map((u) => u.trim().replace(/\/+$/, ""))
    .filter((u) => /^https:\/\//i.test(u));
  return configured.length ? configured : DEFAULT_BASE_URLS;
}

/** The host answered, but the API is not there (moved / vhost misconfigured). */
class SupplierApiMissingError extends Error {}

/** The request never reached the supplier API (DNS, TLS, timeout, refused). */
export class SupplierUnreachableError extends Error {
  constructor(cause: unknown) {
    const inner = (cause as { cause?: { code?: string; message?: string } })?.cause;
    const code = inner?.code || inner?.message || (cause instanceof Error ? cause.name : "");
    const reason = /CERT|TLS|SSL/i.test(code)
      ? "its HTTPS certificate is invalid"
      : /Timeout|Abort/i.test(code)
        ? "it did not respond in time"
        : "the connection failed";
    super(
      `Could not reach the supplier API (api.lgdusallc.com): ${reason}${code ? ` [${code}]` : ""}. This is a problem on the supplier's side — please contact LGD USA.`,
    );
    this.name = "SupplierUnreachableError";
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Type guard that validates a raw JSON response looks like a supplier payload.
 * Handles both "data" and "Stock" keys and detects rate-limit messages.
 */
function isValidResponse(
  raw: unknown,
): raw is FlexibleResponse & { page_no: string; total_page: number } {
  if (!raw || typeof raw !== "object") return false;

  const obj = raw as Record<string, unknown>;

  // e.g. {"error":"This API is deprecated. ...","documentation":"..."}
  if (typeof obj.error === "string" && obj.error.trim()) {
    throw new Error(`Supplier API error: ${obj.error.trim()}`);
  }

  // The supplier reports problems inside a 200 response, as "Message" or
  // "message", e.g. {"data":[],"message":"Please Enter Correct API KEY","status":0}
  const rawMessage = obj.Message ?? obj.message;
  const message = typeof rawMessage === "string" ? rawMessage.trim() : "";
  if (message.toLowerCase().includes("limit")) {
    throw new Error(
      "Rate limit reached on supplier API (1 request per 15 min). Please wait before trying again.",
    );
  }

  // Accept either "data" or "Stock" as the items array
  const items = obj.data ?? obj.Stock;
  if (!Array.isArray(items)) return false;

  // An error answer must never pass as "the catalog is empty": auto-sync
  // would then set the stock of every product in the store to 0.
  if (items.length === 0 && (message || obj.status === 0 || obj.status === "0")) {
    throw new Error(
      /api key/i.test(message)
        ? "The supplier rejected the API key. Check the key in Settings."
        : `Supplier API error: ${message || "request was not successful"}`,
    );
  }

  const pageNo = obj.page_no ?? "1";
  const totalPage = obj.total_page ?? 1;

  // Normalise the object into a predictable shape for the caller
  const normalised = obj as unknown as Record<string, unknown>;
  normalised["Stock"] = items;
  normalised["page_no"] = String(pageNo);
  normalised["total_page"] = Number(totalPage);
  const totalResults = Number(obj.total_results);
  normalised["total_results"] = Number.isFinite(totalResults) && totalResults > 0
    ? totalResults
    : undefined;

  return true;
}

// ── API functions ────────────────────────────────────────────────────────────

/**
 * Fetch a single page of supplier products.
 * Returns the raw SupplierApiResponse or throws on error / rate-limit.
 */
export async function fetchSupplierPage(
  apiKey: string,
  page = 1,
  signal?: AbortSignal,
): Promise<SupplierApiResponse> {
  let lastError: unknown;
  for (const baseUrl of baseUrls()) {
    try {
      return await fetchSupplierPageFrom(baseUrl, apiKey, page, signal);
    } catch (err) {
      const tryNextHost =
        err instanceof SupplierUnreachableError ||
        err instanceof SupplierApiMissingError;
      if (!tryNextHost) throw err;
      console.warn(
        `[supplier] ${new URL(baseUrl).host} unavailable: ${err.message}`,
      );
      lastError = err;
    }
  }
  throw lastError instanceof SupplierUnreachableError
    ? lastError
    : new SupplierUnreachableError(lastError);
}

async function fetchSupplierPageFrom(
  baseUrl: string,
  apiKey: string,
  page: number,
  signal?: AbortSignal,
): Promise<SupplierApiResponse> {
  const url = `${baseUrl}/jewelry?type=all&page=${page}&key=${encodeURIComponent(apiKey)}`;

  // The supplier can hang; never let a fetch block the sync lock forever.
  const timeout = AbortSignal.timeout(90_000);
  let res: Response;
  try {
    res = await fetch(url, {
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (err) {
    throw new SupplierUnreachableError(err);
  }

  if (res.status === 404) {
    throw new SupplierApiMissingError(`HTTP 404 for the API path`);
  }

  if (!res.ok) {
    throw new Error(
      `Supplier API returned HTTP ${res.status} ${res.statusText} for page ${page}`,
    );
  }

  const json: unknown = await res.json();

  if (!isValidResponse(json)) {
    throw new Error(
      `Unexpected response shape from supplier API on page ${page}`,
    );
  }

  return json as unknown as SupplierApiResponse;
}

/**
 * Fetch every page from the supplier API, returning all items in one flat array.
 * Respects the AbortSignal so callers can cancel mid-fetch.
 */
export interface SupplierFetchResult {
  items: SupplierItem[];
  totalPages: number;
  fetchedPages: number;
  /** Item count the supplier reported (undefined when it does not say). */
  totalResults?: number;
  /** Set when a later page failed (e.g. rate limit) and the result is partial. */
  warning?: string;
}

export async function fetchAllSupplierProducts(
  apiKey: string,
  signal?: AbortSignal,
): Promise<SupplierFetchResult> {
  const allItems: SupplierItem[] = [];
  let page = 1;
  let totalPages = 1;
  let fetchedPages = 0;
  let totalResults: number | undefined;
  let warning: string | undefined;

  do {
    try {
      const pageResp = await fetchSupplierPage(apiKey, page, signal);
      allItems.push(...pageResp.Stock);
      totalPages = pageResp.total_page;
      totalResults = pageResp.total_results ?? totalResults;
      fetchedPages++;
      page++;
    } catch (err) {
      // Page 1 failing means nothing usable — propagate. A later page failing
      // (the supplier allows 1 request / 15 min) must not throw away the
      // pages already downloaded: store them and tell the merchant.
      if (page === 1) throw err;
      const message = err instanceof Error ? err.message : String(err);
      warning = `Fetched ${fetchedPages} of ${totalPages} supplier pages; page ${page} failed (${message}). Fetch again in 15 minutes to complete the catalog.`;
      break;
    }
  } while (page <= totalPages);

  // Duplicate stock numbers inside one feed would upsert twice; keep the last.
  const byStockNo = new Map<string, SupplierItem>();
  for (const item of allItems) {
    const stockNo = String(item.Stock_No ?? "").trim();
    if (stockNo) byStockNo.set(stockNo, { ...item, Stock_No: stockNo });
  }
  const items = [...byStockNo.values()];

  if (!warning && totalResults !== undefined && items.length < totalResults) {
    warning = `The supplier reported ${totalResults} products but sent ${items.length}. Stored what was received; fetch again later to complete the catalog.`;
  }

  return { items, totalPages, fetchedPages, totalResults, warning };
}

/**
 * Quick connectivity / credential check.
 * Returns ok:true when the API key works and the first page has products;
 * otherwise ok:false with a human-readable reason (never throws).
 * NOTE: this consumes the supplier's 1-request-per-15-minute window.
 */
export async function testSupplierConnection(
  apiKey: string,
): Promise<{ ok: boolean; items?: number; error?: string; unreachable?: boolean }> {
  try {
    const pageResp = await fetchSupplierPage(apiKey, 1);
    const items = Array.isArray(pageResp.Stock) ? pageResp.Stock.length : 0;
    if (items === 0) {
      return { ok: false, items, error: "Supplier API responded but returned no products — check the API key." };
    }
    return { ok: true, items };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      unreachable: err instanceof SupplierUnreachableError,
      error: `Supplier connection failed: ${message}`,
    };
  }
}
