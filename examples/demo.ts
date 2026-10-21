import { loadConfig } from "../src/config";
import { ZERO_USAGE } from "../src/cost";
import { parseModelSpec } from "../src/model";
import { runEval } from "../src/runner";
import { runSmoke } from "../src/smoke";
import { canvasFixture } from "./fixtures";

const config = await loadConfig("configs/default.jsonc");
const modelSpec = parseModelSpec("demo/scripted");
const result = await runEval({
  config, modelSpec, repairModelSpec: modelSpec,
  rates: { "demo/scripted": { inputPerMTok: 0, outputPerMTok: 0, cachedReadPerMTok: 0, cachedWritePerMTok: 0 } },
  runOne: async ({ promptCase, now, onStep }) => {
    const started = now();
    const files = canvasFixture(promptCase.id === "moving-marker");
    onStep({ step: 1, elapsedMs: now() - started, toolCalls: [{ toolName: "smoke_check", argsPreview: "handwritten fixture" }] });
    const smoke = await runSmoke(files);
    return {
      promptId: promptCase.id, validationPassed: !smoke.errors.some(e => e.startsWith("bundle:")),
      validationCalls: 1, validationRetries: 0, editsCount: 1, toolCallCount: 1,
      toolCallBreakdown: { smoke_check: 1 }, askUserCount: 0, escalatedToRepair: false,
      failureMode: smoke.passed ? null : "validation_fail", finishSummary: "Scripted fixture checked.",
      wallTimeMs: now() - started, draftFiles: {}, errorMessage: null, usage: { ...ZERO_USAGE },
      smokeTestPassed: smoke.passed, smokeTestErrors: smoke.errors, smokeTestDrawCalls: smoke.drawCalls,
    };
  },
});
console.log("Offline scripted demonstration, not a model benchmark.");
console.log(JSON.stringify({ results: result.resultsPath, report: result.reportPath,
  cases: result.summary.promptResults.map(p => ({ id: p.promptId, passRate: p.passRate })) }, null, 2));
