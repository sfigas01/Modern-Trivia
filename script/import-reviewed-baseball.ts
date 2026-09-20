import { reviewedBaseballQuestions } from '../server/content/baseball-reviewed';
import { auditQuestionQuality } from '../server/lib/question-quality-audit';
import { hasCurrentSourceReview } from '../server/lib/source-review';
import { questions } from '@shared/schema';
import { inArray } from 'drizzle-orm';

// No DB connection in dry-run mode. --apply is an explicit content import.
// Existing IDs are preserved, including administrator withdrawals/edits.
async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--apply'))
    throw new Error('Usage: npx tsx script/import-reviewed-baseball.ts [--apply]');
  const pack = reviewedBaseballQuestions();
  const high = auditQuestionQuality(pack).findings.filter((f) => f.severity === 'high');
  if (pack.length !== 40 || high.length || !pack.every(hasCurrentSourceReview))
    throw new Error('Reviewed pack failed validation');
  console.info(
    `Reviewed baseball pack: ${pack.length} questions; ${high.length} high QA findings. Answers omitted.`
  );
  if (!args.includes('--apply')) {
    console.info('Dry run only. Use --apply against the intended database to import missing IDs.');
    return;
  }
  const { db, pool } = await import('../server/db');
  try {
    const inserted = await db.transaction(async (tx) => {
      // All or nothing for missing rows; never overwrite existing questions.
      return tx
        .insert(questions)
        .values(pack)
        .onConflictDoNothing()
        .returning({ id: questions.id });
    });
    const saved = await db
      .select()
      .from(questions)
      .where(
        inArray(
          questions.id,
          pack.map((q) => q.id!)
        )
      );
    const ready = saved.filter((q) => q.status === 'approved' && hasCurrentSourceReview(q)).length;
    console.info(
      `Imported ${inserted.length}; preserved ${40 - inserted.length} existing IDs; ${ready}/40 retain approved source-reviewed content.`
    );
    if (ready !== 40) {
      console.error(
        'The pack is incomplete: review existing withdrawn or edited rows in the admin UI. No existing rows were changed.'
      );
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}
void main().catch((error) => {
  console.error(
    'Reviewed pack import failed:',
    error instanceof Error ? error.message : 'Unknown error'
  );
  process.exitCode = 1;
});
