import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { loadConfig } from "./config";
import { ZERO_USAGE } from "./cost";
import type { RunMetrics } from "./metrics";
import { runEval, type RunEvalInputs } from "./runner";

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
function passing(promptId: string, changes: Partial<RunMetrics> = {}): RunMetrics {
  return { promptId, validationPassed: true, validationCalls: 1, validationRetries: 0,
    editsCount: 1, toolCallCount: 1, toolCallBreakdown: {}, askUserCount: 0,
    escalatedToRepair: false, failureMode: null, finishSummary: "Checked.", wallTimeMs: 10,
    draftFiles: {}, errorMessage: null, usage: { ...ZERO_USAGE }, smokeTestPassed: true,
    smokeTestErrors: [], smokeTestDrawCalls: 2, ...changes };
}
async function setup(): Promise<RunEvalInputs> {
  const config = await loadConfig("configs/default.jsonc");
  const out = await mkdtemp(path.join(tmpdir(), "public-eval-")); dirs.push(out);
  return { config: { ...config, outDirPath: out }, modelSpec: { provider: "demo", model: "scripted" },
    repairModelSpec: { provider: "demo", model: "scripted" },
    rates: { "demo/scripted": { inputPerMTok: 0, outputPerMTok: 0, cachedReadPerMTok: 0, cachedWritePerMTok: 0 } },
    runOne: async ({ promptCase }) => passing(promptCase.id) };
}
it("runs each selected case and repeat, and persists a report", async () => {
  const input = await setup(); const run = vi.fn(input.runOne); input.runOne = run;
  const r = await runEval(input);
  expect(run).toHaveBeenCalledTimes(4);
  expect(r.summary.promptResults.map(p => p.passRate)).toEqual([1, 1]);
  expect(JSON.parse(await readFile(r.resultsPath, "utf8"))).toEqual(r.summary);
  expect(await readFile(r.reportPath, "utf8")).toContain("Total passes: 4");
});
it.each([
  { validationPassed: false, editsCount: 0 },
  { failureMode: "runtime_error" as const },
  { smokeTestPassed: false },
  { finishSummary: null },
])("does not count a partial or failed outcome as a pass: %j", async changes => {
  const input = await setup(); input.runOne = async ({ promptCase }) => passing(promptCase.id, changes);
  const r = await runEval(input); expect(r.summary.promptResults.every(p => p.passRate === 0)).toBe(true);
});
it("preserves an overshooting run and does not start more work", async () => {
  const input = await setup(); const run = vi.fn(input.runOne); input.runOne = run;
  input.computeCostUsd = () => 1.1;
  const r = await runEval(input);
  expect(r.summary.aborted).toBe(true); expect(r.summary.totalCostUsd).toBe(1.1);
  expect(run).toHaveBeenCalledTimes(1);
  expect(JSON.parse(await readFile(r.resultsPath, "utf8")).promptResults[0].runs).toHaveLength(1);
});
it("stops before the next repeat at exactly the budget", async () => {
  const input = await setup(); const run = vi.fn(input.runOne); input.runOne = run;
  input.computeCostUsd = () => 1;
  const r = await runEval(input);
  expect(run).toHaveBeenCalledTimes(1); expect(r.summary.aborted).toBe(true);
});
it("rejects missing pricing before starting an adapter", async () => {
  const input = await setup(); const run = vi.fn(input.runOne); input.runOne = run; input.rates = {};
  await expect(runEval(input)).rejects.toThrow("Configure a price"); expect(run).not.toHaveBeenCalled();
});
it("rejects malformed pricing before any potentially paid work", async () => {
  const input = await setup(); const run = vi.fn(input.runOne); input.runOne = run;
  input.rates = { "demo/scripted": { inputPerMTok: Infinity, outputPerMTok: 0, cachedReadPerMTok: 0, cachedWritePerMTok: 0 } };
  await expect(runEval(input)).rejects.toThrow("price must be finite"); expect(run).not.toHaveBeenCalled();
});
it("keeps adapter failures and marks the cost incomplete", async () => {
  const input = await setup(); const run = vi.fn(async () => { throw new Error("provider connection lost"); });
  input.runOne = run;
  const r = await runEval(input);
  expect(run).toHaveBeenCalledTimes(1); expect(r.summary.anyCostUnknown).toBe(true);
  expect(r.summary.promptResults[0]?.runs[0]?.failureMode).toBe("runtime_error");
  expect(await readFile(r.reportPath, "utf8")).toContain("cost is partial");
});
