import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { fetchSupplierPage, SupplierUnreachableError } from "./supplier.server";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const item = { Stock_No: "A1" };

beforeEach(() => {
  process.env.SUPPLIER_API_BASE_URL = "https://first.example/api, https://second.example/api/";
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.SUPPLIER_API_BASE_URL;
});

describe("fetchSupplierPage host fallback", () => {
  it("falls back to the second host when the first is unreachable", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("first.example")) {
        throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ERR_TLS_CERT_ALTNAME_INVALID" } });
      }
      return json({ data: [item], page_no: "1", total_page: 1 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const out = await fetchSupplierPage("k");
    expect(out.Stock).toEqual([item]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("falls back on HTTP 404 from the first host", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      url.includes("first.example") ? new Response("nope", { status: 404 }) : json({ Stock: [item] }),
    ));
    expect((await fetchSupplierPage("k")).Stock).toEqual([item]);
  });

  it("does not retry another host after a real API answer", async () => {
    const fetchMock = vi.fn(async () => json({ Message: "Request limit exceeded" }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchSupplierPage("k")).rejects.toThrow(/Rate limit/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports unreachable when every host fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    await expect(fetchSupplierPage("k")).rejects.toBeInstanceOf(SupplierUnreachableError);
  });

  it("uses the documented API host by default", async () => {
    delete process.env.SUPPLIER_API_BASE_URL;
    const fetchMock = vi.fn(async (_url: string) =>
      json({ data: [item], message: "Success", status: 1 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await fetchSupplierPage("k", 2);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.lgdusallc.com/api/v1/inventory/jewelry?type=all&page=2&key=k",
    );
  });

  it("surfaces the supplier's own error text", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "This API is deprecated." })));
    await expect(fetchSupplierPage("k")).rejects.toThrow(/This API is deprecated/);
  });

  it("treats a rejected API key as an error, not an empty catalog", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      json({ data: [], message: "Please Enter Correct API KEY", status: 0 }),
    ));
    await expect(fetchSupplierPage("k")).rejects.toThrow(/rejected the API key/);
  });
});
