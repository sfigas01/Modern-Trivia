import { mkdir, writeFile } from 'fs/promises';
import path from 'path';

import { eq } from 'drizzle-orm';

import { db, pool } from '../server/db';
import { questions } from '@shared/models/questions';
import type { Question } from '@shared/models/questions';
import {
  auditQuestionQuality,
  type QuestionQualityAuditReport,
  type QuestionQualityFinding,
} from '../server/lib/question-quality-audit';
import { detectDuplicates, type DuplicateDetectionReport } from '../server/lib/duplicate-detector';
import { batchFactCheck, type FactCheckReport } from '../server/lib/verifier';

// ---------------------------------------------------------------------------
// CLI options
// ---------------------------------------------------------------------------

type CliOptions = {
  skipFactCheck: boolean;
  skipDuplicates: boolean;
  failOnHigh: boolean;
  jsonOutputPath: string;
  markdownOutputPath: string;
};

const DEFAULT_JSON_OUTPUT_PATH = 'reports/quality-sweep-report.json';
const DEFAULT_MARKDOWN_OUTPUT_PATH = 'reports/quality-sweep-report.md';

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    skipFactCheck: false,
    skipDuplicates: false,
    failOnHigh: false,
    jsonOutputPath: DEFAULT_JSON_OUTPUT_PATH,
    markdownOutputPath: DEFAULT_MARKDOWN_OUTPUT_PATH,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--skip-fact-check') {
      options.skipFactCheck = true;
      continue;
    }
    if (arg === '--skip-duplicates') {
      options.skipDuplicates = true;
      continue;
    }
    if (arg === '--fail-on-high') {
      options.failOnHigh = true;
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
  }

  return options;
}

function absolutePathFromCwd(targetPath: string): string {
  return path.isAbsolute(targetPath) ? targetPath : path.resolve(process.cwd(), targetPath);
}

async function writeOutput(filePath: string, content: string): Promise<void> {
  const resolved = absolutePathFromCwd(filePath);
  await mkdir(path.dirname(resolved), { recursive: true });
  await writeFile(resolved, content, 'utf8');
}

// ---------------------------------------------------------------------------
// Type adapter: Question → shape expected by auditQuestionQuality
// ---------------------------------------------------------------------------

function toAuditShape(q: Question) {
  return {
    id: q.id,
    category: q.category,
    difficulty: q.difficulty,
    question: q.question,
    answer: q.answer,
    acceptableAnswers: q.acceptableAnswers ?? [],
    explanation: q.explanation,
    tags: q.tags ?? [],
    sourceUrl: q.sourceUrl ?? undefined,
    sourceName: q.sourceName ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Markdown report builder
// ---------------------------------------------------------------------------

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function truncate(text: string, max = 120): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function buildRecommendations(
  auditReport: QuestionQualityAuditReport,
  duplicateReport: DuplicateDetectionReport | null,
  factCheckReport: FactCheckReport | null
): string[] {
  const recs: string[] = [];

  if (auditReport.findingsBySeverity.high > 0) {
    recs.push(
      `${auditReport.findingsBySeverity.high} high-severity static findings — fix before next release.`
    );
  }
  if (auditReport.findingsBySeverity.medium > 0) {
    recs.push(
      `${auditReport.findingsBySeverity.medium} medium-severity static findings — review and improve.`
    );
  }

  if (duplicateReport) {
    const total = duplicateReport.duplicatesFound.length;
    if (total > 0) {
      recs.push(
        `${total} duplicate pair(s) found (${duplicateReport.duplicatesByType.exact} exact, ` +
          `${duplicateReport.duplicatesByType.near_duplicate} near-duplicate, ` +
          `${duplicateReport.duplicatesByType.conceptual} conceptual) — ` +
          `recommend removing the lower-quality version of each pair.`
      );
    }
  }

  if (factCheckReport) {
    const failures = factCheckReport.results.filter((r) => r.verdict === 'fail').length;
    const flags = factCheckReport.results.filter((r) => r.verdict === 'flag').length;
    if (failures > 0) recs.push(`${failures} question(s) failed fact-check — review immediately.`);
    if (flags > 0)
      recs.push(`${flags} question(s) flagged by fact-check — verify before next release.`);
  }

  if (recs.length === 0) {
    recs.push('No critical issues found. All approved questions passed the sweep.');
  }

  return recs;
}

function buildMarkdownReport(
  generatedAt: string,
  allQuestions: Question[],
  auditReport: QuestionQualityAuditReport,
  duplicateReport: DuplicateDetectionReport | null,
  factCheckReport: FactCheckReport | null
): string {
  const lines: string[] = [];

  lines.push('# Quality Sweep Report');
  lines.push('');
  lines.push(`Generated: ${generatedAt}`);
  lines.push('');

  // --- Summary ---
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Questions scanned: ${allQuestions.length}`);
  lines.push(`- Static findings (high): ${auditReport.findingsBySeverity.high}`);
  lines.push(`- Static findings (medium): ${auditReport.findingsBySeverity.medium}`);
  lines.push(`- Static findings (low): ${auditReport.findingsBySeverity.low}`);
  if (duplicateReport) {
    lines.push(`- Duplicate pairs found: ${duplicateReport.duplicatesFound.length}`);
  } else {
    lines.push('- Duplicate detection: skipped');
  }
  if (factCheckReport) {
    const failed = factCheckReport.results.filter((r) => r.verdict === 'fail').length;
    const flagged = factCheckReport.results.filter((r) => r.verdict === 'flag').length;
    lines.push(`- Fact-check failures: ${failed}`);
    lines.push(`- Fact-check flags: ${flagged}`);
  } else {
    lines.push('- Fact-check: skipped');
  }
  lines.push('');

  // --- Recommendations ---
  lines.push('## Recommendations');
  lines.push('');
  const recs = buildRecommendations(auditReport, duplicateReport, factCheckReport);
  for (const rec of recs) {
    lines.push(`- ${rec}`);
  }
  lines.push('');

  // --- Duplicates ---
  lines.push('## Duplicates');
  lines.push('');
  if (!duplicateReport) {
    lines.push('_Duplicate detection was skipped._');
    lines.push('');
  } else if (duplicateReport.duplicatesFound.length === 0) {
    lines.push('No duplicates found.');
    lines.push('');
  } else {
    lines.push(
      `${duplicateReport.duplicatesFound.length} pair(s) found across ${duplicateReport.totalPairsChecked} pair(s) checked.`
    );
    lines.push('');
    lines.push(
      '| Type | Score | ID A | ID B | Question A | Question B | Answer A | Answer B | AI Reasoning |'
    );
    lines.push('| --- | ---: | --- | --- | --- | --- | --- | --- | --- |');

    for (const match of duplicateReport.duplicatesFound) {
      const reasoning = match.aiReasoning ? escapeCell(truncate(match.aiReasoning, 80)) : '—';
      lines.push(
        `| ${match.matchType} | ${match.similarityScore.toFixed(2)} | ${match.questionIdA} | ${match.questionIdB} | ${escapeCell(truncate(match.questionTextA))} | ${escapeCell(truncate(match.questionTextB))} | ${escapeCell(match.answerA)} | ${escapeCell(match.answerB)} | ${reasoning} |`
      );
    }
    lines.push('');
  }

  // --- Static Audit Findings ---
  lines.push('## Static Audit Findings');
  lines.push('');
  if (auditReport.findings.length === 0) {
    lines.push('No static audit findings.');
    lines.push('');
  } else {
    for (const severity of ['high', 'medium', 'low'] as const) {
      const group = auditReport.findings.filter((f) => f.severity === severity);
      if (group.length === 0) continue;

      lines.push(`### ${severity.charAt(0).toUpperCase() + severity.slice(1)} (${group.length})`);
      lines.push('');
      lines.push('| Question ID | Index | Rule | Message |');
      lines.push('| --- | ---: | --- | --- |');

      for (const finding of group) {
        lines.push(
          `| ${escapeCell(finding.questionId)} | ${finding.questionIndex} | ${finding.rule} | ${escapeCell(finding.message)} |`
        );
      }
      lines.push('');
    }
  }

  // --- Fact-Check Results ---
  lines.push('## Fact-Check Results');
  lines.push('');
  if (!factCheckReport) {
    lines.push('_Fact-checking was skipped._');
    lines.push('');
  } else {
    const actionable = factCheckReport.results.filter(
      (r) => r.verdict === 'flag' || r.verdict === 'fail'
    );
    if (actionable.length === 0) {
      lines.push('All questions passed fact-check.');
      lines.push('');
    } else {
      lines.push(`${actionable.length} question(s) require attention:`);
      lines.push('');
      lines.push('| Question ID | Verdict | Confidence | Reason |');
      lines.push('| --- | --- | ---: | --- |');

      for (const result of actionable) {
        lines.push(
          `| ${result.questionId} | ${result.verdict} | ${result.confidence} | ${escapeCell(truncate(result.reason))} |`
        );
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Report JSON shape
// ---------------------------------------------------------------------------

interface SweepReport {
  generatedAt: string;
  totalQuestionsScanned: number;
  staticAudit: QuestionQualityAuditReport;
  duplicates: DuplicateDetectionReport | null;
  factCheck: FactCheckReport | null;
  findingsSummary: {
    highSeverityStatic: number;
    mediumSeverityStatic: number;
    lowSeverityStatic: number;
    duplicatePairs: number;
    factCheckFailed: number;
    factCheckFlagged: number;
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const generatedAt = new Date().toISOString();

  // 1. Query approved questions from DB
  console.log('Querying approved questions from database…');
  const rows = await db.select().from(questions).where(eq(questions.status, 'approved'));
  console.log(`Found ${rows.length} approved question(s).`);

  if (rows.length === 0) {
    console.warn('No approved questions found. Exiting.');
    await pool.end();
    return;
  }

  // 2. Static audit
  console.log('Running static quality audit…');
  const auditReport = auditQuestionQuality(rows.map(toAuditShape));
  console.log(
    `Static audit complete: ${auditReport.totalFindings} finding(s) ` +
      `(high: ${auditReport.findingsBySeverity.high}, medium: ${auditReport.findingsBySeverity.medium}, ` +
      `low: ${auditReport.findingsBySeverity.low})`
  );

  // 3. Duplicate detection
  let duplicateReport: DuplicateDetectionReport | null = null;
  if (!options.skipDuplicates) {
    console.log('Running duplicate detection…');
    duplicateReport = await detectDuplicates(rows);
    console.log(
      `Duplicate detection complete: ${duplicateReport.duplicatesFound.length} pair(s) found ` +
        `across ${duplicateReport.totalPairsChecked} pair(s) checked.`
    );
  } else {
    console.log('Skipping duplicate detection (--skip-duplicates).');
  }

  // 4. Fact-checking
  let factCheckReport: FactCheckReport | null = null;
  if (!options.skipFactCheck) {
    console.log('Running batch fact-check via GPT-4o…');
    factCheckReport = await batchFactCheck(rows);
    const failed = factCheckReport.results.filter((r) => r.verdict === 'fail').length;
    const flagged = factCheckReport.results.filter((r) => r.verdict === 'flag').length;
    console.log(`Fact-check complete: ${failed} fail(s), ${flagged} flag(s).`);
  } else {
    console.log('Skipping fact-check (--skip-fact-check).');
  }

  // 5. Build combined report
  const sweepReport: SweepReport = {
    generatedAt,
    totalQuestionsScanned: rows.length,
    staticAudit: auditReport,
    duplicates: duplicateReport,
    factCheck: factCheckReport,
    findingsSummary: {
      highSeverityStatic: auditReport.findingsBySeverity.high,
      mediumSeverityStatic: auditReport.findingsBySeverity.medium,
      lowSeverityStatic: auditReport.findingsBySeverity.low,
      duplicatePairs: duplicateReport?.duplicatesFound.length ?? 0,
      factCheckFailed: factCheckReport?.results.filter((r) => r.verdict === 'fail').length ?? 0,
      factCheckFlagged: factCheckReport?.results.filter((r) => r.verdict === 'flag').length ?? 0,
    },
  };

  // 6. Write reports
  await writeOutput(options.jsonOutputPath, `${JSON.stringify(sweepReport, null, 2)}\n`);
  await writeOutput(
    options.markdownOutputPath,
    buildMarkdownReport(generatedAt, rows, auditReport, duplicateReport, factCheckReport)
  );

  console.log(`JSON report:     ${absolutePathFromCwd(options.jsonOutputPath)}`);
  console.log(`Markdown report: ${absolutePathFromCwd(options.markdownOutputPath)}`);

  await pool.end();

  // 7. Fail-on-high exit code
  if (options.failOnHigh && auditReport.findingsBySeverity.high > 0) {
    throw new Error(
      `Quality sweep exceeded fail threshold: ${auditReport.findingsBySeverity.high} high-severity finding(s).`
    );
  }
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Quality sweep failed: ${message}`);
  if (error instanceof Error && error.stack) {
    console.error(error.stack);
  }
  if (error instanceof Error && error.cause) {
    console.error('Caused by:', error.cause);
  }
  process.exit(1);
});
