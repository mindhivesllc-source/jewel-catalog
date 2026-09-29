import { describe, it, expect } from "vitest";
import { shouldSkipTick, planSync, SYNC_INTERVAL_MS } from "./sync.server";

const now = new Date("2026-09-11T12:00:00Z");

describe("shouldSkipTick", () => {
  it("runs when never fetched", () => expect(shouldSkipTick(null, now)).toBe(false));
  it("skips inside the 15-minute window", () =>
    expect(shouldSkipTick(new Date(now.getTime() - 5 * 60_000), now)).toBe(true));
  it("runs once the window has passed", () =>
    expect(shouldSkipTick(new Date(now.getTime() - SYNC_INTERVAL_MS), now)).toBe(false));
});

describe("planSync", () => {
  const row = (o: Partial<Parameters<typeof planSync>[0][number]>) => ({
    id: 1, stockNo: "A", pushed: true, syncHash: "h1", lastPushedHash: "h1",
    inhandPcs: "3", delistedAt: null, ...o,
  });
  it("ignores never-pushed rows", () => {
    expect(planSync([row({ pushed: false, lastPushedHash: null })], new Set())).toEqual({ changedIds: [], delistedIds: [], relistedIds: [] });
  });
  it("flags changed hash", () => {
    expect(planSync([row({ syncHash: "h2" })], new Set(["A"])).changedIds).toEqual([1]);
  });
  it("flags delisted rows once", () => {
    expect(planSync([row({})], new Set()).delistedIds).toEqual([1]);
    const already = row({ delistedAt: now, inhandPcs: "0" });
    expect(planSync([already], new Set()).delistedIds).toEqual([]);
  });
  it("relists rows that came back and re-pushes if changed", () => {
    const p = planSync([row({ delistedAt: now, syncHash: "h9" })], new Set(["A"]));
    expect(p.relistedIds).toEqual([1]);
    expect(p.changedIds).toEqual([1]);
  });
});
