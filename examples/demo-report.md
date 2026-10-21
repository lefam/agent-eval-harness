This is output from the scripted offline demonstration, not a model benchmark.

# Agent Evaluation Report

**Tag:** Offline scripted demonstration; no model calls  
**Model:** `demo/scripted`  
**Repeats:** 2  
**Started:** 2026-10-21T14:24:47.396Z  
**Finished:** 2026-10-21T14:24:47.572Z (176ms)  
**Total cost:** $0.0000  

## Per-prompt results

### `moving-marker` - 2/2 passed

- Median tool calls: 1
- Median wall time: 83ms
- Total cost: $0.0000

| repeat | finish | tools | val | smoke | cost | failure |
|---|---|---|---|---|---|---|
| 1 | "Scripted fixture checked." | 1 | OK | OK (60d) | $0.0000 |  |
| 2 | "Scripted fixture checked." | 1 | OK | OK (60d) | $0.0000 |  |

### `blank-canvas` - 0/2 passed

- Median tool calls: 1
- Median wall time: 3ms
- Total cost: $0.0000

| repeat | finish | tools | val | smoke | cost | failure |
|---|---|---|---|---|---|---|
| 1 | "Scripted fixture checked." | 1 | OK | FAIL | $0.0000 | validation_fail |
| 2 | "Scripted fixture checked." | 1 | OK | FAIL | $0.0000 | validation_fail |

## Aggregate

- Total runs: 4
- Total passes: 2
- Pass rate: 50%
- Total cost: $0.0000
