import { db } from './db';
import { questions } from '@shared/schema';
import seedData from './seed-data.json';

function log(msg: string) {
  const t = new Date().toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
  console.log(`${t} [seed] ${msg}`);
}

interface SeedRecord {
  id: string;
  category: string;
  difficulty: string;
  question: string;
  answer: string;
  acceptableAnswers: string[] | null;
  explanation: string;
  pillar: string;
  tags: string[] | null;
  sourceUrl: string | null;
  sourceName: string | null;
  status: string;
  aiAnalysis: unknown;
  createdAt: string | null;
  updatedAt: string | null;
}

const typedSeedData: SeedRecord[] = seedData as SeedRecord[];

/**
 * Upserts all approved seed questions into the database.
 * Uses ON CONFLICT DO NOTHING so production-side edits are preserved.
 * Runs on every startup — new questions added to seed-data.json will be
 * inserted; existing ones (matched by id) are left untouched.
 */
export async function seedQuestions(): Promise<void> {
  try {
    log(`Upserting ${typedSeedData.length} seed questions…`);

    const BATCH = 50;
    let inserted = 0;

    for (let i = 0; i < typedSeedData.length; i += BATCH) {
      const batch = typedSeedData.slice(i, i + BATCH).map((q) => ({
        id: q.id,
        category: q.category,
        difficulty: q.difficulty as 'Easy' | 'Medium' | 'Hard',
        question: q.question,
        answer: q.answer,
        acceptableAnswers: q.acceptableAnswers ?? [],
        explanation: q.explanation,
        pillar: q.pillar as 'GlobalEh' | 'FreshPrints' | 'TimeCapsule' | 'GreatOutdoors',
        tags: q.tags ?? [],
        sourceUrl: q.sourceUrl,
        sourceName: q.sourceName,
        status: q.status as 'approved' | 'pending' | 'rejected' | 'draft',
        aiAnalysis: q.aiAnalysis,
        createdAt: q.createdAt ? new Date(q.createdAt) : new Date(),
        updatedAt: q.updatedAt ? new Date(q.updatedAt) : new Date(),
      }));

      const result = await db
        .insert(questions)
        .values(batch)
        .onConflictDoNothing()
        .returning({ id: questions.id });

      inserted += result.length;
    }

    const skipped = typedSeedData.length - inserted;
    log(`Seed complete — inserted ${inserted} new, ${skipped} already present`);
  } catch (err) {
    log(`Seed error: ${err}`);
  }
}
