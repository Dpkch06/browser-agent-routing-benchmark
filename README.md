# Browser agent routing benchmark

A standalone project for comparing browser automation strategies and routing policies on the same practice-site tasks.

## What it compares

The first version runs six approaches against the same task definitions and verifiers:

1. A deterministic Playwright script.
2. Jev-guided actions through Playwright.
3. Reasoning-model-guided actions through Playwright.
4. A rule-based router that selects one of those approaches.
5. A Jev-based router that selects one of those approaches.
6. A reasoning-model router that selects one of those approaches.

The first version uses Playwright only. It does not include Stagehand.

## Benchmark shape

Use two practice-site tasks, one full matrix sweep, and one shared verifier per task. Keep routine checks local and deterministic. Run paid model evaluations only during an explicit benchmark run. Save a compact JSON report under benchmarks/results. Generated reports stay out of Git; the repository will include one sample report.

## Development status

The initial setup and issue plan are in docs/plan.md. Read AGENTS.md and the linked domain and tracker docs before making changes.

## Local development

Use Node.js 24 or newer.

```sh
npm install
npx playwright install chromium
npm test
npm run typecheck
npm run build
```

These checks use local fixtures and do not call model APIs or practice sites. Live browser and model runs will use separate explicit commands.
