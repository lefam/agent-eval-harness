import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { loadBaseline, renderMarkdown, writeReport } from "./report";
import type { RunMetricsWithCost } from "./runner";
import type { EvalSummary } from "./runner";

function fixtureRun(overrides: Partial<RunMetricsWithCost> = {}): RunMetricsWithCost {
  return {
    promptId: "x",
    validationPassed: true,
    validationCalls: 1,
    validationRetries: 0,
    editsCount: 1,
    toolCallCount: 5,
    toolCallBreakdown: {},
    askUserCount: 0,
    escalatedToRepair: false,
    failureMode: null,
    finishSummary: "Did the thing.",
    wallTimeMs: 1234,
    draftFiles: {},
    errorMessage: null,
    usage: { inputTokens: 0, outputTokens: 0, cachedReadTokens: 0, cachedWriteTokens: 0 },
    costUsd: 0.01,
    costUnknown: false,
    smokeTestPassed: true,
    smokeTestErrors: [],
    smokeTestDrawCalls: 1,
    ...overrides,
  };
}

const FIXTURE: EvalSummary = {
  scenario: {
    configPath: null,
    tag: "smoke",
    modelSpec: "anthropic/claude-haiku-4-5",
    repairModelSpec: "anthropic/claude-haiku-4-5",
    repeats: 2,
    maxCostUsd: 5,
    promptsPath: "/tmp/v1.json",
    only: [],
  },
  startedAt: 1714944000000,
  finishedAt: 1714944001234,
  aborted: false,
  abortReason: null,
  totalCostUsd: 0.04,
  anyCostUnknown: false,
  promptResults: [
    {
      promptId: "snake",
      runs: [
        fixtureRun({ promptId: "snake", costUsd: 0.01, toolCallCount: 5 }),
        fixtureRun({ promptId: "snake", costUsd: 0.01, toolCallCount: 7 }),
      ],
      passRate: 1,
      medianToolCalls: 6,
      medianWallTimeMs: 1234,
      totalCostUsd: 0.02,
    },
    {
      promptId: "asteroids",
      runs: [
        fixtureRun({
          promptId: "asteroids",
          costUsd: 0.01,
          toolCallCount: 12,
          validationPassed: false,
          finishSummary: null,
          failureMode: "validation_fail",
          validationCalls: 3,
        }),
        fixtureRun({ promptId: "asteroids", costUsd: 0.01, toolCallCount: 8 }),
      ],
      passRate: 0.5,
      medianToolCalls: 10,
      medianWallTimeMs: 1234,
      totalCostUsd: 0.02,
    },
  ],
};

describe("renderMarkdown", () => {
  it("emits a header with model + repeats + total cost", () => {
    const md = renderMarkdown(FIXTURE);
    expect(md).toContain("# Agent Evaluation Report");
    expect(md).toContain("**Tag:** smoke");
    expect(md).toContain("**Model:** `anthropic/claude-haiku-4-5`");
    expect(md).toContain("**Repeats:** 2");
    expect(md).toContain("**Total cost:** $0.0400");
  });

  it("renders per-prompt sections with pass counts and per-repeat tables", () => {
    const md = renderMarkdown(FIXTURE);
    expect(md).toContain("### `snake` - 2/2 passed");
    expect(md).toContain("### `asteroids` - 1/2 passed");
    expect(md).toContain("| repeat | finish | tools | val | smoke | cost | failure |");
    expect(md).toContain("FAIL×3");
    expect(md).toContain("validation_fail");
  });

  it("prints aggregate footer", () => {
    const md = renderMarkdown(FIXTURE);
    expect(md).toContain("## Aggregate");
    expect(md).toContain("Total runs: 4");
    expect(md).toContain("Total passes: 3");
    expect(md).toContain("Pass rate: 75%");
  });

  it("annotates aborted runs with the reason", () => {
    const aborted: EvalSummary = {
      ...FIXTURE,
      aborted: true,
      abortReason: "Cost cap exceeded: $0.6 > $0.5",
    };
    const md = renderMarkdown(aborted);
    expect(md).toContain("**Aborted:** Cost cap exceeded");
  });

  it("annotates unknown cost rates", () => {
    const md = renderMarkdown({ ...FIXTURE, anyCostUnknown: true });
    expect(md).toMatch(/some specs lack a configured rate/);
  });

  it("inlines deltas vs baseline", () => {
    const [snake, ast] = FIXTURE.promptResults;
    if (!snake || !ast) throw new Error("fixture missing prompts");
    const baseline: EvalSummary = {
      ...FIXTURE,
      promptResults: [
        { ...snake, passRate: 0.5, medianToolCalls: 10, totalCostUsd: 0.05 },
        { ...ast, passRate: 0.5, medianToolCalls: 10, totalCostUsd: 0.05 },
      ],
      totalCostUsd: 0.1,
    };
    const md = renderMarkdown(FIXTURE, baseline);
    expect(md).toContain("vs baseline");
    expect(md).toMatch(/`snake`.*\(\+50pp vs baseline\)/);
  });

  it("handles empty promptResults", () => {
    const md = renderMarkdown({ ...FIXTURE, promptResults: [] });
    expect(md).toContain("# Agent Evaluation Report");
    expect(md).toContain("Total runs: 0");
    expect(md).not.toContain("## Per-prompt results");
  });
});

describe("writeReport + loadBaseline", () => {
  it("writes report.md alongside the results JSON file and round-trips loadBaseline", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "loop-eval-report-"));
    try {
      const resultsPath = path.join(dir, "results.json");
      await fs.writeFile(resultsPath, JSON.stringify(FIXTURE, null, 2));
      const reportPath = await writeReport(resultsPath, FIXTURE, null);
      expect(reportPath).toBe(path.join(dir, "report.md"));
      const text = await fs.readFile(reportPath, "utf8");
      expect(text).toContain("# Agent Evaluation Report");
      const reload = await loadBaseline(resultsPath);
      expect(reload.totalCostUsd).toBeCloseTo(0.04);
    } finally {
      await fs.rm(dir, { recursive: true });
    }
  });
});
