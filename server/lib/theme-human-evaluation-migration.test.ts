import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

describe('owner-attended theme evaluation migration', () => {
  it('adds bounded JSON review payloads without changing existing outcomes', async () => {
    const sql = await readFile(
      new URL('../../migrations/0024_theme_question_writer_review_payload.sql', import.meta.url),
      'utf8'
    );

    expect(sql).toContain('ADD COLUMN IF NOT EXISTS writer_output jsonb');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS qa_review jsonb');
    expect(sql).toContain("jsonb_typeof(writer_output) = 'object'");
    expect(sql).toContain("jsonb_typeof(qa_review) = 'object'");
    expect(sql).not.toMatch(/DROP\s+(TABLE|COLUMN)/i);
  });
});
