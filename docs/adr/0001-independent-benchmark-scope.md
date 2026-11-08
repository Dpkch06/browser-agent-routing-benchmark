# Decision 0001: independent benchmark scope

## Status

Accepted

## Decision

Create a clean, independent browser-agent benchmark. Use Playwright as the only browser controller in version one. Compare three direct execution strategies and three policies that route tasks to those strategies. Run them against the same two practice-site tasks and verifiers.

## Context

The prior browser benchmark and dashboard can inform the product shape, but the new repository must stand on its own. The initial project should measure both how an agent executes a browser task and when a router should select a more or less capable execution strategy.

## Consequences

The first version will not compare browser controller libraries such as Stagehand and Playwright. It will focus on execution and routing behavior. The task definitions and compact result schema must be shared across the six approaches so the comparison remains consistent.
