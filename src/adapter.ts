import type { ModelSpec } from "./model";
import type { PromptCase } from "./prompts";

/** Inputs supplied to the agent under test. */
export type AdapterInputs = {
  promptCase: PromptCase;
  modelSpec: ModelSpec;
  remainingBudgetUsd: number;
  now: () => number;
  onStep: (event: {
    step: number;
    elapsedMs: number;
    toolCalls: ReadonlyArray<{ toolName: string; argsPreview: string }>;
  }) => void;
};
