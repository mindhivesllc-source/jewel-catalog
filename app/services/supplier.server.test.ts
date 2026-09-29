import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchSupplierPage, SupplierUnreachableError } from "./supplier.server";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const item = { Stock_No: "A1" };

afterEach(() => vi.unstubAllGlobals());

describe("fetchSupplierPage host fallback", () => {
  it("falls back to the second host when the first is unreachable", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("lgdusallc.com")) {
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
      url.includes("lgdusallc.com") ? new Response("nope", { status: 404 }) : json({ Stock: [item] }),
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

  it("treats a rejected API key as an error, not an empty catalog", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      json({ data: [], message: "Please Enter Correct API KEY", status: 0 }),
    ));
    await expect(fetchSupplierPage("k")).rejects.toThrow(/rejected the API key/);
  });
});
