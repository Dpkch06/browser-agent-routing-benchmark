# Project plan

## Goal

Build a clean, independent benchmark that compares direct browser execution strategies and routing policies against the same tasks. Keep it small enough to run with limited model credits and broad enough to compare at least four strategy types.

## Decisions

- Rebuild the project cleanly. Treat the prior Torque project only as a conceptual reference. Do not copy its code or company material.
- Use two existing practice sites rather than building a custom target website: Playwright TodoMVC and The Internet.
- Use two small tasks, one per site. The initial task candidates are adding and completing a TodoMVC item, and completing a practice login flow on The Internet. The implementation issue must pin exact inputs and success checks before the matrix runner ships.
- Compare three direct execution strategies: deterministic Playwright, Jev-guided Playwright, and reasoning-model-guided Playwright.
- Compare three routers: rule-based, Jev-based, and reasoning-model-based. Each selects one of the three direct strategies.
- Run every configured strategy against the same tasks and shared task verifiers.
- Use Playwright for the first version. Stagehand is out of scope.
- Save one compact JSON report per explicit benchmark run under benchmarks/results. Ignore generated reports and keep one sample report in Git.
- Do not save raw prompts, page snapshots, or full tool-call traces.
- Perform one full benchmark sweep. Repeat a paid sweep only if a defect invalidates its results. A strategy may make the model calls it needs within that sweep.
- Keep paid model calls and live-site requirements out of routine tests.

## Test seams

- Unit-test routing decisions with fixed task metadata and fake strategy outcomes.
- Unit-test each task verifier against controlled observed state.
- Unit-test report serialization without browser or model dependencies.
- Use one explicit browser smoke run for each task definition, then one explicit paid matrix sweep for benchmark evidence.

## Issue graph

1. Define the benchmark contract and project structure.
2. Implement task definitions and shared verification. Blocked by 1.
3. Implement direct strategies and routers. Blocked by 1.
4. Build the matrix runner and result writer. Blocked by 2 and 3.
5. Build the dashboard for saved reports. Blocked by 4.
6. Document setup and the demo workflow. Blocked by 1 and 4.

## Ask Matt workflow

Use domain modeling while fixing vocabulary and decisions, to-spec for the buildable specification, and to-tickets for the issue graph. Implement blockers first with the implement-spec flow where parallel work is safe. Each implementation ticket should use TDD at its declared seams. Close the build with code-review and retro.
