import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { benchmarkReportSchema, type BenchmarkReport } from '../domain/schema.js';

export async function saveBenchmarkReport(args: {
  report: BenchmarkReport;
  outputDirectory: string;
}): Promise<string> {
  const report = benchmarkReportSchema.parse(args.report);
  await mkdir(args.outputDirectory, { recursive: true });

  const timestamp = report.startedAt.replace(/[:.]/g, '-');
  const filePath = join(args.outputDirectory, timestamp + '-' + report.runId + '.json');
  await writeFile(filePath, JSON.stringify(report, null, 2) + '\n', {
    encoding: 'utf8',
    flag: 'wx',
  });
  return filePath;
}
