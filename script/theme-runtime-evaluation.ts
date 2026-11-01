import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

import {
  buildThemeRuntimeEvaluationReport,
  createPostgresThemeRuntimeEvaluationRepository,
} from '../server/lib/theme-runtime-evaluation';

function values(name: string): string[] {
  return process.argv.flatMap((value, index) =>
    value === name && process.argv[index + 1] ? [process.argv[index + 1]] : []
  );
}

function option(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : (process.argv[index + 1] ?? fallback);
}

if (process.env.THEME_EVALUATION_ENVIRONMENT !== 'preview')
  throw new Error('THEME_EVALUATION_ENVIRONMENT must be preview');
const connectionString = process.env.THEME_EVALUATION_DATABASE_URL;
if (!connectionString) throw new Error('THEME_EVALUATION_DATABASE_URL is required');
const jobIds = values('--job');
const output = path.resolve(option('--json', 'reports/theme-runtime-evaluation.json'));
const pool = new pg.Pool({ connectionString, max: 2 });
try {
  const rows = await createPostgresThemeRuntimeEvaluationRepository(pool).load(jobIds);
  const report = buildThemeRuntimeEvaluationReport(rows);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    JSON.stringify({
      schemaVersion: report.schemaVersion,
      answerRedacted: report.answerRedacted,
      denominators: report.denominators,
      jobStatuses: report.jobStatuses,
      attemptStatuses: report.attemptStatuses,
      actualCostMicros: report.actualCostMicros,
      unresolvedReservedMicros: report.unresolvedReservedMicros,
    })
  );
} finally {
  await pool.end();
}
