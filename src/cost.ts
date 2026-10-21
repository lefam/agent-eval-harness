import type { ModelSpec } from "./model";

/** Normalize provider usage to disjoint token buckets before returning it. */
export type Usage = {
  inputTokens: number;
  outputTokens: number;
  cachedReadTokens: number;
  cachedWriteTokens: number;
};
export const ZERO_USAGE: Usage = Object.freeze({
  inputTokens: 0, outputTokens: 0, cachedReadTokens: 0, cachedWriteTokens: 0,
});
export type CostRate = {
  inputPerMTok: number;
  outputPerMTok: number;
  cachedReadPerMTok: number;
  cachedWritePerMTok: number;
};
export type PricingTable = Readonly<Record<string, CostRate>>;

function nonnegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be finite and nonnegative`);
  return value;
}

export function isKnownRate(spec: ModelSpec, rates: PricingTable): boolean {
  return Object.hasOwn(rates, `${spec.provider}/${spec.model}`);
}

export function estimateCostUsd(spec: ModelSpec, usage: Usage, rates: PricingTable): number {
  const rate = rates[`${spec.provider}/${spec.model}`];
  if (!isKnownRate(spec, rates) || !rate) throw new Error("Unknown price; refusing to assume free inference");
  const pairs = [
    [usage.inputTokens, rate.inputPerMTok],
    [usage.outputTokens, rate.outputPerMTok],
    [usage.cachedReadTokens, rate.cachedReadPerMTok],
    [usage.cachedWriteTokens, rate.cachedWritePerMTok],
  ] as const;
  return pairs.reduce((sum, [tokens, price]) =>
    sum + nonnegative(tokens, "token count") * nonnegative(price, "price") / 1_000_000, 0);
}

export class CostCapExceededError extends Error {
  constructor(readonly accumulatedUsd: number, readonly capUsd: number) {
    super(`Cost cap exceeded: $${accumulatedUsd.toFixed(4)} > $${capUsd.toFixed(2)}`);
    this.name = "CostCapExceededError";
  }
}

/** Stop a sweep after reported spend reaches its limit. Not a provider-side cap. */
export class CostTracker {
  private accumulated = 0;
  constructor(private readonly capUsd: number) { nonnegative(capUsd, "cost cap"); }
  add(usd: number): void {
    this.accumulated += nonnegative(usd, "cost");
    if (this.accumulated > this.capUsd) throw new CostCapExceededError(this.accumulated, this.capUsd);
  }
  total(): number { return this.accumulated; }
  cap(): number { return this.capUsd; }
}
