# Build retrospective

## Outcome

The repository now contains an independent benchmark runner and local playground for comparing six Playwright strategies across two shared practice tasks. Each completed run writes a JSON report, and the repository includes a clearly marked synthetic sample.

## What worked

- Shared task definitions and independent verifiers keep the twelve comparisons consistent.
- Local tests use fixtures and fake providers, so routine checks do not spend model credits.
- Provider credentials stay in the Node process, and the playground requires explicit confirmation before a paid matrix run.
- Separate issue branches let the server, UI, and setup guide move in parallel. Integration checks caught mismatches between live progress and the UI.

## What changed during review

The first status API exposed only a completed-cell count. The UI could not show completed outcomes until the full run ended, and it could not detect missing provider settings before enabling the run button. The final API now reports safe setting names, active-cell identity, and completed cell outcomes. The UI shows those outcomes as the matrix advances.

## What remains unmeasured

No live paid benchmark has run because provider credentials are not configured. The sample report is synthetic and must not support performance claims. Results will depend on the configured models, practice-site behavior, and task set.

## Next experiment

Configure the required provider settings in the local server environment and run one full matrix from the playground. Review the saved JSON report for failures and available usage totals. Repeat a paid sweep only if a defect makes the first report invalid.
