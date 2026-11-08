# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Existing TypeScript and Node.js project. The playground will run locally in a browser and use the existing Node benchmark runner.

## Users

The primary user is the project developer running controlled browser-agent experiments locally, including live demonstrations.

## Product Purpose

The project compares browser execution strategies and routing policies across the same practice-site tasks. Success means a user can run the full matrix, inspect progress, and review a saved report for each run.

## Positioning

Each strategy runs against the same task definitions and independent verifiers, so results can be compared across a shared benchmark rather than separate demonstrations.

## Operating Context

The user starts the local Node server, opens the playground in a browser, configures provider credentials in the server environment, starts a benchmark run, and inspects saved JSON reports. The current task set uses TodoMVC and The Internet practice login.

## Capabilities and Constraints

- Version one compares six Playwright-based strategies and routers across two practice tasks.
- One run covers the complete task and strategy matrix and saves a JSON report under `benchmarks/results/`.
- Provider keys remain in the local server environment and never reach the browser.
- The playground binds to loopback and prevents overlapping runs.
- Generated reports may include model, routing, timing, token usage, and task outcome data. They must not include credentials, task values, raw prompts, page snapshots, or full tool traces.
- Stagehand is outside the first version.

## Evidence on Hand

The repository contains the benchmark runner, task verifiers, strategy implementations, and one sample report. Paid live benchmark measurements have not yet been recorded.

## Product Principles

- Compare approaches on the same tasks and verification rules.
- Keep routine checks deterministic and local.
- Save every run as a compact report that can be inspected later.
- Keep secrets and task values out of browser output and reports.
- Make experiment costs and model usage visible when available.
