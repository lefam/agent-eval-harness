# Agent evaluation harness

Run repeatable checks on agent-generated software and compare correctness, tool use, latency and estimated cost. Extracted from the evaluation tooling I built for [Loop](https://liveloop.run/).

## Run

Requires Node.js 22.17 or later.

```sh
npm ci
npm run typecheck
npm test
npm run demo
```

The demo runs two handwritten canvas programs through the evaluator: one draws, the other stays blank. Both compile. No API key or model call is needed.

Results are written to `results/<timestamp>/results.json` and `report.md`. See the [example report](examples/demo-report.md).

## Connect an agent

Pass a `runOne` adapter and model prices to `runEval`. The adapter receives the case and remaining budget, then returns validation results, tool counts, timing and token usage. [examples/demo.ts](examples/demo.ts) shows the interface.

- [runner.ts](src/runner.ts): repeated runs, pass rates, partial results and cost limits.
- [smoke.ts](src/smoke.ts): bundling and canvas runtime checks.
- [report.ts](src/report.ts): readable results and baseline comparisons.

Failures and incomplete runs stay visible in the results. Unknown pricing stops a run before execution; an adapter exception stops the sweep and marks spend as unknown.

## Limits

The smoke checker uses a DOM/canvas mock. It checks runtime behavior, not visual quality, full TypeScript typing or task completion. It is **not a security sandbox**; isolate untrusted code separately.

Prices are caller-supplied. Report disjoint input, output and cache-token counts; use custom costing for mixed-model runs. Budget limits stop later calls, but an in-flight call can exceed them.

The demo is not a model benchmark. Loop's agent and product code are excluded; [EXTRACTION.md](EXTRACTION.md) records the scope.

Copyright (c) 2026 Leonel Machava. All rights reserved.
