import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { sql } from 'drizzle-orm';
import { db } from './db';
import { questions } from '@shared/schema';

const SEED_PATH = resolve(process.cwd(), 'server/seed-data.json');

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

function loadSeedData(): SeedRecord[] {
  if (!existsSync(SEED_PATH)) {
    log(`Seed file not found at ${SEED_PATH} — skipping seed.`);
    return [];
  }
  return JSON.parse(readFileSync(SEED_PATH, 'utf-8')) as SeedRecord[];
}

export async function seedQuestions(): Promise<void> {
  try {
    // First-run bootstrap only: if the questions table already has rows, the
    // database is the source of truth (admin-curated edits/deletes via Quality
    // Sweep, etc.). Re-seeding from seed-data.json would silently revert those
    // deletes on every boot/republish — see STE-145.
    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(questions);

    if (count > 0) {
      log(`Skipping seed — questions table already has ${count} rows.`);
      return;
    }

    const seedData = loadSeedData();
    if (seedData.length === 0) return;

    log(`Upserting ${seedData.length} seed questions…`);

    const BATCH = 50;
    let inserted = 0;

    for (let i = 0; i < seedData.length; i += BATCH) {
      const batch = seedData.slice(i, i + BATCH).map((q) => ({
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

    const skipped = seedData.length - inserted;
    log(`Seed complete — inserted ${inserted} new, ${skipped} already present`);
  } catch (err) {
    console.error('[seed] CRITICAL: Seed failed — production may have no questions.');
    console.error('[seed]', err);
  }
}
