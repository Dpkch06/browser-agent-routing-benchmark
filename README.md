# Browser agent routing benchmark

This project compares six Playwright-based execution and routing approaches on two practice-site tasks. Every approach uses the same task definition and an independent verifier. The project does not use code, data, or credentials from an employer.

## Comparison matrix

The full run contains twelve cells, one for each approach and task pair.

| Group | Approach |
|---|---|
| Direct | Deterministic Playwright |
| Direct | Jev-guided Playwright |
| Direct | Reasoning-model-guided Playwright |
| Router | Rule-based router |
| Router | Jev-based router |
| Router | Reasoning-model-based router |

The tasks are adding and completing a TodoMVC item, and signing in to The Internet's practice login page. Stagehand is outside the first version.

## Requirements and install

Use Node.js 24 or newer. From the repository root, install the dependencies and Chromium:

```sh
npm install
npx playwright install chromium
```

Run the local checks before a live experiment:

```sh
npm test
npm run typecheck
npm run build
```

These checks use local fixtures. They do not open the practice sites or call model APIs.

## Run the local playground

Start the loopback-only Node server:

```sh
npm run playground
```

Open the local URL printed by the command. The playground shows the matrix, progress for the active run, and saved reports. Select a report to inspect its results. You can inspect the sample without provider credentials. The repository includes `benchmarks/results/sample-report.json` as a synthetic example. Its sample label means it is not a measurement.

The browser asks for confirmation before it starts a paid matrix run. One run executes all twelve cells and writes a uniquely named JSON report under `benchmarks/results/`. Generated reports are ignored by Git. Each cell gets a fresh browser context, and one failure does not stop the other cells.

## Configure model providers

Set these variables in the environment of the local server process before starting the playground:

| Variable | Purpose |
|---|---|
| `TYPESAFE_API_KEY` | Key for Jev-guided execution and routing. |
| `JEV_MODEL_ID` | Jev model ID. Defaults to `jev-1.14.0`. |
| `REASONING_API_ENDPOINT` | HTTPS endpoint for the OpenAI-compatible reasoning provider. |
| `REASONING_API_KEY` | Key for the reasoning provider. |
| `REASONING_MODEL` | Reasoning model ID accepted by that endpoint. |

For PowerShell, set the values in the current terminal session:

```powershell
$env:TYPESAFE_API_KEY = "your-key"
$env:REASONING_API_ENDPOINT = "https://provider.example/v1/chat/completions"
$env:REASONING_API_KEY = "your-key"
$env:REASONING_MODEL = "your-model"
# Optional. The server defaults this to jev-1.14.0.
$env:JEV_MODEL_ID = "jev-1.14.0"
npm run playground
```

Do not commit provider keys or paste them into the browser. The playground sends only the explicit run request to the local server. The server checks configuration before it launches Chromium or makes provider calls. If configuration is missing, it reports the required setting names without returning key values.

## Read a result

Each report records its schema version, run ID, start and completion times, browser environment, and twelve task results. A result includes the task ID, direct strategy or router, the chosen direct strategy when routing succeeds, verified outcome or failure phase, duration, model call count, available token or cost totals, and model identity by stage. Usage totals may be absent when a provider does not return them. `usagePartial` marks a call whose usage is incomplete.

Reports do not store task instructions or inputs, credentials, raw prompts, page snapshots, or full tool traces. Compare runs only when their task IDs and result schema match. These two practice tasks support a small demonstration; they do not establish performance across other sites or tasks. No measured live run is included in the repository yet.

## Project notes

- [Project plan](docs/plan.md)
- [Benchmark specification](docs/spec.md)
- [Glossary](GLOSSARY.md)
