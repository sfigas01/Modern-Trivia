import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  loadThemeEvaluationFixture,
  runThemeEvaluation,
  validateFixture,
} from '../server/lib/theme-evaluation';

function option(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : (process.argv[index + 1] ?? fallback);
}

const input = path.resolve(option('--input', 'test/fixtures/theme-evaluation/contract-v1.json'));
const output = path.resolve(option('--json', 'reports/theme-evaluation.json'));
const partitionValue = option('--partition', 'holdout');
if (partitionValue !== 'tuning' && partitionValue !== 'holdout')
  throw new Error('--partition must be tuning or holdout');
const partition = partitionValue;
const fixture = await loadThemeEvaluationFixture(input, partition);
const problems = validateFixture(fixture);
if (problems.length > 0) throw new Error(problems.join('\n'));
const report = await runThemeEvaluation(fixture);
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(
  JSON.stringify(
    {
      fixtureId: report.fixtureId,
      partition: report.partition,
      schemaValidation: report.schemaValidation,
      detector: report.detector,
      coverageGaps: report.coverageGaps.length,
    },
    null,
    2
  )
);
if (report.schemaValidation.failed > 0) process.exitCode = 1;
