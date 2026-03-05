import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { loadEnvironment } from '../server/lib/env';
import { questions } from '@shared/schema';
import rawQuestions from '../client/src/lib/questions.json';

loadEnvironment();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error(
    'DATABASE_URL is not set. Copy .env.example to .env and provide your PostgreSQL connection string.',
  );
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: databaseUrl });
const db = drizzle({ client: pool });

const PILLAR_TAGS = new Set(['GlobalEh', 'FreshPrints', 'TimeCapsule', 'GreatOutdoors']);

interface RawQuestion {
  id: string;
  category: string;
  difficulty: string;
  question: string;
  answer: string;
  acceptableAnswers?: string[];
  explanation: string;
  tags: string[];
  sourceUrl?: string;
  sourceName?: string;
}

async function seed() {
  console.log(`Seeding ${rawQuestions.length} questions...`);

  let seeded = 0;
  let skipped = 0;

  for (const q of rawQuestions as RawQuestion[]) {
    const pillar = q.tags.find((t) => PILLAR_TAGS.has(t));
    if (!pillar) {
      console.error(`Question ${q.id} has no pillar tag in [${q.tags.join(', ')}]. Skipping.`);
      skipped++;
      continue;
    }

    const remainingTags = q.tags.filter((t) => !PILLAR_TAGS.has(t));

    await db
      .insert(questions)
      .values({
        id: q.id,
        category: q.category,
        difficulty: q.difficulty,
        question: q.question,
        answer: q.answer,
        acceptableAnswers: q.acceptableAnswers ?? [],
        explanation: q.explanation,
        pillar,
        tags: remainingTags,
        sourceUrl: q.sourceUrl ?? null,
        sourceName: q.sourceName ?? null,
      })
      .onConflictDoUpdate({
        target: questions.id,
        set: {
          category: q.category,
          difficulty: q.difficulty,
          question: q.question,
          answer: q.answer,
          acceptableAnswers: q.acceptableAnswers ?? [],
          explanation: q.explanation,
          pillar,
          tags: remainingTags,
          sourceUrl: q.sourceUrl ?? null,
          sourceName: q.sourceName ?? null,
          updatedAt: new Date(),
        },
      });

    seeded++;
  }

  console.log(`Done. Seeded: ${seeded}, Skipped: ${skipped}`);
  await pool.end();
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
