import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import * as z from 'zod';
import { practiceTasks } from '../tasks/registry.js';
import { createStrategySuite } from '../strategies/index.js';
import { createProvidersFromEnvironment } from './configuration.js';
import { PlaywrightBrowserFactory } from './browser-factory.js';
import { runMatrix } from './matrix.js';

const require = createRequire(import.meta.url);

async function main(): Promise<void> {
  const providers = createProvidersFromEnvironment(process.env);
  const packageMetadata: unknown = require('playwright/package.json');
  const { version: playwrightVersion } = z.object({
    version: z.string().trim().min(1),
  }).parse(packageMetadata);

  const suite = createStrategySuite(providers);
  const browser = await chromium.launch({ headless: true });
  try {
    const { filePath, report } = await runMatrix({
      browserFactory: new PlaywrightBrowserFactory({ browser, playwrightVersion }),
      tasks: practiceTasks,
      suite,
      reportDir: resolve(process.cwd(), 'benchmarks/results'),
    });
    const succeeded = report.results.filter((result) => result.outcome.status === 'succeeded').length;
    process.stdout.write('Saved ' + filePath + '\n');
    process.stdout.write('Verified ' + succeeded + ' of ' + report.results.length + ' matrix cells.\n');
  } finally {
    await browser.close();
  }
}

void main().catch(() => {
  process.stderr.write('Benchmark runner failed. Check required provider settings, browser setup, and the saved report if one was produced.\n');
  process.exitCode = 1;
});
