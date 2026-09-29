import { describe, it, expect } from "vitest";
import { applyMarkup, buildShopifyProductInput, renderTitle } from "./mapper.server";
import type { SupplierItem } from "./supplier.server";

describe("applyMarkup", () => {
  it("percent", () => expect(applyMarkup(100, { markupType: "percent", markupValue: 20, roundTo: "none" })).toBe(120));
  it("fixed", () => expect(applyMarkup(100, { markupType: "fixed", markupValue: 15, roundTo: "none" })).toBe(115));
  it("round to .99", () => expect(applyMarkup(123.4, { markupType: "percent", markupValue: 0, roundTo: "0.99" })).toBe(123.99));
  it("round to whole", () => expect(applyMarkup(123.4, { markupType: "percent", markupValue: 0, roundTo: "whole" })).toBe(124));
  it("no rule → unchanged", () => expect(applyMarkup(99.5, null)).toBe(99.5));
  it("never negative", () => expect(applyMarkup(10, { markupType: "fixed", markupValue: -50, roundTo: "none" })).toBe(0));
});

describe("buildShopifyProductInput pricing", () => {
  const item = { Stock_No: "S1", Price: "100", Category: "RINGS", Image_1: "" } as unknown as SupplierItem;
  it("compare-at is computed from the marked-up price", () => {
    const out = buildShopifyProductInput(item, "V", "multiply", 2, 0, { markupType: "percent", markupValue: 50, roundTo: "none" });
    expect(out.variant.price).toBe("150.00");
    expect(out.variant.compareAtPrice).toBe("300.00");
  });
});

describe("renderTitle", () => {
  const base = { Stock_No: "LGD1", Dia_Wt: "1.50", Shape: "Round", Metal_Type: "14KW" } as unknown as SupplierItem;
  const mapped = { category: "Rings", jewelryType: "Solitaire" };
  it("fills the default template", () => {
    expect(renderTitle("", base, mapped)).toBe("1.50ct Round Lab Grown Diamond Solitaire Rings in 14KW");
  });
  it("drops empty tokens and the ct suffix", () => {
    const item = { ...base, Dia_Wt: "", Metal_Type: "" } as SupplierItem;
    expect(renderTitle("", item, { category: "Rings", jewelryType: "Other" })).toBe("Round Lab Grown Diamond Rings");
  });
  it("supports custom templates", () => {
    expect(renderTitle("{stockNo} - {metal} {shape}", base, mapped)).toBe("LGD1 - 14KW Round");
  });
  it("never returns empty", () => {
    expect(renderTitle("{color}", base, mapped)).toBe("Jewelry LGD1");
  });
});

describe("buildShopifyProductInput media", () => {
  it("adds a VIDEO entry for an http Video_1", () => {
    const item = { Stock_No: "S1", Price: "1", Image_1: "https://x/a.jpg", Video_1: "https://x/v.mp4" } as unknown as SupplierItem;
    const out = buildShopifyProductInput(item, "V");
    expect(out.media.map((m) => m.mediaContentType)).toEqual(["IMAGE", "VIDEO"]);
  });
  it("ignores non-URL Video_1", () => {
    const item = { Stock_No: "S1", Price: "1", Video_1: "N/A" } as unknown as SupplierItem;
    expect(buildShopifyProductInput(item, "V").media).toEqual([]);
  });
});
