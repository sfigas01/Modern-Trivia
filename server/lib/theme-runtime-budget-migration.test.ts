import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  new URL('../../migrations/0018_theme_runtime_budget.sql', import.meta.url),
  'utf8'
);

describe('S11B runtime budget migration', () => {
  it('persists account ownership and exact dispatch identity', () => {
    expect(sql).toContain('owner_user_id');
    expect(sql).toContain('policy_fingerprint');
    expect(sql).toContain('request_fingerprint');
    expect(sql).toContain('uq_theme_job_attempts_allocation');
  });

  it('preserves accounting after lifecycle cleanup and protects identity fields', () => {
    expect(sql).toContain('fk_theme_budget_allocations_job_restrict');
    expect(sql).toContain('fk_theme_job_attempts_job_restrict');
    expect(sql).toContain('protect_theme_budget_allocation_identity');
    expect(sql).toContain('protect_theme_job_attempt_identity');
  });

  it('can retain unknown charges and record actual overages without clamping', () => {
    expect(sql).toContain("'unknown'");
    expect(sql).not.toContain('settled_micros <= reserved_micros');
    expect(sql).not.toContain('actual_cost_micros <= reserved_cost_micros');
  });

  it('uses append-only reconciliation instead of mutating an overrun charge', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS theme_budget_reconciliations');
    expect(sql).toContain('theme_budget_reconciliation_append_only');
    expect(sql).toContain("decision = 'overrun_acknowledged'");
  });
});
