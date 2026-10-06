import { describe, it, expect } from "vitest";
import { applyMarkup, buildShopifyProductInput, deriveSetting, mapCategory, mapJewelryType, renderTitle } from "./mapper.server";
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
  it("defaults to the supplier's description", () => {
    const item = { ...base, Remarks: " SOLITAIRE RING 14KW DEF VS1 CVD DIA 1.50CTS " } as SupplierItem;
    expect(renderTitle("", item, mapped)).toBe("SOLITAIRE RING 14KW DEF VS1 CVD DIA 1.50CTS");
  });
  it("falls back to the descriptive template without Remarks", () => {
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
    expect(renderTitle("{color}", base, mapped)).toBe("1.50ct Round Lab Grown Diamond Solitaire Rings in 14KW");
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

describe("buildShopifyProductInput description", () => {
  const item = {
    Stock_No: "TJ6530NCW", Subitem: "6530NCW", Price: "100", Category: "Necklaces",
    Jewelry_Type: "Tennis", Shape: "ROUND", Metal_Type: "14KW", Color: "E<F", Clarity: "VS2",
    Dia_Pcs: "98", Dia_Wt: "10.77", Gross_Wt: "21.14", Casting_Wt: "0", Growth_Type: "CVD",
    Size: "17", Certificate: "", Inhand_Pcs: "1", Memo_Out: "2",
    Remarks: "BEZEL TENNIS NECKLACE 14KW <b>EFG</b> VS2 CVD DIA 10.77CTS",
  } as unknown as SupplierItem;
  const out = buildShopifyProductInput(item, "V");
  const html = out.descriptionHtml;
  const row = (label: string, value: string) =>
    `<tr><td><strong>${label}</strong></td><td>${value}</td></tr>`;
  it("lists every supplier detail", () => {
    for (const [label, value] of [
      ["Stock Number", "TJ6530NCW"], ["Subitem", "6530NCW"], ["Category", "NECKLACES"],
      ["Jewelry Type", "TENNIS"], ["Metal Type", "14KW"], ["Shape", "ROUND"], ["Clarity", "VS2"],
      ["Diamond Pieces", "98"], ["Diamond Weight", "10.77"], ["Gross Weight", "21.14"],
      ["Growth Type", "CVD"], ["Size", "17"], ["Setting", "BEZEL"], ["In-hand Pieces", "1"],
    ]) {
      expect(html).toContain(row(label, value));
    }
  });
  it("skips empty and zero values, and Memo Out", () => {
    expect(html).not.toMatch(/Casting Weight|Certificate|Memo/);
  });
  it("escapes supplier text", () => {
    expect(html).toContain(row("Color", "E&lt;F"));
    expect(html).not.toContain("<b>");
    expect(out.title).toBe("BEZEL TENNIS NECKLACE 14KW <b>EFG</b> VS2 CVD DIA 10.77CTS");
  });
  it("does not tag products as Other", () => {
    const other = { Stock_No: "S1", Price: "1" } as unknown as SupplierItem;
    expect(buildShopifyProductInput(other, "V").tags).not.toContain("Other");
  });
});

describe("deriveSetting", () => {
  it("reads the setting from Remarks", () => {
    expect(deriveSetting("BEZEL TENNIS NECKLACE 14KW")).toBe("BEZEL");
    expect(deriveSetting("4 prong  SOLITAIRE RING")).toBe("4 PRONG");
  });
  it("is empty when Remarks names none", () => {
    expect(deriveSetting("EMERALD ETERNITY RING 14KW")).toBe("");
    expect(deriveSetting(undefined)).toBe("");
  });
});

describe("category mapping", () => {
  it("maps known values", () => expect(mapCategory(" bracelet ")).toBe("Bracelets"));
  it("keeps unknown supplier values readable instead of Other", () => {
    expect(mapCategory("ANKLE_CHAINS")).toBe("Ankle Chains");
    expect(mapJewelryType("three stone")).toBe("Three Stone");
  });
  it("uses Other only for blanks", () => {
    expect(mapCategory("  ")).toBe("Other");
    expect(mapJewelryType(null)).toBe("Other");
  });
});
