import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

import {
  auditQuestionQuality,
  formatQuestionQualitySummary,
} from '../server/lib/question-quality-audit';

type CliOptions = {
  inputPath: string;
  jsonOutputPath: string;
  markdownOutputPath: string;
  failOnHigh: boolean;
  failOnMedium: boolean;
};

const DEFAULT_INPUT_PATH = 'client/src/lib/questions.json';
const DEFAULT_JSON_OUTPUT_PATH = 'reports/question-quality-report.json';
const DEFAULT_MARKDOWN_OUTPUT_PATH = 'reports/question-quality-report.md';

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    inputPath: DEFAULT_INPUT_PATH,
    jsonOutputPath: DEFAULT_JSON_OUTPUT_PATH,
    markdownOutputPath: DEFAULT_MARKDOWN_OUTPUT_PATH,
    failOnHigh: false,
    failOnMedium: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--input') {
      options.inputPath = argv[i + 1] ?? options.inputPath;
      i++;
      continue;
    }

    if (arg === '--json') {
      options.jsonOutputPath = argv[i + 1] ?? options.jsonOutputPath;
      i++;
      continue;
    }

    if (arg === '--markdown') {
      options.markdownOutputPath = argv[i + 1] ?? options.markdownOutputPath;
      i++;
      continue;
    }

    if (arg === '--fail-on-high') {
      options.failOnHigh = true;
      continue;
    }

    if (arg === '--fail-on-medium') {
      options.failOnMedium = true;
      continue;
    }
  }

  return options;
}

function absolutePathFromCwd(targetPath: string): string {
  return path.isAbsolute(targetPath) ? targetPath : path.resolve(process.cwd(), targetPath);
}

function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function buildMarkdownReport(report: ReturnType<typeof auditQuestionQuality>): string {
  const lines: string[] = [];

  lines.push('# Question Quality Audit Report');
  lines.push('');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Questions scanned: ${report.totalQuestions}`);
  lines.push(`- Flagged questions: ${report.flaggedQuestionCount}`);
  lines.push(`- High findings: ${report.findingsBySeverity.high}`);
  lines.push(`- Medium findings: ${report.findingsBySeverity.medium}`);
  lines.push(`- Low findings: ${report.findingsBySeverity.low}`);
  lines.push('');
  lines.push('## Findings');
  lines.push('');

  if (report.findings.length === 0) {
    lines.push('No findings.');
    lines.push('');
    return lines.join('\n');
  }

  lines.push('| Question ID | Index | Severity | Rule | Message |');
  lines.push('| --- | ---: | --- | --- | --- |');

  for (const finding of report.findings) {
    lines.push(
      `| ${escapeMarkdownCell(finding.questionId)} | ${finding.questionIndex} | ${
        finding.severity
      } | ${finding.rule} | ${escapeMarkdownCell(finding.message)} |`
    );
  }

  lines.push('');
  return lines.join('\n');
}

async function writeOutput(filePath: string, content: string) {
  const resolved = absolutePathFromCwd(filePath);
  await mkdir(path.dirname(resolved), { recursive: true });
  await writeFile(resolved, content, 'utf8');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const inputPath = absolutePathFromCwd(options.inputPath);

  const raw = await readFile(inputPath, 'utf8');
  const parsed = JSON.parse(raw);

  if (!Array.isArray(parsed)) {
    throw new Error('Questions file must contain a top-level array.');
  }

  const report = auditQuestionQuality(parsed);

  await writeOutput(options.jsonOutputPath, `${JSON.stringify(report, null, 2)}\n`);
  await writeOutput(options.markdownOutputPath, buildMarkdownReport(report));

  console.log(formatQuestionQualitySummary(report));
  console.log(`JSON report: ${absolutePathFromCwd(options.jsonOutputPath)}`);
  console.log(`Markdown report: ${absolutePathFromCwd(options.markdownOutputPath)}`);

  const shouldFailForHigh = options.failOnHigh && report.findingsBySeverity.high > 0;
  const shouldFailForMedium = options.failOnMedium && report.findingsBySeverity.medium > 0;

  if (shouldFailForHigh || shouldFailForMedium) {
    const threshold = options.failOnHigh ? 'high' : 'medium';
    throw new Error(`Question quality findings exceeded fail threshold (${threshold}).`);
  }
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Question quality audit failed: ${message}`);
  process.exit(1);
});
