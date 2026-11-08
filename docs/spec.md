# Benchmark specification

## Comparison matrix

The first run contains two task definitions and six approaches, for twelve task and strategy results. Each router chooses one of the three direct Playwright strategies.

| Group | Approach |
|---|---|
| Direct | Deterministic Playwright |
| Direct | Jev-guided Playwright |
| Direct | Reasoning-model-guided Playwright |
| Router | Rule-based router |
| Router | Jev-based router |
| Router | Reasoning-model-based router |

The tasks are TodoMVC add-and-complete and The Internet practice login. The task issue owns exact instructions, inputs, and success checks. Every approach receives the same task definition and inputs. The verifier checks browser state independently of the agent's completion claim.

## Result contract

A result report has schema version, run ID, UTC timestamps, browser environment details, and one result for every task and approach. Each result records the direct strategy or router, the selected direct strategy for a successful route, outcome, duration, model call count, and available token or cost totals. A route failure is a failed result with a route phase.

The report stores task IDs, not task instructions or credential inputs. It stores no prompts, page snapshots, or full tool-call traces. Provider outputs must be reduced to the selected strategy and aggregate usage before serialization.

## Runtime boundaries

- Task definitions provide ID, site, instruction, and string inputs.
- Direct strategies execute a task with Playwright.
- Routers select one direct strategy.
- A separate verifier decides whether the requested browser state was reached.
- A matrix runner captures one result per task and approach.
- The dashboard reads result reports and does not execute browsers or call models.

## Failure and repeat rules

A strategy failure is data, not a reason to stop the matrix. The runner records the failure phase and continues. Run one full matrix sweep. Repeat a paid sweep only if a defect makes the first report invalid.

## Local checks

Unit tests cover schema validation, routing decisions, task verification, and report serialization. They use fixed data and fake providers. Live websites and paid model endpoints are used only by explicit smoke or benchmark commands.
