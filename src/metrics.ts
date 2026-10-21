import type { Usage } from "./cost";

export type FailureMode =
  | null
  | "validation_fail"
  | "max_tool_calls"
  | "wall_time_exceeded"
  | "validation_budget_exceeded"
  | "no_finish"
  | "runtime_error";

export type RunMetrics = {
  promptId: string;

  validationPassed: boolean;

  validationCalls: number;

  validationRetries: number;

  editsCount: number;

  toolCallCount: number;

  toolCallBreakdown: Record<string, number>;

  askUserCount: number;

  escalatedToRepair: boolean;

  failureMode: FailureMode;

  finishSummary: string | null;

  wallTimeMs: number;

  draftFiles: Record<string, string>;

  errorMessage: string | null;

  usage: Usage;
  smokeTestPassed: boolean | null;
  smokeTestErrors: string[];
  smokeTestDrawCalls: number;
};
