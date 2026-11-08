# Agent instructions

Read the relevant GitHub issue and docs/plan.md before changing code. Keep the repository independent of employer code, names, credentials, and datasets.

Use the same task input and verifier for every strategy in a comparison. Add tests at the routing, task verification, and result serialization seams. Routine tests must not call paid model APIs or external websites.

A benchmark run is explicit. Store its compact result JSON under benchmarks/results, but do not commit generated runs. Commit only the maintained sample report. Do not save raw prompts, page snapshots, or full tool-call traces.

Keep provider credentials in environment variables. Do not print them or include them in reports. Do not add Stagehand to the first version.
