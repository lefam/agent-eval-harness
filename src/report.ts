import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { EvalSummary, PromptAggregate } from "./runner";

function fmtUsd(n: number): string {
  return `$${n.toFixed(4)}`;
}

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}

function fmtIso(ms: number): string {
  return new Date(ms).toISOString();
}

function deltaPct(now: number, base: number): string {
  const diff = (now - base) * 100;
  if (Math.abs(diff) < 0.5) return "(same)";
  const sign = diff >= 0 ? "+" : "";
  return `(${sign}${diff.toFixed(0)}pp vs baseline)`;
}

function deltaUsd(now: number, base: number): string {
  const diff = now - base;
  if (Math.abs(diff) < 0.0001) return "(same)";
  const sign = diff >= 0 ? "+" : "";
  return `(${sign}${diff.toFixed(4)} vs baseline)`;
}

function deltaNum(now: number, base: number): string {
  const diff = now - base;
  if (Math.abs(diff) < 0.5) return "(same)";
  const sign = diff >= 0 ? "+" : "";
  return `(${sign}${diff.toFixed(0)} vs baseline)`;
}

function renderHeader(s: EvalSummary, baseline: EvalSummary | null): string {
  const lines: string[] = [];
  lines.push("# Agent Evaluation Report");
  lines.push("");
  if (s.scenario.tag) lines.push(`**Tag:** ${s.scenario.tag}  `);
  lines.push(`**Model:** \`${s.scenario.modelSpec}\`  `);
  if (s.scenario.repairModelSpec !== s.scenario.modelSpec) {
    lines.push(`**Repair model:** \`${s.scenario.repairModelSpec}\`  `);
  }
  lines.push(`**Repeats:** ${s.scenario.repeats}  `);
  lines.push(`**Started:** ${fmtIso(s.startedAt)}  `);
  lines.push(`**Finished:** ${fmtIso(s.finishedAt)} (${s.finishedAt - s.startedAt}ms)  `);
  const costSuffix = baseline ? ` ${deltaUsd(s.totalCostUsd, baseline.totalCostUsd)}` : "";
  const unknownNote = s.anyCostUnknown
    ? " *(some specs lack a configured rate; cost is partial)*"
    : "";
  lines.push(`**Total cost:** ${fmtUsd(s.totalCostUsd)}${costSuffix}${unknownNote}  `);
  if (s.aborted) lines.push(`**Aborted:** ${s.abortReason ?? "yes"}  `);
  if (baseline) {
    lines.push(`**Baseline:** ${baseline.scenario.tag ?? fmtIso(baseline.startedAt)}  `);
  }
  lines.push("");
  return lines.join("\n");
}

function renderPrompt(p: PromptAggregate, base: PromptAggregate | null): string {
  const lines: string[] = [];
  const passes = Math.round(p.passRate * p.runs.length);
  const passDelta = base ? ` ${deltaPct(p.passRate, base.passRate)}` : "";
  lines.push(`### \`${p.promptId}\` - ${passes}/${p.runs.length} passed${passDelta}`);
  lines.push("");
  lines.push(
    `- Median tool calls: ${p.medianToolCalls}${
      base ? ` ${deltaNum(p.medianToolCalls, base.medianToolCalls)}` : ""
    }`,
  );
  lines.push(`- Median wall time: ${Math.round(p.medianWallTimeMs)}ms`);
  lines.push(
    `- Total cost: ${fmtUsd(p.totalCostUsd)}${
      base ? ` ${deltaUsd(p.totalCostUsd, base.totalCostUsd)}` : ""
    }`,
  );
  lines.push("");
  lines.push("| repeat | finish | tools | val | smoke | cost | failure |");
  lines.push("|---|---|---|---|---|---|---|");
  for (let i = 0; i < p.runs.length; i++) {
    const r = p.runs[i];
    if (!r) continue;
    const finishCol = r.finishSummary
      ? `"${r.finishSummary.replace(/\|/g, "\\|").slice(0, 50)}"`
      : "(none)";
    const valCol = r.validationPassed ? "OK" : `FAIL×${r.validationCalls}`;
    const smokeCol =
      r.smokeTestPassed === null
        ? "-"
        : r.smokeTestPassed
          ? `OK (${r.smokeTestDrawCalls}d)`
          : "FAIL";
    const failCol = r.failureMode ?? "";
    lines.push(
      `| ${i + 1} | ${finishCol} | ${r.toolCallCount} | ${valCol} | ${smokeCol} | ${fmtUsd(r.costUsd)} | ${failCol} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

function renderAggregate(s: EvalSummary, baseline: EvalSummary | null): string {
  const totalRuns = s.promptResults.reduce((sum, p) => sum + p.runs.length, 0);
  const totalPasses = s.promptResults.reduce(
    (sum, p) => sum + Math.round(p.passRate * p.runs.length),
    0,
  );
  const passRate = totalRuns === 0 ? 0 : totalPasses / totalRuns;
  let deltaStr = "";
  if (baseline) {
    const bRuns = baseline.promptResults.reduce((sum, p) => sum + p.runs.length, 0);
    const bPasses = baseline.promptResults.reduce(
      (sum, p) => sum + Math.round(p.passRate * p.runs.length),
      0,
    );
    const bRate = bRuns === 0 ? 0 : bPasses / bRuns;
    deltaStr = ` ${deltaPct(passRate, bRate)}`;
  }
  return [
    "## Aggregate",
    "",
    `- Total runs: ${totalRuns}`,
    `- Total passes: ${totalPasses}`,
    `- Pass rate: ${fmtPct(passRate)}${deltaStr}`,
    `- Total cost: ${fmtUsd(s.totalCostUsd)}`,
    "",
  ].join("\n");
}

export function renderMarkdown(summary: EvalSummary, baseline: EvalSummary | null = null): string {
  const sections: string[] = [];
  sections.push(renderHeader(summary, baseline));

  if (summary.promptResults.length > 0) {
    sections.push("## Per-prompt results\n");
    const baseById = new Map<string, PromptAggregate>();
    if (baseline) {
      for (const bp of baseline.promptResults) baseById.set(bp.promptId, bp);
    }
    for (const p of summary.promptResults) {
      sections.push(renderPrompt(p, baseById.get(p.promptId) ?? null));
    }
  }

  sections.push(renderAggregate(summary, baseline));
  return sections.join("\n");
}

export async function loadBaseline(filePath: string): Promise<EvalSummary> {
  const text = await fs.readFile(filePath, "utf8");
  return JSON.parse(text) as EvalSummary;
}

export async function writeReport(
  resultsPath: string,
  summary: EvalSummary,
  baseline: EvalSummary | null,
): Promise<string> {
  const dir = path.dirname(resultsPath);
  const file = path.join(dir, "report.md");
  await fs.writeFile(file, renderMarkdown(summary, baseline), "utf8");
  return file;
}
