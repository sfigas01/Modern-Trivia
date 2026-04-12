import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
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

export function removeFromSeedData(questionId: string): boolean {
  try {
    if (!existsSync(SEED_PATH)) return false;
    const data: SeedRecord[] = JSON.parse(readFileSync(SEED_PATH, 'utf-8'));
    const before = data.length;
    const filtered = data.filter((q) => q.id !== questionId);
    if (filtered.length === before) return false;
    writeFileSync(SEED_PATH, JSON.stringify(filtered, null, 2) + '\n', 'utf-8');
    log(`Removed ${questionId} from seed-data.json (${before} → ${filtered.length})`);
    return true;
  } catch (err) {
    console.error(`[seed] Failed to remove ${questionId} from seed-data.json:`, err);
    return false;
  }
}
