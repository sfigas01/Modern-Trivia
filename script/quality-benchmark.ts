import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

import {
  LABEL_REGISTRY,
  runBenchmark,
  validateCases,
  type BenchmarkCase,
  type BenchmarkReport,
} from '../server/lib/quality-benchmark';

type CliOptions = {
  inputPath: string;
  jsonOutputPath: string;
  markdownOutputPath: string;
  runLive: boolean;
  failUnder: number;
};

const DEFAULT_INPUT_PATH = 'test/fixtures/benchmark/cases.json';
const DEFAULT_JSON_OUTPUT_PATH = 'reports/quality-benchmark.json';
const DEFAULT_MARKDOWN_OUTPUT_PATH = 'reports/quality-benchmark.md';
const DEFAULT_FAIL_UNDER = 0.95;

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    inputPath: DEFAULT_INPUT_PATH,
    jsonOutputPath: DEFAULT_JSON_OUTPUT_PATH,
    markdownOutputPath: DEFAULT_MARKDOWN_OUTPUT_PATH,
    runLive: false,
    failUnder: DEFAULT_FAIL_UNDER,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--live') {
      options.runLive = true;
      continue;
    }
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

function pct(value: number | null): string {
  return value === null ? '  n/a' : `${(value * 100).toFixed(1)}%`;
}

function printReport(report: BenchmarkReport): void {
  console.log('');
  console.log('Guardian quality-engine benchmark');
  console.log('=================================');
  console.log(`Cases:            ${report.totalCases}`);
  console.log(`Live checks:      ${report.ranLive ? 'yes' : 'no (static only)'}`);
  console.log(
    `Overall accuracy: ${pct(report.overallAccuracy)} (${report.activeCellsAgreed}/${report.activeCellsTotal} active cells agree)`
  );
  console.log('');

  console.log('Per failure mode (active detectors):');
  console.log('  mode                 tier    support  precision  recall  accuracy');
  console.log('  -------------------- ------  -------  ---------  ------  --------');
  for (const metric of report.labels) {
    if (!metric.active) continue;
    console.log(
      `  ${metric.label.padEnd(20)} ${metric.tier.padEnd(6)} ${String(metric.support).padStart(7)}  ${pct(
        metric.precision
      ).padStart(9)}  ${pct(metric.recall).padStart(6)}  ${pct(metric.accuracy).padStart(8)}`
    );
  }

  const failures = report.cases.filter((c) => !c.passed);
  console.log('');
  if (failures.length === 0) {
    console.log('All active-detector cases agree with their expected labels. ✔');
  } else {
    console.log(`Mismatches (${failures.length}):`);
    for (const c of failures) {
      console.log(`  ✖ ${c.id}`);
      console.log(`      expected: [${c.expected.join(', ')}]`);
      console.log(`      detected: [${c.detected.join(', ')}]`);
      console.log(`      disagree: [${c.mismatches.join(', ')}]`);
    }
  }

  if (report.pendingCoverage.length > 0) {
    console.log('');
    console.log('Coverage gaps (fixtures ready, detector not active in this run):');
    for (const gap of report.pendingCoverage) {
      const owner = gap.ownerTicket ? ` — owner ${gap.ownerTicket}` : '';
      const reason = gap.tier === 'live' ? ' (run with --live)' : '';
      console.log(
        `  • ${gap.label}: ${gap.casesAwaiting} case(s) awaiting a detector${owner}${reason}`
      );
    }
  }
  console.log('');
}

function buildMarkdownReport(report: BenchmarkReport): string {
  const lines: string[] = [];
  lines.push('# Guardian Quality-Engine Benchmark');
  lines.push('');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Cases: ${report.totalCases}`);
  lines.push(`- Live checks: ${report.ranLive ? 'yes' : 'no (static only)'}`);
  lines.push(
    `- Overall accuracy: ${pct(report.overallAccuracy)} (${report.activeCellsAgreed}/${report.activeCellsTotal} active cells)`
  );
  lines.push('');
  lines.push('## Per failure mode');
  lines.push('');
  lines.push('| Mode | Tier | Active | Support | Precision | Recall | Accuracy |');
  lines.push('| --- | --- | --- | ---: | ---: | ---: | ---: |');
  for (const metric of report.labels) {
    lines.push(
      `| ${metric.label} | ${metric.tier} | ${metric.active ? 'yes' : 'no'} | ${metric.support} | ${pct(
        metric.precision
      )} | ${pct(metric.recall)} | ${pct(metric.accuracy)} |`
    );
  }
  lines.push('');
  lines.push('## Coverage gaps');
  lines.push('');
  if (report.pendingCoverage.length === 0) {
    lines.push('None — every failure mode with fixtures has an active detector.');
  } else {
    lines.push('| Mode | Cases awaiting | Owner ticket | Detector meaning |');
    lines.push('| --- | ---: | --- | --- |');
    for (const gap of report.pendingCoverage) {
      lines.push(
        `| ${gap.label} | ${gap.casesAwaiting} | ${gap.ownerTicket ?? '—'} | ${LABEL_REGISTRY[gap.label].description} |`
      );
    }
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
  const cases = JSON.parse(raw) as BenchmarkCase[];

  const problems = validateCases(cases);
  if (problems.length > 0) {
    throw new Error(`Invalid benchmark fixtures:\n - ${problems.join('\n - ')}`);
  }

  const report = await runBenchmark(cases, { runLive: options.runLive });

  printReport(report);

  await writeOutput(options.jsonOutputPath, `${JSON.stringify(report, null, 2)}\n`);
  await writeOutput(options.markdownOutputPath, buildMarkdownReport(report));
  console.log(`JSON report:     ${absolutePathFromCwd(options.jsonOutputPath)}`);
  console.log(`Markdown report: ${absolutePathFromCwd(options.markdownOutputPath)}`);

  const activeMismatches = report.cases.filter((c) => !c.passed).length;
  if (report.overallAccuracy < options.failUnder) {
    throw new Error(
      `Benchmark accuracy ${pct(report.overallAccuracy)} is below the ${pct(options.failUnder)} threshold.`
    );
  }
  if (activeMismatches > 0) {
    throw new Error(`${activeMismatches} case(s) disagree with an active detector.`);
  }
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Quality benchmark failed: ${message}`);
  process.exit(1);
});
