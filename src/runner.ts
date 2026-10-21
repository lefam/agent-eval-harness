import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ModelSpec } from "./model";
import type { AdapterInputs } from "./adapter";
import type { EvalConfig } from "./config";
import {
  CostCapExceededError,
  CostTracker,
  ZERO_USAGE,
  estimateCostUsd,
  isKnownRate,
  type PricingTable,
} from "./cost";
import type { RunMetrics } from "./metrics";
import { type PromptCase, filterPromptSet, loadPromptSet } from "./prompts";
import { loadBaseline, writeReport } from "./report";

export type RunEvalInputs = {
  config: EvalConfig;
  modelSpec: ModelSpec;
  repairModelSpec: ModelSpec;
  runOne: (input: AdapterInputs) => Promise<RunMetrics>;
  rates: PricingTable;

  planModelSpec?: ModelSpec;

  now?: () => number;

  computeCostUsd?: (m: RunMetrics, spec: ModelSpec) => number;

  onProgress?: (event: ProgressEvent) => void | Promise<void>;
};

export type ProgressEvent =
  | { kind: "start"; totalPrompts: number; totalRuns: number }
  | { kind: "prompt-start"; index: number; total: number; promptId: string }
  | {
      kind: "step";
      promptId: string;
      step: number;
      elapsedMs: number;
      toolCalls: ReadonlyArray<{ toolName: string; argsPreview: string }>;
    }
  | {
      kind: "run-end";
      index: number;
      total: number;
      promptId: string;
      repeat: number;
      repeats: number;
      metrics: RunMetricsWithCost;
    }
  | {
      kind: "prompt-end";
      index: number;
      total: number;
      promptId: string;
      aggregate: PromptAggregate;
    }
  | { kind: "abort"; reason: string }
  | { kind: "done"; summary: EvalSummary };

export type RunMetricsWithCost = RunMetrics & {
  costUsd: number;

  costUnknown: boolean;
};

export type PromptAggregate = {
  promptId: string;

  runs: RunMetricsWithCost[];

  passRate: number;
  medianToolCalls: number;
  medianWallTimeMs: number;
  totalCostUsd: number;
};

export type EvalSummary = {

  scenario: {
    configPath: string | null;
    tag: string | null;
    modelSpec: string;
    repairModelSpec: string;

    planModelSpec?: string;
    repeats: number;
    maxCostUsd: number;
    promptsPath: string;
    only: string[];
  };
  startedAt: number;
  finishedAt: number;
  aborted: boolean;
  abortReason: string | null;
  totalCostUsd: number;

  anyCostUnknown: boolean;
  promptResults: PromptAggregate[];
};

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
    : (sorted[mid] as number);
}

function aggregate(promptId: string, runs: RunMetricsWithCost[]): PromptAggregate {
  const isFullPass = (r: RunMetricsWithCost): boolean =>
    r.failureMode === null && r.validationPassed && r.finishSummary !== null && r.smokeTestPassed === true;
  const passes = runs.filter(isFullPass).length;
  return {
    promptId,
    runs,
    passRate: runs.length === 0 ? 0 : passes / runs.length,
    medianToolCalls: median(runs.map((r) => r.toolCallCount)),
    medianWallTimeMs: median(runs.map((r) => r.wallTimeMs)),
    totalCostUsd: runs.reduce((s, r) => s + r.costUsd, 0),
  };
}

function timestampDir(now: number): string {
  return new Date(now).toISOString().replace(/[:]/g, "-");
}

export async function writeResults(outDirPath: string, summary: EvalSummary): Promise<string> {
  const dir = path.join(outDirPath, timestampDir(summary.startedAt));
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, "results.json");
  await fs.writeFile(file, JSON.stringify(summary, null, 2), "utf8");
  return file;
}

export async function runEval(inputs: RunEvalInputs): Promise<{
  summary: EvalSummary;
  resultsPath: string;
  reportPath: string;
}> {
  const now = inputs.now ?? Date.now;
  const onProgress = inputs.onProgress ?? (() => {});
  const startedAt = now();
  if (!isKnownRate(inputs.modelSpec, inputs.rates)) {
    throw new Error("Configure a price for the evaluated model before starting.");
  }
  estimateCostUsd(inputs.modelSpec, ZERO_USAGE, inputs.rates);

  const all = await loadPromptSet(inputs.config.promptsPath);
  const cases: PromptCase[] = filterPromptSet(all, inputs.config.only);

  const tracker = new CostTracker(inputs.config.maxCostUsd);
  const promptResults: PromptAggregate[] = [];
  let aborted = false;
  let abortReason: string | null = null;
  let anyCostUnknown = false;

  const buildSummary = (): EvalSummary => ({
    scenario: {
      configPath: inputs.config.configPath,
      tag: inputs.config.tag,
      modelSpec: `${inputs.modelSpec.provider}/${inputs.modelSpec.model}`,
      repairModelSpec: `${inputs.repairModelSpec.provider}/${inputs.repairModelSpec.model}`,
      planModelSpec: inputs.planModelSpec
        ? `${inputs.planModelSpec.provider}/${inputs.planModelSpec.model}`
        : undefined,
      repeats: inputs.config.repeats,
      maxCostUsd: inputs.config.maxCostUsd,
      promptsPath: inputs.config.promptsPath,
      only: inputs.config.only,
    },
    startedAt,
    finishedAt: now(),
    aborted,
    abortReason,
    totalCostUsd: tracker.total(),
    anyCostUnknown,
    promptResults,
  });

  const flushResults = async (): Promise<{ summary: EvalSummary; resultsPath: string }> => {
    const summary = buildSummary();
    const resultsPath = await writeResults(inputs.config.outDirPath, summary);
    return { summary, resultsPath };
  };

  await onProgress({
    kind: "start",
    totalPrompts: cases.length,
    totalRuns: cases.length * inputs.config.repeats,
  });

  outer: for (let i = 0; i < cases.length; i++) {
    const c = cases[i] as PromptCase;
    await onProgress({ kind: "prompt-start", index: i + 1, total: cases.length, promptId: c.id });
    const runs: RunMetricsWithCost[] = [];
    for (let j = 0; j < inputs.config.repeats; j++) {
      let m: RunMetrics;
      try {
        m = await inputs.runOne({
          promptCase: c,
          remainingBudgetUsd: Math.max(0, tracker.cap() - tracker.total()),
          modelSpec: inputs.modelSpec,
          now,
          onStep: (ev) => {
            void onProgress({
              kind: "step",
              promptId: c.id,
              step: ev.step,
              elapsedMs: ev.elapsedMs,
              toolCalls: ev.toolCalls,
            });
          },
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        aborted = true;
        abortReason = "Adapter threw; partial spend is unknown. " + message;
        anyCostUnknown = true;
        m = {
          promptId: c.id,
          validationPassed: false,
          validationCalls: 0,
          validationRetries: 0,
          editsCount: 0,
          toolCallCount: 0,
          toolCallBreakdown: {},
          askUserCount: 0,
          escalatedToRepair: false,
          failureMode: "runtime_error",
          finishSummary: null,
          wallTimeMs: 0,
          draftFiles: {},
          errorMessage: message,
          usage: ZERO_USAGE,
          smokeTestPassed: null,
          smokeTestErrors: [`runner caught: ${message.slice(0, 200)}`],
          smokeTestDrawCalls: 0,
        };
      }
      const costUsd = inputs.computeCostUsd
        ? inputs.computeCostUsd(m, inputs.modelSpec)
        : estimateCostUsd(inputs.modelSpec, m.usage, inputs.rates);
      const costUnknown = aborted;
      if (costUnknown) anyCostUnknown = true;
      const enriched: RunMetricsWithCost = { ...m, costUsd, costUnknown };
      try {
        tracker.add(costUsd);
      } catch (e) {
        if (e instanceof CostCapExceededError) {
          aborted = true;
          abortReason = e.message;
          runs.push(enriched);
          const agg = aggregate(c.id, runs);
          promptResults.push(agg);
          await onProgress({
            kind: "run-end",
            index: i + 1,
            total: cases.length,
            promptId: c.id,
            repeat: j + 1,
            repeats: inputs.config.repeats,
            metrics: enriched,
          });
          await flushResults();
          await onProgress({
            kind: "prompt-end",
            index: i + 1,
            total: cases.length,
            promptId: c.id,
            aggregate: agg,
          });
          await onProgress({ kind: "abort", reason: e.message });
          break outer;
        }
        throw e;
      }
      runs.push(enriched);
      await onProgress({
        kind: "run-end",
        index: i + 1,
        total: cases.length,
        promptId: c.id,
        repeat: j + 1,
        repeats: inputs.config.repeats,
        metrics: enriched,
      });
      promptResults.push(aggregate(c.id, [...runs]));
      await flushResults();
      promptResults.pop();
      if (aborted) break;
      if (tracker.total() >= tracker.cap() && j + 1 < inputs.config.repeats) {
        aborted = true;
        abortReason = "Budget exhausted before the next repeat.";
        break;
      }
    }
    const agg = aggregate(c.id, runs);
    promptResults.push(agg);
    await flushResults();
    await onProgress({
      kind: "prompt-end",
      index: i + 1,
      total: cases.length,
      promptId: c.id,
      aggregate: agg,
    });
    if (aborted) {
      await onProgress({ kind: "abort", reason: abortReason ?? "aborted" });
      break;
    }
    if (tracker.total() >= tracker.cap() && i + 1 < cases.length) {
      aborted = true;
      abortReason = "Budget exhausted before the next prompt.";
      await onProgress({ kind: "abort", reason: abortReason });
      break;
    }
  }

  const { summary, resultsPath } = await flushResults();
  const baseline = inputs.config.baselinePath
    ? await loadBaseline(inputs.config.baselinePath)
    : null;
  const reportPath = await writeReport(resultsPath, summary, baseline);
  await onProgress({ kind: "done", summary });
  return { summary, resultsPath, reportPath };
}
