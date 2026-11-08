# Domain terms

- **Task:** A fixed browser job with inputs, permitted actions, and a success condition.
- **Strategy:** A way to execute a task or choose an executor. The initial set includes three direct execution strategies and three router strategies.
- **Direct execution strategy:** A deterministic Playwright script, Jev-guided Playwright actions, or reasoning-model-guided Playwright actions.
- **Router:** A policy that selects one direct execution strategy for a task. Initial policies are rule-based, Jev-based, and reasoning-model-based.
- **Verifier:** A task-specific check that determines whether the required browser state was reached.
- **Benchmark run:** One complete sweep of every configured strategy against the same task set.
- **Result report:** Compact, structured run metadata and per-task outcomes. It excludes raw prompts, page snapshots, and complete tool-call traces.
