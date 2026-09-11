import { describe, it, expect } from "vitest";
import { previewRow } from "./preview.server";

const built = (o: Partial<{ price: string; quantity: number; media: { mediaContentType: string }[] }>) => ({
  product: { title: "T" },
  media: o.media ?? [{ mediaContentType: "IMAGE" }],
  variant: { price: o.price ?? "10.00", quantity: o.quantity ?? 1 },
});

describe("previewRow", () => {
  it("no warnings for a healthy row", () => {
    expect(previewRow(built({}), "S1", false).warnings).toEqual([]);
  });
  it("flags zero price, no images, zero stock", () => {
    const r = previewRow(built({ price: "0.00", quantity: 0, media: [] }), "S1", true);
    expect(r.warnings).toEqual(["zero_price", "no_images", "zero_stock"]);
    expect(r.action).toBe("update");
    expect(r.imageCount).toBe(0);
  });
  it("counts images and detects video", () => {
    const r = previewRow(built({ media: [{ mediaContentType: "IMAGE" }, { mediaContentType: "VIDEO" }] }), "S1", false);
    expect(r.imageCount).toBe(1);
    expect(r.hasVideo).toBe(true);
    expect(r.action).toBe("create");
  });
});
