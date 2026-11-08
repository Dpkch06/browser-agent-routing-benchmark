import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import * as z from 'zod';
import { practiceTasks } from '../tasks/registry.js';
import { createStrategySuite } from '../strategies/index.js';
import { createProvidersFromEnvironment, getProviderConfigurationIssues, parseProviderEnvironment } from '../runner/configuration.js';
import { PlaywrightBrowserFactory } from '../runner/browser-factory.js';
import { runMatrix } from '../runner/matrix.js';
import { createPlaygroundServer } from './server.js';

const require = createRequire(import.meta.url);

async function main(): Promise<void> {
  const port = parsePort(process.env.PLAYGROUND_PORT);
  const server = await createPlaygroundServer({
    host: '127.0.0.1',
    port,
    reportDirectory: resolve(process.cwd(), 'benchmarks/results'),
    staticDirectory: resolve(process.cwd(), 'playground'),
    checkConfiguration: () => { parseProviderEnvironment(process.env); },
    getRequiredSettings: () => getProviderConfigurationIssues(process.env),
    runner: async ({ onCellStart, onCellComplete }) => {
      const providers = createProvidersFromEnvironment(process.env);
      const packageMetadata: unknown = require('playwright/package.json');
      const { version: playwrightVersion } = z.object({ version: z.string().trim().min(1) }).parse(packageMetadata);
      const suite = createStrategySuite(providers);
      const browser = await chromium.launch({ headless: true });
      try {
        return await runMatrix({
          browserFactory: new PlaywrightBrowserFactory({ browser, playwrightVersion }),
          tasks: practiceTasks,
          suite,
          reportDir: resolve(process.cwd(), 'benchmarks/results'),
          onCellStart,
          onCellComplete,
        });
      } finally {
        await browser.close();
      }
    },
  });

  process.stdout.write('Browser strategy lab is available at ' + server.url + '\n');
  const shutdown = (): void => {
    void server.close().then(
      () => { process.exitCode = 0; },
      () => { process.exitCode = 1; },
    );
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

function parsePort(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return 4173;
  const parsed = z.coerce.number().int().min(1).max(65_535).safeParse(value);
  if (!parsed.success) throw new Error('PLAYGROUND_PORT must be an integer from 1 to 65535.');
  return parsed.data;
}

void main().catch(() => {
  process.stderr.write('Playground server failed. Check provider settings, port availability, and local browser setup.\n');
  process.exitCode = 1;
});
