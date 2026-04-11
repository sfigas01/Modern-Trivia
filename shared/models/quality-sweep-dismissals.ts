import { sql } from 'drizzle-orm';
import { pgTable, varchar, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

import { questions } from './questions';

// Tracks quality-sweep findings that an admin has explicitly dismissed
// (i.e. "Accept" — the finding is a false positive). Future sweep runs
// filter out any finding whose (questionId, findingType, findingKey) tuple
// matches a row here.
export const questionQualitySweepDismissals = pgTable(
  'question_quality_sweep_dismissals',
  {
    id: varchar('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    questionId: varchar('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    // 'static' | 'duplicate' | 'fact_check'
    findingType: varchar('finding_type', { length: 20 }).notNull(),
    // For static: the rule name. For duplicate: sorted "{minId}::{maxId}".
    // For fact_check: the literal "fact_check".
    findingKey: text('finding_key').notNull(),
    dismissedAt: timestamp('dismissed_at').notNull().defaultNow(),
    dismissedBy: varchar('dismissed_by'),
    reason: text('reason'),
  },
  (table) => [
    uniqueIndex('idx_qsd_unique').on(table.questionId, table.findingType, table.findingKey),
  ]
);

export type QualitySweepDismissal = typeof questionQualitySweepDismissals.$inferSelect;
export type InsertQualitySweepDismissal = typeof questionQualitySweepDismissals.$inferInsert;
