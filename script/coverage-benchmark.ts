import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

import {
  runCoverageBenchmark,
  validateCoverageCases,
  type CoverageBenchmarkCase,
  type CoverageBenchmarkReport,
} from '../server/lib/coverage-benchmark';

/**
 * Standalone CLI for the coverage-diversity benchmark (STE-249). Deliberately separate from
 * `script/quality-benchmark.ts` (owned by Lane A / STE-26): different fixtures, different report
 * files, no shared package script — this lets Lane B validate and merge independently.
 *
 * Run with: npx tsx script/coverage-benchmark.ts
 */

type CliOptions = {
  inputPath: string;
  jsonOutputPath: string;
  markdownOutputPath: string;
  failUnder: number;
};

const DEFAULT_INPUT_PATH = 'test/fixtures/benchmark/coverage-cases.json';
const DEFAULT_JSON_OUTPUT_PATH = 'reports/coverage-benchmark.json';
const DEFAULT_MARKDOWN_OUTPUT_PATH = 'reports/coverage-benchmark.md';
const DEFAULT_FAIL_UNDER = 1;

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    inputPath: DEFAULT_INPUT_PATH,
    jsonOutputPath: DEFAULT_JSON_OUTPUT_PATH,
    markdownOutputPath: DEFAULT_MARKDOWN_OUTPUT_PATH,
    failUnder: DEFAULT_FAIL_UNDER,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--input') {
      options.inputPath = argv[++i] ?? options.inputPath;
      continue;
    }
    if (arg === '--json') {
      options.jsonOutputPath = argv[++i] ?? options.jsonOutputPath;
      continue;
    }
    if (arg === '--markdown') {
      options.markdownOutputPath = argv[++i] ?? options.markdownOutputPath;
      continue;
    }
    if (arg === '--fail-under') {
      const value = Number(argv[++i]);
      if (!Number.isNaN(value)) options.failUnder = value;
      continue;
    }
  }

  return options;
}

function absolutePathFromCwd(targetPath: string): string {
  return path.isAbsolute(targetPath) ? targetPath : path.resolve(process.cwd(), targetPath);
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function printReport(report: CoverageBenchmarkReport): void {
  console.log('');
  console.log('Coverage-planned generation benchmark (STE-249)');
  console.log('================================================');
  console.log(`Cases:            ${report.totalCases}`);
  console.log(
    `Overall accuracy: ${pct(report.overallAccuracy)} (${report.agreementCount}/${report.totalCases} agree with expected label)`
  );
  console.log('');

  for (const c of report.cases) {
    const status = c.agrees ? '✔' : '✖';
    console.log(
      `  ${status} ${c.id} — expected ${c.expectedDiverse ? 'diverse' : 'mean-reverted'}, detected ${
        c.detectedDiverse ? 'diverse' : 'mean-reverted'
      } (${pct(c.diversity.diversityRatio)}, ${c.diversity.distinctSubtopicCount}/${c.diversity.totalQuestions} distinct subtopics)`
    );
    if (c.diversity.duplicatePairs.length > 0) {
      for (const pair of c.diversity.duplicatePairs) {
        console.log(
          `      collision: ${pair.a} ~ ${pair.b} (similarity ${pair.similarity.toFixed(2)})`
        );
      }
    }
    const offStrategy = c.pillarDistribution.filter((p) => !p.withinTolerance);
    if (offStrategy.length > 0) {
      console.log(
        `      off-strategy pillars: ${offStrategy
          .map((p) => `${p.pillar} (${pct(p.actualShare)} vs target ${pct(p.targetShare)})`)
          .join(', ')}`
      );
    }
  }

  const failures = report.cases.filter((c) => !c.agrees);
  console.log('');
  if (failures.length === 0) {
    console.log('All cases agree with their expected diversity label. ✔');
  } else {
    console.log(`Disagreements (${failures.length}): ${failures.map((c) => c.id).join(', ')}`);
  }
  console.log('');
}

function buildMarkdownReport(report: CoverageBenchmarkReport): string {
  const lines: string[] = [];
  lines.push('# Coverage-Planned Generation Benchmark (STE-249)');
  lines.push('');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Cases: ${report.totalCases}`);
  lines.push(
    `- Overall accuracy: ${pct(report.overallAccuracy)} (${report.agreementCount}/${report.totalCases} agree)`
  );
  lines.push('');
  lines.push('## Cases');
  lines.push('');
  lines.push('| Case | Topic | Expected | Detected | Diversity | Distinct/Total | Agrees |');
  lines.push('| --- | --- | --- | --- | ---: | ---: | --- |');
  for (const c of report.cases) {
    lines.push(
      `| ${c.id} | ${c.topic} | ${c.expectedDiverse ? 'diverse' : 'mean-reverted'} | ${
        c.detectedDiverse ? 'diverse' : 'mean-reverted'
      } | ${pct(c.diversity.diversityRatio)} | ${c.diversity.distinctSubtopicCount}/${c.diversity.totalQuestions} | ${
        c.agrees ? 'yes' : 'no'
      } |`
    );
  }
  lines.push('');
  return lines.join('\n');
}

async function writeOutput(filePath: string, content: string): Promise<void> {
  const resolved = absolutePathFromCwd(filePath);
  await mkdir(path.dirname(resolved), { recursive: true });
  await writeFile(resolved, content, 'utf8');
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const raw = await readFile(absolutePathFromCwd(options.inputPath), 'utf8');
  const cases = JSON.parse(raw) as CoverageBenchmarkCase[];

  const problems = validateCoverageCases(cases);
  if (problems.length > 0) {
    throw new Error(`Invalid coverage benchmark fixtures:\n - ${problems.join('\n - ')}`);
  }

  const report = runCoverageBenchmark(cases);

  printReport(report);

  await writeOutput(options.jsonOutputPath, `${JSON.stringify(report, null, 2)}\n`);
  await writeOutput(options.markdownOutputPath, buildMarkdownReport(report));
  console.log(`JSON report:     ${absolutePathFromCwd(options.jsonOutputPath)}`);
  console.log(`Markdown report: ${absolutePathFromCwd(options.markdownOutputPath)}`);

  if (report.overallAccuracy < options.failUnder) {
    throw new Error(
      `Coverage benchmark accuracy ${pct(report.overallAccuracy)} is below the ${pct(options.failUnder)} threshold.`
    );
  }
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Coverage benchmark failed: ${message}`);
  process.exit(1);
});
