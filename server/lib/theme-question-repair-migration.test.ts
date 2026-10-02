import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

describe('bounded theme question repair migration', () => {
  it('installs one-child lineage, exact review bindings, and append-only outcomes', async () => {
    const sql = await readFile(
      new URL('../../migrations/0015_theme_question_repairs.sql', import.meta.url),
      'utf8'
    );

    expect(sql).toContain('uq_theme_question_generation_repair_parent');
    expect(sql).toContain('WHERE parent_candidate_id IS NOT NULL');
    expect(sql).toContain('fk_theme_question_generation_repair_parent_revision');
    expect(sql).toContain('uq_theme_question_generation_outcome_review_binding');
    expect(sql).toContain('fk_theme_question_repair_generation_outcome');
    expect(sql).toContain('fk_theme_question_repair_evidence_attempt');
    expect(sql).toContain('parent_question_content_hash IS NOT NULL');
    expect(sql).toContain('evidence_fingerprint IS NOT NULL');
    expect(sql).toContain('failure_code IS NOT NULL');
    expect(sql).toContain('repair_unchanged');
    expect(sql).toContain('theme_question_repair_outcomes_immutable');
  });
});
