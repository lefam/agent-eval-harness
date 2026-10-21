import { describe, expect, it } from "vitest";
import { CostTracker, estimateCostUsd, ZERO_USAGE } from "./cost";
const model = { provider: "fixture", model: "a" };
const rates = { "fixture/a": { inputPerMTok: 2, outputPerMTok: 4, cachedReadPerMTok: 0.2, cachedWritePerMTok: 3 } };

describe("explicit pricing", () => {
  it("prices disjoint uncached, output and cache buckets", () => {
    expect(estimateCostUsd(model, { inputTokens: 1000, outputTokens: 500, cachedReadTokens: 1000, cachedWriteTokens: 100 }, rates)).toBeCloseTo(0.0045);
  });
  it("refuses an unknown model instead of reporting zero", () => {
    expect(() => estimateCostUsd(model, ZERO_USAGE, {})).toThrow("Unknown price");
  });
  it.each([NaN, Infinity, -1])("rejects malformed usage: %s", bad => {
    expect(() => estimateCostUsd(model, { ...ZERO_USAGE, inputTokens: bad }, rates)).toThrow();
  });
  it("retains the overshooting spend in its total", () => {
    const t = new CostTracker(1); t.add(0.9);
    expect(() => t.add(0.2)).toThrow("Cost cap exceeded");
    expect(t.total()).toBeCloseTo(1.1);
  });
  it.each([NaN, Infinity, -1])("rejects malformed caps: %s", bad => {
    expect(() => new CostTracker(bad)).toThrow();
  });
});
