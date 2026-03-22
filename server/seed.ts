import { db } from './db';
import { questions } from '@shared/schema';
import { count } from 'drizzle-orm';
import seedData from './seed-data.json';

function log(msg: string) {
  const t = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
  console.log(`${t} [seed] ${msg}`);
}

export async function seedIfEmpty(): Promise<void> {
  try {
    const [{ value: total }] = await db.select({ value: count() }).from(questions);
    if (total > 0) {
      log(`Database already has ${total} questions — skipping seed`);
      return;
    }

    log(`Database is empty — seeding ${seedData.length} questions…`);

    const BATCH = 50;
    let inserted = 0;

    for (let i = 0; i < seedData.length; i += BATCH) {
      const batch = (seedData as any[]).slice(i, i + BATCH).map((q: any) => ({
        id: q.id,
        category: q.category,
        difficulty: q.difficulty as 'Easy' | 'Medium' | 'Hard',
        question: q.question,
        answer: q.answer,
        acceptableAnswers: q.acceptableAnswers ?? [],
        explanation: q.explanation,
        pillar: q.pillar,
        tags: q.tags ?? [],
        sourceUrl: q.sourceUrl ?? null,
        sourceName: q.sourceName ?? null,
        status: q.status ?? 'approved',
        aiAnalysis: q.aiAnalysis ?? null,
        createdAt: q.createdAt ? new Date(q.createdAt) : new Date(),
        updatedAt: q.updatedAt ? new Date(q.updatedAt) : new Date(),
      }));

      await db.insert(questions).values(batch).onConflictDoNothing();
      inserted += batch.length;
    }

    log(`Seed complete — inserted ${inserted} questions`);
  } catch (err) {
    log(`Seed error: ${err}`);
  }
}
