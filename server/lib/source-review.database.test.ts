import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { questions } from '@shared/schema';
import {
  approvedForPlaySql,
  currentSourceReviewSql,
  hasCurrentSourceReview,
} from './source-review';
import { reviewedBaseballQuestions } from '../content/baseball-reviewed';

// Opt-in, disposable PostgreSQL only. Never falls back to DATABASE_URL.
const url = process.env.THEME_REVIEW_TEST_DATABASE_URL;
describe.runIf(!!url)('source eligibility on PostgreSQL', () => {
  it('selects all 40 reviewed rows and excludes legacy AI, withdrawals and edited answers', async () => {
    const client = new pg.Client({ connectionString: url });
    const schema = `theme_${randomUUID().replaceAll('-', '')}`;
    await client.connect();
    try {
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET search_path TO ${schema}`);
      await client.query(
        `CREATE TABLE questions (id text primary key, question text, answer text, acceptable_answers jsonb, explanation text, category text, difficulty text, pillar text, tags jsonb, source_url text, source_name text, status text, origin text, ai_analysis jsonb, created_at timestamp default now(), updated_at timestamp default now())`
      );
      const db = drizzle(client);
      const pack = reviewedBaseballQuestions();
      await db.insert(questions).values(pack);
      const ready = await db.select().from(questions).where(currentSourceReviewSql);
      expect(ready).toHaveLength(40);
      // PostgreSQL jsonb reorders keys: JS review validation must still agree.
      expect(ready.every(hasCurrentSourceReview)).toBe(true);
      await db.insert(questions).values({
        ...pack[0],
        id: 'legacy-ai',
        origin: 'player_ai',
        aiAnalysis: { factCheck: { verdict: 'pass' } },
      });
      await db.execute(sql`UPDATE questions SET answer = 'changed' WHERE id = ${pack[0].id}`);
      await db.execute(sql`UPDATE questions SET status = 'pending' WHERE id = ${pack[1].id}`);
      await db.execute(
        sql`UPDATE questions SET acceptable_answers = '["wrong alias"]'::jsonb WHERE id = ${pack[2].id}`
      );
      const themed = await db
        .select()
        .from(questions)
        .where(sql`${approvedForPlaySql} AND ${currentSourceReviewSql}`);
      expect(themed).toHaveLength(37);
      const normal = await db.select().from(questions).where(approvedForPlaySql);
      expect(normal.some((q) => q.id === 'legacy-ai')).toBe(false);
      const ai = {
        ...pack[3],
        id: 'reviewed-ai',
        origin: 'player_ai' as const,
        aiAnalysis: {
          ...(pack[3].aiAnalysis as object),
          qaFindings: [],
          factCheck: {
            questionId: 'reviewed-ai',
            verdict: 'pass',
            coherence: 'pass',
            obviousness: 'pass',
          },
        },
      };
      await db.insert(questions).values(ai);
      expect(
        (await db.select().from(questions).where(approvedForPlaySql)).some((q) => q.id === ai.id)
      ).toBe(true);
      await db.execute(
        sql`UPDATE questions SET ai_analysis = jsonb_set(ai_analysis, '{factCheck,coherence}', '"flag"') WHERE id = ${ai.id}`
      );
      expect(
        (await db.select().from(questions).where(approvedForPlaySql)).some((q) => q.id === ai.id)
      ).toBe(false);
    } finally {
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await client.end();
    }
  });
});
