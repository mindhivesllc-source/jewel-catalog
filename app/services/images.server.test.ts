import { describe, it, expect } from "vitest";
import {
  customImageUrls,
  mediaFileName,
  planMediaReplace,
  renderImageUrl,
  resolveCustomImages,
  validateImageTemplate,
} from "./images.server";

const T = "https://cdn.example.com/products/{stockNo}_{n}.jpg";

describe("custom image URLs", () => {
  it("renders stock number and index", () => {
    expect(renderImageUrl(T, "LGD1002RMH", 3)).toBe("https://cdn.example.com/products/LGD1002RMH_3.jpg");
  });
  it("encodes unsafe characters in the stock number", () => {
    expect(renderImageUrl(T, "A B/C", 1)).toBe("https://cdn.example.com/products/A%20B%2FC_1.jpg");
  });
  it("builds one URL per image, 1-based", () => {
    expect(customImageUrls(T, 3, "S1")).toEqual([
      "https://cdn.example.com/products/S1_1.jpg",
      "https://cdn.example.com/products/S1_2.jpg",
      "https://cdn.example.com/products/S1_3.jpg",
    ]);
  });
  it("returns nothing without a template or stock number", () => {
    expect(customImageUrls("", 8, "S1")).toEqual([]);
    expect(customImageUrls(T, 8, " ")).toEqual([]);
    expect(customImageUrls("https://x.com/{n}.jpg", 8, "S1")).toEqual([]);
  });
  it("caps the count", () => {
    expect(customImageUrls(T, 999, "S1")).toHaveLength(12);
    expect(customImageUrls(T, 0, "S1")).toHaveLength(1);
  });
});

describe("validateImageTemplate", () => {
  it("accepts empty and valid templates", () => {
    expect(validateImageTemplate("")).toBeNull();
    expect(validateImageTemplate(T)).toBeNull();
  });
  it("rejects http, missing tokens", () => {
    expect(validateImageTemplate("http://x.com/{stockNo}_{n}.jpg")).toMatch(/https/);
    expect(validateImageTemplate("https://x.com/{n}.jpg")).toMatch(/stockNo/);
    expect(validateImageTemplate("https://x.com/{stockNo}.jpg")).toMatch(/\{n\}/);
    expect(validateImageTemplate("https://10.0.0.1/{stockNo}_{n}.jpg")).toMatch(/public domain/);
    expect(validateImageTemplate("https://postgres.railway.internal/{stockNo}_{n}.jpg")).toMatch(/public domain/);
  });
});

describe("resolveCustomImages", () => {
  it("keeps only images that exist, in order", async () => {
    const out = await resolveCustomImages(T, 4, "S1", async (u) => !u.endsWith("_2.jpg"));
    expect(out).toEqual([
      "https://cdn.example.com/products/S1_1.jpg",
      "https://cdn.example.com/products/S1_3.jpg",
      "https://cdn.example.com/products/S1_4.jpg",
    ]);
  });
});

describe("planMediaReplace", () => {
  const src = (n: number) => ({
    originalSource: `https://shop.example/cdn/shop/files/TJ1-${n}_result.avif`,
  });
  const own = (n: number) => ({
    id: `m${n}`,
    url: `https://cdn.shopify.com/s/files/1/0001/files/TJ1-${n}_result.avif?v=17`,
  });
  it("reads the file name without the query", () => {
    expect(mediaFileName(own(1).url)).toBe("TJ1-1_result.avif");
    expect(mediaFileName(null)).toBe("");
  });
  it("never deletes a photo that is its own source", () => {
    expect(planMediaReplace([own(1), own(2)], [src(1), src(2)])).toEqual({ deleteIds: [], add: [] });
  });
  it("adds only the missing photos and removes the others", () => {
    const supplier = { id: "s1", url: "https://cdn.shopify.com/s/files/1/0001/files/1.jpg" };
    const video = { id: "v1", url: null };
    expect(planMediaReplace([own(1), supplier, video], [src(1), src(2)])).toEqual({
      deleteIds: ["s1", "v1"],
      add: [src(2)],
    });
  });
});
