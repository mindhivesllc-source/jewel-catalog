import { describe, it, expect } from "vitest";
import { applyMarkup, buildShopifyProductInput } from "./mapper.server";
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
