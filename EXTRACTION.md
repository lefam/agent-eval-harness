# Extraction notes

The runner, reports, configuration, case parsing, metrics and canvas runtime checker came from Loop's evaluation package.

For this standalone version:

- Replaced private agent imports with a `runOne` adapter and caller-supplied pricing.
- Added handwritten demo fixtures and tests for the adapter boundary.
- Tightened failure handling, partial-result persistence and unknown-cost reporting.

Loop's generation agent, tools, product prompts, scaffolds, UI, backend, deployment files and run history are not included. Browser capture and model-based grading also remain private because they depend on those components.

The demonstration programs are new fixtures. The original product source was not modified.
