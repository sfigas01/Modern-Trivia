import { chmod, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

import {
  buildThemeHumanEvaluationReport,
  createPostgresThemeHumanEvaluationRepository,
} from '../server/lib/theme-human-evaluation';

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
if (!process.argv.includes('--include-answers') || !process.argv.includes('--owner-review'))
  throw new Error('Explicit --include-answers and --owner-review acknowledgement is required');
const connectionString = process.env.THEME_EVALUATION_DATABASE_URL;
if (!connectionString) throw new Error('THEME_EVALUATION_DATABASE_URL is required');
const jobIds = values('--job');
const reportsRoot = path.resolve('reports');
const output = path.resolve(option('--json', 'reports/theme-human-evaluation.json'));
if (output !== reportsRoot && !output.startsWith(`${reportsRoot}${path.sep}`))
  throw new Error('Human-evaluation output must remain under the gitignored reports directory');

const pool = new pg.Pool({ connectionString, max: 2 });
try {
  const rows = await createPostgresThemeHumanEvaluationRepository(pool).load(jobIds);
  const report = buildThemeHumanEvaluationReport(rows);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  await chmod(output, 0o600);
  console.log(
    JSON.stringify({
      schemaVersion: report.schemaVersion,
      answerRedacted: report.answerRedacted,
      previewOnly: report.previewOnly,
      items: report.items.length,
      output,
    })
  );
} finally {
  await pool.end();
}
