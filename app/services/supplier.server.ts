/**
 * LGD USA Supplier API client.
 *
 * Base URL:  https://lgdusallc.com/developer-api
 * Endpoint:  GET /jewelry?type=all&page={page}&key={apiKey}
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
}

/** Some versions of the API nest items under "data" instead of "Stock". */
type FlexibleResponse =
  | { data: SupplierItem[]; page_no?: string; total_page?: number }
  | { Stock: SupplierItem[]; page_no?: string; total_page?: number };

// ── Constants ────────────────────────────────────────────────────────────────

const BASE_URL = "https://lgdusallc.com/developer-api";

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

  // Detect rate-limit message embedded in response
  if (obj.Message && typeof obj.Message === "string") {
    if (obj.Message.toLowerCase().includes("limit")) {
      throw new Error(
        "Rate limit reached on supplier API (1 request per 15 min). Please wait before trying again.",
      );
    }
  }

  // Accept either "data" or "Stock" as the items array
  const items = obj.data ?? obj.Stock;
  if (!Array.isArray(items)) return false;

  const pageNo = obj.page_no ?? "1";
  const totalPage = obj.total_page ?? 1;

  // Normalise the object into a predictable shape for the caller
  const normalised = obj as unknown as Record<string, unknown>;
  normalised["Stock"] = items;
  normalised["page_no"] = String(pageNo);
  normalised["total_page"] = Number(totalPage);

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
  const url = `${BASE_URL}/jewelry?type=all&page=${page}&key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url, { signal });

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
export async function fetchAllSupplierProducts(
  apiKey: string,
  signal?: AbortSignal,
): Promise<SupplierItem[]> {
  const allItems: SupplierItem[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    const pageResp = await fetchSupplierPage(apiKey, page, signal);
    allItems.push(...pageResp.Stock);

    totalPages = pageResp.total_page;
    page++;
  } while (page <= totalPages);

  return allItems;
}

/**
 * Quick connectivity / credential check.
 * Returns `true` when the API key works and the first page is parseable.
 */
export async function testSupplierConnection(
  apiKey: string,
): Promise<boolean> {
  try {
    const pageResp = await fetchSupplierPage(apiKey, 1);
    return Array.isArray(pageResp.Stock) && pageResp.Stock.length > 0;
  } catch {
    return false;
  }
}
